// Section-wise examination API, mounted at /api/exams. Students use /available, /:examId/attempts and /attempts/*; administrators use /admin/*.
// Authorisation is enforced here and in the modules, never in the browser: ownership of every attempt, the institute of every examination, the state machine on every transition.
const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../../prisma");
const { authenticate, requireRole } = require("../../middleware/auth");
const { attachRequesterInstitute } = require("../../middleware/institute");
const attempts = require("./exams.attempts");
const admin = require("./exams.admin");
const view = require("./exams.view");
const aiEval = require("./exams.interviewEval");

const router = express.Router();
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"];
const REVIEW_ROLES = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"]; // invalidating, reviewing and publishing are not delegated to staff
const byUser = (req) => req.user.id;
const startLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, keyGenerator: byUser });
const saveLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, keyGenerator: byUser });
const codeLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: byUser });
const eventLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, keyGenerator: byUser });

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => { console.error("[exams]", req.method, req.originalUrl, err); if (!res.headersSent) res.status(500).json({ error: "Something went wrong. Your saved answers are safe." }); });
function send(res, r, okStatus = 200) {
  if (r.ok) { const { ok, ...rest } = r; return res.status(okStatus).json(rest); }
  const { ok, status, message, code, ...rest } = r;
  return res.status(status).json({ error: message, code, ...rest });
}

// ---- student ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function currentStudent(req) {
  return prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, instituteId: true, academicGroupId: true } });
}

async function ownAttempt(req, res, next) {
  try {
    const a = await attempts.loadFull(req.params.id);
    if (!a || a.studentId !== req.user.id) return res.status(404).json({ error: "Attempt not found", code: "NOT_FOUND" });
    req.attempt = await attempts.applyExpiry(a); // the server closes an overdue attempt or section before anything else happens
    next();
  } catch (err) { console.error("[exams] load attempt", err); res.status(500).json({ error: "Could not load the attempt." }); }
}
function sameSession(req, res, next) {
  if (!attempts.sessionAllows(req.attempt, req)) return res.status(409).json({ error: "This examination is open in another tab, window or device. Close this one and continue there.", code: "SESSION_REPLACED" });
  next();
}
const student = [authenticate, requireRole("STUDENT")];

router.get("/available", ...student, wrap(async (req, res) => res.json({ exams: await attempts.listAvailable(await currentStudent(req)) })));

router.post("/:examId/attempts", ...student, startLimiter, wrap(async (req, res) => {
  const r = await attempts.startAttempt({ student: await currentStudent(req), examId: req.params.examId, mode: String(req.body?.mode || "") });
  return send(res, r, r.ok && !r.resumed ? 201 : 200);
}));

router.get("/attempts/:id", ...student, ownAttempt, wrap(async (req, res) => {
  const a = req.attempt;
  // self-heal: an AI evaluation that was pending when the server restarted is picked up again, and a result that is still pending is refreshed
  if (a.status === "EVALUATING" || a.status === "COMPLETED") {
    const stale = !a.resultComputedAt || Date.now() - +a.resultComputedAt > 30000;
    if (a.resultStatus === "EVALUATION_PENDING" && stale && !aiEval.isRunning(a.id)) attempts.refreshAfterEvaluation(a.id).then(() => aiEval.runInterviewEvaluations(a.id, { onSettled: attempts.refreshAfterEvaluation })).catch(() => {});
  }
  res.json(await view.studentView(a));
}));

router.post("/attempts/:id/begin", ...student, ownAttempt, wrap(async (req, res) => {
  const r = await attempts.beginAttempt(req.attempt, req.body?.readiness);
  if (!r.ok) return send(res, r);
  const fresh = await attempts.loadFull(req.attempt.id);
  res.json(await view.studentView(fresh, { sessionId: r.sessionId }));
}));

router.post("/attempts/:id/claim", ...student, ownAttempt, wrap(async (req, res) => {
  const r = await attempts.claimSession(req.attempt);
  res.json(await view.studentView(await attempts.loadFull(req.attempt.id), { sessionId: r.sessionId }));
}));

router.post("/attempts/:id/sections/:key/open", ...student, ownAttempt, sameSession, wrap(async (req, res) => {
  const r = await attempts.openSection(req.attempt, req.params.key);
  if (!r.ok) return send(res, r);
  res.json(await view.studentView(await attempts.loadFull(req.attempt.id)));
}));

router.put("/attempts/:id/answers/:itemRef", ...student, saveLimiter, ownAttempt, sameSession, wrap(async (req, res) => {
  const r = await attempts.saveAnswer(req.attempt, req.params.itemRef, { version: req.body?.version, payload: req.body?.payload, finalize: !!req.body?.finalize });
  return send(res, r);
}));

router.post("/attempts/:id/items/:itemRef/run", ...student, codeLimiter, ownAttempt, sameSession, wrap(async (req, res) => send(res, await attempts.runCode(req.attempt, req.params.itemRef, { language: req.body?.language, code: req.body?.code }))));
router.post("/attempts/:id/items/:itemRef/submit-code", ...student, codeLimiter, ownAttempt, sameSession, wrap(async (req, res) => send(res, await attempts.submitCode(req.attempt, req.params.itemRef, { language: req.body?.language, code: req.body?.code }))));

router.post("/attempts/:id/sections/:key/complete", ...student, ownAttempt, sameSession, wrap(async (req, res) => {
  const r = await attempts.completeSection(req.attempt, req.params.key, { expectedAnswered: Number.isInteger(req.body?.expectedAnswered) ? req.body.expectedAnswered : undefined });
  if (!r.ok) return send(res, r);
  res.json(await view.studentView(await attempts.loadFull(req.attempt.id)));
}));

router.post("/attempts/:id/submit", ...student, ownAttempt, sameSession, wrap(async (req, res) => {
  const r = await attempts.submitAttempt(req.attempt);
  if (!r.ok) return send(res, r);
  res.json(await view.studentView(await attempts.loadFull(req.attempt.id)));
}));

router.post("/attempts/:id/events", ...student, eventLimiter, ownAttempt, wrap(async (req, res) => send(res, await attempts.recordEvent(req.attempt, { type: req.body?.type, sectionKey: req.body?.sectionKey, clientAt: req.body?.clientAt }))));

router.get("/attempts/:id/report", ...student, ownAttempt, wrap(async (req, res) => res.json(await view.buildReport(req.attempt, { audience: "STUDENT" }))));

// ---- administration -----------------------------------------------------------------------------------------------------------------------------------------------------------
const adminAuth = [authenticate, requireRole(...ADMIN_ROLES), attachRequesterInstitute];
const reviewAuth = [authenticate, requireRole(...REVIEW_ROLES), attachRequesterInstitute];

async function loadManagedExam(req, res, next) {
  const exam = await prisma.examDefinition.findUnique({ where: { id: req.params.id } });
  if (!exam || !admin.canManage(req, exam)) return res.status(404).json({ error: "Examination not found", code: "NOT_FOUND" }); // not 403: another institute's exam is not confirmed to exist
  req.exam = exam;
  next();
}
async function loadManagedAttempt(req, res, next) {
  const a = await attempts.loadFull(req.params.id);
  const exam = a ? await prisma.examDefinition.findUnique({ where: { id: a.examId } }) : null;
  if (!a || !exam || !admin.canManage(req, exam)) return res.status(404).json({ error: "Attempt not found", code: "NOT_FOUND" });
  req.attempt = a; req.exam = exam;
  next();
}

router.get("/admin/sources", ...adminAuth, wrap(async (req, res) => res.json(await admin.sources(req, req.query))));
router.get("/admin/exams", ...adminAuth, wrap(async (req, res) => res.json(await admin.listExams(req, req.query))));
router.post("/admin/exams", ...adminAuth, wrap(async (req, res) => { const r = await admin.createExam(req, req.body || {}); return send(res, r, 201); }));
router.get("/admin/exams/:id", ...adminAuth, loadManagedExam, wrap(async (req, res) => res.json(await admin.getExam(req, req.exam))));
router.put("/admin/exams/:id", ...adminAuth, loadManagedExam, wrap(async (req, res) => send(res, await admin.updateExam(req, req.exam, req.body || {}))));
router.post("/admin/exams/:id/validate", ...adminAuth, loadManagedExam, wrap(async (req, res) => {
  const { validateFullBlueprint } = require("../../utils/examSources");
  const core = require("./exams.core");
  const v = validateFullBlueprint(req.exam.blueprint);
  const out = { valid: v.valid, errors: v.errors, warnings: v.warnings };
  if (v.valid) { const a = await core.availability(v.normalized, req.exam.instituteId); out.shortages = a.shortages; out.invalidQuestionsExcluded = a.invalidCount; out.groups = Object.fromEntries(Object.entries(a.report).map(([k, r]) => [k, r.groups])); }
  res.json(out);
}));
router.post("/admin/exams/:id/publish", ...adminAuth, loadManagedExam, wrap(async (req, res) => send(res, await admin.publishExam(req, req.exam))));
router.post("/admin/exams/:id/archive", ...adminAuth, loadManagedExam, wrap(async (req, res) => { await prisma.examDefinition.update({ where: { id: req.exam.id }, data: { status: "ARCHIVED" } }); res.json({ status: "ARCHIVED" }); }));
router.get("/admin/exams/:id/attempts", ...adminAuth, loadManagedExam, wrap(async (req, res) => res.json(await admin.listAttempts(req.exam, req.query))));
router.get("/admin/exams/:id/analytics", ...adminAuth, loadManagedExam, wrap(async (req, res) => res.json(await admin.analytics(req.exam))));
router.get("/admin/exams/:id/export.csv", ...adminAuth, loadManagedExam, wrap(async (req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="exam-${req.exam.id}-results.csv"`);
  for await (const chunk of admin.csvRows(req.exam)) res.write(chunk);
  res.end();
}));
router.post("/admin/exams/:id/publish-results", ...reviewAuth, loadManagedExam, wrap(async (req, res) => res.json(await admin.publishAllResults(req, req.exam))));

router.get("/admin/attempts/:id/report", ...adminAuth, loadManagedAttempt, wrap(async (req, res) => res.json(await view.buildReport(req.attempt, { audience: "ADMIN" }))));
router.post("/admin/attempts/:id/invalidate", ...reviewAuth, loadManagedAttempt, wrap(async (req, res) => send(res, await admin.invalidateAttempt(req, req.attempt, req.body?.reason))));
router.post("/admin/attempts/:id/events/:eventId/review", ...reviewAuth, loadManagedAttempt, wrap(async (req, res) => send(res, await admin.reviewEvent(req, req.attempt, req.params.eventId, { status: req.body?.status, note: req.body?.note }))));
router.post("/admin/attempts/:id/publish-result", ...reviewAuth, loadManagedAttempt, wrap(async (req, res) => send(res, await admin.publishResult(req, req.attempt))));
router.post("/admin/attempts/:id/retry-evaluation", ...adminAuth, loadManagedAttempt, wrap(async (req, res) => send(res, await admin.retryEvaluation(req, req.attempt))));

module.exports = router;
