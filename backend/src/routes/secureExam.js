// Secure exam environment API: device registration (admin), challenge/response session creation, heartbeat, session check,
// staff unlock. Used by the CodeArena Secure Exam Client (secure-client/) and by the Edge kiosk launcher. The exam routes
// in moduleCoding.js call evaluateSecureSession()/bindSessionToAttempt() from here, so the server stays the authority.
const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const S = require("../utils/secureExam");
const X = require("../utils/examSecurity");

const router = express.Router();
const ADMINS = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"];
const STAFF = [...ADMINS, "STAFF"];
const byUser = (req) => req.user?.id || req.ip;
const handshakeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: byUser, standardHeaders: false, legacyHeaders: false });
const heartbeatLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, keyGenerator: byUser, standardHeaders: false, legacyHeaders: false });

async function recordEvent({ type, attempt, session, studentId, instituteId, testId, deviceId, metadata, questionId }) {
  try {
    await prisma.examSecurityEvent.create({ data: {
      attemptKind: "MODULE_CODING", attemptId: attempt?.id || session?.attemptId || "none", studentId: studentId || session?.studentId || attempt?.studentId,
      testId: testId || attempt?.moduleCodingTestId || session?.testId || null, questionId: questionId || null, type,
      severity: X.EVENT_SEVERITY[type] || "MEDIUM", metadata: X.cleanMetadata(metadata),
      instituteId: instituteId || session?.instituteId || null, deviceId: deviceId || session?.deviceId || null,
    } });
  } catch (e) { console.error("[secureExam] could not record", type, e.message); }
}

// ---- called by the exam routes -------------------------------------------------------------------------------------------

// Validate a presented secure-session token for a student (and, when given, the attempt it must be bound to). Returns
//   { ok:true, session, state, checks }  or  { ok:false, code, message, status }
// State is derived from heartbeat age and persisted on transition so HEARTBEAT_LOST is recorded once.
async function evaluateSecureSession(token, { studentId, policy, attemptId = null, now = Date.now() }) {
  if (!S.configured()) return { ok: false, status: 503, code: "SECURE_EXAM_UNAVAILABLE", message: "The secure exam service is not configured. Please contact your invigilator." };
  if (!token) return { ok: false, status: 403, code: "SECURE_CLIENT_REQUIRED", message: "This assessment must be taken in the CodeArena Secure Exam environment. Open it from the secure exam launcher." };
  const session = await prisma.secureExamSession.findUnique({ where: { tokenHash: S.sha256(token) } });
  if (!session || session.studentId !== studentId) {
    return { ok: false, status: 403, code: "SECURE_SESSION_INVALID", message: "The secure exam session is not valid. Restart the secure exam client." };
  }
  if (session.endedAt || session.state === "ENDED" || new Date(session.expiresAt).getTime() < now) {
    return { ok: false, status: 403, code: "SECURE_SESSION_EXPIRED", message: "The secure exam session has ended. Restart the secure exam client." };
  }
  const device = await prisma.examDevice.findUnique({ where: { id: session.examDeviceId } });
  if (!device || device.status !== "ACTIVE" || device.instituteId !== session.instituteId) {
    return { ok: false, status: 403, code: "DEVICE_NOT_ALLOWED", message: "This computer is not registered for secure exams." };
  }
  if (attemptId && session.attemptId && session.attemptId !== attemptId) {
    await recordEvent({ type: "SESSION_TAMPERING", session, attempt: { id: attemptId }, metadata: { reason: "session bound to another attempt" } });
    return { ok: false, status: 403, code: "SECURE_SESSION_MISMATCH", message: "This secure session belongs to a different attempt." };
  }
  const state = S.connectionState(session, { heartbeatSec: 15, graceSec: policy?.graceSec || 120 }, now);
  if (state === "SECURITY_SESSION_LOST") {
    if (session.state !== "SECURITY_SESSION_LOST") {
      const moved = await prisma.secureExamSession.updateMany({ where: { id: session.id, state: { not: "SECURITY_SESSION_LOST" } }, data: { state: "SECURITY_SESSION_LOST", ...(["LOCK", "REQUIRE_INVIGILATOR"].includes(policy?.exitAction) ? { lockedAt: new Date(), lockReason: "heartbeat lost" } : {}) } });
      if (moved.count) await recordEvent({ type: "HEARTBEAT_LOST", session, metadata: { silentSeconds: Math.round((now - new Date(session.lastHeartbeatAt).getTime()) / 1000) } });
    }
    return { ok: false, status: 423, code: "SECURE_SESSION_LOST", message: "The secure exam connection was lost. Reconnect the secure exam client; your timer and answers are preserved." };
  }
  if (session.lockedAt && !session.unlockedAt) {
    return { ok: false, status: 423, code: "SESSION_LOCKED", message: "Your exam is locked. Please call your invigilator." };
  }
  const checks = S.capabilityChecks(policy || { requiredCapabilities: [] }, session.capabilities);
  const failed = S.failedRequired(checks);
  if (failed.length) {
    return { ok: false, status: 403, code: "SECURE_CAPABILITY_MISSING", message: `This computer does not meet the exam security requirements: ${failed.map((f) => f.label).join(", ")}.`, checks };
  }
  if (!S.versionAtLeast(session.clientVersion, S.minClientVersion())) {
    return { ok: false, status: 403, code: "VERSION_MISMATCH", message: "Your secure exam client is out of date. Please update it.", checks };
  }
  return { ok: true, session, state, checks };
}

// Bind a session to the attempt it protects (at start/resume). A previously LOST+LOCKED attempt cannot be re-bound to a
// fresh session until staff unlock it, otherwise "restart the client" would bypass the lock.
async function bindSessionToAttempt(session, attempt, policy) {
  if (session.attemptId === attempt.id) return { ok: true };
  const locked = await prisma.secureExamSession.findFirst({ where: { attemptId: attempt.id, lockedAt: { not: null }, unlockedAt: null } });
  if (locked && ["LOCK", "REQUIRE_INVIGILATOR"].includes(policy?.exitAction)) {
    return { ok: false, status: 423, code: "SESSION_LOCKED", message: "Your exam is locked. Please call your invigilator." };
  }
  // one active secure session per attempt: end the previous one (a reconnect after a crash replaces it)
  await prisma.secureExamSession.updateMany({ where: { attemptId: attempt.id, id: { not: session.id }, endedAt: null }, data: { endedAt: new Date(), state: "ENDED" } });
  await prisma.secureExamSession.update({ where: { id: session.id }, data: { attemptId: attempt.id, testId: attempt.moduleCodingTestId || attempt.testId || null } });
  return { ok: true };
}

// ---- device registration (admins) ---------------------------------------------------------------------------------------

function resolveInstitute(req, res) {
  const id = req.requesterInstituteId || req.body?.instituteId || req.query?.instituteId;
  if (!id) { res.status(400).json({ error: "instituteId is required for a platform-level admin" }); return null; }
  if (req.requesterInstituteId && (req.body?.instituteId || req.query?.instituteId) && (req.body?.instituteId || req.query?.instituteId) !== req.requesterInstituteId) {
    res.status(403).json({ error: "You can only manage devices of your own institute" }); return null;
  }
  return id;
}

router.post("/devices", authenticate, requireRole(...ADMINS), attachRequesterInstitute, async (req, res) => {
  try {
    if (!S.configured()) return res.status(503).json({ error: "SECURE_BROWSER_SECRET is not configured on the server (min 16 characters)" });
    const instituteId = resolveInstitute(req, res); if (!instituteId) return;
    const label = String(req.body?.label || "").trim().slice(0, 80);
    if (!label) return res.status(400).json({ error: "label is required (for example Lab 3 PC 14)" });
    const deviceId = String(req.body?.deviceId || `dev-${require("crypto").randomBytes(6).toString("hex")}`).trim().slice(0, 64);
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(deviceId)) return res.status(400).json({ error: "deviceId may contain letters, digits, dot, dash and underscore (3-64 characters)" });
    const institute = await prisma.institute.findUnique({ where: { id: instituteId }, select: { id: true } });
    if (!institute) return res.status(404).json({ error: "Institute not found" });
    const device = await prisma.examDevice.create({ data: { instituteId, deviceId, label, registeredById: req.user.id } });
    await logAudit({ req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId, details: { entity: "examDevice", operation: "register", deviceId, label } });
    // The secret is derived, not stored; this is the only time it is shown.
    res.json({ device: { id: device.id, deviceId, label, status: device.status }, deviceSecret: S.deriveDeviceSecret(instituteId, deviceId), note: "Store this secret in the secure client's protected config now. It cannot be shown again." });
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A device with this id is already registered for the institute" : "Failed to register device" });
  }
});

router.get("/devices", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const where = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : (req.query.instituteId ? { instituteId: String(req.query.instituteId) } : {});
    const page = Math.max(1, Number(req.query.page) || 1), pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
    const [total, rows] = await Promise.all([
      prisma.examDevice.count({ where }),
      prisma.examDevice.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, instituteId: true, deviceId: true, label: true, status: true, clientVersion: true, clientKind: true, capabilities: true, lastHeartbeatAt: true, createdAt: true } }),
    ]);
    res.json({ total, page, pageSize, rows });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load devices" }); }
});

router.patch("/devices/:id", authenticate, requireRole(...ADMINS), attachRequesterInstitute, async (req, res) => {
  try {
    const device = await prisma.examDevice.findUnique({ where: { id: req.params.id } });
    if (!device || (req.requesterInstituteId && device.instituteId !== req.requesterInstituteId)) return res.status(404).json({ error: "Device not found" });
    const data = {};
    if (req.body?.status !== undefined) { if (!["ACTIVE", "REVOKED"].includes(req.body.status)) return res.status(400).json({ error: "status must be ACTIVE or REVOKED" }); data.status = req.body.status; }
    if (req.body?.label !== undefined) data.label = String(req.body.label).slice(0, 80);
    const updated = await prisma.examDevice.update({ where: { id: device.id }, data });
    if (data.status === "REVOKED") await prisma.secureExamSession.updateMany({ where: { examDeviceId: device.id, endedAt: null }, data: { endedAt: new Date(), state: "ENDED" } });
    await logAudit({ req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId: device.instituteId, details: { entity: "examDevice", operation: data.status ? data.status.toLowerCase() : "edit", deviceId: device.deviceId } });
    res.json({ id: updated.id, status: updated.status, label: updated.label });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to update device" }); }
});

// ---- handshake (students, from the secure client) -----------------------------------------------------------------------

async function studentContext(req, res) {
  const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, instituteId: true } });
  if (!student?.instituteId) { res.status(403).json({ error: "Your account has no institute; secure exams are unavailable" }); return null; }
  return student;
}

router.post("/challenge", authenticate, requireRole("STUDENT"), handshakeLimiter, async (req, res) => {
  try {
    if (!S.configured()) return res.status(503).json({ code: "SECURE_EXAM_UNAVAILABLE", error: "The secure exam service is not configured" });
    const student = await studentContext(req, res); if (!student) return;
    const deviceId = String(req.body?.deviceId || "");
    const device = await prisma.examDevice.findUnique({ where: { instituteId_deviceId: { instituteId: student.instituteId, deviceId } } });
    // Same answer for "unknown" and "other institute's" device: no enumeration.
    if (!device || device.status !== "ACTIVE") return res.status(403).json({ code: "DEVICE_NOT_ALLOWED", error: "This computer is not registered for secure exams" });
    res.json({ nonce: S.makeNonce(student.id, student.instituteId, deviceId), ttlSec: S.NONCE_TTL_MS / 1000, minClientVersion: S.minClientVersion() });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to create challenge" }); }
});

router.post("/session", authenticate, requireRole("STUDENT"), handshakeLimiter, async (req, res) => {
  try {
    if (!S.configured()) return res.status(503).json({ code: "SECURE_EXAM_UNAVAILABLE", error: "The secure exam service is not configured" });
    const student = await studentContext(req, res); if (!student) return;
    const { deviceId, nonce, sig, clientVersion, clientKind, capabilities } = req.body || {};
    if (!deviceId || !nonce || !sig || !clientVersion || !["ELECTRON"].includes(clientKind) || typeof capabilities !== "object") return res.status(400).json({ error: "deviceId, nonce, sig, clientVersion, clientKind and capabilities are required" });
    const device = await prisma.examDevice.findUnique({ where: { instituteId_deviceId: { instituteId: student.instituteId, deviceId: String(deviceId) } } });
    if (!device || device.status !== "ACTIVE") return res.status(403).json({ code: "DEVICE_NOT_ALLOWED", error: "This computer is not registered for secure exams" });
    const evidence = { instituteId: student.instituteId, deviceId: device.deviceId, studentId: student.id };
    if (!S.verifyNonce(nonce, student.id, student.instituteId, device.deviceId)) {
      await recordEvent({ type: "SESSION_TAMPERING", ...evidence, metadata: { reason: "invalid or expired challenge" } });
      return res.status(403).json({ code: "CHALLENGE_INVALID", error: "The challenge is invalid or expired. Try again." });
    }
    const secret = S.deriveDeviceSecret(student.instituteId, device.deviceId);
    if (!S.verifyClientSignature(secret, { nonce, clientVersion: String(clientVersion), clientKind, capabilities }, sig)) {
      await recordEvent({ type: "DEVICE_MISMATCH", ...evidence, metadata: { reason: "bad signature" } });
      return res.status(403).json({ code: "SIGNATURE_INVALID", error: "Secure client authentication failed" });
    }
    if (!S.versionAtLeast(clientVersion, S.minClientVersion())) {
      await recordEvent({ type: "VERSION_MISMATCH", ...evidence, metadata: { version: String(clientVersion).slice(0, 20), minimum: S.minClientVersion() } });
      return res.status(426).json({ code: "VERSION_MISMATCH", error: "Your secure exam client is out of date. Please update it.", minClientVersion: S.minClientVersion() });
    }
    const caps = {}; for (const k of S.CAPABILITIES) caps[k] = !!capabilities[k];
    const token = S.newToken();
    try {
      await prisma.secureExamSession.create({ data: {
        tokenHash: S.sha256(token), nonceHash: S.sha256(nonce), studentId: student.id, instituteId: student.instituteId, examDeviceId: device.id, deviceId: device.deviceId,
        clientVersion: String(clientVersion).slice(0, 20), clientKind, capabilities: caps, expiresAt: new Date(Date.now() + S.sessionTtlMs()),
      } });
    } catch (e) {
      if (e.code === "P2002") { await recordEvent({ type: "SESSION_TAMPERING", ...evidence, metadata: { reason: "challenge replay" } }); return res.status(403).json({ code: "CHALLENGE_INVALID", error: "The challenge was already used" }); }
      throw e;
    }
    await prisma.examDevice.update({ where: { id: device.id }, data: { clientVersion: String(clientVersion).slice(0, 20), clientKind, capabilities: caps, lastHeartbeatAt: new Date() } });
    await recordEvent({ type: "SECURE_CLIENT_STARTED", ...evidence, metadata: { version: String(clientVersion).slice(0, 20), kind: clientKind } });
    res.json({ token, heartbeatSec: 15, expiresInSec: Math.round(S.sessionTtlMs() / 1000), capabilities: caps });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to create secure session" }); }
});

// Heartbeat from the client MAIN PROCESS (not page JavaScript, so tampering with the page cannot silence it). Carries the
// current capability attestation and a small batch of client-detected events.
router.post("/heartbeat", authenticate, requireRole("STUDENT"), heartbeatLimiter, async (req, res) => {
  try {
    const token = req.get("x-secure-session");
    if (!token) return res.status(403).json({ code: "SECURE_CLIENT_REQUIRED", error: "No secure session" });
    const session = await prisma.secureExamSession.findUnique({ where: { tokenHash: S.sha256(token) } });
    if (!session || session.studentId !== req.user.id || session.endedAt || new Date(session.expiresAt).getTime() < Date.now()) return res.status(403).json({ code: "SECURE_SESSION_INVALID", error: "The secure session is not valid" });
    const device = await prisma.examDevice.findUnique({ where: { id: session.examDeviceId } });
    if (!device || device.status !== "ACTIVE") return res.status(403).json({ code: "DEVICE_NOT_ALLOWED", error: "This computer is not registered for secure exams" });

    // Policy comes from the attempt's test (server side). A session not yet bound to an attempt uses a conservative default.
    let policy = { exitAction: "LOCK", graceSec: 120 };
    let attempt = null;
    if (session.attemptId) {
      attempt = await prisma.moduleCodingAttempt.findUnique({ where: { id: session.attemptId }, include: { moduleCodingTest: true } });
      if (attempt) policy = X.resolvePolicy(attempt.moduleCodingTest);
    }
    const wasState = S.connectionState(session, { heartbeatSec: 15, graceSec: policy.graceSec });
    const lockExit = ["LOCK", "REQUIRE_INVIGILATOR"].includes(policy.exitAction);
    const nowDate = new Date();
    const patch = { lastHeartbeatAt: nowDate };
    let locked = !!(session.lockedAt && !session.unlockedAt);
    if (wasState === "SECURITY_SESSION_LOST" && lockExit && !session.lockedAt) { patch.lockedAt = nowDate; patch.lockReason = "heartbeat lost"; locked = true; }
    const restoring = wasState !== "CONNECTED";
    if (!locked) patch.state = "CONNECTED"; else patch.state = "SECURITY_SESSION_LOST";
    if (req.body?.capabilities && typeof req.body.capabilities === "object") { const caps = {}; for (const k of S.CAPABILITIES) caps[k] = !!req.body.capabilities[k]; patch.capabilities = caps; }
    await prisma.secureExamSession.update({ where: { id: session.id }, data: patch });
    await prisma.examDevice.update({ where: { id: device.id }, data: { lastHeartbeatAt: nowDate } }).catch(() => {});
    if (restoring) await recordEvent({ type: locked ? "EXAM_LOCKED" : "HEARTBEAT_RESTORED", session, attempt, metadata: { silentSeconds: Math.round((nowDate - new Date(session.lastHeartbeatAt)) / 1000) } });

    // Capability regression mid-exam (for example the client reports it left kiosk or its policy check failed)
    if (patch.capabilities && attempt && policy.requiredCapabilities) {
      const failed = S.failedRequired(S.capabilityChecks(policy, patch.capabilities));
      if (failed.length) await recordEvent({ type: "APPLICATION_POLICY_FAILURE", session, attempt, metadata: { missing: failed.map((f) => f.key).join(",") } });
    }

    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 20) : [];
    const rows = [];
    for (const ev of events) {
      const type = String(ev?.type || "").toUpperCase();
      if (!X.SECURE_CLIENT_REPORTABLE.has(type)) continue;
      rows.push({ attemptKind: "MODULE_CODING", attemptId: session.attemptId || "none", studentId: session.studentId, testId: session.testId, type, severity: X.EVENT_SEVERITY[type] || "MEDIUM", metadata: X.cleanMetadata(ev.metadata), instituteId: session.instituteId, deviceId: session.deviceId });
    }
    if (rows.length) await prisma.examSecurityEvent.createMany({ data: rows });
    res.json({ ok: true, state: locked ? "SECURITY_SESSION_LOST" : "CONNECTED", locked, serverTime: Date.now(), heartbeatSec: 15 });
  } catch (err) { console.error(err); res.status(500).json({ error: "Heartbeat failed" }); }
});

// The exam page asks "what does the server think of my secure session?" before the attempt exists (device health check).
router.get("/session/check", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const policy = X.resolvePolicy({ securityLevel: "LOCKDOWN" });
    const ev = await evaluateSecureSession(req.get("x-secure-session"), { studentId: req.user.id, policy });
    if (ev.ok) return res.json({ ok: true, state: ev.state, checks: ev.checks });
    res.status(ev.status === 423 ? 200 : ev.status).json({ ok: false, code: ev.code, message: ev.message, checks: ev.checks || null });
  } catch (err) { console.error(err); res.status(500).json({ error: "Check failed" }); }
});

// The client ends its session on a normal exit (so a clean close is not reported as a lost session).
router.post("/end", authenticate, requireRole("STUDENT"), async (req, res) => {
  const token = req.get("x-secure-session");
  if (token) await prisma.secureExamSession.updateMany({ where: { tokenHash: S.sha256(token), studentId: req.user.id, endedAt: null }, data: { endedAt: new Date(), state: "ENDED" } });
  res.json({ ok: true });
});

// STAFF (invigilator): release a locked attempt. Institute-scoped and audit-logged.
router.post("/attempts/:attemptId/unlock", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const attempt = await prisma.moduleCodingAttempt.findUnique({ where: { id: req.params.attemptId }, include: { student: { select: { id: true, instituteId: true } } } });
    if (!attempt) return res.status(404).json({ error: "Attempt not found" });
    if (req.requesterInstituteId && attempt.student.instituteId !== req.requesterInstituteId) return res.status(403).json({ error: "You can only unlock attempts of your own institute" });
    const r = await prisma.secureExamSession.updateMany({ where: { attemptId: attempt.id, lockedAt: { not: null }, unlockedAt: null }, data: { unlockedAt: new Date(), unlockedById: req.user.id } });
    await recordEvent({ type: "EXAM_UNLOCKED", attempt, studentId: attempt.studentId, instituteId: attempt.student.instituteId, metadata: { by: req.user.role } });
    await logAudit({ req, action: AUDIT_ACTIONS.REATTEMPT_GRANTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, studentId: attempt.studentId, instituteId: attempt.student.instituteId, details: { operation: "secure-exam-unlock", attemptId: attempt.id, sessionsUnlocked: r.count } });
    res.json({ unlocked: r.count });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to unlock" }); }
});

// Scheduler hook: for tests whose policy says AUTO_SUBMIT, a session lost beyond its grace period submits the attempt. Every
// other exit action only blocks (PAUSE/LOCK/REQUIRE_INVIGILATOR) or records (WARNING); nothing is submitted for a short blip.
async function sweepLostSecureSessions() {
  const { gradeModuleCodingAttempt } = require("../utils/gradeModuleCodingAttempt");
  const cutoff = new Date(Date.now() - 60 * 1000);
  const stale = await prisma.secureExamSession.findMany({ where: { attemptId: { not: null }, endedAt: null, lastHeartbeatAt: { lt: cutoff } }, take: 200 });
  let submitted = 0;
  for (const s of stale) {
    const attempt = await prisma.moduleCodingAttempt.findUnique({ where: { id: s.attemptId }, include: { moduleCodingTest: true } });
    if (!attempt || attempt.status !== "IN_PROGRESS") continue;
    const policy = X.resolvePolicy(attempt.moduleCodingTest);
    const silent = (Date.now() - new Date(s.lastHeartbeatAt).getTime()) / 1000;
    if (silent <= policy.graceSec) continue;
    const moved = await prisma.secureExamSession.updateMany({ where: { id: s.id, state: { not: "SECURITY_SESSION_LOST" } }, data: { state: "SECURITY_SESSION_LOST", ...(["LOCK", "REQUIRE_INVIGILATOR"].includes(policy.exitAction) ? { lockedAt: new Date(), lockReason: "heartbeat lost" } : {}) } });
    if (moved.count) await recordEvent({ type: "HEARTBEAT_LOST", session: s, attempt, metadata: { silentSeconds: Math.round(silent), swept: true } });
    if (policy.exitAction === "AUTO_SUBMIT") {
      const claim = await prisma.moduleCodingAttempt.updateMany({ where: { id: attempt.id, status: "IN_PROGRESS" }, data: { autoSubmitReason: "SECURITY_SESSION_LOST" } });
      if (claim.count) { await gradeModuleCodingAttempt(attempt.id, { reason: "SECURITY_SESSION_LOST" }).catch((e) => console.error("[secureExam] auto-submit failed", e.message)); submitted++; }
    }
  }
  return { checked: stale.length, submitted };
}

module.exports = router;
module.exports.evaluateSecureSession = evaluateSecureSession;
module.exports.bindSessionToAttempt = bindSessionToAttempt;
module.exports.sweepLostSecureSessions = sweepLostSecureSessions;
