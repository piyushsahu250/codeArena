// Database-backed verification of the ANDROID_MANAGED secure-client kind against the live API on this instance: opt-in / opt-out, no downgrade between client kinds,
// capability enforcement, session binding, heartbeat events and ordinary (web) exams staying untouched. Needs SECURE_BROWSER_SECRET on the server.
// Disposable data only (@example.invalid users, a throwaway group and devices); the test level's settings are restored.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const S = require("../src/utils/secureExam");

const BASE = "http://localhost:4000/api";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", "User-Agent": DESKTOP_UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

const ANDROID_FULL = { deviceOwner: true, lockTask: true, kiosk: true, homeBlocked: true, overviewBlocked: true, globalActionsBlocked: true, notificationsBlocked: true, assistantUnavailable: true, screenCaptureProtection: true, appRestriction: true, browserRestriction: true, fullscreen: true, devtoolsDisabled: true, clipboard: false };
const ELECTRON_FULL = { kiosk: true, appRestriction: true, browserRestriction: true, networkRestriction: true, clipboard: true, fullscreen: true, devtoolsDisabled: true, screenCaptureProtection: false };
const ANDROID_REQUIRED = ["deviceOwner", "lockTask", "kiosk", "homeBlocked", "overviewBlocked", "globalActionsBlocked", "notificationsBlocked", "assistantUnavailable", "screenCaptureProtection"];

async function handshake(jwt, deviceId, secret, kind, caps, signKind = kind) {
  const ch = await call("POST", "/secure-exam/challenge", jwt, { deviceId });
  if (ch.status !== 200) return { stage: "challenge", ...ch };
  const sig = S.clientSignature(secret, { nonce: ch.body.nonce, clientVersion: "1.0.0", clientKind: signKind, capabilities: caps });
  const r = await call("POST", "/secure-exam/session", jwt, { deviceId, nonce: ch.body.nonce, sig, clientVersion: "1.0.0", clientKind: kind, capabilities: caps });
  return { stage: "session", ...r };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: "verify-sa-", endsWith: "@example.invalid" } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.secureExamSession.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.examSecurityEvent.deleteMany({ where: { studentId: { in: ids } } });
  }
  await prisma.examDevice.deleteMany({ where: { deviceId: { startsWith: "VERIFYA-" } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.academicGroup.deleteMany({ where: { batch: "ZZ-VERIFY-SA" } });
}

(async () => {
  await cleanup();
  check("server has SECURE_BROWSER_SECRET configured (>= 16 chars)", S.configured());
  if (!S.configured()) { console.log("\nCannot continue without the secret"); process.exit(2); }

  const institute = await prisma.institute.create({ data: { name: `ZZ Verify SA ${Date.now()}` } });
  const instituteId = institute.id;
  const ts = Date.now();
  const mk = async (name, role, inst) => { const pw = rand(); const u = await prisma.user.create({ data: { name, email: `verify-sa-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId: inst, mustChangePassword: false } }); return { ...u, pw }; };
  const s1 = await mk("Alice", "STUDENT", instituteId), s2 = await mk("Bob", "STUDENT", instituteId);
  const instAdmin = await mk("Inst Admin", "INSTITUTE_ADMIN", instituteId);
  // Own fixtures, no dependence on seeded courses: Course > Module > completed Lesson > coding test > one question.
  const course = await prisma.course.create({ data: { slug: `verify-sa-${ts}`, name: "Verify Android Course", status: "PUBLISHED" } });
  const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: "Verify Android Module", isActive: true } });
  const lesson = await prisma.lesson.create({ data: { moduleId: mod.id, title: "Verify Android Lesson", content: "x", order: 0, isActive: true } });
  for (const s of [s1, s2]) await prisma.lessonProgress.create({ data: { studentId: s.id, lessonId: lesson.id, status: "COMPLETED", completedAt: new Date() } });
  const question = await prisma.question.create({ data: { title: "Verify Android Question", description: "Return the sum of two integers.", questionType: "CODING", difficulty: "EASY", points: 10, testCases: { create: [{ input: "2 3", expected: "5", isHidden: false }, { input: "10 20", expected: "30", isHidden: true }] } } });
  const level = await prisma.moduleCodingTest.create({ data: { moduleId: mod.id, title: "Verify Android Test", isActive: true, questionCount: 1, timeLimitMin: 30, passingPercent: 50, maxAttempts: null, requireFullscreen: false, allowedLanguages: ["java"] } });
  await prisma.question.update({ where: { id: question.id }, data: { moduleCodingTestId: level.id } });
  const setLevel = (data) => prisma.moduleCodingTest.update({ where: { id: level.id }, data });
  const start = (tok, ua, jwt) => call("POST", `/module-coding/module/${mod.id}/start`, jwt, null, { ...(tok ? { "X-Secure-Session": tok } : {}), ...(ua ? { "User-Agent": ua } : {}) });

  try {
    const T1 = await login(s1.email, s1.pw), T2 = await login(s2.email, s2.pw), TI = await login(instAdmin.email, instAdmin.pw);

    // ---- opt-out: an ordinary web exam is untouched
    await setLevel({ securityLevel: "STANDARD", securityPolicy: null });
    const web = await start(null, DESKTOP_UA, T2);
    check("opt-out: a STANDARD web exam starts in a plain desktop browser, no secure session needed", web.status === 200 && !!web.body.attemptId, `${web.status} ${JSON.stringify(web.body).slice(0, 200)}`);
    check("opt-out: the client policy payload is unchanged (no Android fields leak into it)", web.body.security && !("allowedClientKinds" in web.body.security));

    // ---- register the device
    const reg = await call("POST", "/secure-exam/devices", TI, { label: "Verify Android 1", deviceId: "VERIFYA-1" });
    check("an institute admin registers an Android device and receives the one-time secret", reg.status === 200 && /^[0-9a-f]{64}$/.test(reg.body.deviceSecret || ""));
    const secret = reg.body.deviceSecret;

    // ---- default LOCKDOWN (desktop client only): the Android client is NOT accepted without an explicit opt-in
    await setLevel({ securityLevel: "LOCKDOWN", securityPolicy: { exitAction: "LOCK", graceSec: 120 } });
    const aDefault = await handshake(T1, "VERIFYA-1", secret, "ANDROID_MANAGED", ANDROID_FULL);
    check("an Android session is created (the handshake itself is kind-agnostic)", aDefault.status === 200 && (aDefault.body.token || "").length >= 40);
    const sAnd = await start(aDefault.body.token, PHONE_UA, T1);
    check("no opt-in: a default LOCKDOWN exam refuses a phone outright (MOBILE_NOT_SUPPORTED)", sAnd.status === 403 && sAnd.body.code === "MOBILE_NOT_SUPPORTED");
    const sAndDesk = await start(aDefault.body.token, DESKTOP_UA, T1);
    check("no opt-in: an Android session cannot satisfy a desktop-only policy (CLIENT_KIND_NOT_ALLOWED)", sAndDesk.status === 403 && sAndDesk.body.code === "CLIENT_KIND_NOT_ALLOWED");

    // ---- opt-in: Android-only strict exam
    await setLevel({ securityLevel: "LOCKDOWN", securityPolicy: { allowedClientKinds: ["ANDROID_MANAGED"], requiredCapabilities: ANDROID_REQUIRED, exitAction: "LOCK", graceSec: 120 } });
    const noSession = await start(null, PHONE_UA, T1);
    check("opt-in: a phone browser with no secure session is refused (SECURE_CLIENT_REQUIRED, not a downgrade)", noSession.status === 403 && noSession.body.code === "SECURE_CLIENT_REQUIRED");
    const noSessionDesktop = await start(null, DESKTOP_UA, T1);
    check("opt-in: a desktop browser with no secure session is refused too", noSessionDesktop.status === 403 && noSessionDesktop.body.code === "SECURE_CLIENT_REQUIRED");
    const spoof = await call("POST", `/module-coding/module/${mod.id}/start`, T1, { securityLevel: "STANDARD", clientKind: "ANDROID_MANAGED" }, { "X-Security-Level": "STANDARD", "X-Client-Kind": "ANDROID_MANAGED", "User-Agent": PHONE_UA });
    check("opt-in: client-supplied level or client-kind headers cannot downgrade the policy", spoof.status === 403 && spoof.body.code === "SECURE_CLIENT_REQUIRED");

    const electron = await handshake(T1, "VERIFYA-1", secret, "ELECTRON", ELECTRON_FULL);
    const eStart = await start(electron.body.token, DESKTOP_UA, T1);
    check("downgrade: a desktop-client session cannot satisfy an Android-only exam (CLIENT_KIND_NOT_ALLOWED)", eStart.status === 403 && eStart.body.code === "CLIENT_KIND_NOT_ALLOWED");

    const forged = await handshake(T1, "VERIFYA-1", secret, "ANDROID_MANAGED", ANDROID_FULL, "ELECTRON");
    check("forgery: claiming ANDROID_MANAGED with an Electron-kind signature is refused (SIGNATURE_INVALID)", forged.status === 403 && forged.body.code === "SIGNATURE_INVALID");
    const upgraded = await handshake(T1, "VERIFYA-1", secret, "ANDROID_MANAGED", { ...ANDROID_FULL, assistantUnavailable: false });
    const upgradedStart = await start(upgraded.body.token, PHONE_UA, T1);
    check("capability: a device that does not attest assistantUnavailable cannot start (SECURE_CAPABILITY_MISSING)", upgradedStart.status === 403 && upgradedStart.body.code === "SECURE_CAPABILITY_MISSING" && /Assistant/.test(upgradedStart.body.error));

    const good = await handshake(T1, "VERIFYA-1", secret, "ANDROID_MANAGED", ANDROID_FULL);
    const tok = good.body.token;
    check("the Android session records its kind and capability set", !!(await prisma.secureExamSession.findFirst({ where: { tokenHash: S.sha256(tok), clientKind: "ANDROID_MANAGED" } })));
    check("another student cannot use this Android session (SECURE_SESSION_INVALID)", (await start(tok, PHONE_UA, T2)).body?.code === "SECURE_SESSION_INVALID");
    const st = await call("GET", `/module-coding/module/${mod.id}`, T1, null, { "X-Secure-Session": tok, "User-Agent": PHONE_UA });
    check("the device check passes with a verified Android session on a phone", st.status === 200 && st.body.securityCheck.secureBrowserOk === true && st.body.securityCheck.mobileBlocked === false);
    const ok = await start(tok, PHONE_UA, T1);
    check("opt-in: a verified Android managed session starts the exam on a phone", ok.status === 200 && !!ok.body.attemptId && !!ok.body.sessionId);
    check("hidden tests never reach the Android client", !/"isHidden":true/.test(JSON.stringify(ok.body)));
    const attemptId = ok.body.attemptId, examSession = ok.body.sessionId, q0 = ok.body.questions[0].id;
    check("timer integrity: the deadline comes from the server and is in the future", typeof ok.body.deadline === "string" && new Date(ok.body.deadline).getTime() > Date.now());
    const H = { "X-Secure-Session": tok, "X-Exam-Session": examSession, "User-Agent": PHONE_UA };
    check("autosave works with the Android secure session", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 1 }, H)).status === 200);
    const noSec = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "x", seq: 2 }, { "X-Exam-Session": examSession, "User-Agent": PHONE_UA });
    check("a plain browser cannot continue the attempt mid-exam (SECURE_CLIENT_REQUIRED)", noSec.status === 403 && noSec.body.code === "SECURE_CLIENT_REQUIRED");
    check("another student cannot drive this attempt", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T2, { questionId: q0, language: "java", code: "x", seq: 3 }, H)).status === 403);

    // ---- heartbeat: observable events stored with server-assigned severity; a capability regression is recorded
    const hb = await call("POST", "/secure-exam/heartbeat", T1, { capabilities: ANDROID_FULL, events: [{ type: "SYSTEM_UI_INTERRUPTION", metadata: { seconds: 7 } }, { type: "SCREEN_OFF_RESUME", metadata: { seconds: 30 } }, { type: "GEMINI_DETECTED" }, { type: "SESSION_TAMPERING" }] }, { "X-Secure-Session": tok });
    check("heartbeat accepted", hb.status === 200 && hb.body.state === "CONNECTED" && hb.body.locked === false);
    const ev = await prisma.examSecurityEvent.findMany({ where: { studentId: s1.id, attemptId } });
    const sev = Object.fromEntries(ev.map((e) => [e.type, e.severity]));
    check("the Android interruption events are stored with server-assigned severity", sev.SYSTEM_UI_INTERRUPTION === "MEDIUM" && sev.SCREEN_OFF_RESUME === "LOW");
    check("an invented 'Gemini detected' event and a forged tamper event from the client are dropped", !sev.GEMINI_DETECTED && !sev.SESSION_TAMPERING);
    await call("POST", "/secure-exam/heartbeat", T1, { capabilities: { ...ANDROID_FULL, lockTask: false, kiosk: false } }, { "X-Secure-Session": tok });
    check("leaving lock task mid-exam is recorded as a policy failure", (await prisma.examSecurityEvent.count({ where: { studentId: s1.id, attemptId, type: "APPLICATION_POLICY_FAILURE" } })) >= 1);
    const after = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 4 }, H);
    check("and the next exam call is refused until lock task is back (SECURE_CAPABILITY_MISSING)", after.status === 403 && after.body.code === "SECURE_CAPABILITY_MISSING");
    await call("POST", "/secure-exam/heartbeat", T1, { capabilities: ANDROID_FULL }, { "X-Secure-Session": tok });
    check("once the device attests lock task again the attempt continues", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 5 }, H)).status === 200);

    // ---- rollback behaviour: removing the opt-in stops accepting Android sessions at once
    await setLevel({ securityLevel: "LOCKDOWN", securityPolicy: { exitAction: "LOCK", graceSec: 120 } });
    const rolled = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 6 }, H);
    check("rollback: dropping ANDROID_MANAGED from the policy makes the server refuse Android sessions immediately", rolled.status === 403 && rolled.body.code === "CLIENT_KIND_NOT_ALLOWED");
  } finally {
    await prisma.examSecurityEvent.deleteMany({ where: { testId: level.id } }).catch(() => {});
    await prisma.moduleCodingAttempt.deleteMany({ where: { moduleCodingTestId: level.id } }).catch(() => {});
    await cleanup();
    await prisma.question.deleteMany({ where: { id: question.id } }).catch(() => {});
    await prisma.moduleCodingTest.deleteMany({ where: { id: level.id } }).catch(() => {});
    await prisma.courseModule.deleteMany({ where: { id: mod.id } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: course.id } }).catch(() => {});
    await prisma.institute.deleteMany({ where: { id: instituteId } }).catch(() => {});
  }
  console.log(failures === 0 ? "\nSECURE ANDROID VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
