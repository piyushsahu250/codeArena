// Exam-security API: evidence intake (batched from the exam page), the staff monitor + per-attempt timeline, human review
// of evidence, and the managed-browser handshake. Authority lives here; the browser only reports. See docs/EXAM_SECURITY.md.
const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { ownsLmsInstitute, resolveModuleCodingTestCourseInstituteId } = require("../utils/lmsOwnership");
const X = require("../utils/examSecurity");

const router = express.Router();
const STAFF = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"];
const EVENT_LIMIT = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: false, legacyHeaders: false });
const MAX_EVENTS_PER_ATTEMPT = 2000; // hard ceiling so one attempt can never grow the table without bound

// STUDENT: report a batch of observed events for their own open attempt. Batched client-side (one request per ~10 s or
// on pagehide), never per keypress. The server assigns severity; a client can neither pick it nor forge server-only types.
router.post("/events", authenticate, requireRole("STUDENT"), EVENT_LIMIT, async (req, res) => {
  try {
    const { attemptId, events } = req.body || {};
    if (!attemptId || !Array.isArray(events) || events.length === 0) return res.status(400).json({ error: "attemptId and a non-empty events array are required" });
    const attempt = await prisma.moduleCodingAttempt.findUnique({ where: { id: String(attemptId) }, include: { moduleCodingTest: { select: { id: true, securityLevel: true, securityPolicy: true, requireFullscreen: true } } } });
    // Same non-disclosure as every attempt route: someone else's attempt looks exactly like a nonexistent one.
    if (!attempt || attempt.studentId !== req.user.id) return res.status(404).json({ error: "Attempt not found" });
    if (attempt.status !== "IN_PROGRESS") return res.json({ accepted: 0, closed: true });
    const existing = await prisma.examSecurityEvent.count({ where: { attemptKind: "MODULE_CODING", attemptId: attempt.id } });
    if (existing >= MAX_EVENTS_PER_ATTEMPT) return res.json({ accepted: 0, capped: true });

    const rows = [];
    for (const ev of events.slice(0, 25)) {
      const type = String(ev?.type || "").toUpperCase();
      if (!X.CLIENT_REPORTABLE.has(type)) continue; // unknown or server-only types are ignored, not stored
      rows.push({
        attemptKind: "MODULE_CODING", attemptId: attempt.id, studentId: req.user.id, testId: attempt.moduleCodingTestId,
        questionId: typeof ev.questionId === "string" ? ev.questionId.slice(0, 64) : null,
        type, severity: X.EVENT_SEVERITY[type] || "LOW", metadata: X.cleanMetadata(ev.metadata),
      });
    }
    if (rows.length) await prisma.examSecurityEvent.createMany({ data: rows });
    res.json({ accepted: rows.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to record events" }); }
});

// Records a server-originated event (used by moduleCoding.js when it enforces a rule). Never throws into the caller.
async function recordServerEvent({ attempt, type, metadata, questionId }) {
  try {
    await prisma.examSecurityEvent.create({ data: {
      attemptKind: "MODULE_CODING", attemptId: attempt.id, studentId: attempt.studentId, testId: attempt.moduleCodingTestId,
      questionId: questionId || null, type, severity: X.EVENT_SEVERITY[type] || "MEDIUM", metadata: X.cleanMetadata(metadata),
    } });
  } catch (e) { console.error("[examSecurity] could not record", type, e.message); }
}

async function loadTestScoped(req, res) {
  const instituteId = await resolveModuleCodingTestCourseInstituteId(req.params.testId);
  if (instituteId === undefined) { res.status(404).json({ error: "Assessment not found" }); return null; }
  if (!ownsLmsInstitute(req, instituteId)) { res.status(403).json({ error: "You can only view assessments under your own institute" }); return null; }
  const test = await prisma.moduleCodingTest.findUnique({ where: { id: req.params.testId }, select: { id: true, title: true, securityLevel: true, securityPolicy: true, requireFullscreen: true, requireWebcam: true, requireMicrophone: true, maxViolations: true, proctoring: true } });
  return { test, instituteId };
}

// STAFF: one row per student attempt with a risk band, counts and last event. Paginated; aggregation is in SQL-sized
// chunks (events fetched only for the page of attempts shown), so the page stays fast with large event volumes.
router.get("/tests/:testId/monitor", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const ctx = await loadTestScoped(req, res); if (!ctx) return;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
    const studentScope = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
    const where = { moduleCodingTestId: ctx.test.id, student: studentScope };
    const [total, attempts] = await Promise.all([
      prisma.moduleCodingAttempt.count({ where }),
      prisma.moduleCodingAttempt.findMany({
        where, orderBy: { startedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, status: true, startedAt: true, submittedAt: true, violationCount: true, autoSubmitReason: true, student: { select: { id: true, name: true, registrationNumber: true } } },
      }),
    ]);
    const ids = attempts.map((a) => a.id);
    const [classic, extra] = ids.length ? await Promise.all([
      prisma.proctoringViolation.findMany({ where: { attemptId: { in: ids } }, select: { attemptId: true, type: true, severity: true, penalized: true, createdAt: true } }),
      prisma.examSecurityEvent.findMany({ where: { attemptKind: "MODULE_CODING", attemptId: { in: ids } }, select: { attemptId: true, type: true, severity: true, reviewStatus: true, createdAt: true } }),
    ]) : [[], []];
    const by = (arr) => { const m = new Map(); for (const e of arr) { if (!m.has(e.attemptId)) m.set(e.attemptId, []); m.get(e.attemptId).push(e); } return m; };
    const classicBy = by(classic), extraBy = by(extra);
    const rows = attempts.map((a) => {
      const evs = [...(classicBy.get(a.id) || []), ...(extraBy.get(a.id) || [])];
      const risk = X.computeRisk(evs);
      const last = evs.sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt))[0];
      return {
        attemptId: a.id, student: a.student, status: a.status, startedAt: a.startedAt, submittedAt: a.submittedAt,
        autoSubmitReason: a.autoSubmitReason, violationCount: a.violationCount, eventCount: evs.length,
        risk: risk.level, riskScore: risk.score, lastEvent: last ? { type: last.type, at: last.createdAt } : null,
        pendingReview: (extraBy.get(a.id) || []).filter((e) => e.reviewStatus === "PENDING" && e.severity !== "LOW").length,
      };
    });
    res.json({
      test: { id: ctx.test.id, title: ctx.test.title }, policy: X.clientPolicy(X.resolvePolicy(ctx.test)),
      proctoring: { enabled: ctx.test.proctoring, camera: ctx.test.requireWebcam, microphone: ctx.test.requireMicrophone, maxViolations: ctx.test.maxViolations },
      total, page, pageSize, rows,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load monitor" }); }
});

// STAFF: chronological timeline for one attempt (classic proctoring strikes + newer evidence + start/submit).
router.get("/attempts/:attemptId/timeline", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const attempt = await prisma.moduleCodingAttempt.findUnique({ where: { id: req.params.attemptId }, include: { student: { select: { id: true, name: true, instituteId: true, registrationNumber: true } } } });
    if (!attempt) return res.status(404).json({ error: "Attempt not found" });
    const instituteId = await resolveModuleCodingTestCourseInstituteId(attempt.moduleCodingTestId);
    if (!ownsLmsInstitute(req, instituteId) || (req.requesterInstituteId && attempt.student.instituteId !== req.requesterInstituteId)) return res.status(403).json({ error: "Not allowed" });
    const [classic, extra] = await Promise.all([
      prisma.proctoringViolation.findMany({ where: { attemptId: attempt.id }, orderBy: { createdAt: "asc" } }),
      prisma.examSecurityEvent.findMany({ where: { attemptKind: "MODULE_CODING", attemptId: attempt.id }, orderBy: { createdAt: "asc" }, take: 500 }),
    ]);
    const timeline = [
      { at: attempt.startedAt, type: "EXAM_STARTED", source: "system" },
      ...classic.map((c) => ({ id: c.id, at: c.createdAt, type: c.type, severity: c.severity, penalized: c.penalized, source: "proctoring" })),
      ...extra.map((e) => ({ id: e.id, at: e.createdAt, type: e.type, severity: e.severity, metadata: e.metadata, questionId: e.questionId, reviewStatus: e.reviewStatus, reviewNote: e.reviewNote, source: "security", reviewable: true })),
      ...(attempt.submittedAt ? [{ at: attempt.submittedAt, type: attempt.autoSubmitReason ? `AUTO_SUBMITTED (${attempt.autoSubmitReason})` : "SUBMITTED", source: "system" }] : []),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));
    const risk = X.computeRisk([...classic, ...extra]);
    res.json({ attemptId: attempt.id, student: attempt.student, status: attempt.status, risk: risk.level, riskScore: risk.score, byType: risk.byType, timeline });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load timeline" }); }
});

// STAFF: record a human review of one piece of evidence. Weak browser signals are never punished automatically; this is
// where a person decides. Audit-logged.
const REVIEW_STATES = ["REVIEWED", "LEGITIMATE", "SUSPICIOUS", "ESCALATED"];
router.patch("/events/:id/review", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const { reviewStatus, note } = req.body || {};
    if (!REVIEW_STATES.includes(reviewStatus)) return res.status(400).json({ error: `reviewStatus must be one of ${REVIEW_STATES.join(", ")}` });
    const ev = await prisma.examSecurityEvent.findUnique({ where: { id: req.params.id } });
    if (!ev) return res.status(404).json({ error: "Event not found" });
    const student = await prisma.user.findUnique({ where: { id: ev.studentId }, select: { instituteId: true } });
    const instituteId = ev.testId ? await resolveModuleCodingTestCourseInstituteId(ev.testId) : null;
    if (!ownsLmsInstitute(req, instituteId) || (req.requesterInstituteId && student?.instituteId !== req.requesterInstituteId)) return res.status(403).json({ error: "Not allowed" });
    const updated = await prisma.examSecurityEvent.update({ where: { id: ev.id }, data: { reviewStatus, reviewNote: note ? String(note).slice(0, 500) : null, reviewedById: req.user.id, reviewedAt: new Date() } });
    await logAudit({ req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, studentId: ev.studentId, instituteId: student?.instituteId || null, details: { entity: "examSecurityEvent", operation: "review", eventId: ev.id, type: ev.type, reviewStatus } });
    res.json({ id: updated.id, reviewStatus: updated.reviewStatus, reviewNote: updated.reviewNote });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to save review" }); }
});

// MANAGED BROWSER: exchange a signed handshake for a short-lived, student-bound secure-session token. The signing secret
// (SECURE_BROWSER_SECRET) is provisioned to institution-managed browsers/kiosk launchers out of band.
router.post("/secure-session", authenticate, requireRole("STUDENT"), rateLimit({ windowMs: 60 * 1000, max: 10, keyGenerator: (req) => req.user?.id || req.ip }), (req, res) => {
  const { deviceId, ts, sig } = req.body || {};
  if (!X.verifyHandshake({ deviceId, ts, sig })) return res.status(403).json({ error: "Secure browser handshake failed" });
  res.json({ token: X.issueSecureToken(req.user.id), expiresInMs: 6 * 60 * 60 * 1000 });
});

module.exports = router;
module.exports.recordServerEvent = recordServerEvent;
