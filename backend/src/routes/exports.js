const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { sendExport } = require("../utils/exportFile");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { questionVisibilityWhere } = require("../utils/questionVisibility");
const { dedupe } = require("../utils/requestDedup");

const router = express.Router();

// Cap, not archive — same "cap at N, this is an operational export not a data-warehouse dump"
// convention as this platform's other unbounded list views. Anyone needing the full untruncated
// dataset has the on-demand full-database backup (backend/src/routes/backup.js) for that.
const MAX_ROWS = 5000;

// Same UTC-midnight normalization attendance.js's /reports uses, so a date-range filter here never
// drifts a day depending on the requester's local timezone offset. Returns null for anything
// unparseable, matching that file's convention (a bad date silently doesn't filter, rather than 500ing).
function normalizeDate(input) {
  if (!input) return null;
  const match = String(input).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const d = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function dateRangeWhere(field, query) {
  const { dateFrom, dateTo } = query || {};
  if (!dateFrom && !dateTo) return {};
  const range = {};
  const from = normalizeDate(dateFrom);
  const to = normalizeDate(dateTo);
  if (from) range.gte = from;
  if (to) range.lte = to;
  return Object.keys(range).length ? { [field]: range } : {};
}

// Each builder takes the requester's instituteId (null = platform-level Super Admin, sees every
// institute — same convention as attachRequesterInstitute everywhere else) and returns an array
// of flat, already-labeled objects; sendExport turns that into CSV/XLSX/JSON.
const ENTITIES = {
  // Second arg (query) is only meaningful for this entity — every other builder below ignores it.
  // Placement columns + filters live here (not a separate export entity) so Clerk — whose export
  // access is restricted to "students" only, see the route handler below — can already reach them.
  students: async (instituteId, query = {}) => {
    const { departmentId, batch, placementParticipation, offerVerificationStatus } = query;
    const academicGroupFilter = { ...(departmentId ? { departmentId } : {}), ...(batch ? { batch } : {}) };
    const rows = await prisma.user.findMany({
      where: {
        role: "STUDENT", ...(instituteId ? { instituteId } : {}),
        ...(Object.keys(academicGroupFilter).length ? { academicGroup: academicGroupFilter } : {}),
      },
      take: MAX_ROWS,
      orderBy: { createdAt: "desc" },
      include: {
        institute: { select: { name: true } },
        academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } },
      },
    });

    const studentIds = rows.map((u) => u.id);
    const [profiles, offers] = await Promise.all([
      prisma.studentProfile.findMany({ where: { studentId: { in: studentIds } } }),
      prisma.placementOffer.findMany({ where: { studentId: { in: studentIds } } }),
    ]);
    const profileByStudent = new Map(profiles.map((p) => [p.studentId, p]));
    const offersByStudent = new Map();
    for (const o of offers) {
      if (!offersByStudent.has(o.studentId)) offersByStudent.set(o.studentId, []);
      offersByStudent.get(o.studentId).push(o);
    }

    let mapped = rows.map((u) => {
      const p = profileByStudent.get(u.id);
      const studentOffers = offersByStudent.get(u.id) || [];
      const verifiedCount = studentOffers.filter((o) => o.verificationStatus === "VERIFIED").length;
      const pendingCount = studentOffers.filter((o) => o.verificationStatus === "PENDING").length;
      const highest = studentOffers.reduce((max, o) => (!max || o.offeredPackage > max.offeredPackage ? o : max), null);
      return {
        "Roll Number": u.rollNumber || "", Name: u.name, "Registration Number (PRN)": u.registrationNumber || "", Email: u.email,
        Department: u.academicGroup?.department?.name || u.department || "", Mobile: u.mobile || "", Program: u.program || "",
        "Batch Year": u.academicGroup?.batch || u.batchYear || "", Section: u.academicGroup?.section || u.section || "",
        Institute: u.institute?.name || "",
        Active: u.isActive ? "Yes" : "No", "Created At": u.createdAt.toISOString(),
        "Placement Registration": p?.placementParticipation === "INTERESTED" ? "Registered" : p?.placementParticipation === "NOT_INTERESTED" ? "Not Registered" : "Not Set",
        "Department Eligibility": p?.departmentEligibility || "Not Set",
        "Placement Cell Eligibility": p?.clerkEligibility || "Not Set",
        "Offer Count": studentOffers.length,
        "Highest Package": highest ? highest.offeredPackage : "",
        "Offer Verification": studentOffers.length ? `${verifiedCount} verified / ${pendingCount} pending` : "",
        _placementParticipation: p?.placementParticipation, _pendingCount: pendingCount, _verifiedCount: verifiedCount,
      };
    });

    if (placementParticipation) mapped = mapped.filter((r) => r._placementParticipation === placementParticipation);
    if (offerVerificationStatus === "PENDING") mapped = mapped.filter((r) => r._pendingCount > 0);
    if (offerVerificationStatus === "VERIFIED") mapped = mapped.filter((r) => r._verifiedCount > 0);

    return mapped.map(({ _placementParticipation, _pendingCount, _verifiedCount, ...rest }) => rest);
  },

  staff: async (instituteId) => {
    const rows = await prisma.user.findMany({
      where: { role: { in: ["STAFF", "ADMIN"] }, ...(instituteId ? { instituteId } : {}) },
      take: MAX_ROWS,
      orderBy: { createdAt: "desc" },
      include: { institute: { select: { name: true } } },
    });
    return rows.map((u) => ({
      Name: u.name, Email: u.email, Role: u.role, Institute: u.institute?.name || "(platform-level)",
      Active: u.isActive ? "Yes" : "No", "Created At": u.createdAt.toISOString(),
    }));
  },

  results: async (instituteId, query = {}) => {
    const rows = await prisma.testAttempt.findMany({
      where: { ...(instituteId ? { student: { instituteId } } : {}), ...dateRangeWhere("startedAt", query) },
      take: MAX_ROWS,
      orderBy: { startedAt: "desc" },
      include: { student: { select: { name: true, email: true, rollNumber: true, registrationNumber: true } }, test: { select: { title: true } } },
    });
    return rows.map((a) => ({
      "Roll Number": a.student.rollNumber || "", Student: a.student.name, "Registration Number (PRN)": a.student.registrationNumber || "", Email: a.student.email,
      Test: a.test.title, Score: a.totalScore, Status: a.status, "Tab Switches": a.tabSwitchCount,
      "Started At": a.startedAt.toISOString(), "Submitted At": a.submittedAt ? a.submittedAt.toISOString() : "",
    }));
  },

  reports: async (instituteId, query = {}) => {
    const rows = await prisma.interviewReport.findMany({
      where: { ...(instituteId ? { student: { instituteId } } : {}), ...dateRangeWhere("createdAt", query) },
      take: MAX_ROWS,
      orderBy: { createdAt: "desc" },
      include: {
        student: { select: { name: true, email: true } },
        session: { select: { category: true, isMock: true, isCompanyRound: true } },
      },
    });
    return rows.map((r) => ({
      Student: r.student.name, Email: r.student.email,
      Type: r.session.isCompanyRound ? "Company Round" : r.session.isMock ? "Mock Interview" : (r.session.category || "Practice"),
      "Overall Score": r.overallScore, "Created At": r.createdAt.toISOString(),
    }));
  },

  certificates: async (instituteId, query = {}) => {
    const rows = await prisma.certificate.findMany({
      where: { ...(instituteId ? { student: { instituteId } } : {}), ...dateRangeWhere("issuedAt", query) },
      take: MAX_ROWS,
      orderBy: { issuedAt: "desc" },
      include: { student: { select: { name: true, email: true, registrationNumber: true } } },
    });
    return rows.map((c) => ({
      Student: c.student.name, "Registration Number (PRN)": c.student.registrationNumber || "", Email: c.student.email, Type: c.type, "Program/Title": c.programName || c.title,
      "Certificate Code": c.certificateCode, Status: c.status, "Issued At": c.issuedAt.toISOString(),
    }));
  },

  questions: async (instituteId, query, req) => {
    const rows = await prisma.question.findMany({
      where: questionVisibilityWhere(req),
      take: MAX_ROWS,
      orderBy: { createdAt: "desc" },
      select: { title: true, subject: true, topic: true, questionType: true, difficulty: true, points: true, createdAt: true },
    });
    return rows.map((q) => ({
      Title: q.title || "", Subject: q.subject || "", Topic: q.topic || "", Type: q.questionType,
      Difficulty: q.difficulty, Points: q.points, "Created At": q.createdAt.toISOString(),
    }));
  },

  // Requires ?poolId= — unlike every other entity here, this one is scoped to a single Talent
  // Pool rather than "every row of this type at the institute," since a pool roster only makes
  // sense in that context (there's no "all Talent Pool members across the institute" report).
  talentPools: async (instituteId, query = {}) => {
    if (!query.poolId) return [];
    // A pool can span multiple institutes (TalentPoolInstitute join) or be genuinely platform-wide
    // (no institutes configured) -- mirrors talentPools.js's own loadPoolScoped() exactly. Without
    // this check, any authorized exporter could pull another institute's full member roster
    // (email, PRN, skills) just by supplying a poolId that isn't theirs -- instituteId above was
    // otherwise never actually applied to the query below.
    const pool = await prisma.talentPool.findUnique({ where: { id: query.poolId }, include: { institutes: { select: { instituteId: true } } } });
    if (!pool) return [];
    const poolInstituteIds = pool.institutes.map((i) => i.instituteId);
    if (instituteId && poolInstituteIds.length && !poolInstituteIds.includes(instituteId)) return [];

    const members = await prisma.talentPoolMember.findMany({
      where: { poolId: query.poolId },
      include: {
        student: {
          select: {
            name: true, email: true, rollNumber: true, registrationNumber: true,
            academicGroup: { select: { batch: true, department: { select: { name: true } } } },
          },
        },
      },
      orderBy: { addedAt: "desc" },
    });
    const studentIds = members.map((m) => m.studentId);
    const [profiles, resumes] = await Promise.all([
      prisma.studentProfile.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true, placementParticipation: true } }),
      prisma.resume.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true, skills: true } }),
    ]);
    const placementByStudent = new Map(profiles.map((p) => [p.studentId, p.placementParticipation]));
    const skillsByStudent = new Map(
      resumes.map((r) => [r.studentId, Array.isArray(r.skills) ? r.skills.map((s) => s.name).filter(Boolean).join(", ") : ""])
    );
    return members.map((m) => ({
      "Roll Number": m.student.rollNumber || "", Name: m.student.name, "Registration Number (PRN)": m.student.registrationNumber || "",
      Email: m.student.email, Department: m.student.academicGroup?.department?.name || "", Batch: m.student.academicGroup?.batch || "",
      "Placement Status": placementByStudent.get(m.studentId) === "INTERESTED" ? "Registered"
        : placementByStudent.get(m.studentId) === "NOT_INTERESTED" ? "Not Registered" : "Not Set",
      Skills: skillsByStudent.get(m.studentId) || "",
      "Added Via": m.addedVia, "Added At": m.addedAt.toISOString(),
    }));
  },
};

// ADMIN/STAFF (institute-scoped for Staff and institute-scoped Admins; unscoped for platform-level
// Super Admin — same convention as certificates.js's /admin route). ?format=csv|xlsx|json, default csv.
// CLERK is scoped further still — Placement Cell access is "download student records" only, not
// staff/results/reports/certificates/questions, so it's restricted to the "students" entity below
// rather than opening this whole generic multi-entity route to the role.
router.get("/:entity", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, requireFeature("export_center"), async (req, res) => {
  const builder = ENTITIES[req.params.entity];
  if (!builder) return res.status(404).json({ error: `Unknown export entity "${req.params.entity}"` });
  if (req.user.role === "CLERK" && req.params.entity !== "students") {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const format = req.query.format || "csv";
  // Coalesces the exact same user re-requesting the exact same export (double-click, a retried
  // request) into one in-flight run instead of two — the second caller gets the first's result
  // rather than kicking off its own duplicate query. Keyed on the actual filters, not just the
  // entity, so two DIFFERENT filtered exports by the same user never collide.
  const dedupeKey = `export:${req.user.id}:${req.params.entity}:${JSON.stringify(req.query)}`;

  const job = await prisma.exportJob.create({
    data: {
      entity: req.params.entity, format, filters: req.query, status: "PROCESSING",
      requestedById: req.user.id, requestedByName: req.user.name, instituteId: req.requesterInstituteId,
    },
  }).catch((err) => { console.error("[exports] failed to create ExportJob record:", err.message); return null; });

  try {
    const rows = await dedupe(dedupeKey, () => builder(req.requesterInstituteId, req.query, req));

    if (job) {
      await prisma.exportJob.update({
        where: { id: job.id }, data: { status: "COMPLETED", rowCount: rows.length, completedAt: new Date() },
      }).catch(() => {});
    }
    await logAudit({
      req, action: AUDIT_ACTIONS.DATA_EXPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { entity: req.params.entity, format, filters: req.query, rowCount: rows.length },
    });

    // A filtered export with zero matches would otherwise silently download a confusing
    // header-only (or fully empty) file — 204 lets the frontend distinguish "nothing matched"
    // from "here's your file" without inspecting file content, even under responseType: "blob".
    if (rows.length === 0) return res.status(204).end();

    sendExport(res, {
      rows,
      filenameBase: `codearena-${req.params.entity}-${new Date().toISOString().slice(0, 10)}`,
      format: req.query.format,
    });
  } catch (err) {
    console.error(err);
    if (job) {
      await prisma.exportJob.update({
        where: { id: job.id }, data: { status: "FAILED", errorMessage: String(err.message || err).slice(0, 500), completedAt: new Date() },
      }).catch(() => {});
    }
    res.status(500).json({ error: "Export failed" });
  }
});

// Export History — the requester's own past export jobs (Admin/institute-scoped Admin also sees
// their institute's other Staff/Clerk exports, same convention as the audit-log viewer; a
// non-institute-scoped Staff/Clerk only ever sees their own). Paginated like every other list
// route on this platform — this can grow without bound otherwise.
router.get("/history/mine", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20));
    const where = req.user.role === "ADMIN" && req.requesterInstituteId
      ? { instituteId: req.requesterInstituteId }
      : req.user.role === "ADMIN" && !req.requesterInstituteId
        ? {}
        : { requestedById: req.user.id };
    const [rows, total] = await Promise.all([
      prisma.exportJob.findMany({
        where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      prisma.exportJob.count({ where }),
    ]);
    res.json({ rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load export history" });
  }
});

module.exports = router;
