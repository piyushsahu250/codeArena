const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { cached, invalidate } = require("../utils/cache");
const { spreadsheetFileFilter } = require("../utils/uploadFilters");
const { sendExport } = require("../utils/exportFile");
const { generateMarksheetPdf } = require("../utils/resultMarksheetPdf");
const { buildMarksheetData } = require("../utils/resultMarksheetData");
const { generateMarksheetCode } = require("../utils/resultCode");
const { notifyResultPublished } = require("../utils/notifications");
const { computeGrade, invalidateGradeCache } = require("../utils/resultGrading");
const QRCode = require("qrcode");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });

const STUDENT_SELECT = {
  id: true, name: true, rollNumber: true, registrationNumber: true, instituteId: true,
  academicGroup: { select: { batch: true, section: true, department: { select: { id: true, name: true } } } },
};
// Marksheet-only variant — profilePhotoUrl is a data URL, kept out of STUDENT_SELECT so it never
// leaks into every existing list/search/export response that spreads that constant.
const MARKSHEET_STUDENT_SELECT = { ...STUDENT_SELECT, profilePhotoUrl: true };

// ============================================================
// Shared helpers
// ============================================================

// Marks obtained is the only real input; percentage/passed are always derived from it and the
// exam's own thresholds, never entered directly — "no manual calculation required" per spec.
// `status` (PRESENT/ABSENT/EXEMPTED/NOT_APPEARED — spec section 9): for anything other than
// PRESENT there is no real mark to score, so percentage/passed here are placeholder values ONLY —
// every caller that reads them (marksheet, analytics, dashboard, exports) must check `status`
// FIRST and treat a non-PRESENT entry as "no result", never as "scored 0/failed". This deliberately
// does NOT make percentage/passed nullable in the schema (a bigger, riskier migration touching
// every existing consumer of this always-populated field) — the placeholder-plus-status-gate
// approach gets the same correctness without that.
function computeResult(obtainedMarks, exam, status = "PRESENT") {
  if (status !== "PRESENT") return { percentage: 0, passed: false };
  const percentage = exam.totalMarks > 0 ? (obtainedMarks / exam.totalMarks) * 100 : 0;
  let passed = true;
  if (exam.passingPercent != null) passed = percentage >= exam.passingPercent;
  else if (exam.passingMarks != null) passed = obtainedMarks >= exam.passingMarks;
  return { percentage: Math.round(percentage * 100) / 100, passed };
}

// ADMIN can always edit entries. STAFF/CLERK can only "assist in data preparation" — manual entry
// or bulk import — while the exam is still Draft or In Review; once it moves to Ready to Publish
// (a deliberate "frozen, about to go out" checkpoint) or beyond, only Admin may touch entries
// (matches the spec's explicit "Update Results" being an Admin-only publication action).
function canEditEntries(examination, user) {
  if (user.role === "ADMIN" || user.role === "SUPER_ADMIN" || user.role === "INSTITUTE_ADMIN") return true;
  if ((user.role === "STAFF" || user.role === "CLERK") && (examination.status === "DRAFT" || examination.status === "IN_REVIEW")) return true;
  return false;
}

// Correction audit trail (spec sections 15/16): writes one ResultEntryHistory row per changed
// field, BEFORE the update is applied, so a PUBLISHED result's marks are never silently
// overwritten with no trace. Called for every entry edit, not just post-publish ones — a full,
// unconditional history is simpler and strictly more useful than only tracking "some" changes.
async function recordEntryHistory(tx, { entryId, subjectId, changes, user, reason }) {
  if (!changes.length) return;
  await tx.resultEntryHistory.createMany({
    data: changes.map((c) => ({
      entryId, subjectId: subjectId || null, field: c.field,
      oldValue: c.oldValue == null ? null : String(c.oldValue), newValue: c.newValue == null ? null : String(c.newValue),
      changedByAdminId: user.id, changedByName: user.name, reason,
    })),
  });
}

// Optimistic-concurrency check (spec section 24): a caller who read version N must send N back;
// if the row is already at a different version, someone else saved in between. Returns null (ok)
// or an error message to send back as a 409.
function checkVersion(existingEntry, requestBody) {
  if (requestBody.version === undefined) return null; // caller didn't send one — e.g. a fresh manual-entry create path
  if (Number(requestBody.version) !== existingEntry.version) {
    return "This result was modified by another user. Please refresh before saving.";
  }
  return null;
}

async function loadExaminationScoped(req, res, id) {
  const examination = await prisma.resultExamination.findUnique({
    where: { id },
    include: { departments: { include: { department: { select: { id: true, name: true } } } }, institute: { select: { id: true, name: true, code: true, logoUrl: true, marksheetSignatories: true } } },
  });
  if (!examination) { res.status(404).json({ error: "Examination not found" }); return null; }
  if (req.requesterInstituteId && examination.instituteId !== req.requesterInstituteId) {
    res.status(403).json({ error: "You can only access examinations under your own institute" });
    return null;
  }
  return examination;
}

function serializeEntry(entry) {
  return {
    id: entry.id,
    studentId: entry.studentId,
    studentName: entry.student.name,
    rollNumber: entry.student.rollNumber,
    registrationNumber: entry.student.registrationNumber,
    department: entry.student.academicGroup?.department?.name || null,
    division: entry.student.academicGroup?.section || null,
    batch: entry.student.academicGroup?.batch || null,
    status: entry.status,
    obtainedMarks: entry.obtainedMarks,
    percentage: entry.percentage,
    passed: entry.passed,
    grade: entry.grade,
    remarks: entry.remarks,
    verificationCode: entry.verificationCode,
    source: entry.source,
    enteredByName: entry.enteredByName,
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    subjectMarks: Array.isArray(entry.subjectMarks)
      ? entry.subjectMarks.map((m) => ({ subjectId: m.subjectId, subjectName: m.subject?.name, status: m.status, obtainedMarks: m.obtainedMarks, maxMarks: m.subject?.maxMarks }))
      : undefined,
  };
}

// Included wherever an entry needs its per-subject breakdown alongside the student — kept as one
// constant so the shape can never drift between the routes that need it.
const SUBJECT_MARKS_INCLUDE = { subjectMarks: { include: { subject: { select: { id: true, name: true, maxMarks: true, order: true } } }, orderBy: { subject: { order: "asc" } } } };

// ============================================================
// Student-facing
// ============================================================

router.get("/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const entries = await prisma.resultEntry.findMany({
      where: { studentId: req.user.id, examination: { status: "PUBLISHED" } },
      include: { examination: { include: { institute: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(entries.map((e) => ({
      entryId: e.id,
      examinationId: e.examinationId,
      title: e.examination.title,
      description: e.examination.description,
      instituteName: e.examination.institute.name,
      batch: e.examination.batch,
      examDate: e.examination.examDate,
      publishedAt: e.examination.publishedAt,
      totalMarks: e.examination.totalMarks,
      status: e.status,
      obtainedMarks: e.status === "PRESENT" ? e.obtainedMarks : null,
      percentage: e.status === "PRESENT" ? e.percentage : null,
      passed: e.status === "PRESENT" ? e.passed : null,
      resultLabel: e.status === "PRESENT" ? (e.passed ? e.examination.passLabel : e.examination.failLabel) : e.status,
      grade: e.status === "PRESENT" ? e.grade : null,
      allowPdfDownload: e.examination.allowPdfDownload,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load your results" });
  }
});

// Shared ownership/publish/download-enabled gate for all three of a student's own marksheet
// surfaces (JSON preview, PDF download, QR image) — kept in one place so the three routes below
// can never drift on who's allowed to see what.
async function loadOwnMarksheetEntry(req, res, { requireDownloadEnabled }) {
  const entry = await prisma.resultEntry.findUnique({
    where: { id: req.params.entryId },
    include: { examination: { include: { institute: true } }, student: { select: MARKSHEET_STUDENT_SELECT }, ...SUBJECT_MARKS_INCLUDE },
  });
  if (!entry || entry.studentId !== req.user.id) { res.status(404).json({ error: "Result not found" }); return null; }
  if (entry.examination.status !== "PUBLISHED") { res.status(403).json({ error: "This result is not published yet" }); return null; }
  if (requireDownloadEnabled && !entry.examination.allowPdfDownload) {
    res.status(403).json({ error: "Marksheet download isn't enabled for this examination" });
    return null;
  }
  return entry;
}

router.get("/me/:entryId", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const entry = await loadOwnMarksheetEntry(req, res, { requireDownloadEnabled: false });
    if (!entry) return;
    const data = await buildMarksheetData({
      examination: entry.examination, entry, student: entry.student, institute: entry.examination.institute,
      department: entry.student.academicGroup?.department?.name, division: entry.student.academicGroup?.section,
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load marksheet" });
  }
});

router.get("/me/:entryId/qr.png", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const entry = await loadOwnMarksheetEntry(req, res, { requireDownloadEnabled: false });
    if (!entry) return;
    const data = await buildMarksheetData({
      examination: entry.examination, entry, student: entry.student, institute: entry.examination.institute,
      department: entry.student.academicGroup?.department?.name, division: entry.student.academicGroup?.section,
    });
    const buffer = await QRCode.toBuffer(data.verifyUrl, { margin: 1, width: 200 });
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

router.get("/me/:entryId/marksheet.pdf", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const entry = await loadOwnMarksheetEntry(req, res, { requireDownloadEnabled: true });
    if (!entry) return;
    const data = await buildMarksheetData({
      examination: entry.examination, entry, student: entry.student, institute: entry.examination.institute,
      department: entry.student.academicGroup?.department?.name, division: entry.student.academicGroup?.section,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="marksheet-${entry.examinationId}.pdf"`);
    await generateMarksheetPdf(data, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate marksheet" });
  }
});

// ============================================================
// Public verification (no auth) — mirrors certificates.js's GET /verify/:code exactly. Gated on
// PUBLISHED status (not just "code exists") so unpublishing a result also revokes its public
// verifiability, the same posture certificates.js takes toward a REVOKED certificate. Discloses
// only the same minimal field set certificates.js's verify route already discloses publicly — no
// PRN/roll/email/photo.
// ============================================================

router.get("/verify/:code", async (req, res) => {
  try {
    const entry = await prisma.resultEntry.findUnique({
      where: { verificationCode: req.params.code },
      include: { examination: { include: { institute: { select: { name: true } } } }, student: { select: { name: true } } },
    });
    if (!entry || entry.examination.status !== "PUBLISHED") {
      return res.json({ valid: false, error: "No published marksheet found with this ID" });
    }
    const isPresent = entry.status === "PRESENT" || entry.status === undefined;
    const STATUS_LABELS = { ABSENT: "Absent", EXEMPTED: "Exempted", NOT_APPEARED: "Not Appeared" };
    res.json({
      valid: true,
      studentName: entry.student.name,
      institute: entry.examination.institute?.name || null,
      examinationTitle: entry.examination.title,
      obtainedMarks: isPresent ? entry.obtainedMarks : null,
      totalMarks: entry.examination.totalMarks,
      percentage: isPresent ? entry.percentage : null,
      result: isPresent ? (entry.passed ? entry.examination.passLabel : entry.examination.failLabel) : STATUS_LABELS[entry.status],
      publishedAt: entry.examination.publishedAt,
      verificationCode: entry.verificationCode,
      verificationTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ valid: false, error: "Verification failed" });
  }
});

// ============================================================
// Admin: examination CRUD + publish lifecycle
// ============================================================

const EXAM_FIELDS = ["title", "description", "batch", "divisions", "semester", "examDate", "publishDate", "totalMarks", "passingMarks", "passingPercent", "passLabel", "failLabel", "allowPdfDownload", "showRank", "showClassAverage", "showAttendance", "academicGroupIds"];
function pickExamData(body) {
  const data = {};
  for (const key of EXAM_FIELDS) if (body[key] !== undefined) data[key] = body[key];
  if (data.academicGroupIds !== undefined) data.academicGroupIds = Array.isArray(data.academicGroupIds) ? data.academicGroupIds : [];
  if (data.totalMarks !== undefined) data.totalMarks = Number(data.totalMarks);
  if (data.passingMarks !== undefined) data.passingMarks = data.passingMarks === null || data.passingMarks === "" ? null : Number(data.passingMarks);
  if (data.passingPercent !== undefined) data.passingPercent = data.passingPercent === null || data.passingPercent === "" ? null : Number(data.passingPercent);
  if (data.examDate !== undefined) data.examDate = new Date(data.examDate);
  if (data.publishDate !== undefined) data.publishDate = data.publishDate ? new Date(data.publishDate) : null;
  if (data.showRank !== undefined) data.showRank = !!data.showRank;
  if (data.showClassAverage !== undefined) data.showClassAverage = !!data.showClassAverage;
  if (data.showAttendance !== undefined) data.showAttendance = !!data.showAttendance;
  return data;
}

router.get("/admin/examinations", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { status, batch, departmentId, search } = req.query;
    const where = {};
    if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
    else if (req.query.instituteId) where.instituteId = req.query.instituteId;
    if (status) where.status = status;
    if (batch) where.batch = batch;
    if (departmentId) where.departments = { some: { departmentId } };
    if (search && search.trim()) where.title = { contains: search.trim(), mode: "insensitive" };

    const examinations = await prisma.resultExamination.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        institute: { select: { id: true, name: true } },
        departments: { include: { department: { select: { id: true, name: true } } } },
        _count: { select: { entries: true } },
      },
    });
    res.json(examinations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load examinations" });
  }
});

router.post("/admin/examinations", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { instituteId, departmentIds, visibility } = req.body;
    const effectiveInstituteId = req.requesterInstituteId || instituteId;
    if (!effectiveInstituteId) return res.status(400).json({ error: "Institute is required" });

    const data = pickExamData(req.body);
    if (!data.title || !data.title.trim()) return res.status(400).json({ error: "A title is required" });
    if (!data.examDate) return res.status(400).json({ error: "Examination date is required" });
    if (!data.totalMarks || data.totalMarks <= 0) return res.status(400).json({ error: "Total marks must be greater than 0" });
    if (data.passingMarks == null && data.passingPercent == null) {
      return res.status(400).json({ error: "Provide either Passing Marks or Passing Percentage" });
    }

    const status = visibility === "PUBLISH_NOW" ? "PUBLISHED" : "DRAFT"; // PUBLISH_LATER and SAVE_DRAFT both start as Draft — Publish Later just records a target date, admin still clicks Publish
    const examination = await prisma.resultExamination.create({
      data: {
        ...data,
        instituteId: effectiveInstituteId,
        status,
        publishedAt: status === "PUBLISHED" ? new Date() : null,
        createdByAdminId: req.user.id,
        createdByName: req.user.name,
        departments: Array.isArray(departmentIds) && departmentIds.length
          ? { create: departmentIds.map((departmentId) => ({ departmentId })) }
          : undefined,
      },
      include: { departments: { include: { department: { select: { id: true, name: true } } } } },
    });

    await logAudit({
      req, action: AUDIT_ACTIONS.RESULT_EXAMINATION_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: effectiveInstituteId, details: { examinationId: examination.id, title: examination.title, status },
    });
    res.json(examination);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create examination" });
  }
});

router.get("/admin/examinations/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    res.json({ ...examination, canEdit: canEditEntries(examination, req.user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load examination" });
  }
});

// Editing thresholds (totalMarks/passingMarks/passingPercent) recomputes every existing entry's
// percentage/passed inside a transaction, so a mid-flight threshold correction never leaves stale
// derived values lying around — "no manual calculation required" applies to edits too, not just
// entry creation.
router.patch("/admin/examinations/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await loadExaminationScoped(req, res, req.params.id);
    if (!existing) return;

    const data = pickExamData(req.body);
    const thresholdsChanged = ["totalMarks", "passingMarks", "passingPercent"].some((k) => data[k] !== undefined);
    const nextExam = { ...existing, ...data };

    const { departmentIds } = req.body;

    // examinationUpdate + one update-op per entry are batched into a single prisma.$transaction
    // array rather than an interactive tx callback with a sequential for-await loop: Prisma
    // pipelines a batched array as one wrapped transaction instead of awaiting each round-trip in
    // turn, which matters once an institute-wide exam has hundreds-to-thousands of entries.
    const examinationUpdate = prisma.resultExamination.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(Array.isArray(departmentIds)
          ? { departments: { deleteMany: {}, create: departmentIds.map((departmentId) => ({ departmentId })) } }
          : {}),
      },
      include: { departments: { include: { department: { select: { id: true, name: true } } } } },
    });

    let entryUpdates = [];
    if (thresholdsChanged) {
      const entries = await prisma.resultEntry.findMany({ where: { examinationId: req.params.id }, select: { id: true, obtainedMarks: true } });
      entryUpdates = entries.map((entry) => {
        const { percentage, passed } = computeResult(entry.obtainedMarks, nextExam);
        return prisma.resultEntry.update({ where: { id: entry.id }, data: { percentage, passed } });
      });
    }

    const [updated] = await prisma.$transaction([examinationUpdate, ...entryUpdates]);

    await logAudit({
      req, action: AUDIT_ACTIONS.RESULT_EXAMINATION_EDITED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: existing.instituteId, details: { examinationId: updated.id, thresholdsChanged },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update examination" });
  }
});

router.delete("/admin/examinations/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await loadExaminationScoped(req, res, req.params.id);
    if (!existing) return;
    await prisma.resultExamination.delete({ where: { id: req.params.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.RESULT_EXAMINATION_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: existing.instituteId, details: { examinationId: existing.id, title: existing.title },
    });
    res.json({ message: "Examination deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete examination" });
  }
});

router.patch("/admin/examinations/:id/publish", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await loadExaminationScoped(req, res, req.params.id);
    if (!existing) return;
    if (existing.status === "PUBLISHED") return res.status(400).json({ error: "Already published" });

    // Spec section 10/13: "Do not allow publication if required validation rules are not
    // satisfied." The one hard rule enforced here is "at least one entry exists" — everything
    // else (missing marks against an expected roster, all-absent, etc.) is a WARNING the admin
    // sees and can consciously proceed past, since this module has no formal way to know who's
    // "required" to have a result unless the admin opted into academicGroupIds.
    const check = await computePublishCheck(req.params.id);
    if (!check.canPublish) {
      return res.status(400).json({ error: "Cannot publish an examination with no student entries.", publishCheck: check });
    }

    const examination = await prisma.resultExamination.update({
      where: { id: req.params.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    const entries = await prisma.resultEntry.findMany({
      where: { examinationId: req.params.id },
      include: { student: { select: { id: true, name: true, email: true } } },
    });
    // Chunked, not one big Promise.all: notifyResultPublished itself fires 2 concurrent ops
    // (in-app notify + email) per student, so publishing an institute-wide exam with hundreds of
    // entries unchunked would burst hundreds of simultaneous DB writes + email sends from this
    // one 0.1vCPU instance. 15 students (30 concurrent ops) per batch, batches run in sequence.
    const NOTIFY_BATCH_SIZE = 15;
    for (let i = 0; i < entries.length; i += NOTIFY_BATCH_SIZE) {
      const batch = entries.slice(i, i + NOTIFY_BATCH_SIZE);
      await Promise.all(batch.map((e) => notifyResultPublished(prisma, e.student, examination)));
    }

    await logAudit({
      req, action: AUDIT_ACTIONS.RESULT_EXAMINATION_PUBLISHED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: existing.instituteId, details: { examinationId: examination.id, title: examination.title, studentsNotified: entries.length },
    });
    res.json(examination);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to publish examination" });
  }
});

router.patch("/admin/examinations/:id/unpublish", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await loadExaminationScoped(req, res, req.params.id);
    if (!existing) return;
    if (existing.status !== "PUBLISHED") return res.status(400).json({ error: "This examination isn't published" });

    const examination = await prisma.resultExamination.update({ where: { id: req.params.id }, data: { status: "UNPUBLISHED" } });
    await logAudit({
      req, action: AUDIT_ACTIONS.RESULT_EXAMINATION_UNPUBLISHED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: existing.instituteId, details: { examinationId: examination.id, title: examination.title },
    });
    res.json(examination);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to unpublish examination" });
  }
});

// ============================================================
// Workflow transitions (DRAFT -> IN_REVIEW -> READY_TO_PUBLISH -> PUBLISHED), plus ARCHIVED as a
// separate, deliberate "done, keep for records" end state reachable from Published/Unpublished.
// Publishing itself (above) is intentionally NOT restricted to only fire from READY_TO_PUBLISH —
// an institute that doesn't want the extra review checkpoints can still publish straight from
// Draft, exactly like before this workflow existed; these routes make the fuller review process
// available, not mandatory.
// ============================================================

function simpleTransition(fromStatuses, toStatus, action) {
  return async (req, res) => {
    try {
      const existing = await loadExaminationScoped(req, res, req.params.id);
      if (!existing) return;
      if (!fromStatuses.includes(existing.status)) {
        return res.status(400).json({ error: `Cannot move from ${existing.status} to ${toStatus} directly.` });
      }
      const examination = await prisma.resultExamination.update({ where: { id: req.params.id }, data: { status: toStatus } });
      await logAudit({
        req, action, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
        instituteId: existing.instituteId, details: { examinationId: examination.id, title: examination.title, from: existing.status, to: toStatus },
      });
      res.json(examination);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update examination status" });
    }
  };
}

router.patch("/admin/examinations/:id/submit-for-review", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute,
  simpleTransition(["DRAFT"], "IN_REVIEW", AUDIT_ACTIONS.RESULT_EXAMINATION_SUBMITTED_FOR_REVIEW));

router.patch("/admin/examinations/:id/mark-ready", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute,
  simpleTransition(["IN_REVIEW"], "READY_TO_PUBLISH", AUDIT_ACTIONS.RESULT_EXAMINATION_MARKED_READY));

router.patch("/admin/examinations/:id/send-back-to-draft", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute,
  simpleTransition(["IN_REVIEW", "READY_TO_PUBLISH"], "DRAFT", AUDIT_ACTIONS.RESULT_EXAMINATION_SENT_BACK_TO_DRAFT));

router.patch("/admin/examinations/:id/archive", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute,
  simpleTransition(["PUBLISHED", "UNPUBLISHED"], "ARCHIVED", AUDIT_ACTIONS.RESULT_EXAMINATION_ARCHIVED));

router.patch("/admin/examinations/:id/unarchive", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute,
  simpleTransition(["ARCHIVED"], "UNPUBLISHED", AUDIT_ACTIONS.RESULT_EXAMINATION_ARCHIVED));

// Pre-publish validation summary (spec section 13) — same computation the actual publish route
// below uses to decide whether to hard-block, exposed as its own read-only endpoint so the UI can
// show it BEFORE the admin even clicks Publish, not just as a rejection after the fact.
async function computePublishCheck(examinationId) {
  const examination = await prisma.resultExamination.findUnique({ where: { id: examinationId } });
  const entries = await prisma.resultEntry.findMany({ where: { examinationId } });

  const present = entries.filter((e) => e.status === "PRESENT");
  const absent = entries.filter((e) => e.status === "ABSENT").length;
  const exempted = entries.filter((e) => e.status === "EXEMPTED").length;
  const notAppeared = entries.filter((e) => e.status === "NOT_APPEARED").length;
  const marksList = present.map((e) => e.obtainedMarks);

  let expectedCount = null, missingCount = null;
  if (examination.academicGroupIds.length) {
    expectedCount = await prisma.user.count({ where: { role: "STUDENT", academicGroupId: { in: examination.academicGroupIds } } });
    missingCount = Math.max(0, expectedCount - entries.length);
  }

  const warnings = [];
  if (entries.length === 0) warnings.push({ level: "error", message: "No students have marks entered yet." });
  if (missingCount) warnings.push({ level: "warning", message: `${missingCount} student(s) from the selected academic group(s) do not have marks entered.` });
  if (present.length === 0 && entries.length > 0) warnings.push({ level: "warning", message: "Every entry is marked Absent/Exempted/Not Appeared — no student has a scored result." });

  return {
    totalEntries: entries.length,
    expectedCount, missingCount,
    marksEnteredCount: present.length,
    passedCount: present.filter((e) => e.passed).length,
    failedCount: present.filter((e) => !e.passed).length,
    absentCount: absent, exemptedCount: exempted, notAppearedCount: notAppeared,
    averageMarks: marksList.length ? Math.round((marksList.reduce((a, b) => a + b, 0) / marksList.length) * 100) / 100 : 0,
    highestMarks: marksList.length ? Math.max(...marksList) : 0,
    lowestMarks: marksList.length ? Math.min(...marksList) : 0,
    canPublish: entries.length > 0,
    warnings,
  };
}

router.get("/admin/examinations/:id/publish-check", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    res.json(await computePublishCheck(req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute pre-publish summary" });
  }
});

// ============================================================
// Multi-subject support (spec section 4) — a ResultExamination optionally has one or more
// ResultSubject rows; when it has none, the exam behaves exactly as it always has (one total mark
// on ResultEntry itself). Adding subjects is what turns on per-subject mark entry/marksheet rows.
// ============================================================

router.get("/admin/examinations/:id/subjects", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    const subjects = await prisma.resultSubject.findMany({ where: { examinationId: req.params.id }, orderBy: { order: "asc" } });
    res.json(subjects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load subjects" });
  }
});

router.post("/admin/examinations/:id/subjects", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) return res.status(403).json({ error: "This examination can no longer have subjects added" });
    const { name, maxMarks, passingMarks } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Subject name is required" });
    const max = Number(maxMarks);
    if (!Number.isFinite(max) || max <= 0) return res.status(400).json({ error: "Maximum marks must be greater than 0" });
    const count = await prisma.resultSubject.count({ where: { examinationId: req.params.id } });
    const subject = await prisma.resultSubject.create({
      data: { examinationId: req.params.id, name: name.trim(), maxMarks: max, passingMarks: passingMarks != null && passingMarks !== "" ? Number(passingMarks) : null, order: count },
    });
    res.json(subject);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A subject with this name already exists on this examination" });
    console.error(err);
    res.status(500).json({ error: "Failed to add subject" });
  }
});

router.delete("/admin/examinations/:id/subjects/:subjectId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) return res.status(403).json({ error: "This examination's subjects can no longer be edited" });
    const subject = await prisma.resultSubject.findUnique({ where: { id: req.params.subjectId } });
    if (!subject || subject.examinationId !== req.params.id) return res.status(404).json({ error: "Subject not found" });
    await prisma.resultSubject.delete({ where: { id: req.params.subjectId } });
    res.json({ message: "Subject removed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove subject" });
  }
});

// Per-student, per-subject mark entry — separate from the overall ResultEntry.obtainedMarks path
// above. Writing a subject mark also recomputes the entry's aggregate obtainedMarks/percentage/
// passed as the sum across all of this exam's subjects, so the "overall result" the student sees
// always matches the sum of what's shown subject-wise (spec section 11's worked example).
router.post("/admin/examinations/:id/entries/:entryId/subject-marks", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) return res.status(403).json({ error: "This examination is no longer in Draft/Review — only an Admin can update its results now" });

    const entry = await prisma.resultEntry.findUnique({ where: { id: req.params.entryId } });
    if (!entry || entry.examinationId !== req.params.id) return res.status(404).json({ error: "Entry not found" });

    const { subjectId, obtainedMarks } = req.body;
    const status = ["PRESENT", "ABSENT", "EXEMPTED", "NOT_APPEARED"].includes(req.body.status) ? req.body.status : "PRESENT";
    const subject = await prisma.resultSubject.findUnique({ where: { id: subjectId } });
    if (!subject || subject.examinationId !== req.params.id) return res.status(404).json({ error: "Subject not found on this examination" });

    let marks = null;
    if (status === "PRESENT") {
      marks = Number(obtainedMarks);
      if (!Number.isFinite(marks) || marks < 0) return res.status(400).json({ error: "obtainedMarks must be a non-negative number" });
      if (marks > subject.maxMarks) return res.status(400).json({ error: `Obtained marks cannot exceed ${subject.name}'s maximum (${subject.maxMarks})` });
    }

    const existingMark = await prisma.resultSubjectMark.findUnique({ where: { entryId_subjectId: { entryId: entry.id, subjectId } } });
    if (examination.status === "PUBLISHED" && existingMark && (existingMark.obtainedMarks !== marks || existingMark.status !== status) && !req.body.reason) {
      return res.status(400).json({ error: "A reason is required to correct a published result." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (existingMark && (existingMark.obtainedMarks !== marks || existingMark.status !== status)) {
        await recordEntryHistory(tx, {
          entryId: entry.id, subjectId,
          changes: [{ field: "obtainedMarks", oldValue: existingMark.obtainedMarks, newValue: marks }],
          user: req.user, reason: req.body.reason || "Subject marks entry updated",
        });
      }
      await tx.resultSubjectMark.upsert({
        where: { entryId_subjectId: { entryId: entry.id, subjectId } },
        update: { obtainedMarks: marks, status },
        create: { entryId: entry.id, subjectId, obtainedMarks: marks, status },
      });

      // Recompute the overall entry as the sum across every subject this exam has.
      const allSubjects = await tx.resultSubject.findMany({ where: { examinationId: req.params.id } });
      const allMarks = await tx.resultSubjectMark.findMany({ where: { entryId: entry.id } });
      const marksBySubject = new Map(allMarks.map((m) => [m.subjectId, m]));
      const anyPresent = allSubjects.some((s) => marksBySubject.get(s.id)?.status === "PRESENT");
      const totalObtained = allSubjects.reduce((sum, s) => {
        const m = marksBySubject.get(s.id);
        return sum + (m && m.status === "PRESENT" && m.obtainedMarks != null ? m.obtainedMarks : 0);
      }, 0);
      const overallStatus = anyPresent ? "PRESENT" : (allMarks[0]?.status || "PRESENT");
      const { percentage, passed } = computeResult(totalObtained, examination, overallStatus);
      const autoGrade = overallStatus === "PRESENT" ? await computeGrade(examination.instituteId, percentage) : null;

      return tx.resultEntry.update({
        where: { id: entry.id },
        data: { obtainedMarks: totalObtained, status: overallStatus, percentage, passed, grade: autoGrade, version: { increment: 1 } },
        include: { student: { select: STUDENT_SELECT }, ...SUBJECT_MARKS_INCLUDE },
      });
    });

    invalidate(`resultExamStats:${req.params.id}`);
    await logAudit({
      req, action: examination.status === "PUBLISHED" ? AUDIT_ACTIONS.RESULT_ENTRY_CORRECTED : AUDIT_ACTIONS.RESULT_ENTRY_EDITED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: examination.instituteId, details: { examinationId: req.params.id, entryId: entry.id, subjectId, reason: req.body.reason || null },
    });
    res.json(serializeEntry(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save subject marks" });
  }
});

// Correction/change history for one entry (spec sections 15/16) — never deleted, read-only here.
router.get("/admin/examinations/:id/entries/:entryId/history", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    const entry = await prisma.resultEntry.findUnique({ where: { id: req.params.entryId } });
    if (!entry || entry.examinationId !== req.params.id) return res.status(404).json({ error: "Entry not found" });
    const history = await prisma.resultEntryHistory.findMany({ where: { entryId: req.params.entryId }, orderBy: { createdAt: "desc" } });
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load correction history" });
  }
});

// ============================================================
// Institute-configurable grading scale (spec sections 11/12) — GET is open to any authenticated
// admin-tier/staff role scoped to their institute (read-only, needed just to render grades); only
// Admin-tier roles may edit it, matching every other "settings" surface on this platform.
// ============================================================

router.get("/admin/grade-scale", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId || req.query.instituteId;
    if (!instituteId) return res.status(400).json({ error: "instituteId is required" });
    if (req.requesterInstituteId && req.requesterInstituteId !== instituteId) return res.status(403).json({ error: "You can only view your own institute's grading scale" });
    const bands = await prisma.resultGradeBand.findMany({ where: { instituteId }, orderBy: { order: "asc" } });
    res.json(bands);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load grading scale" });
  }
});

router.put("/admin/grade-scale", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId || req.body.instituteId;
    if (!instituteId) return res.status(400).json({ error: "instituteId is required" });
    if (req.requesterInstituteId && req.requesterInstituteId !== instituteId) return res.status(403).json({ error: "You can only edit your own institute's grading scale" });

    const bands = Array.isArray(req.body.bands) ? req.body.bands : [];
    for (const b of bands) {
      if (!b.grade || !b.grade.trim()) return res.status(400).json({ error: "Every band needs a grade label" });
      if (!Number.isFinite(Number(b.minPercent)) || !Number.isFinite(Number(b.maxPercent))) return res.status(400).json({ error: "Every band needs numeric min/max percentages" });
      if (Number(b.minPercent) > Number(b.maxPercent)) return res.status(400).json({ error: `Band "${b.grade}": minimum percent cannot exceed maximum percent` });
    }

    await prisma.$transaction([
      prisma.resultGradeBand.deleteMany({ where: { instituteId } }),
      ...bands.map((b, i) => prisma.resultGradeBand.create({ data: { instituteId, grade: b.grade.trim(), minPercent: Number(b.minPercent), maxPercent: Number(b.maxPercent), order: i } })),
    ]);
    invalidateGradeCache(instituteId);

    await logAudit({
      req, action: AUDIT_ACTIONS.RESULT_GRADE_SCALE_UPDATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId, details: { bandCount: bands.length },
    });
    const saved = await prisma.resultGradeBand.findMany({ where: { instituteId }, orderBy: { order: "asc" } });
    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save grading scale" });
  }
});

// ============================================================
// Admin+Staff+Clerk: entries (manual entry + read), gated by canEditEntries()
// ============================================================

router.get("/admin/examinations/:id/entries", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    const entries = await prisma.resultEntry.findMany({
      where: { examinationId: req.params.id },
      include: { student: { select: STUDENT_SELECT }, ...SUBJECT_MARKS_INCLUDE },
      orderBy: { createdAt: "desc" },
    });
    res.json(entries.map(serializeEntry));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load entries" });
  }
});

router.post("/admin/examinations/:id/entries", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) {
      return res.status(403).json({ error: "This examination is no longer in Draft — only an Admin can update its results now" });
    }

    const { studentId, obtainedMarks, grade, remarks } = req.body;
    const status = ["PRESENT", "ABSENT", "EXEMPTED", "NOT_APPEARED"].includes(req.body.status) ? req.body.status : "PRESENT";
    if (!studentId) return res.status(400).json({ error: "studentId is required" });

    let marks = 0;
    if (status === "PRESENT") {
      marks = Number(obtainedMarks);
      if (!Number.isFinite(marks) || marks < 0) return res.status(400).json({ error: "obtainedMarks must be a non-negative number" });
      if (marks > examination.totalMarks) return res.status(400).json({ error: `Obtained marks cannot exceed total marks (${examination.totalMarks})` });
    }
    // Absent/Exempted/Not Appeared students have no real mark — spec section 9: "do not force
    // marks for every student." obtainedMarks stays 0 in storage only as a non-null placeholder;
    // every reader must check `status` before treating it as a real score (see computeResult).

    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.role !== "STUDENT") return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only enter results for students under your own institute" });
    }

    const { percentage, passed } = computeResult(marks, examination, status);
    const autoGrade = status === "PRESENT" ? await computeGrade(examination.instituteId, percentage) : null;
    const finalGrade = grade !== undefined && grade !== "" ? grade : autoGrade;
    const verificationCode = await generateMarksheetCode({ instituteCode: examination.institute?.code });

    const existing = await prisma.resultEntry.findUnique({ where: { examinationId_studentId: { examinationId: req.params.id, studentId } } });
    if (existing) {
      const versionErr = checkVersion(existing, req.body);
      if (versionErr) return res.status(409).json({ error: versionErr, conflict: true });
    }

    const entry = await prisma.$transaction(async (tx) => {
      if (existing) {
        const changes = [];
        if (existing.obtainedMarks !== marks) changes.push({ field: "obtainedMarks", oldValue: existing.obtainedMarks, newValue: marks });
        if (existing.status !== status) changes.push({ field: "status", oldValue: existing.status, newValue: status });
        if ((existing.grade || null) !== (finalGrade || null)) changes.push({ field: "grade", oldValue: existing.grade, newValue: finalGrade });
        if (examination.status === "PUBLISHED" && changes.length && !req.body.reason) {
          throw Object.assign(new Error("A reason is required to correct a published result."), { httpStatus: 400 });
        }
        if (changes.length) await recordEntryHistory(tx, { entryId: existing.id, changes, user: req.user, reason: req.body.reason || "Marks entry updated" });
      }
      return tx.resultEntry.upsert({
        where: { examinationId_studentId: { examinationId: req.params.id, studentId } },
        update: { obtainedMarks: marks, status, percentage, passed, grade: finalGrade || null, remarks: remarks || null, enteredByAdminId: req.user.id, enteredByName: req.user.name, source: "MANUAL", version: { increment: 1 } },
        create: { examinationId: req.params.id, studentId, obtainedMarks: marks, status, percentage, passed, grade: finalGrade || null, remarks: remarks || null, verificationCode, enteredByAdminId: req.user.id, enteredByName: req.user.name, source: "MANUAL" },
        include: { student: { select: STUDENT_SELECT }, ...SUBJECT_MARKS_INCLUDE },
      });
    });

    invalidate(`resultExamStats:${req.params.id}`);
    await logAudit({
      req, action: existing ? AUDIT_ACTIONS.RESULT_ENTRY_EDITED : AUDIT_ACTIONS.RESULT_ENTRY_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: examination.instituteId, details: { examinationId: req.params.id, entryId: entry.id, studentId, status },
    });
    res.json(serializeEntry(entry));
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

router.patch("/admin/examinations/:id/entries/:entryId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) {
      return res.status(403).json({ error: "This examination is no longer in Draft — only an Admin can update its results now" });
    }
    const existingEntry = await prisma.resultEntry.findUnique({ where: { id: req.params.entryId } });
    if (!existingEntry || existingEntry.examinationId !== req.params.id) return res.status(404).json({ error: "Entry not found" });

    const versionErr = checkVersion(existingEntry, req.body);
    if (versionErr) return res.status(409).json({ error: versionErr, conflict: true });

    const data = {};
    const changes = [];
    const status = req.body.status !== undefined && ["PRESENT", "ABSENT", "EXEMPTED", "NOT_APPEARED"].includes(req.body.status) ? req.body.status : existingEntry.status;
    if (status !== existingEntry.status) changes.push({ field: "status", oldValue: existingEntry.status, newValue: status });
    data.status = status;

    if (req.body.grade !== undefined) {
      const nextGrade = req.body.grade || null;
      if (nextGrade !== existingEntry.grade) changes.push({ field: "grade", oldValue: existingEntry.grade, newValue: nextGrade });
      data.grade = nextGrade;
    }
    if (req.body.remarks !== undefined) data.remarks = req.body.remarks || null;

    let marks = existingEntry.obtainedMarks;
    if (status === "PRESENT" && req.body.obtainedMarks !== undefined) {
      marks = Number(req.body.obtainedMarks);
      if (!Number.isFinite(marks) || marks < 0) return res.status(400).json({ error: "obtainedMarks must be a non-negative number" });
      if (marks > examination.totalMarks) return res.status(400).json({ error: `Obtained marks cannot exceed total marks (${examination.totalMarks})` });
    } else if (status !== "PRESENT") {
      marks = 0; // placeholder — see computeResult's comment; no real mark exists for a non-present student
    }
    if (marks !== existingEntry.obtainedMarks) changes.push({ field: "obtainedMarks", oldValue: existingEntry.obtainedMarks, newValue: marks });
    const { percentage, passed } = computeResult(marks, examination, status);
    Object.assign(data, { obtainedMarks: marks, percentage, passed });

    if (examination.status === "PUBLISHED" && changes.length && !req.body.reason) {
      return res.status(400).json({ error: "A reason is required to correct a published result." });
    }

    data.enteredByAdminId = req.user.id;
    data.enteredByName = req.user.name;
    data.version = { increment: 1 };

    const entry = await prisma.$transaction(async (tx) => {
      if (changes.length) await recordEntryHistory(tx, { entryId: existingEntry.id, changes, user: req.user, reason: req.body.reason || "Marks entry updated" });
      return tx.resultEntry.update({ where: { id: req.params.entryId }, data, include: { student: { select: STUDENT_SELECT }, ...SUBJECT_MARKS_INCLUDE } });
    });
    invalidate(`resultExamStats:${req.params.id}`);
    await logAudit({
      req, action: examination.status === "PUBLISHED" ? AUDIT_ACTIONS.RESULT_ENTRY_CORRECTED : AUDIT_ACTIONS.RESULT_ENTRY_EDITED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: examination.instituteId, details: { examinationId: req.params.id, entryId: entry.id, changes: changes.map((c) => c.field), reason: req.body.reason || null },
    });
    res.json(serializeEntry(entry));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update entry" });
  }
});

router.delete("/admin/examinations/:id/entries/:entryId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) {
      return res.status(403).json({ error: "This examination is no longer in Draft — only an Admin can update its results now" });
    }
    const existingEntry = await prisma.resultEntry.findUnique({ where: { id: req.params.entryId }, include: { student: { select: { name: true } } } });
    if (!existingEntry || existingEntry.examinationId !== req.params.id) return res.status(404).json({ error: "Entry not found" });
    await prisma.resultEntry.delete({ where: { id: req.params.entryId } });
    invalidate(`resultExamStats:${req.params.id}`);
    await logAudit({
      req, action: AUDIT_ACTIONS.RESULT_ENTRY_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: examination.instituteId, details: { examinationId: req.params.id, entryId: existingEntry.id, studentName: existingEntry.student?.name },
    });
    res.json({ message: "Entry removed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove entry" });
  }
});

async function loadAdminMarksheetEntry(req, res) {
  const examination = await loadExaminationScoped(req, res, req.params.id);
  if (!examination) return null;
  const entry = await prisma.resultEntry.findUnique({ where: { id: req.params.entryId }, include: { student: { select: MARKSHEET_STUDENT_SELECT }, ...SUBJECT_MARKS_INCLUDE } });
  if (!entry || entry.examinationId !== req.params.id) { res.status(404).json({ error: "Entry not found" }); return null; }
  return { examination, entry };
}

router.get("/admin/examinations/:id/entries/:entryId/marksheet", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const loaded = await loadAdminMarksheetEntry(req, res);
    if (!loaded) return;
    const { examination, entry } = loaded;
    const data = await buildMarksheetData({
      examination, entry, student: entry.student, institute: examination.institute,
      department: entry.student.academicGroup?.department?.name, division: entry.student.academicGroup?.section,
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load marksheet preview" });
  }
});

router.get("/admin/examinations/:id/entries/:entryId/qr.png", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const loaded = await loadAdminMarksheetEntry(req, res);
    if (!loaded) return;
    const { examination, entry } = loaded;
    const data = await buildMarksheetData({
      examination, entry, student: entry.student, institute: examination.institute,
      department: entry.student.academicGroup?.department?.name, division: entry.student.academicGroup?.section,
    });
    const buffer = await QRCode.toBuffer(data.verifyUrl, { margin: 1, width: 200 });
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

router.get("/admin/examinations/:id/entries/:entryId/marksheet.pdf", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const loaded = await loadAdminMarksheetEntry(req, res);
    if (!loaded) return;
    const { examination, entry } = loaded;
    const data = await buildMarksheetData({
      examination, entry, student: entry.student, institute: examination.institute,
      department: entry.student.academicGroup?.department?.name, division: entry.student.academicGroup?.section,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="marksheet-preview-${entry.id}.pdf"`);
    await generateMarksheetPdf(data, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate marksheet preview" });
  }
});

// ============================================================
// Bulk Excel upload — mirrors talentPools.js's bulk-import route almost exactly (same
// multer/spreadsheetFileFilter setup, flexible header matching, "continue past bad rows, bucket
// every row into exactly one outcome" loop).
// ============================================================

// Roll Number is deliberately NOT a mapped column — Registration Number (PRN) is the sole student
// identifier for this import (matching is PRN-only; see the row loop below), and Roll Number is
// never a bulk-upload input anywhere on the platform.
const BULK_IMPORT_FIELD_ALIASES = {
  instituteName: ["institute", "institute name", "college", "college name"],
  // "registration number (prn)" is included because it's this bulk-template's own header below —
  // normalizeBulkImportHeader strips ALL non-alphanumeric chars (no space substitution, unlike
  // users.js's normalizeHeader), so "Registration Number (PRN)" collapses to "registrationnumberprn",
  // which without this alias never matched anything and made the platform's own template fail its
  // own "missing required columns" check.
  registrationNumber: ["registration number", "registration number (prn)", "registration no", "reg no", "reg. no", "prn", "prn no", "prn number"],
  obtainedMarks: ["marks obtained", "marks", "obtained marks", "score"],
  // Optional — a blank/unrecognized value defaults to PRESENT, so every existing template/file
  // that predates this column keeps working exactly as before.
  status: ["status", "attendance", "attendance status"],
};
const BULK_STATUS_VALUES = { present: "PRESENT", absent: "ABSENT", exempted: "EXEMPTED", "not appeared": "NOT_APPEARED", "notappeared": "NOT_APPEARED" };
function normalizeBulkStatus(raw) {
  const key = String(raw || "").trim().toLowerCase();
  return BULK_STATUS_VALUES[key] || "PRESENT";
}
function normalizeBulkImportHeader(h) {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function buildBulkImportHeaderMap(headers) {
  const map = {};
  for (const [field, aliases] of Object.entries(BULK_IMPORT_FIELD_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeBulkImportHeader);
    const match = headers.find((h) => normalizedAliases.includes(normalizeBulkImportHeader(h)));
    if (match) map[field] = match;
  }
  return map;
}

// academicGroupId is optional for backward compatibility (any existing caller that doesn't pass
// one still gets the old single-sample-row template), but the admin UI always passes one now —
// the whole point of this route is to pre-fill the template with a real roster instead of making
// the admin build their own student list.
router.get("/admin/examinations/:id/bulk-template", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    const headers = ["Institute Name", "Student Name", "Registration Number (PRN)", "Marks Obtained", "Status (Present/Absent/Exempted/Not Appeared)"];

    let dataRows;
    const { academicGroupId } = req.query;
    if (academicGroupId) {
      const group = await prisma.academicGroup.findUnique({ where: { id: academicGroupId }, select: { instituteId: true } });
      if (!group || group.instituteId !== examination.instituteId) {
        return res.status(400).json({ error: "That Academic Group doesn't belong to this examination's institute." });
      }
      const students = await prisma.user.findMany({
        where: { role: "STUDENT", academicGroupId },
        select: { name: true, registrationNumber: true },
        orderBy: { name: "asc" },
      });
      if (students.length === 0) return res.status(400).json({ error: "That Academic Group has no students yet." });
      // Marks Obtained/Status left blank — this is what the admin fills in before re-uploading.
      // Blank Status defaults to Present on import, so leaving it blank for everyone is normal.
      dataRows = students.map((s) => [examination.institute.name, s.name, s.registrationNumber || "", "", ""]);
    } else {
      dataRows = [[examination.institute.name, "", "2024COMP001", Math.round(examination.totalMarks * 0.8), "Present"]];
    }

    const sheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Results");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=result-bulk-import-template.xlsx");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate bulk-import template" });
  }
});

// Preview -> Validate -> Confirm Import (spec section 7): the SAME validation/matching logic runs
// either way; the only difference is whether prisma writes actually happen. `?commit=true` is
// required to write — a plain POST with no query param (or commit=false) is always a dry run, so
// an admin can inspect valid/invalid/duplicate/unknown-student buckets before anything touches the
// database, and re-upload a corrected file without ever having partially applied the first attempt.
router.post("/admin/examinations/:id/bulk-import", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, upload.single("file"), async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) {
      return res.status(403).json({ error: "This examination is no longer in Draft/Review — only an Admin can update its results now" });
    }
    if (!req.file) return res.status(400).json({ error: "A file is required" });
    const commit = req.query.commit === "true" || req.body.commit === "true" || req.body.commit === true;

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ error: "Could not read this file. Please upload a valid .xlsx or .csv file." });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });

    const headerMap = buildBulkImportHeaderMap(Object.keys(rows[0]));
    if (!headerMap.instituteName || !headerMap.registrationNumber || !headerMap.obtainedMarks) {
      return res.status(400).json({ error: 'The file must have "Institute Name", "Registration Number (PRN)", and "Marks Obtained" columns.' });
    }

    const institutes = await prisma.institute.findMany({ select: { id: true, name: true, code: true } });
    const instituteByName = new Map(institutes.map((i) => [i.name.toLowerCase().trim(), i]));

    const existingEntries = await prisma.resultEntry.findMany({ where: { examinationId: req.params.id }, select: { studentId: true } });
    const existingStudentIds = new Set(existingEntries.map((e) => e.studentId));

    // Batch-fetch every candidate student by Registration Number (PRN, globally unique) in one
    // query instead of a per-row findFirst inside the loop below — an institute-wide import can be
    // hundreds to thousands of rows, and a per-row query at that scale is exactly the N+1 pattern
    // this platform already avoids elsewhere (see instituteByName above).
    const registrationNumbersInFile = [...new Set(rows.map((row) => String(row[headerMap.registrationNumber] || "").trim()).filter(Boolean))];
    const candidateStudents = registrationNumbersInFile.length
      ? await prisma.user.findMany({
          where: { role: "STUDENT", registrationNumber: { in: registrationNumbersInFile } },
          select: { id: true, name: true, instituteId: true, registrationNumber: true },
        })
      : [];
    const studentByInstituteAndRegNo = new Map(candidateStudents.map((s) => [`${s.instituteId}::${s.registrationNumber}`, s]));

    const imported = [], duplicate = [], invalidInstitute = [], invalidRegistrationNumber = [], failed = [];
    const seen = new Set();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      const instituteNameRaw = String(row[headerMap.instituteName] || "").trim();
      const registrationNumberRaw = String(row[headerMap.registrationNumber] || "").trim();
      const marksRaw = row[headerMap.obtainedMarks];
      const status = headerMap.status ? normalizeBulkStatus(row[headerMap.status]) : "PRESENT";
      if (!instituteNameRaw && !registrationNumberRaw && marksRaw === "") continue; // skip fully blank rows

      try {
        if (!instituteNameRaw || !registrationNumberRaw) {
          failed.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, reason: "Institute Name and Registration Number (PRN) are both required." });
          continue;
        }
        const institute = instituteByName.get(instituteNameRaw.toLowerCase());
        if (!institute) {
          invalidInstitute.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, reason: `Institute "${instituteNameRaw}" was not found.` });
          continue;
        }
        if (req.requesterInstituteId && institute.id !== req.requesterInstituteId) {
          invalidInstitute.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, reason: `"${instituteNameRaw}" is not your institute.` });
          continue;
        }

        // Absent/Exempted/Not Appeared rows carry no real mark (spec section 9) — the max-marks
        // check below only applies when the student is actually marked Present.
        let marks = 0;
        if (status === "PRESENT") {
          marks = Number(marksRaw);
          if (!Number.isFinite(marks) || marks < 0 || marks > examination.totalMarks) {
            failed.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, reason: `Marks Obtained must be a number between 0 and ${examination.totalMarks}.` });
            continue;
          }
        }

        // Matched by Registration Number (PRN), the platform's sole unique student identifier —
        // Roll Number is never accepted as an import column since it legitimately repeats across
        // departments and is auto-generated from the PRN, not entered manually.
        const student = studentByInstituteAndRegNo.get(`${institute.id}::${registrationNumberRaw}`);
        if (!student) {
          invalidRegistrationNumber.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, reason: `No student with Registration Number "${registrationNumberRaw}" was found at ${institute.name}.` });
          continue;
        }
        // "Duplicate" means the same PRN appears more than once in THIS uploaded file — the
        // second occurrence is skipped (existing house policy, unchanged). A PRN that already has
        // a ResultEntry from an earlier import/manual entry is NOT a duplicate here: this route
        // is now also how an admin re-uploads the same pre-filled template to correct marks, so an
        // existing entry for this student gets its marks updated instead of being skipped.
        if (seen.has(student.id)) {
          duplicate.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, name: student.name });
          continue;
        }
        seen.add(student.id);

        const { percentage, passed } = computeResult(marks, examination, status);
        const isUpdate = existingStudentIds.has(student.id);

        // Dry run (preview, the default): every validation above still ran in full — this is the
        // ONLY place that distinguishes preview from commit, so "what would happen" is guaranteed
        // to be exactly what DOES happen on the follow-up commit call with the same file.
        if (commit) {
          const autoGrade = status === "PRESENT" ? await computeGrade(examination.instituteId, percentage) : null;
          if (isUpdate) {
            await prisma.resultEntry.update({
              where: { examinationId_studentId: { examinationId: req.params.id, studentId: student.id } },
              data: { obtainedMarks: marks, status, percentage, passed, grade: autoGrade, enteredByAdminId: req.user.id, enteredByName: req.user.name, source: "BULK_IMPORT", version: { increment: 1 } },
            });
          } else {
            const verificationCode = await generateMarksheetCode({ instituteCode: institute.code });
            await prisma.resultEntry.create({
              data: {
                examinationId: req.params.id, studentId: student.id, obtainedMarks: marks, status, percentage, passed, grade: autoGrade, verificationCode,
                enteredByAdminId: req.user.id, enteredByName: req.user.name, source: "BULK_IMPORT",
              },
            });
          }
        }
        imported.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, name: student.name, obtainedMarks: marks, status, updated: isUpdate });
      } catch (rowErr) {
        failed.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, reason: rowErr.message || "Unexpected error processing this row." });
      }
    }

    if (commit && imported.length) invalidate(`resultExamStats:${req.params.id}`);

    if (commit) {
      await logAudit({
        req, action: AUDIT_ACTIONS.RESULT_ENTRIES_BULK_IMPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
        instituteId: examination.instituteId,
        details: { examinationId: req.params.id, importedCount: imported.length, duplicateCount: duplicate.length, invalidInstituteCount: invalidInstitute.length, invalidRegistrationNumberCount: invalidRegistrationNumber.length, failedCount: failed.length },
      });
    }

    res.json({ imported, duplicate, invalidInstitute, invalidRegistrationNumber, failed, totalRows: rows.length, committed: commit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to import results" });
  }
});

// ============================================================
// Analytics + Search + Export
// ============================================================

// `division` here means AcademicGroup.section's actual string value (e.g. "Section A"), not a
// Division-model id — the legacy Division entity isn't what current students are scoped by (see
// the schema comment on ResultExamination.divisions).
//
// Shared base where-clause for analytics (full unbounded load, cached, needs every matching row to
// aggregate) and search/export (paginated/capped) below, so all three routes can never disagree
// about what's in scope.
function buildEntryWhere(req) {
  const { examinationId, batch, departmentId, division, dateFrom, dateTo, instituteId } = req.query;
  const examWhere = {};
  if (req.requesterInstituteId) examWhere.instituteId = req.requesterInstituteId;
  else if (instituteId) examWhere.instituteId = instituteId;
  if (examinationId) examWhere.id = examinationId;
  if (batch) examWhere.batch = batch;
  if (dateFrom || dateTo) {
    examWhere.examDate = {};
    if (dateFrom) examWhere.examDate.gte = new Date(dateFrom);
    if (dateTo) examWhere.examDate.lte = new Date(dateTo);
  }

  const entryWhere = { examination: examWhere };
  if (departmentId || division) {
    entryWhere.student = { academicGroup: { ...(departmentId ? { departmentId } : {}), ...(division ? { section: division } : {}) } };
  }
  return entryWhere;
}

const ENTRY_INCLUDE = { student: { select: STUDENT_SELECT }, examination: { select: { id: true, title: true, status: true, batch: true, institute: { select: { name: true } } } } };

async function loadFilteredEntries(req) {
  return prisma.resultEntry.findMany({ where: buildEntryWhere(req), include: ENTRY_INCLUDE, orderBy: { createdAt: "desc" }, take: EXPORT_ROW_CAP });
}

// Result Management dashboard summary (spec section 18) — deliberately a separate, cheap
// COUNT-only query rather than folded into the heavier per-entry /admin/analytics above, since
// this is the always-visible landing view and shouldn't pay for loading every entry's full row.
router.get("/admin/dashboard", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId || req.query.instituteId || null;
    const instituteKey = instituteId || "all";
    const summary = await cached(`resultDashboard:${instituteKey}`, 30 * 1000, async () => {
      const where = instituteId ? { instituteId } : {};
      const [total, draft, inReview, readyToPublish, published, unpublished, archived, studentsEvaluated] = await Promise.all([
        prisma.resultExamination.count({ where }),
        prisma.resultExamination.count({ where: { ...where, status: "DRAFT" } }),
        prisma.resultExamination.count({ where: { ...where, status: "IN_REVIEW" } }),
        prisma.resultExamination.count({ where: { ...where, status: "READY_TO_PUBLISH" } }),
        prisma.resultExamination.count({ where: { ...where, status: "PUBLISHED" } }),
        prisma.resultExamination.count({ where: { ...where, status: "UNPUBLISHED" } }),
        prisma.resultExamination.count({ where: { ...where, status: "ARCHIVED" } }),
        prisma.resultEntry.count({ where: { examination: where } }),
      ]);
      return { totalExams: total, draft, inReview, readyToPublish, published, unpublished, archived, studentsEvaluated };
    });
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard summary" });
  }
});

router.get("/admin/analytics", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteKey = req.requesterInstituteId || req.query.instituteId || "all";
    const filterKey = JSON.stringify(req.query);
    const analytics = await cached(`resultAnalytics:${instituteKey}:${filterKey}`, 60 * 1000, async () => {
      const entries = await loadFilteredEntries(req);
      const published = entries.filter((e) => e.examination.status === "PUBLISHED");
      // Absent/Exempted/Not Appeared entries carry a placeholder obtainedMarks/passed value (see
      // computeResult's comment) — every pass/fail/average/highest/lowest figure below must only
      // ever look at entries with status PRESENT, or an absent student would silently count as a
      // scored failure and drag the average down with a fabricated 0.
      const present = entries.filter((e) => e.status === "PRESENT");
      const marksList = present.map((e) => e.obtainedMarks);

      function breakdownBy(keyFn) {
        const byKey = new Map();
        for (const e of present) {
          const key = keyFn(e) || "Unassigned";
          if (!byKey.has(key)) byKey.set(key, { key, appeared: 0, passed: 0, failed: 0 });
          const row = byKey.get(key);
          row.appeared++;
          if (e.passed) row.passed++; else row.failed++;
        }
        return [...byKey.values()].map((r) => ({ ...r, passPercent: r.appeared ? Math.round((r.passed / r.appeared) * 100) : 0 }));
      }

      return {
        totalExaminationsPublished: new Set(published.map((e) => e.examinationId)).size,
        studentsAppeared: present.length,
        studentsAbsent: entries.filter((e) => e.status === "ABSENT").length,
        studentsExempted: entries.filter((e) => e.status === "EXEMPTED").length,
        studentsNotAppeared: entries.filter((e) => e.status === "NOT_APPEARED").length,
        studentsPassed: present.filter((e) => e.passed).length,
        studentsFailed: present.filter((e) => !e.passed).length,
        passPercent: present.length ? Math.round((present.filter((e) => e.passed).length / present.length) * 100) : 0,
        highestMarks: marksList.length ? Math.max(...marksList) : 0,
        lowestMarks: marksList.length ? Math.min(...marksList) : 0,
        averageMarks: marksList.length ? Math.round((marksList.reduce((a, b) => a + b, 0) / marksList.length) * 100) / 100 : 0,
        departmentWise: breakdownBy((e) => e.student.academicGroup?.department?.name),
        instituteWise: breakdownBy((e) => e.examination.institute.name),
        batchWise: breakdownBy((e) => e.student.academicGroup?.batch),
        divisionWise: breakdownBy((e) => e.student.academicGroup?.section),
      };
    });
    res.json(analytics);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

router.get("/admin/search", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { studentName, rollNumber, status } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

    // Every filter (including name/roll/status) is pushed into the Prisma where clause and the
    // page is fetched DB-side via skip/take + a matching count — this used to load every matching
    // entry into memory and filter/paginate in JS, which recomputed the full unbounded load on
    // every keystroke-driven search request across an institute that can have thousands of entries.
    const entryWhere = buildEntryWhere(req);
    if (status === "PASS") entryWhere.passed = true;
    else if (status === "FAIL") entryWhere.passed = false;
    else if (status) entryWhere.examination = { ...entryWhere.examination, status };
    if (studentName && studentName.trim()) {
      entryWhere.student = { ...(entryWhere.student || {}), name: { contains: studentName.trim(), mode: "insensitive" } };
    }
    if (rollNumber && rollNumber.trim()) {
      const q = rollNumber.trim();
      entryWhere.student = { ...(entryWhere.student || {}), OR: [{ rollNumber: { contains: q, mode: "insensitive" } }, { registrationNumber: { contains: q, mode: "insensitive" } }] };
    }

    const instituteKey = req.requesterInstituteId || req.query.instituteId || "all";
    const filterKey = JSON.stringify(req.query);
    const { entries, total } = await cached(`resultSearch:${instituteKey}:${filterKey}`, 20 * 1000, async () => {
      const [entries, total] = await Promise.all([
        prisma.resultEntry.findMany({ where: entryWhere, include: ENTRY_INCLUDE, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.resultEntry.count({ where: entryWhere }),
      ]);
      return { entries, total };
    });

    const rows = entries.map((e) => ({
      ...serializeEntry(e),
      examinationTitle: e.examination.title,
      examinationStatus: e.examination.status,
      instituteName: e.examination.institute.name,
    }));
    res.json({ rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to search results" });
  }
});

// Same take:10000 hard ceiling attendance.js's export uses — a runaway/unfiltered export request
// stays bounded instead of pulling the entire table into memory.
const EXPORT_ROW_CAP = 10000;

router.get("/admin/export", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const entries = await prisma.resultEntry.findMany({ where: buildEntryWhere(req), include: ENTRY_INCLUDE, orderBy: { createdAt: "desc" }, take: EXPORT_ROW_CAP });
    // Attendance status (spec section 9) is the source of truth for whether Obtained
    // Marks/Percentage/Result mean anything — an Absent/Exempted/Not Appeared row shows that
    // status instead of a fabricated Pass/Fail, matching every other reader of this data.
    const rows = entries.map((e) => ({
      Examination: e.examination.title,
      Institute: e.examination.institute.name,
      "Student Name": e.student.name,
      "Roll Number": e.student.rollNumber || "",
      "Registration Number (PRN)": e.student.registrationNumber || "",
      Department: e.student.academicGroup?.department?.name || "",
      Batch: e.student.academicGroup?.batch || "",
      Division: e.student.academicGroup?.section || "",
      Attendance: e.status,
      "Obtained Marks": e.status === "PRESENT" ? e.obtainedMarks : "",
      Percentage: e.status === "PRESENT" ? e.percentage : "",
      Result: e.status === "PRESENT" ? (e.passed ? "Pass" : "Fail") : e.status,
      Grade: e.status === "PRESENT" ? (e.grade || "") : "",
      Status: e.examination.status,
    }));
    sendExport(res, { rows, filenameBase: `results-export-${new Date().toISOString().slice(0, 10)}`, format: req.query.format });
    await logAudit({
      req, action: AUDIT_ACTIONS.RESULT_EXPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId || null, details: { rowCount: rows.length, format: req.query.format || "xlsx", filters: req.query },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export results" });
  }
});

module.exports = router;
