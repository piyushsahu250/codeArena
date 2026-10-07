// End-to-end verification of the LOCKDOWN secure-exam architecture against the live API on this instance:
// device registration, challenge/response sessions, capability enforcement, device/institute binding, heartbeat states,
// lock / pause / auto-submit policies, unlock, downgrade protection, monitor. Needs SECURE_BROWSER_SECRET set on the server.
// Disposable data only (@example.invalid users, a throwaway group and devices); the test level's settings are restored.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const S = require("../src/utils/secureExam");
const X = require("../src/utils/examSecurity");
const { sweepLostSecureSessions, evaluateSecureSession } = require("../src/routes/secureExam");

const BASE = "http://localhost:4000/api";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", "User-Agent": DESKTOP_UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;
const FULL = { kiosk: true, appRestriction: true, browserRestriction: true, networkRestriction: true, clipboard: true, fullscreen: true, devtoolsDisabled: true, screenCaptureProtection: false };

async function handshake(jwt, deviceId, secret, caps = FULL, version = "1.0.0") {
  const ch = await call("POST", "/secure-exam/challenge", jwt, { deviceId });
  if (ch.status !== 200) return { stage: "challenge", ...ch };
  const sig = S.clientSignature(secret, { nonce: ch.body.nonce, clientVersion: version, clientKind: "ELECTRON", capabilities: caps });
  const r = await call("POST", "/secure-exam/session", jwt, { deviceId, nonce: ch.body.nonce, sig, clientVersion: version, clientKind: "ELECTRON", capabilities: caps });
  return { stage: "session", nonce: ch.body.nonce, ...r };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: "verify-se2-", endsWith: "@example.invalid" } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.secureExamSession.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.examSecurityEvent.deleteMany({ where: { studentId: { in: ids } } });
  }
  await prisma.examDevice.deleteMany({ where: { deviceId: { startsWith: "VERIFY-" } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.academicGroup.deleteMany({ where: { batch: "ZZ-VERIFY-SE2" } });
}

(async () => {
  await cleanup();
  check("server has SECURE_BROWSER_SECRET configured (>= 16 chars)", S.configured());
  if (!S.configured()) { console.log("\nCannot continue without the secret"); process.exit(2); }

  const course = await prisma.course.findUnique({ where: { slug: "java-practice" } });
  const groups = await prisma.academicGroup.findMany({ where: { isActive: true } });
  const off = await prisma.featureSetting.findMany({ where: { featureKey: { in: ["lms", "compiler"] }, enabled: false } });
  const offIds = new Set(off.map((f) => f.instituteId));
  const real = groups.find((g) => !offIds.has(g.instituteId));
  const { instituteId, departmentId } = real;
  const otherInst = await prisma.institute.findFirst({ where: { id: { not: instituteId } }, select: { id: true } });
  const ts = Date.now();
  const grp = await prisma.academicGroup.create({ data: { instituteId, departmentId, batch: "ZZ-VERIFY-SE2", section: `ZZ-${ts}` } });
  const mk = async (name, role, inst, group) => { const pw = rand(); const u = await prisma.user.create({ data: { name, email: `verify-se2-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId: inst, academicGroupId: group?.id || null, mustChangePassword: false } }); return { ...u, pw }; };
  const s1 = await mk("Alice", "STUDENT", instituteId, grp), s2 = await mk("Bob", "STUDENT", instituteId, grp);
  const foreign = otherInst ? await mk("Foreign", "STUDENT", otherInst.id, null) : null;
  const admin = await mk("Admin", "ADMIN", null), instAdmin = await mk("Inst Admin", "INSTITUTE_ADMIN", instituteId);
  await prisma.courseAcademicGroupAssignment.create({ data: { courseId: course.id, academicGroupId: grp.id, assignedByUserId: admin.id, assignedByName: admin.name } });
  const level = await prisma.moduleCodingTest.findFirst({ where: { chapter: { module: { courseId: course.id } }, isActive: true }, orderBy: { createdAt: "asc" } });
  const original = { securityLevel: level.securityLevel, securityPolicy: level.securityPolicy, maxAttempts: level.maxAttempts, proctoring: level.proctoring };
  const setLevel = (data) => prisma.moduleCodingTest.update({ where: { id: level.id }, data });

  try {
    const T1 = await login(s1.email, s1.pw), T2 = await login(s2.email, s2.pw), TA = await login(admin.email, admin.pw), TI = await login(instAdmin.email, instAdmin.pw);
    const TF = foreign ? await login(foreign.email, foreign.pw) : null;
    await setLevel({ maxAttempts: 20, securityLevel: "LOCKDOWN", securityPolicy: { exitAction: "LOCK", graceSec: 120 } });

    // ---- device registration + isolation
    const reg = await call("POST", "/secure-exam/devices", TI, { label: "Verify Lab PC 1", deviceId: "VERIFY-PC-1" });
    check("institute admin registers a device and receives the one-time secret", reg.status === 200 && /^[0-9a-f]{64}$/.test(reg.body.deviceSecret || ""));
    const secret1 = reg.body.deviceSecret;
    check("the secret equals the derived value (nothing secret is stored)", secret1 === S.deriveDeviceSecret(instituteId, "VERIFY-PC-1"));
    check("duplicate device id in the same institute is refused (409)", (await call("POST", "/secure-exam/devices", TI, { label: "dup", deviceId: "VERIFY-PC-1" })).status === 409);
    check("a student cannot register devices (403)", (await call("POST", "/secure-exam/devices", T1, { label: "x" })).status === 403);
    check("a platform admin must name the institute (400)", (await call("POST", "/secure-exam/devices", TA, { label: "x" })).status === 400);
    check("an institute admin cannot register into another institute (403)", otherInst ? (await call("POST", "/secure-exam/devices", TI, { label: "x", instituteId: otherInst.id })).status === 403 : true);
    const reg2 = await call("POST", "/secure-exam/devices", TI, { label: "Verify Lab PC 2", deviceId: "VERIFY-PC-2" });
    const secret2 = reg2.body.deviceSecret;
    const list = await call("GET", "/secure-exam/devices", TI);
    check("device list is institute-scoped and never contains a secret", list.status === 200 && list.body.rows.some((r) => r.deviceId === "VERIFY-PC-1") && !JSON.stringify(list.body).includes(secret1));

    check("unknown device is refused at challenge (403)", (await call("POST", "/secure-exam/challenge", T1, { deviceId: "NOPE-1" })).status === 403);
    if (TF) {
      const cf = await call("POST", "/secure-exam/challenge", TF, { deviceId: "VERIFY-PC-1" });
      check("a student of ANOTHER institute cannot use this institute's device (same refusal as unknown)", cf.status === 403 && cf.body.code === "DEVICE_NOT_ALLOWED");
    }

    // ---- session handshake abuse cases
    const good = await handshake(T1, "VERIFY-PC-1", secret1);
    check("signed challenge/response creates a secure session and an opaque token", good.status === 200 && (good.body.token || "").length >= 40 && good.body.heartbeatSec === 15);
    const tok1 = good.body.token;
    const dbSess = await prisma.secureExamSession.findFirst({ where: { studentId: s1.id } });
    check("only a hash of the token is stored", dbSess && dbSess.tokenHash === S.sha256(tok1) && dbSess.tokenHash !== tok1);
    check("session is bound to student, institute and device", dbSess.studentId === s1.id && dbSess.instituteId === instituteId && dbSess.deviceId === "VERIFY-PC-1");
    const wrongSecret = await handshake(T1, "VERIFY-PC-1", secret2);
    check("signing with another device's secret is refused (403 SIGNATURE_INVALID)", wrongSecret.status === 403 && wrongSecret.body.code === "SIGNATURE_INVALID");
    // claim upgrade in transit: sign weak caps, send strong caps
    const ch = await call("POST", "/secure-exam/challenge", T1, { deviceId: "VERIFY-PC-1" });
    const weak = { ...FULL, appRestriction: false };
    const sigWeak = S.clientSignature(secret1, { nonce: ch.body.nonce, clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: weak });
    const upg = await call("POST", "/secure-exam/session", T1, { deviceId: "VERIFY-PC-1", nonce: ch.body.nonce, sig: sigWeak, clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: FULL });
    check("upgrading the capability claims after signing is refused", upg.status === 403 && upg.body.code === "SIGNATURE_INVALID");
    const replay = await call("POST", "/secure-exam/session", T1, { deviceId: "VERIFY-PC-1", nonce: good.nonce, sig: S.clientSignature(secret1, { nonce: good.nonce, clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: FULL }), clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: FULL });
    check("replaying a used challenge is refused", replay.status === 403 && replay.body.code === "CHALLENGE_INVALID");
    const realNow = Date.now; Date.now = () => realNow() - 5 * 60 * 1000; const oldNonce = S.makeNonce(s1.id, instituteId, "VERIFY-PC-1"); Date.now = realNow;
    const expired = await call("POST", "/secure-exam/session", T1, { deviceId: "VERIFY-PC-1", nonce: oldNonce, sig: S.clientSignature(secret1, { nonce: oldNonce, clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: FULL }), clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: FULL });
    check("an expired challenge is refused", expired.status === 403 && expired.body.code === "CHALLENGE_INVALID");
    const stolen = await call("POST", "/secure-exam/session", T2, { deviceId: "VERIFY-PC-1", nonce: (await call("POST", "/secure-exam/challenge", T1, { deviceId: "VERIFY-PC-1" })).body.nonce, sig: "00".repeat(32), clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: FULL });
    check("a challenge issued to one student cannot be redeemed by another", stolen.status === 403);
    check("tampering is recorded as evidence", (await prisma.examSecurityEvent.count({ where: { studentId: s1.id, type: { in: ["DEVICE_MISMATCH", "SESSION_TAMPERING"] } } })) >= 3);
    check("a client kind other than the shipped secure client is refused", (await call("POST", "/secure-exam/session", T1, { deviceId: "VERIFY-PC-1", nonce: "x", sig: "x", clientVersion: "1.0.0", clientKind: "CHROME", capabilities: FULL })).status === 400);

    // ---- LOCKDOWN start enforcement (server side)
    const st0 = await call("GET", `/module-coding/level/${level.id}`, T1);
    check("status shows LOCKDOWN with the failing check when there is no secure session", st0.body.security.level === "LOCKDOWN" && st0.body.securityCheck.secureBrowserOk === false && st0.body.securityCheck.checks.some((c) => c.required && !c.ok));
    const noTok = await call("POST", `/module-coding/level/${level.id}/start`, T1);
    check("no secure session -> start refused (SECURE_CLIENT_REQUIRED)", noTok.status === 403 && noTok.body.code === "SECURE_CLIENT_REQUIRED");
    const downgrade = await call("POST", `/module-coding/level/${level.id}/start`, T1, { securityLevel: "STANDARD", proctored: false, securityMode: "standard" }, { "X-Security-Level": "STANDARD" });
    check("client-supplied 'standard' / 'proctored=false' cannot downgrade the policy", downgrade.status === 403 && downgrade.body.code === "SECURE_CLIENT_REQUIRED");
    const weakSess = await handshake(T1, "VERIFY-PC-1", secret1, { ...FULL, appRestriction: false });
    const weakStart = await call("POST", `/module-coding/level/${level.id}/start`, T1, null, { "X-Secure-Session": weakSess.body.token });
    check("device that does not attest application restriction cannot start (SECURE_CAPABILITY_MISSING)", weakStart.status === 403 && weakStart.body.code === "SECURE_CAPABILITY_MISSING" && /Application restriction/.test(weakStart.body.error));
    const otherStudentTok = await call("POST", `/module-coding/level/${level.id}/start`, T2, null, { "X-Secure-Session": tok1 });
    check("student B cannot use student A's secure session", otherStudentTok.status === 403 && otherStudentTok.body.code === "SECURE_SESSION_INVALID");
    const mob = await call("POST", `/module-coding/level/${level.id}/start`, T1, null, { "X-Secure-Session": tok1, "User-Agent": MOBILE_UA });
    check("a phone is refused even with a valid session (MOBILE_NOT_SUPPORTED)", mob.status === 403 && mob.body.code === "MOBILE_NOT_SUPPORTED");
    check("no attempt exists after all the refused starts", (await prisma.moduleCodingAttempt.count({ where: { studentId: s1.id } })) === 0);

    const stOk = await call("GET", `/module-coding/level/${level.id}`, T1, null, { "X-Secure-Session": tok1 });
    check("with a valid session the device check reports every required capability as passed", stOk.body.securityCheck.secureBrowserOk === true && stOk.body.securityCheck.checks.filter((c) => c.required).every((c) => c.ok));
    const start = await call("POST", `/module-coding/level/${level.id}/start`, T1, null, { "X-Secure-Session": tok1 });
    check("LOCKDOWN start succeeds inside the secure session", start.status === 200 && start.body.attemptId && start.body.sessionId);
    const attemptId = start.body.attemptId, examSession = start.body.sessionId, q0 = start.body.questions[0].id, deadline1 = start.body.deadline;
    check("the secure session is now bound to the attempt, test and institute", !!(await prisma.secureExamSession.findFirst({ where: { tokenHash: S.sha256(tok1), attemptId, testId: level.id, instituteId } })));
    check("hidden tests never reach the secure client", !/"isHidden":true/.test(JSON.stringify(start.body)));
    const H = (t = tok1) => ({ "X-Secure-Session": t, "X-Exam-Session": examSession });
    check("autosave works with both the secure session and the exam session", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 1 }, H())).status === 200);
    const noSecure = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "x", seq: 2 }, { "X-Exam-Session": examSession });
    check("an exam call without the secure session is refused mid-attempt (normal browser cannot continue a lockdown attempt)", noSecure.status === 403 && noSecure.body.code === "SECURE_CLIENT_REQUIRED");
    check("another student's attempt id cannot be driven with my secure session", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T2, { questionId: q0, language: "java", code: "x", seq: 3 }, H())).status === 403);

    // ---- heartbeat
    const hb = await call("POST", "/secure-exam/heartbeat", T1, { capabilities: FULL, events: [{ type: "FOCUS_LOSS", metadata: { seconds: 2 } }, { type: "EXTERNAL_NAVIGATION", metadata: { host: "chat.openai.com" } }, { type: "SESSION_TAMPERING" }, { type: "APPLICATION_POLICY_FAILURE", metadata: { processes: "chrome.exe" } }] }, { "X-Secure-Session": tok1 });
    check("heartbeat is accepted and reports the connected state", hb.status === 200 && hb.body.state === "CONNECTED" && hb.body.locked === false);
    const evs = await prisma.examSecurityEvent.findMany({ where: { attemptId, type: { in: ["FOCUS_LOSS", "EXTERNAL_NAVIGATION", "APPLICATION_POLICY_FAILURE", "SESSION_TAMPERING"] } } });
    check("client events are stored with institute + device, server-assigned severity", ["FOCUS_LOSS", "EXTERNAL_NAVIGATION", "APPLICATION_POLICY_FAILURE"].every((t) => evs.some((e) => e.type === t && e.instituteId === instituteId && e.deviceId === "VERIFY-PC-1")) && evs.find((e) => e.type === "APPLICATION_POLICY_FAILURE").severity === "HIGH");
    check("a client cannot forge server-only evidence (SESSION_TAMPERING from a heartbeat is dropped)", !evs.some((e) => e.type === "SESSION_TAMPERING"));
    check("heartbeat with a stranger's token is refused", (await call("POST", "/secure-exam/heartbeat", T2, { capabilities: FULL }, { "X-Secure-Session": tok1 })).status === 403);
    check("heartbeat without a token is refused", (await call("POST", "/secure-exam/heartbeat", T1, {})).status === 403);

    // ---- connection states (time travelled by editing the heartbeat timestamp; the server derives state from it)
    const back = (sec) => prisma.secureExamSession.updateMany({ where: { tokenHash: S.sha256(tok1) }, data: { lastHeartbeatAt: new Date(Date.now() - sec * 1000) } });
    await back(75);
    const mon1 = await call("GET", `/exam-security/tests/${level.id}/monitor`, TA);
    const row1 = mon1.body.rows.find((r) => r.attemptId === attemptId);
    check("75 s of silence = TEMPORARILY_DISCONNECTED in the live monitor (inside the grace period)", row1?.connection === "TEMPORARILY_DISCONNECTED", row1?.connection);
    check("inside the grace period the exam keeps working (no punishment for a short blip)", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 4 }, H())).status === 200);
    await back(200);
    const lost = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 5 }, H());
    check("beyond the grace period the exam is blocked with SECURE_SESSION_LOST (423)", lost.status === 423 && lost.body.code === "SECURE_SESSION_LOST", `${lost.status} ${lost.body?.code}`);
    check("HEARTBEAT_LOST is recorded exactly once", (await prisma.examSecurityEvent.count({ where: { attemptId, type: "HEARTBEAT_LOST" } })) === 1);
    check("exitAction LOCK: the session is locked, not submitted", (await prisma.secureExamSession.findFirst({ where: { tokenHash: S.sha256(tok1) } })).lockedAt !== null && (await prisma.moduleCodingAttempt.findUnique({ where: { id: attemptId } })).status === "IN_PROGRESS");
    const hbLocked = await call("POST", "/secure-exam/heartbeat", T1, { capabilities: FULL }, { "X-Secure-Session": tok1 });
    check("a returning heartbeat does NOT release a locked exam", hbLocked.status === 200 && hbLocked.body.locked === true);
    const monL = await call("GET", `/exam-security/tests/${level.id}/monitor`, TA);
    check("the live monitor shows the lock and counts the student as disconnected", monL.body.rows.find((r) => r.attemptId === attemptId).connection === "LOCKED" && monL.body.summary.disconnected >= 1 && monL.body.summary.active >= 1);

    // reconnecting (client restarts, fresh handshake) cannot bypass the lock
    const re = await handshake(T1, "VERIFY-PC-1", secret1);
    const resumeLocked = await call("POST", `/module-coding/level/${level.id}/start`, T1, null, { "X-Secure-Session": re.body.token });
    check("a fresh secure session cannot bypass a locked attempt (SESSION_LOCKED)", resumeLocked.status === 423 && resumeLocked.body.code === "SESSION_LOCKED");
    check("students cannot unlock themselves (403)", (await call("POST", `/secure-exam/attempts/${attemptId}/unlock`, T1)).status === 403);
    const unl = await call("POST", `/secure-exam/attempts/${attemptId}/unlock`, TA);
    check("an invigilator can unlock (audited)", unl.status === 200 && unl.body.unlocked >= 1 && (await prisma.auditLog.count({ where: { studentId: s1.id } })) >= 1);
    const resumed = await call("POST", `/module-coding/level/${level.id}/start`, T1, null, { "X-Secure-Session": re.body.token });
    check("after unlock the SAME attempt resumes: same attempt id, same deadline (timer not reset), no duplicate attempt", resumed.status === 200 && resumed.body.attemptId === attemptId && resumed.body.deadline === deadline1 && (await prisma.moduleCodingAttempt.count({ where: { studentId: s1.id } })) === 1);
    const examSession2 = resumed.body.sessionId, tok2 = re.body.token;
    check("saved code survives the interruption", resumed.body.savedAnswers && resumed.body.savedAnswers[q0]?.code === "class Main{}");
    check("the new secure session continues the exam", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{ int a; }", seq: 6 }, { "X-Secure-Session": tok2, "X-Exam-Session": examSession2 })).status === 200);
    check("the old (replaced) secure session is ended", (await prisma.secureExamSession.findFirst({ where: { tokenHash: S.sha256(tok1) } })).endedAt !== null);

    // ---- PAUSE policy: recovers by itself when the client reconnects
    await setLevel({ securityPolicy: { exitAction: "PAUSE", graceSec: 120 } });
    await prisma.secureExamSession.updateMany({ where: { tokenHash: S.sha256(tok2) }, data: { lastHeartbeatAt: new Date(Date.now() - 300 * 1000), lockedAt: null, state: "CONNECTED" } });
    const lostP = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "x", seq: 7 }, { "X-Secure-Session": tok2, "X-Exam-Session": examSession2 });
    check("PAUSE: blocked while the connection is lost", lostP.status === 423 && lostP.body.code === "SECURE_SESSION_LOST");
    const hbP = await call("POST", "/secure-exam/heartbeat", T1, { capabilities: FULL }, { "X-Secure-Session": tok2 });
    check("PAUSE: the next heartbeat restores the session without staff", hbP.status === 200 && hbP.body.state === "CONNECTED" && hbP.body.locked === false);
    check("PAUSE: HEARTBEAT_RESTORED recorded and the exam continues", (await prisma.examSecurityEvent.count({ where: { attemptId, type: "HEARTBEAT_RESTORED" } })) >= 1 && (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{ int b; }", seq: 8 }, { "X-Secure-Session": tok2, "X-Exam-Session": examSession2 })).status === 200);

    // ---- capability regression mid-exam
    await call("POST", "/secure-exam/heartbeat", T1, { capabilities: { ...FULL, kiosk: false } }, { "X-Secure-Session": tok2 });
    const capLost = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "x", seq: 9 }, { "X-Secure-Session": tok2, "X-Exam-Session": examSession2 });
    check("if the device stops attesting a required capability mid-exam, the exam is blocked (SECURE_CAPABILITY_MISSING)", capLost.status === 403 && capLost.body.code === "SECURE_CAPABILITY_MISSING");
    check("and the regression is recorded as APPLICATION_POLICY_FAILURE", (await prisma.examSecurityEvent.count({ where: { attemptId, type: "APPLICATION_POLICY_FAILURE", metadata: { path: ["missing"], equals: "kiosk" } } })) >= 1);
    await call("POST", "/secure-exam/heartbeat", T1, { capabilities: FULL }, { "X-Secure-Session": tok2 });

    // ---- device revoked mid-exam
    await call("PATCH", `/secure-exam/devices/${reg.body.device.id}`, TI, { status: "REVOKED" });
    const rev = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "x", seq: 10 }, { "X-Secure-Session": tok2, "X-Exam-Session": examSession2 });
    check("revoking the device stops the exam immediately", rev.status === 403 && ["DEVICE_NOT_ALLOWED", "SECURE_SESSION_EXPIRED"].includes(rev.body.code), `${rev.status} ${rev.body?.code}`);
    check("a revoked device cannot get a new challenge", (await call("POST", "/secure-exam/challenge", T1, { deviceId: "VERIFY-PC-1" })).status === 403);
    await call("PATCH", `/secure-exam/devices/${reg.body.device.id}`, TI, { status: "ACTIVE" });

    // ---- AUTO_SUBMIT policy via the scheduler sweep (student 2 on device 2)
    await setLevel({ securityPolicy: { exitAction: "AUTO_SUBMIT", graceSec: 90 } });
    const g2 = await handshake(T2, "VERIFY-PC-2", secret2);
    const st2 = await call("POST", `/module-coding/level/${level.id}/start`, T2, null, { "X-Secure-Session": g2.body.token });
    check("second student starts on a second registered device", st2.status === 200);
    await prisma.secureExamSession.updateMany({ where: { tokenHash: S.sha256(g2.body.token) }, data: { lastHeartbeatAt: new Date(Date.now() - 20 * 1000) } });
    await sweepLostSecureSessions();
    check("AUTO_SUBMIT: a short silence does NOT submit the exam", (await prisma.moduleCodingAttempt.findUnique({ where: { id: st2.body.attemptId } })).status === "IN_PROGRESS");
    await prisma.secureExamSession.updateMany({ where: { tokenHash: S.sha256(g2.body.token) }, data: { lastHeartbeatAt: new Date(Date.now() - 400 * 1000) } });
    await sweepLostSecureSessions();
    const a2 = await prisma.moduleCodingAttempt.findUnique({ where: { id: st2.body.attemptId } });
    check("AUTO_SUBMIT: silence beyond the grace period submits and grades the attempt", a2.status !== "IN_PROGRESS" && a2.autoSubmitReason === "SECURITY_SESSION_LOST", `${a2.status} ${a2.autoSubmitReason}`);
    check("the attempt result is preserved (graded, not deleted)", a2.score !== null && a2.submittedAt !== null);

    // ---- fail safe + RBAC + monitor
    const saved = process.env.SECURE_BROWSER_SECRET; delete process.env.SECURE_BROWSER_SECRET;
    const ev = await evaluateSecureSession(tok2, { studentId: s1.id, policy: X.resolvePolicy({ securityLevel: "LOCKDOWN" }) });
    process.env.SECURE_BROWSER_SECRET = saved;
    check("fail-safe: if the secure-exam service is not configured, LOCKDOWN is refused (never silently downgraded)", !ev.ok && ev.code === "SECURE_EXAM_UNAVAILABLE");
    check("students cannot change a test's security settings (403)", (await call("PATCH", `/module-coding/admin/tests/${level.id}`, T1, { securityLevel: "STANDARD" })).status === 403);
    check("students cannot read the live monitor (403)", (await call("GET", `/exam-security/tests/${level.id}/monitor`, T1)).status === 403);
    const mon = await call("GET", `/exam-security/tests/${level.id}/monitor`, TA);
    const mrow = mon.body.rows.find((r) => r.attemptId === attemptId);
    check("monitor rows carry device, progress and server-computed time left", mrow && mrow.device?.label === "Verify Lab PC 1" && typeof mrow.secondsLeft === "number" && mrow.progress && ["CONNECTED", "TEMPORARILY_DISCONNECTED", "LOCKED", "SESSION_ENDED"].includes(mrow.connection));
    check("monitor summary has all dashboard counters", ["totalStudents", "active", "completed", "disconnected", "securityWarnings", "highRisk", "critical", "deviceFailures", "networkFailures"].every((k) => typeof mon.body.summary[k] === "number"));
    const tl = await call("GET", `/exam-security/attempts/${attemptId}/timeline`, TA);
    check("the security timeline shows the lock, unlock and device events in order", tl.status === 200 && ["EXAM_LOCKED", "EXAM_UNLOCKED", "HEARTBEAT_LOST"].every((t) => tl.body.timeline.some((e) => e.type === t)) && tl.body.timeline.every((e, i, a) => i === 0 || new Date(a[i - 1].at) <= new Date(e.at)));
    check("an institute admin is blocked from this GLOBAL course's monitor", (await call("GET", `/exam-security/tests/${level.id}/monitor`, TI)).status === 403);
    const hbBeforeEnd = await call("POST", "/secure-exam/end", T2, null, { "X-Secure-Session": g2.body.token });
    check("a clean exit ends the session", hbBeforeEnd.status === 200);
  } finally {
    await prisma.moduleCodingTest.update({ where: { id: level.id }, data: original }).catch((e) => console.log("restore failed:", e.message));
    await prisma.courseAcademicGroupAssignment.deleteMany({ where: { courseId: course.id, academicGroupId: grp.id } });
    await cleanup();
  }
  const restored = await prisma.moduleCodingTest.findUnique({ where: { id: level.id } });
  check("level settings restored exactly", restored.securityLevel === original.securityLevel && restored.maxAttempts === original.maxAttempts && restored.proctoring === original.proctoring);
  console.log(failures === 0 ? "\nSECURE EXAM VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
