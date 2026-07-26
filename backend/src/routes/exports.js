const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { sendExport } = require("../utils/exportFile");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

const router = express.Router();

// Cap, not archive — same "cap at N, this is an operational export not a data-warehouse dump"
// convention as this platform's other unbounded list views. Anyone needing the full untruncated
// dataset has the on-demand full-database backup (backend/src/routes/backup.js) for that.
const MAX_ROWS = 5000;

// Each builder takes the requester's instituteId (null = platform-level Super Admin, sees every
// institute — same convention as attachRequesterInstitute everywhere else) and returns an array
// of flat, already-labeled objects; sendExport turns that into CSV/XLSX/JSON.
const ENTITIES = {
  students: async (instituteId) => {
    const rows = await prisma.user.findMany({
      where: { role: "STUDENT", ...(instituteId ? { instituteId } : {}) },
      take: MAX_ROWS,
      orderBy: { createdAt: "desc" },
      include: {
        institute: { select: { name: true } },
        academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } },
      },
    });
    return rows.map((u) => ({
      Name: u.name, Email: u.email, "Roll Number": u.rollNumber || "", "Registration Number": u.registrationNumber || "",
      Department: u.academicGroup?.department?.name || u.department || "", Mobile: u.mobile || "", Program: u.program || "",
      "Batch Year": u.academicGroup?.batch || u.batchYear || "", Section: u.academicGroup?.section || u.section || "",
      Institute: u.institute?.name || "",
      Active: u.isActive ? "Yes" : "No", "Created At": u.createdAt.toISOString(),
    }));
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

  results: async (instituteId) => {
    const rows = await prisma.testAttempt.findMany({
      where: instituteId ? { student: { instituteId } } : {},
      take: MAX_ROWS,
      orderBy: { startedAt: "desc" },
      include: { student: { select: { name: true, email: true, rollNumber: true } }, test: { select: { title: true } } },
    });
    return rows.map((a) => ({
      Student: a.student.name, Email: a.student.email, "Roll Number": a.student.rollNumber || "",
      Test: a.test.title, Score: a.totalScore, Status: a.status, "Tab Switches": a.tabSwitchCount,
      "Started At": a.startedAt.toISOString(), "Submitted At": a.submittedAt ? a.submittedAt.toISOString() : "",
    }));
  },

  reports: async (instituteId) => {
    const rows = await prisma.interviewReport.findMany({
      where: instituteId ? { student: { instituteId } } : {},
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

  certificates: async (instituteId) => {
    const rows = await prisma.certificate.findMany({
      where: instituteId ? { student: { instituteId } } : {},
      take: MAX_ROWS,
      orderBy: { issuedAt: "desc" },
      include: { student: { select: { name: true, email: true } } },
    });
    return rows.map((c) => ({
      Student: c.student.name, Email: c.student.email, Type: c.type, "Program/Title": c.programName || c.title,
      "Certificate Code": c.certificateCode, Status: c.status, "Issued At": c.issuedAt.toISOString(),
    }));
  },

  questions: async (instituteId) => {
    const rows = await prisma.question.findMany({
      where: instituteId ? { OR: [{ instituteId }, { instituteId: null }] } : {},
      take: MAX_ROWS,
      orderBy: { createdAt: "desc" },
      select: { title: true, subject: true, topic: true, questionType: true, difficulty: true, points: true, createdAt: true },
    });
    return rows.map((q) => ({
      Title: q.title || "", Subject: q.subject || "", Topic: q.topic || "", Type: q.questionType,
      Difficulty: q.difficulty, Points: q.points, "Created At": q.createdAt.toISOString(),
    }));
  },
};

// ADMIN/STAFF (institute-scoped for Staff and institute-scoped Admins; unscoped for platform-level
// Super Admin — same convention as certificates.js's /admin route). ?format=csv|xlsx|json, default csv.
// CLERK is scoped further still — Placement Cell access is "download student records" only, not
// staff/results/reports/certificates/questions, so it's restricted to the "students" entity below
// rather than opening this whole generic multi-entity route to the role.
router.get("/:entity", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  const builder = ENTITIES[req.params.entity];
  if (!builder) return res.status(404).json({ error: `Unknown export entity "${req.params.entity}"` });
  if (req.user.role === "CLERK" && req.params.entity !== "students") {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  try {
    const rows = await builder(req.requesterInstituteId);
    await logAudit({
      req, action: AUDIT_ACTIONS.DATA_EXPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { entity: req.params.entity, format: req.query.format || "csv", rowCount: rows.length },
    });
    sendExport(res, {
      rows,
      filenameBase: `codearena-${req.params.entity}-${new Date().toISOString().slice(0, 10)}`,
      format: req.query.format,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Export failed" });
  }
});

module.exports = router;
