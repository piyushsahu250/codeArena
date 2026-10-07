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
const SecureExam = require("../utils/secureExam");

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
  const test = await prisma.moduleCodingTest.findUnique({ where: { id: req.params.testId }, select: { id: true, title: true, securityLevel: true, securityPolicy: true, requireFullscreen: true, requireWebcam: true, requireMicrophone: true, maxViolations: true, proctoring: true, timeLimitMin: true } });
  return { test, instituteId };
}


// Dashboard totals for a whole test (not just the visible page). Cached for a few seconds per test so a monitor open on many
// staff screens does not turn into one heavy query per refresh; counts come from narrow selects, not the full event bodies.
const summaryCache = new Map();
async function monitorSummary(test, studentScope, pol) {
  const hit = summaryCache.get(test.id);
  if (hit && Date.now() - hit.at < 5000 && hit.scope === JSON.stringify(studentScope)) return hit.value;
  const attempts = await prisma.moduleCodingAttempt.findMany({ where: { moduleCodingTestId: test.id, student: studentScope }, select: { id: true, status: true }, take: 5000 });
  const ids = attempts.map((a) => a.id);
  const active = attempts.filter((a) => a.status === "IN_PROGRESS");
  const [classic, extra, sessions] = ids.length ? await Promise.all([
    prisma.proctoringViolation.findMany({ where: { attemptId: { in: ids } }, select: { attemptId: true, type: true } }),
    prisma.examSecurityEvent.findMany({ where: { attemptKind: "MODULE_CODING", attemptId: { in: ids } }, select: { attemptId: true, type: true, reviewStatus: true } }),
    prisma.secureExamSession.findMany({ where: { attemptId: { in: active.map((a) => a.id) }, endedAt: null }, select: { attemptId: true, lastHeartbeatAt: true, lockedAt: true, unlockedAt: true, state: true, endedAt: true } }),
  ]) : [[], [], []];
  const evBy = new Map();
  for (const e of [...classic, ...extra]) { if (!evBy.has(e.attemptId)) evBy.set(e.attemptId, []); evBy.get(e.attemptId).push(e); }
  const bands = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const a of attempts) bands[X.computeRisk(evBy.get(a.id) || []).level]++;
  const nowMs = Date.now();
  const disconnected = sessions.filter((s) => (s.lockedAt && !s.unlockedAt) || SecureExam.connectionState(s, { heartbeatSec: 15, graceSec: pol.graceSec }, nowMs) !== "CONNECTED").length;
  const countType = (types) => extra.filter((e) => types.includes(e.type)).length;
  const value = {
    totalStudents: attempts.length, active: active.length, completed: attempts.length - active.length, disconnected,
    securityWarnings: bands.MEDIUM, highRisk: bands.HIGH, critical: bands.CRITICAL,
    deviceFailures: countType(["APPLICATION_POLICY_FAILURE", "BROWSER_POLICY_FAILURE", "SECURE_CLIENT_STOPPED", "DEVICE_MISMATCH", "VERSION_MISMATCH"]),
    networkFailures: countType(["NETWORK_POLICY_FAILURE", "NETWORK_DISCONNECT", "HEARTBEAT_LOST"]),
  };
  summaryCache.set(test.id, { at: Date.now(), scope: JSON.stringify(studentScope), value });
  if (summaryCache.size > 500) summaryCache.clear();
  return value;
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
    // Live fields: latest secure session per attempt (device + connection state), answered/accepted counts, server-side time left.
    const [sessions, subs] = ids.length ? await Promise.all([
      prisma.secureExamSession.findMany({ where: { attemptId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { attemptId: true, deviceId: true, examDeviceId: true, state: true, lastHeartbeatAt: true, endedAt: true, lockedAt: true, unlockedAt: true, clientKind: true } }),
      prisma.moduleCodingSubmission.findMany({ where: { attemptId: { in: ids } }, select: { attemptId: true, verdict: true } }),
    ]) : [[], []];
    const sessBy = new Map(); for (const s of sessions) if (!sessBy.has(s.attemptId)) sessBy.set(s.attemptId, s);
    const subBy = new Map(); for (const s of subs) { const c = subBy.get(s.attemptId) || { answered: 0, accepted: 0 }; if (s.verdict && s.verdict !== "PENDING") c.answered++; if (s.verdict === "ACCEPTED") c.accepted++; subBy.set(s.attemptId, c); }
    const devLabels = new Map((await prisma.examDevice.findMany({ where: { id: { in: [...new Set(sessions.map((s) => s.examDeviceId))] } }, select: { id: true, label: true } })).map((d) => [d.id, d.label]));
    const pol = X.resolvePolicy(ctx.test);
    const nowMs = Date.now();
    const rows = attempts.map((a) => {
      const evs = [...(classicBy.get(a.id) || []), ...(extraBy.get(a.id) || [])];
      const risk = X.computeRisk(evs);
      const last = evs.sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt))[0];
      return {
        attemptId: a.id, student: a.student, status: a.status, startedAt: a.startedAt, submittedAt: a.submittedAt,
        autoSubmitReason: a.autoSubmitReason, violationCount: a.violationCount, eventCount: evs.length,
        risk: risk.level, riskScore: risk.score, lastEvent: last ? { type: last.type, at: last.createdAt } : null,
        pendingReview: (extraBy.get(a.id) || []).filter((e) => e.reviewStatus === "PENDING" && e.severity !== "LOW").length,
        device: sessBy.get(a.id) ? { deviceId: sessBy.get(a.id).deviceId, label: devLabels.get(sessBy.get(a.id).examDeviceId) || null, kind: sessBy.get(a.id).clientKind } : null,
        connection: a.status !== "IN_PROGRESS" ? "ENDED" : (sessBy.get(a.id) ? (sessBy.get(a.id).lockedAt && !sessBy.get(a.id).unlockedAt ? "LOCKED" : SecureExam.connectionState(sessBy.get(a.id), { heartbeatSec: 15, graceSec: pol.graceSec }, nowMs)) : (pol.secureBrowserRequired ? "NO_SECURE_SESSION" : "BROWSER")),
        progress: { answered: (subBy.get(a.id) || {}).answered || 0, accepted: (subBy.get(a.id) || {}).accepted || 0 },
        secondsLeft: a.status === "IN_PROGRESS" ? Math.max(0, Math.round((new Date(a.startedAt).getTime() + ctx.test.timeLimitMin * 60000 - nowMs) / 1000)) : 0,
      };
    });
    res.json({
      test: { id: ctx.test.id, title: ctx.test.title }, policy: X.clientPolicy(X.resolvePolicy(ctx.test)),
      proctoring: { enabled: ctx.test.proctoring, camera: ctx.test.requireWebcam, microphone: ctx.test.requireMicrophone, maxViolations: ctx.test.maxViolations },
      total, page, pageSize, rows, summary: await monitorSummary(ctx.test, studentScope, pol),
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

// (The managed-browser handshake now lives in routes/secureExam.js: device-bound challenge/response sessions.)

module.exports = router;
module.exports.recordServerEvent = recordServerEvent;
