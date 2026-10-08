// Exam-security API: evidence intake (batched from the exam page), the staff monitor + per-attempt timeline, human review
// of evidence, and the managed-browser handshake. Authority lives here; the browser only reports. See docs/EXAM_SECURITY.md.
const express = require("express");
const { Prisma } = require("@prisma/client");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { ownsLmsInstitute, resolveModuleCodingTestCourseInstituteId } = require("../utils/lmsOwnership");
const X = require("../utils/examSecurity");
const SecureExam = require("../utils/secureExam");
const { canStaffAccessTest } = require("../utils/testOwnership");
const SecurityTypes = require("../utils/testExamSecurity");
const { policyOf } = SecurityTypes;

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
        connection: a.status !== "IN_PROGRESS" ? "ENDED" : (sessBy.get(a.id) ? (sessBy.get(a.id).lockedAt && !sessBy.get(a.id).unlockedAt ? "LOCKED" : (SecureExam.connectionState(sessBy.get(a.id), { heartbeatSec: 15, graceSec: pol.graceSec }, nowMs) === "ENDED" ? "SESSION_ENDED" : SecureExam.connectionState(sessBy.get(a.id), { heartbeatSec: 15, graceSec: pol.graceSec }, nowMs))) : (pol.secureBrowserRequired ? "NO_SECURE_SESSION" : "BROWSER")),
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

// ------------------------------------------------------------------ formal Test engine (MCQ / company / coding tests)
// Same evidence model for tests.js attempts: classic strikes (TestViolation) + newer evidence (ExamSecurityEvent, kind TEST).
async function loadFormalTestScoped(req, res) {
  const test = await prisma.test.findUnique({
    where: { id: req.params.testId },
    select: { id: true, title: true, instituteId: true, createdById: true, durationMin: true, securityLevel: true, securityPolicy: true, requireFullscreen: true, shares: { select: { staffId: true } } },
  });
  if (!test) { res.status(404).json({ error: "Test not found" }); return null; }
  if (req.requesterInstituteId && test.instituteId && test.instituteId !== req.requesterInstituteId) { res.status(403).json({ error: "You can only view tests under your own institute" }); return null; }
  if (!canStaffAccessTest(req, test)) { res.status(403).json({ error: "You can only view tests you created or that were shared with you" }); return null; }
  return test;
}

// Shared scoring for the three attempt kinds. `attempts`: [{ attemptId, student, status, startedAt, submittedAt, strikes, deadlineAt|null }].
// `classic`/`extra`: evidence rows carrying attemptId/type/severity/createdAt (+ reviewStatus for `extra`).
function buildMonitorRows(attempts, classic, extra) {
  const by = (arr) => { const m = new Map(); for (const e of arr) { if (!m.has(e.attemptId)) m.set(e.attemptId, []); m.get(e.attemptId).push(e); } return m; };
  const classicBy = by(classic), extraBy = by(extra);
  const nowMs = Date.now();
  return attempts.map((a) => {
    const evs = [...(classicBy.get(a.attemptId) || []), ...(extraBy.get(a.attemptId) || [])];
    const risk = X.computeRisk(evs);
    const count = (...types) => evs.filter((e) => types.includes(e.type)).length;
    const last = evs.slice().sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt))[0];
    return {
      attemptId: a.attemptId, student: a.student, status: a.status, startedAt: a.startedAt, submittedAt: a.submittedAt, strikes: a.strikes, eventCount: evs.length,
      risk: risk.level, riskScore: risk.score, lastEvent: last ? { type: last.type, at: last.createdAt } : null,
      label: a.label || null,
      counts: {
        fullscreenExits: count("FULLSCREEN_EXIT"), tabSwitches: count("TAB_SWITCH", "TAB_SWITCH_BRIEF", "PAGE_HIDDEN"), focusLoss: count("POSSIBLE_EXTERNAL_ASSISTANT"),
        splitScreen: count("SPLIT_SCREEN_SUSPECTED", "SCREEN_OVERLAY_DETECTED"), copy: count("COPY", "COPY_ATTEMPT"), paste: count("PASTE", "PASTE_ATTEMPT"),
        sessionConflicts: count("MULTIPLE_SESSION", "SESSION_REPLACED"),
      },
      secondsLeft: a.status === "IN_PROGRESS" && a.deadlineAt ? Math.max(0, Math.round((a.deadlineAt - nowMs) / 1000)) : 0,
      pendingReview: (extraBy.get(a.attemptId) || []).filter((e) => e.reviewStatus === "PENDING" && e.severity !== "LOW").length,
    };
  });
}

function monitorResponse({ req, title, policy, scored }) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
  const riskFilter = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(req.query.risk) ? req.query.risk : null;
  const bands = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const r of scored) bands[r.risk]++;
  const filtered = riskFilter ? scored.filter((r) => r.risk === riskFilter) : scored;
  const sum = (f) => scored.reduce((s, r) => s + f(r), 0);
  return {
    test: title, policy, total: filtered.length, page, pageSize, rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    summary: {
      attempts: scored.length, active: scored.filter((r) => r.status === "IN_PROGRESS").length, bands,
      fullscreenExits: sum((r) => r.counts.fullscreenExits), tabSwitches: sum((r) => r.counts.tabSwitches),
      possibleExternalActivity: sum((r) => r.counts.focusLoss + r.counts.splitScreen), sessionConflicts: sum((r) => r.counts.sessionConflicts),
    },
  };
}

router.get("/exams/:testId/monitor", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const test = await loadFormalTestScoped(req, res); if (!test) return;
    const studentScope = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
    const all = await prisma.testAttempt.findMany({
      where: { testId: test.id, student: studentScope }, orderBy: { startedAt: "desc" }, take: 3000,
      select: { id: true, status: true, startedAt: true, submittedAt: true, tabSwitchCount: true, student: { select: { id: true, name: true, registrationNumber: true, rollNumber: true, department: true } } },
    });
    const ids = all.map((a) => a.id);
    const [classic, extra] = ids.length ? await Promise.all([
      prisma.testViolation.findMany({ where: { attemptId: { in: ids } }, select: { attemptId: true, type: true, severity: true, penalized: true, createdAt: true } }),
      prisma.examSecurityEvent.findMany({ where: { attemptKind: "TEST", attemptId: { in: ids } }, select: { attemptId: true, type: true, severity: true, reviewStatus: true, createdAt: true } }),
    ]) : [[], []];
    const attempts = all.map((a) => ({ attemptId: a.id, student: a.student, status: a.status, startedAt: a.startedAt, submittedAt: a.submittedAt, strikes: a.tabSwitchCount, deadlineAt: new Date(a.startedAt).getTime() + test.durationMin * 60000 }));
    res.json(monitorResponse({ req, title: { id: test.id, title: test.title }, policy: X.clientPolicy(policyOf(test)), scored: buildMonitorRows(attempts, classic, extra) }));
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load monitor" }); }
});

// READINESS: one row per assessment attempt of a subject (policy = the subject's current level; each attempt keeps its own snapshot).
router.get("/readiness/:subjectId/monitor", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const subject = await prisma.readinessSubject.findUnique({ where: { id: req.params.subjectId }, select: { id: true, name: true, instituteId: true, createdById: true, securityLevel: true, securityPolicy: true } });
    if (!subject) return res.status(404).json({ error: "Readiness test not found" });
    if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) return res.status(404).json({ error: "Readiness test not found" });
    if (req.user.role === "STAFF" && subject.createdById && subject.createdById !== req.user.id) return res.status(403).json({ error: "You can only view readiness tests you created" });
    const studentScope = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
    const all = await prisma.readinessAssessment.findMany({
      where: { subjectId: subject.id, student: studentScope }, orderBy: { startedAt: "desc" }, take: 3000,
      select: { id: true, status: true, startedAt: true, submittedAt: true, violationCount: true, durationMin: true, assessmentMode: true, student: { select: { id: true, name: true, registrationNumber: true, rollNumber: true, department: true } } },
    });
    const ids = all.map((a) => a.id);
    const [classic, extra] = ids.length ? await Promise.all([
      prisma.readinessViolation.findMany({ where: { assessmentId: { in: ids } }, select: { assessmentId: true, type: true, severity: true, penalized: true, createdAt: true } }),
      prisma.examSecurityEvent.findMany({ where: { attemptKind: "READINESS", attemptId: { in: ids } }, select: { attemptId: true, type: true, severity: true, reviewStatus: true, createdAt: true } }),
    ]) : [[], []];
    const attempts = all.map((a) => ({ attemptId: a.id, student: a.student, status: a.status, startedAt: a.startedAt, submittedAt: a.submittedAt, strikes: a.violationCount, label: a.assessmentMode, deadlineAt: new Date(a.startedAt).getTime() + (a.durationMin || 0) * 60000 }));
    res.json(monitorResponse({ req, title: { id: subject.id, title: `${subject.name} (readiness)` }, policy: X.clientPolicy(policyOf(subject)), scored: buildMonitorRows(attempts, classic.map((c) => ({ ...c, attemptId: c.assessmentId })), extra) }));
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load monitor" }); }
});

// INTERVIEW: one row per mock-interview session in the caller's institute scope. Optional ?type=MOCK|COMPANY_ROUND|TALENT_POOL|RESUME_BASED|CATEGORY.
router.get("/interviews/monitor", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const studentScope = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
    const typeWhere = {
      MOCK: { isMock: true }, COMPANY_ROUND: { isCompanyRound: true }, RESUME_BASED: { isResumeBased: true }, TALENT_POOL: { talentPoolConfigId: { not: null } },
      CATEGORY: { isMock: false, isCompanyRound: false, isResumeBased: false, talentPoolConfigId: null },
    }[req.query.type] || {};
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));
    const all = await prisma.interviewSession.findMany({
      where: { student: studentScope, startedAt: { gte: new Date(Date.now() - days * 86400000) }, ...typeWhere }, orderBy: { startedAt: "desc" }, take: 3000,
      select: { id: true, status: true, startedAt: true, submittedAt: true, violationCount: true, config: true, isMock: true, isCompanyRound: true, isResumeBased: true, talentPoolConfigId: true, category: true, student: { select: { id: true, name: true, registrationNumber: true, rollNumber: true, department: true } } },
    });
    const ids = all.map((a) => a.id);
    const [classic, extra] = ids.length ? await Promise.all([
      prisma.interviewViolation.findMany({ where: { sessionId: { in: ids } }, select: { sessionId: true, type: true, severity: true, penalized: true, createdAt: true } }),
      prisma.examSecurityEvent.findMany({ where: { attemptKind: "INTERVIEW", attemptId: { in: ids } }, select: { attemptId: true, type: true, severity: true, reviewStatus: true, createdAt: true } }),
    ]) : [[], []];
    const attempts = all.map((a) => ({
      attemptId: a.id, student: a.student, status: a.status, startedAt: a.startedAt, submittedAt: a.submittedAt, strikes: a.violationCount,
      label: SecurityTypes.interviewTypeOf(a), deadlineAt: a.config?.durationMin ? new Date(a.startedAt).getTime() + a.config.durationMin * 60000 : null,
    }));
    res.json(monitorResponse({ req, title: { id: "interviews", title: `Mock interviews (last ${days} days)` }, policy: X.clientPolicy(policyOf({ securityLevel: "PROCTORED" })), scored: buildMonitorRows(attempts, classic.map((c) => ({ ...c, attemptId: c.sessionId })), extra) }));
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load monitor" }); }
});

// AI VOICE INTERVIEW: one row per session in the caller's institute scope (evidence is ExamSecurityEvent kind AI_INTERVIEW only).
router.get("/ai-interviews/monitor", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const studentScope = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));
    const all = await prisma.aiInterviewSession.findMany({
      where: { student: studentScope, createdAt: { gte: new Date(Date.now() - days * 86400000) }, status: { not: "CREATED" } }, orderBy: { createdAt: "desc" }, take: 3000,
      select: { id: true, status: true, startedAt: true, completedAt: true, expiresAt: true, interviewType: true, securityLevel: true, student: { select: { id: true, name: true, registrationNumber: true, rollNumber: true, department: true } } },
    });
    const ids = all.map((a) => a.id);
    const extra = ids.length ? await prisma.examSecurityEvent.findMany({ where: { attemptKind: "AI_INTERVIEW", attemptId: { in: ids } }, select: { attemptId: true, type: true, severity: true, reviewStatus: true, createdAt: true } }) : [];
    const active = new Set(["INTRODUCTION", "QUESTIONING", "FOLLOW_UP", "DEEP_DIVE", "SKILL_TRANSITION", "FINAL_QUESTION"]);
    const attempts = all.map((a) => ({
      attemptId: a.id, student: a.student, status: active.has(a.status) ? "IN_PROGRESS" : a.status, startedAt: a.startedAt || a.createdAt, submittedAt: a.completedAt, strikes: 0,
      label: `${a.interviewType}${a.securityLevel === "PROCTORED" ? " · proctored" : ""}`, deadlineAt: a.expiresAt ? new Date(a.expiresAt).getTime() : null,
    }));
    res.json(monitorResponse({ req, title: { id: "ai-interviews", title: `AI voice interviews (last ${days} days)` }, policy: X.clientPolicy(policyOf({ securityLevel: "PROCTORED" })), scored: buildMonitorRows(attempts, [], extra) }));
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load monitor" }); }
});

// Timeline for one attempt of any kind: ?kind=TEST (default) | READINESS | INTERVIEW. Scope checks are per kind and all institute-bound.
router.get("/exam-attempts/:attemptId/timeline", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const kind = ["READINESS", "INTERVIEW", "AI_INTERVIEW"].includes(req.query.kind) ? req.query.kind : "TEST";
    const id = req.params.attemptId;
    let head, classic;
    const inst = req.requesterInstituteId;
    if (kind === "TEST") {
      const a = await prisma.testAttempt.findUnique({ where: { id }, include: { student: { select: { id: true, name: true, instituteId: true, registrationNumber: true } }, test: { select: { id: true, instituteId: true, createdById: true, shares: { select: { staffId: true } } } } } });
      if (!a) return res.status(404).json({ error: "Attempt not found" });
      if (inst && (a.student.instituteId !== inst || (a.test.instituteId && a.test.instituteId !== inst))) return res.status(403).json({ error: "Not allowed" });
      if (!canStaffAccessTest(req, a.test)) return res.status(403).json({ error: "Not allowed" });
      head = a; classic = await prisma.testViolation.findMany({ where: { attemptId: id }, orderBy: { createdAt: "asc" }, take: 500 });
    } else if (kind === "READINESS") {
      const a = await prisma.readinessAssessment.findUnique({ where: { id }, include: { student: { select: { id: true, name: true, instituteId: true, registrationNumber: true } }, subject: { select: { instituteId: true, createdById: true } } } });
      if (!a) return res.status(404).json({ error: "Attempt not found" });
      if (inst && (a.student.instituteId !== inst || (a.subject.instituteId && a.subject.instituteId !== inst))) return res.status(403).json({ error: "Not allowed" });
      if (req.user.role === "STAFF" && a.subject.createdById && a.subject.createdById !== req.user.id) return res.status(403).json({ error: "Not allowed" });
      head = a; classic = await prisma.readinessViolation.findMany({ where: { assessmentId: id }, orderBy: { createdAt: "asc" }, take: 500 });
    } else if (kind === "AI_INTERVIEW") {
      const a = await prisma.aiInterviewSession.findUnique({ where: { id }, include: { student: { select: { id: true, name: true, instituteId: true, registrationNumber: true } } } });
      if (!a) return res.status(404).json({ error: "Attempt not found" });
      if (inst && a.student.instituteId !== inst) return res.status(403).json({ error: "Not allowed" });
      head = { ...a, startedAt: a.startedAt || a.createdAt, submittedAt: a.completedAt }; classic = [];
    } else {
      const a = await prisma.interviewSession.findUnique({ where: { id }, include: { student: { select: { id: true, name: true, instituteId: true, registrationNumber: true } } } });
      if (!a) return res.status(404).json({ error: "Attempt not found" });
      if (inst && a.student.instituteId !== inst) return res.status(403).json({ error: "Not allowed" });
      head = a; classic = await prisma.interviewViolation.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" }, take: 500 });
    }
    const extra = await prisma.examSecurityEvent.findMany({ where: { attemptKind: kind, attemptId: id }, orderBy: { createdAt: "asc" }, take: 500 });
    const timeline = [
      { at: head.startedAt, type: "EXAM_STARTED", source: "system" },
      ...classic.map((c) => ({ id: c.id, at: c.createdAt, type: c.type, severity: c.severity, penalized: c.penalized, source: "proctoring" })),
      ...extra.map((e) => ({ id: e.id, at: e.createdAt, type: e.type, severity: e.severity, metadata: e.metadata, reviewable: true, reviewStatus: e.reviewStatus, reviewNote: e.reviewNote, source: "security" })),
      ...(head.submittedAt ? [{ at: head.submittedAt, type: head.terminationReason === "MAX_VIOLATIONS" ? "ENDED_BY_STRIKE_LIMIT" : ["AUTO_SUBMITTED", "TERMINATED"].includes(head.status) ? head.status : "SUBMITTED", source: "system" }] : []),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));
    const risk = X.computeRisk([...classic, ...extra]);
    res.json({ attemptId: head.id, student: head.student, status: head.status, risk: risk.level, riskScore: risk.score, byType: risk.byType, timeline });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load timeline" }); }
});

// Platform / institute security overview: live attempts and the last 24 h of evidence, aggregated in SQL (no per-attempt loops).
// Institute-scoped callers are pinned to their own institute; only platform-level callers see every institute.
router.get("/overview", authenticate, requireRole("SUPER_ADMIN", "ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const inst = req.requesterInstituteId || null;
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 24));
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const scope = inst ? { instituteId: inst } : {};
    const instSql = inst ? Prisma.sql`AND u."instituteId" = ${inst}` : Prisma.empty;
    const [activeTests, activeCoding, newer, classic, penalizedAttempts, byInstitute, activeReadiness, activeInterviews, classicR, classicI, activeAi] = await Promise.all([
      prisma.testAttempt.count({ where: { status: "IN_PROGRESS", student: scope } }),
      prisma.moduleCodingAttempt.count({ where: { status: "IN_PROGRESS", student: scope } }),
      prisma.$queryRaw`SELECT e.type, COUNT(*)::int AS n FROM "ExamSecurityEvent" e JOIN "User" u ON u.id = e."studentId" WHERE e."createdAt" >= ${since} ${instSql} GROUP BY e.type`,
      prisma.$queryRaw`SELECT v.type, COUNT(*)::int AS n FROM "TestViolation" v JOIN "TestAttempt" a ON a.id = v."attemptId" JOIN "User" u ON u.id = a."studentId" WHERE v."createdAt" >= ${since} ${instSql} GROUP BY v.type`,
      prisma.$queryRaw`SELECT COUNT(DISTINCT v."attemptId")::int AS n FROM "TestViolation" v JOIN "TestAttempt" a ON a.id = v."attemptId" JOIN "User" u ON u.id = a."studentId" WHERE v."createdAt" >= ${since} AND v.penalized = true ${instSql}`,
      inst ? [] : prisma.$queryRaw`SELECT i.id, i.name, COUNT(*)::int AS n FROM "TestViolation" v JOIN "TestAttempt" a ON a.id = v."attemptId" JOIN "User" u ON u.id = a."studentId" JOIN "Institute" i ON i.id = u."instituteId" WHERE v."createdAt" >= ${since} GROUP BY i.id, i.name ORDER BY n DESC LIMIT 5`,
      prisma.readinessAssessment.count({ where: { status: "IN_PROGRESS", student: scope } }),
      prisma.interviewSession.count({ where: { status: "IN_PROGRESS", student: scope } }),
      prisma.$queryRaw`SELECT v.type, COUNT(*)::int AS n FROM "ReadinessViolation" v JOIN "ReadinessAssessment" a ON a.id = v."assessmentId" JOIN "User" u ON u.id = a."studentId" WHERE v."createdAt" >= ${since} ${instSql} GROUP BY v.type`,
      prisma.$queryRaw`SELECT v.type, COUNT(*)::int AS n FROM "InterviewViolation" v JOIN "InterviewSession" a ON a.id = v."sessionId" JOIN "User" u ON u.id = a."studentId" WHERE v."createdAt" >= ${since} ${instSql} GROUP BY v.type`,
      prisma.aiInterviewSession.count({ where: { status: { in: ["INTRODUCTION", "QUESTIONING", "FOLLOW_UP", "DEEP_DIVE", "SKILL_TRANSITION", "FINAL_QUESTION"] }, student: scope } }),
    ]);
    const totals = {};
    for (const r of [...newer, ...classic, ...classicR, ...classicI]) totals[r.type] = (totals[r.type] || 0) + Number(r.n);
    const sum = (...t) => t.reduce((s, k) => s + (totals[k] || 0), 0);
    res.json({
      hours, scope: inst ? "INSTITUTE" : "PLATFORM",
      live: { testAttempts: activeTests, codingAttempts: activeCoding, readinessAttempts: activeReadiness, interviewSessions: activeInterviews, aiInterviewSessions: activeAi, studentsTesting: activeTests + activeCoding + activeReadiness + activeInterviews + activeAi },
      last: {
        attemptsWithStrikes: Number(penalizedAttempts[0]?.n || 0),
        fullscreenExits: sum("FULLSCREEN_EXIT"), tabSwitches: sum("TAB_SWITCH", "TAB_SWITCH_BRIEF", "PAGE_HIDDEN"),
        possibleExternalActivity: sum("POSSIBLE_EXTERNAL_ASSISTANT", "SPLIT_SCREEN_SUSPECTED", "SCREEN_OVERLAY_DETECTED"),
        clipboardAttempts: sum("COPY", "PASTE", "CUT", "COPY_ATTEMPT", "PASTE_ATTEMPT", "CLIPBOARD_ATTEMPT"),
        sessionConflicts: sum("MULTIPLE_SESSION", "SESSION_REPLACED"), devtoolsSuspected: sum("DEVTOOLS", "DEVTOOLS_ATTEMPT"),
        secureClientFailures: sum("SECURE_CLIENT_STOPPED", "KIOSK_EXIT", "APPLICATION_POLICY_FAILURE", "BROWSER_POLICY_FAILURE", "NETWORK_POLICY_FAILURE", "DEVICE_MISMATCH", "VERSION_MISMATCH"),
      },
      byType: Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([type, n]) => ({ type, n })),
      topInstitutes: byInstitute.map((r) => ({ id: r.id, name: r.name, events: Number(r.n) })),
      note: "Counts are evidence signals for human review, not findings of malpractice.",
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load security overview" }); }
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
    const instituteId = ev.testId
      ? (ev.attemptKind === "TEST" ? ((await prisma.test.findUnique({ where: { id: ev.testId }, select: { instituteId: true } }))?.instituteId ?? null) : ev.attemptKind === "READINESS" ? ((await prisma.readinessSubject.findUnique({ where: { id: ev.testId }, select: { instituteId: true } }))?.instituteId ?? null) : await resolveModuleCodingTestCourseInstituteId(ev.testId))
      : null;
    if (!ownsLmsInstitute(req, instituteId) || (req.requesterInstituteId && student?.instituteId !== req.requesterInstituteId)) return res.status(403).json({ error: "Not allowed" });
    const updated = await prisma.examSecurityEvent.update({ where: { id: ev.id }, data: { reviewStatus, reviewNote: note ? String(note).slice(0, 500) : null, reviewedById: req.user.id, reviewedAt: new Date() } });
    await logAudit({ req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, studentId: ev.studentId, instituteId: student?.instituteId || null, details: { entity: "examSecurityEvent", operation: "review", eventId: ev.id, type: ev.type, reviewStatus } });
    res.json({ id: updated.id, reviewStatus: updated.reviewStatus, reviewNote: updated.reviewNote });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to save review" }); }
});

// (The managed-browser handshake now lives in routes/secureExam.js: device-bound challenge/response sessions.)

module.exports = router;
module.exports.recordServerEvent = recordServerEvent;
