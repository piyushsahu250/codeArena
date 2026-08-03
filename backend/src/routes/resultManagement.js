const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { cached } = require("../utils/cache");
const { spreadsheetFileFilter } = require("../utils/uploadFilters");
const { sendExport } = require("../utils/exportFile");
const { generateMarksheetPdf } = require("../utils/resultMarksheetPdf");
const { notifyResultPublished } = require("../utils/notifications");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });

const STUDENT_SELECT = {
  id: true, name: true, rollNumber: true, registrationNumber: true, instituteId: true,
  academicGroup: { select: { batch: true, section: true, department: { select: { id: true, name: true } } } },
};

// ============================================================
// Shared helpers
// ============================================================

// Marks obtained is the only real input; percentage/passed are always derived from it and the
// exam's own thresholds, never entered directly — "no manual calculation required" per spec.
function computeResult(obtainedMarks, exam) {
  const percentage = exam.totalMarks > 0 ? (obtainedMarks / exam.totalMarks) * 100 : 0;
  let passed = true;
  if (exam.passingPercent != null) passed = percentage >= exam.passingPercent;
  else if (exam.passingMarks != null) passed = obtainedMarks >= exam.passingMarks;
  return { percentage: Math.round(percentage * 100) / 100, passed };
}

// ADMIN can always edit entries. STAFF/CLERK can only "assist in data preparation" — manual entry
// or bulk import — while the exam is still a Draft; once it's Published or Unpublished, only Admin
// may touch entries (matches the spec's explicit "Update Results" being an Admin-only publication
// action).
function canEditEntries(examination, user) {
  if (user.role === "ADMIN") return true;
  if ((user.role === "STAFF" || user.role === "CLERK") && examination.status === "DRAFT") return true;
  return false;
}

async function loadExaminationScoped(req, res, id) {
  const examination = await prisma.resultExamination.findUnique({
    where: { id },
    include: { departments: { include: { department: { select: { id: true, name: true } } } }, institute: { select: { id: true, name: true, logoUrl: true } } },
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
    obtainedMarks: entry.obtainedMarks,
    percentage: entry.percentage,
    passed: entry.passed,
    grade: entry.grade,
    source: entry.source,
    enteredByName: entry.enteredByName,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

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
      obtainedMarks: e.obtainedMarks,
      percentage: e.percentage,
      passed: e.passed,
      resultLabel: e.passed ? e.examination.passLabel : e.examination.failLabel,
      grade: e.grade,
      allowPdfDownload: e.examination.allowPdfDownload,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load your results" });
  }
});

router.get("/me/:entryId/marksheet.pdf", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const entry = await prisma.resultEntry.findUnique({
      where: { id: req.params.entryId },
      include: { examination: { include: { institute: true } }, student: { select: STUDENT_SELECT } },
    });
    if (!entry || entry.studentId !== req.user.id) return res.status(404).json({ error: "Result not found" });
    if (entry.examination.status !== "PUBLISHED") return res.status(403).json({ error: "This result is not published yet" });
    if (!entry.examination.allowPdfDownload) return res.status(403).json({ error: "Marksheet download isn't enabled for this examination" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="marksheet-${entry.examinationId}.pdf"`);
    generateMarksheetPdf({
      examination: entry.examination, entry, student: entry.student, institute: entry.examination.institute,
      department: entry.student.academicGroup?.department?.name, division: entry.student.academicGroup?.section,
    }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate marksheet" });
  }
});

// ============================================================
// Admin: examination CRUD + publish lifecycle
// ============================================================

const EXAM_FIELDS = ["title", "description", "batch", "divisions", "examDate", "publishDate", "totalMarks", "passingMarks", "passingPercent", "passLabel", "failLabel", "allowPdfDownload"];
function pickExamData(body) {
  const data = {};
  for (const key of EXAM_FIELDS) if (body[key] !== undefined) data[key] = body[key];
  if (data.totalMarks !== undefined) data.totalMarks = Number(data.totalMarks);
  if (data.passingMarks !== undefined) data.passingMarks = data.passingMarks === null || data.passingMarks === "" ? null : Number(data.passingMarks);
  if (data.passingPercent !== undefined) data.passingPercent = data.passingPercent === null || data.passingPercent === "" ? null : Number(data.passingPercent);
  if (data.examDate !== undefined) data.examDate = new Date(data.examDate);
  if (data.publishDate !== undefined) data.publishDate = data.publishDate ? new Date(data.publishDate) : null;
  return data;
}

router.get("/admin/examinations", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
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

router.post("/admin/examinations", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
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

router.get("/admin/examinations/:id", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
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
router.patch("/admin/examinations/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await loadExaminationScoped(req, res, req.params.id);
    if (!existing) return;

    const data = pickExamData(req.body);
    const thresholdsChanged = ["totalMarks", "passingMarks", "passingPercent"].some((k) => data[k] !== undefined);
    const nextExam = { ...existing, ...data };

    const { departmentIds } = req.body;
    const updated = await prisma.$transaction(async (tx) => {
      const examination = await tx.resultExamination.update({
        where: { id: req.params.id },
        data: {
          ...data,
          ...(Array.isArray(departmentIds)
            ? { departments: { deleteMany: {}, create: departmentIds.map((departmentId) => ({ departmentId })) } }
            : {}),
        },
        include: { departments: { include: { department: { select: { id: true, name: true } } } } },
      });

      if (thresholdsChanged) {
        const entries = await tx.resultEntry.findMany({ where: { examinationId: req.params.id } });
        for (const entry of entries) {
          const { percentage, passed } = computeResult(entry.obtainedMarks, nextExam);
          await tx.resultEntry.update({ where: { id: entry.id }, data: { percentage, passed } });
        }
      }
      return examination;
    });

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

router.delete("/admin/examinations/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
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

router.patch("/admin/examinations/:id/publish", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await loadExaminationScoped(req, res, req.params.id);
    if (!existing) return;
    if (existing.status === "PUBLISHED") return res.status(400).json({ error: "Already published" });

    const examination = await prisma.resultExamination.update({
      where: { id: req.params.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    const entries = await prisma.resultEntry.findMany({
      where: { examinationId: req.params.id },
      include: { student: { select: { id: true, name: true, email: true } } },
    });
    await Promise.all(entries.map((e) => notifyResultPublished(prisma, e.student, examination)));

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

router.patch("/admin/examinations/:id/unpublish", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
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
// Admin+Staff+Clerk: entries (manual entry + read), gated by canEditEntries()
// ============================================================

router.get("/admin/examinations/:id/entries", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    const entries = await prisma.resultEntry.findMany({
      where: { examinationId: req.params.id },
      include: { student: { select: STUDENT_SELECT } },
      orderBy: { createdAt: "desc" },
    });
    res.json(entries.map(serializeEntry));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load entries" });
  }
});

router.post("/admin/examinations/:id/entries", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) {
      return res.status(403).json({ error: "This examination is no longer in Draft — only an Admin can update its results now" });
    }

    const { studentId, obtainedMarks, grade } = req.body;
    if (!studentId) return res.status(400).json({ error: "studentId is required" });
    const marks = Number(obtainedMarks);
    if (!Number.isFinite(marks) || marks < 0) return res.status(400).json({ error: "obtainedMarks must be a non-negative number" });
    if (marks > examination.totalMarks) return res.status(400).json({ error: `Obtained marks cannot exceed total marks (${examination.totalMarks})` });

    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.role !== "STUDENT") return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only enter results for students under your own institute" });
    }

    const { percentage, passed } = computeResult(marks, examination);
    const entry = await prisma.resultEntry.upsert({
      where: { examinationId_studentId: { examinationId: req.params.id, studentId } },
      update: { obtainedMarks: marks, percentage, passed, grade: grade || null, enteredByAdminId: req.user.id, enteredByName: req.user.name, source: "MANUAL" },
      create: { examinationId: req.params.id, studentId, obtainedMarks: marks, percentage, passed, grade: grade || null, enteredByAdminId: req.user.id, enteredByName: req.user.name, source: "MANUAL" },
      include: { student: { select: STUDENT_SELECT } },
    });
    res.json(serializeEntry(entry));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

router.patch("/admin/examinations/:id/entries/:entryId", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) {
      return res.status(403).json({ error: "This examination is no longer in Draft — only an Admin can update its results now" });
    }
    const existingEntry = await prisma.resultEntry.findUnique({ where: { id: req.params.entryId } });
    if (!existingEntry || existingEntry.examinationId !== req.params.id) return res.status(404).json({ error: "Entry not found" });

    const data = {};
    if (req.body.grade !== undefined) data.grade = req.body.grade || null;
    if (req.body.obtainedMarks !== undefined) {
      const marks = Number(req.body.obtainedMarks);
      if (!Number.isFinite(marks) || marks < 0) return res.status(400).json({ error: "obtainedMarks must be a non-negative number" });
      if (marks > examination.totalMarks) return res.status(400).json({ error: `Obtained marks cannot exceed total marks (${examination.totalMarks})` });
      const { percentage, passed } = computeResult(marks, examination);
      Object.assign(data, { obtainedMarks: marks, percentage, passed });
    }
    data.enteredByAdminId = req.user.id;
    data.enteredByName = req.user.name;

    const entry = await prisma.resultEntry.update({ where: { id: req.params.entryId }, data, include: { student: { select: STUDENT_SELECT } } });
    res.json(serializeEntry(entry));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update entry" });
  }
});

router.delete("/admin/examinations/:id/entries/:entryId", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) {
      return res.status(403).json({ error: "This examination is no longer in Draft — only an Admin can update its results now" });
    }
    const existingEntry = await prisma.resultEntry.findUnique({ where: { id: req.params.entryId } });
    if (!existingEntry || existingEntry.examinationId !== req.params.id) return res.status(404).json({ error: "Entry not found" });
    await prisma.resultEntry.delete({ where: { id: req.params.entryId } });
    res.json({ message: "Entry removed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove entry" });
  }
});

router.get("/admin/examinations/:id/entries/:entryId/marksheet.pdf", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    const entry = await prisma.resultEntry.findUnique({ where: { id: req.params.entryId }, include: { student: { select: STUDENT_SELECT } } });
    if (!entry || entry.examinationId !== req.params.id) return res.status(404).json({ error: "Entry not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="marksheet-preview-${entry.id}.pdf"`);
    generateMarksheetPdf({
      examination, entry, student: entry.student, institute: examination.institute,
      department: entry.student.academicGroup?.department?.name, division: entry.student.academicGroup?.section,
    }, res);
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

const BULK_IMPORT_FIELD_ALIASES = {
  instituteName: ["institute", "institute name", "college", "college name"],
  registrationNumber: ["registration number", "registration no", "reg no", "reg. no", "prn", "prn no", "prn number"],
  rollNumber: ["roll number", "roll no", "rollno", "roll no."],
  obtainedMarks: ["marks obtained", "marks", "obtained marks", "score"],
};
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

router.get("/admin/examinations/:id/bulk-template", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    const headers = ["Institute Name", "Registration Number (PRN)", "Roll Number", "Marks Obtained"];
    const sampleRow = [examination.institute.name, "2024COMP001", "12", Math.round(examination.totalMarks * 0.8)];
    const sheet = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
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

router.post("/admin/examinations/:id/bulk-import", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, upload.single("file"), async (req, res) => {
  try {
    const examination = await loadExaminationScoped(req, res, req.params.id);
    if (!examination) return;
    if (!canEditEntries(examination, req.user)) {
      return res.status(403).json({ error: "This examination is no longer in Draft — only an Admin can update its results now" });
    }
    if (!req.file) return res.status(400).json({ error: "A file is required" });

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
      return res.status(400).json({ error: 'The file must have "Institute Name", "Registration Number (PRN)", and "Marks Obtained" columns. Roll Number is optional (Registration Number is now the match key, since Roll Numbers can repeat).' });
    }

    const institutes = await prisma.institute.findMany({ select: { id: true, name: true } });
    const instituteByName = new Map(institutes.map((i) => [i.name.toLowerCase().trim(), i]));

    const existingEntries = await prisma.resultEntry.findMany({ where: { examinationId: req.params.id }, select: { studentId: true } });
    const existingStudentIds = new Set(existingEntries.map((e) => e.studentId));

    const imported = [], duplicate = [], invalidInstitute = [], invalidRollNumber = [], failed = [];
    const toCreate = [];
    const seen = new Set();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      const instituteNameRaw = String(row[headerMap.instituteName] || "").trim();
      const registrationNumberRaw = String(row[headerMap.registrationNumber] || "").trim();
      const rollNumberRaw = headerMap.rollNumber ? String(row[headerMap.rollNumber] || "").trim() : "";
      const marksRaw = row[headerMap.obtainedMarks];
      if (!instituteNameRaw && !registrationNumberRaw && marksRaw === "") continue; // skip fully blank rows

      try {
        if (!instituteNameRaw || !registrationNumberRaw) {
          failed.push({ row: rowNum, institute: instituteNameRaw, rollNumber: registrationNumberRaw, reason: "Institute Name and Registration Number (PRN) are both required." });
          continue;
        }
        const institute = instituteByName.get(instituteNameRaw.toLowerCase());
        if (!institute) {
          invalidInstitute.push({ row: rowNum, institute: instituteNameRaw, rollNumber: registrationNumberRaw, reason: `Institute "${instituteNameRaw}" was not found.` });
          continue;
        }
        if (req.requesterInstituteId && institute.id !== req.requesterInstituteId) {
          invalidInstitute.push({ row: rowNum, institute: instituteNameRaw, rollNumber: registrationNumberRaw, reason: `"${instituteNameRaw}" is not your institute.` });
          continue;
        }

        const marks = Number(marksRaw);
        if (!Number.isFinite(marks) || marks < 0 || marks > examination.totalMarks) {
          failed.push({ row: rowNum, institute: instituteNameRaw, rollNumber: registrationNumberRaw, reason: `Marks Obtained must be a number between 0 and ${examination.totalMarks}.` });
          continue;
        }

        // Matched by Registration Number (PRN), the platform's sole unique student identifier —
        // Roll Number is not used for matching since it legitimately repeats across departments.
        const student = await prisma.user.findFirst({
          where: { role: "STUDENT", instituteId: institute.id, registrationNumber: registrationNumberRaw },
          select: { id: true, name: true },
        });
        if (!student) {
          invalidRollNumber.push({ row: rowNum, institute: instituteNameRaw, rollNumber: registrationNumberRaw, reason: `No student with Registration Number "${registrationNumberRaw}" was found at ${institute.name}.` });
          continue;
        }
        if (existingStudentIds.has(student.id) || seen.has(student.id)) {
          duplicate.push({ row: rowNum, institute: instituteNameRaw, rollNumber: registrationNumberRaw, name: student.name });
          continue;
        }

        seen.add(student.id);
        const { percentage, passed } = computeResult(marks, examination);
        toCreate.push({
          examinationId: req.params.id, studentId: student.id, obtainedMarks: marks, percentage, passed,
          enteredByAdminId: req.user.id, enteredByName: req.user.name, source: "BULK_IMPORT",
        });
        imported.push({ row: rowNum, institute: instituteNameRaw, rollNumber: rollNumberRaw || registrationNumberRaw, name: student.name, obtainedMarks: marks });
      } catch (rowErr) {
        failed.push({ row: rowNum, institute: instituteNameRaw, rollNumber: registrationNumberRaw, reason: rowErr.message || "Unexpected error processing this row." });
      }
    }

    if (toCreate.length) await prisma.resultEntry.createMany({ data: toCreate, skipDuplicates: true });

    await logAudit({
      req, action: AUDIT_ACTIONS.RESULT_ENTRIES_BULK_IMPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: examination.instituteId,
      details: { examinationId: req.params.id, importedCount: imported.length, duplicateCount: duplicate.length, invalidInstituteCount: invalidInstitute.length, invalidRollNumberCount: invalidRollNumber.length, failedCount: failed.length },
    });

    res.json({ imported, duplicate, invalidInstitute, invalidRollNumber, failed, totalRows: rows.length });
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
async function loadFilteredEntries(req) {
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

  return prisma.resultEntry.findMany({
    where: entryWhere,
    include: { student: { select: STUDENT_SELECT }, examination: { select: { id: true, title: true, status: true, batch: true, institute: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}

router.get("/admin/analytics", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteKey = req.requesterInstituteId || req.query.instituteId || "all";
    const filterKey = JSON.stringify(req.query);
    const analytics = await cached(`resultAnalytics:${instituteKey}:${filterKey}`, 60 * 1000, async () => {
      const entries = await loadFilteredEntries(req);
      const published = entries.filter((e) => e.examination.status === "PUBLISHED");
      const marksList = entries.map((e) => e.obtainedMarks);

      function breakdownBy(keyFn) {
        const byKey = new Map();
        for (const e of entries) {
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
        studentsAppeared: entries.length,
        studentsPassed: entries.filter((e) => e.passed).length,
        studentsFailed: entries.filter((e) => !e.passed).length,
        passPercent: entries.length ? Math.round((entries.filter((e) => e.passed).length / entries.length) * 100) : 0,
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

router.get("/admin/search", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { studentName, rollNumber, status } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

    let entries = await loadFilteredEntries(req);
    if (status) entries = entries.filter((e) => (status === "PASS" ? e.passed : status === "FAIL" ? !e.passed : e.examination.status === status));
    if (studentName && studentName.trim()) {
      const q = studentName.trim().toLowerCase();
      entries = entries.filter((e) => e.student.name.toLowerCase().includes(q));
    }
    if (rollNumber && rollNumber.trim()) {
      const q = rollNumber.trim().toLowerCase();
      entries = entries.filter((e) => (e.student.rollNumber || "").toLowerCase().includes(q) || (e.student.registrationNumber || "").toLowerCase().includes(q));
    }

    const total = entries.length;
    const rows = entries.slice((page - 1) * pageSize, page * pageSize).map((e) => ({
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

router.get("/admin/export", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const entries = await loadFilteredEntries(req);
    const rows = entries.map((e) => ({
      Examination: e.examination.title,
      Institute: e.examination.institute.name,
      "Student Name": e.student.name,
      "Roll Number": e.student.rollNumber || "",
      "Registration Number": e.student.registrationNumber || "",
      Department: e.student.academicGroup?.department?.name || "",
      Batch: e.student.academicGroup?.batch || "",
      Division: e.student.academicGroup?.section || "",
      "Obtained Marks": e.obtainedMarks,
      Percentage: e.percentage,
      Result: e.passed ? "Pass" : "Fail",
      Grade: e.grade || "",
      Status: e.examination.status,
    }));
    sendExport(res, { rows, filenameBase: `results-export-${new Date().toISOString().slice(0, 10)}`, format: req.query.format });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export results" });
  }
});

module.exports = router;
