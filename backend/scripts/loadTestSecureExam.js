// Load test of the LOCKDOWN secure-exam path on this instance: N disposable students, each on its own registered device, doing
//   login -> challenge -> signed session -> start (LOCKDOWN) -> 3 heartbeats (with events) -> 2 autosaves -> finalize
// with every step fired by all N students at the same moment (login in waves of LOGIN_WAVE so the login rate limiter does not
// dominate). The judge is NOT exercised here (no code is submitted); judge capacity was measured separately. Reports p50/p95/p99,
// error counts per step and wall time; the caller samples CPU/RAM (docker stats) around it. Removes all its data afterwards.
// Usage: N=500 node scripts/loadTestSecureExam.js
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const S = require("../src/utils/secureExam");

const BASE = "http://localhost:4000/api";
const N = Number(process.env.N || 200);
const LOGIN_WAVE = Number(process.env.LOGIN_WAVE || 200);
const FULL = { kiosk: true, appRestriction: true, browserRestriction: true, networkRestriction: true, clipboard: true, fullscreen: true, devtoolsDisabled: true, screenCaptureProtection: false };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: "verify-lse-", endsWith: "@example.invalid" } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    await prisma.secureExamSession.deleteMany({ where: { studentId: { in: part } } });
    await prisma.examSecurityEvent.deleteMany({ where: { studentId: { in: part } } });
    await prisma.user.deleteMany({ where: { id: { in: part } } });
  }
  await prisma.examDevice.deleteMany({ where: { deviceId: { startsWith: "VERIFY-LSE-" } } });
  await prisma.academicGroup.deleteMany({ where: { batch: "ZZ-VERIFY-LSE" } });
}

(async () => {
  await cleanup();
  if (!S.configured()) throw new Error("SECURE_BROWSER_SECRET not configured");
  const course = await prisma.course.findUnique({ where: { slug: "java-practice" } });
  const real = (await prisma.academicGroup.findMany({ where: { isActive: true } }))[0];
  const level = await prisma.moduleCodingTest.findFirst({ where: { chapter: { module: { courseId: course.id } }, isActive: true }, orderBy: { createdAt: "asc" } });
  const original = { securityLevel: level.securityLevel, securityPolicy: level.securityPolicy, maxAttempts: level.maxAttempts, proctoring: level.proctoring };
  const stamp = Date.now();
  const grp = await prisma.academicGroup.create({ data: { instituteId: real.instituteId, departmentId: real.departmentId, batch: "ZZ-VERIFY-LSE", section: `LSE-${stamp}` } });
  const pw = crypto.randomBytes(18).toString("base64url");
  const hash = await bcrypt.hash(pw, 4); // throwaway credential: login cost is not what is measured here
  const admin = await prisma.user.create({ data: { name: "LSE Admin", email: `verify-lse-admin-${stamp}@example.invalid`, passwordHash: hash, role: "ADMIN", mustChangePassword: false } });
  await prisma.courseAcademicGroupAssignment.create({ data: { courseId: course.id, academicGroupId: grp.id, assignedByUserId: admin.id, assignedByName: admin.name } });
  await prisma.moduleCodingTest.update({ where: { id: level.id }, data: { maxAttempts: 50, securityLevel: "LOCKDOWN", securityPolicy: { exitAction: "PAUSE", graceSec: 120 } } });
  await prisma.user.createMany({ data: Array.from({ length: N }, (_, i) => ({ name: `LSE ${i}`, email: `verify-lse-${stamp}-${i}@example.invalid`, passwordHash: hash, role: "STUDENT", instituteId: real.instituteId, academicGroupId: grp.id, mustChangePassword: false })) });
  await prisma.examDevice.createMany({ data: Array.from({ length: N }, (_, i) => ({ instituteId: real.instituteId, deviceId: `VERIFY-LSE-${stamp}-${i}`, label: `Load PC ${i}`, registeredById: admin.id })) });
  const users = await prisma.user.findMany({ where: { email: { startsWith: `verify-lse-${stamp}-` } }, select: { id: true, email: true }, orderBy: { email: "asc" } });
  const students = users.map((u, i) => ({ ...u, i, deviceId: `VERIFY-LSE-${stamp}-${u.email.match(/-(\d+)@/)[1]}` }));

  const lat = {}, errs = {}, codes = {};
  async function timed(name, fn) {
    const t = Date.now(); let r;
    try { r = await fn(); } catch (e) { r = { status: 0, body: { code: e.message } }; }
    (lat[name] ||= []).push(Date.now() - t);
    if (!(r.status >= 200 && r.status < 300)) { errs[name] = (errs[name] || 0) + 1; const k = `${name}:${r.status}:${r.body?.code || r.body?.error || ""}`.slice(0, 80); codes[k] = (codes[k] || 0) + 1; }
    return r;
  }
  // Each simulated student gets its own client address (X-Forwarded-For with trust-proxy 1), exactly as real students on different
  // machines would; otherwise the per-IP rate limiters would see one client doing thousands of requests from localhost.
  const ipOf = (i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${(i & 255) + 1}`;
  const tokenIp = new Map();
  const call = async (method, path, token, body, headers = {}) => {
    const ipHeader = {};
    if (body?.email && /-(d+)@/.test(body.email) && body.email.startsWith("verify-lse-" + stamp)) ipHeader["X-Forwarded-For"] = ipOf(Number(body.email.match(/-(d+)@/)[1]));
    else if (token && tokenIp.has(token)) ipHeader["X-Forwarded-For"] = tokenIp.get(token);
    const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120", ...ipHeader, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    let b = null; try { b = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: b };
  };

  try {
    const wall0 = Date.now();
    // 1. login (waves)
    const jwt = new Array(N);
    for (let w = 0; w < N; w += LOGIN_WAVE) {
      await Promise.all(students.slice(w, w + LOGIN_WAVE).map(async (s) => { const r = await timed("login", () => call("POST", "/auth/login", null, { email: s.email, password: pw })); jwt[s.i] = r.body?.token; if (jwt[s.i]) tokenIp.set(jwt[s.i], ipOf(s.i)); }));
    }
    const live = students.filter((s) => jwt[s.i]);
    // 2. secure session creation (all at once)
    const sess = new Array(N);
    const nonces = await Promise.all(live.map((s) => timed("challenge", () => call("POST", "/secure-exam/challenge", jwt[s.i], { deviceId: s.deviceId }))));
    await Promise.all(live.map(async (s, k) => {
      if (!nonces[k].body?.nonce) return;
      const secret = S.deriveDeviceSecret(real.instituteId, s.deviceId);
      const sig = S.clientSignature(secret, { nonce: nonces[k].body.nonce, clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: FULL });
      const r = await timed("secure session", () => call("POST", "/secure-exam/session", jwt[s.i], { deviceId: s.deviceId, nonce: nonces[k].body.nonce, sig, clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: FULL }));
      sess[s.i] = r.body?.token;
    }));
    // 3. exam start (all at once)
    const attempt = new Array(N);
    await Promise.all(live.map(async (s) => {
      if (!sess[s.i]) return;
      const r = await timed("exam start (LOCKDOWN)", () => call("POST", `/module-coding/level/${level.id}/start`, jwt[s.i], null, { "X-Secure-Session": sess[s.i] }));
      if (r.body?.attemptId) attempt[s.i] = { id: r.body.attemptId, exam: r.body.sessionId, q: r.body.questions[0].id };
    }));
    const running = live.filter((s) => attempt[s.i]);
    // 4. heartbeats with events (3 rounds, all at once each)
    for (let round = 0; round < 3; round++) {
      await Promise.all(running.map((s) => timed("heartbeat (+2 events)", () => call("POST", "/secure-exam/heartbeat", jwt[s.i], { capabilities: FULL, events: [{ type: "FOCUS_LOSS", metadata: { seconds: 1 } }, { type: "EXTERNAL_NAVIGATION", metadata: { host: "example.org" } }] }, { "X-Secure-Session": sess[s.i] }))));
      await sleep(300);
    }
    // 5. autosave (2 rounds)
    for (let round = 0; round < 2; round++) {
      await Promise.all(running.map((s) => timed("autosave", () => call("POST", `/module-coding/attempts/${attempt[s.i].id}/autosave`, jwt[s.i], { questionId: attempt[s.i].q, language: "java", code: `class Main { /* ${round} */ }`, seq: round + 1 }, { "X-Secure-Session": sess[s.i], "X-Exam-Session": attempt[s.i].exam }))));
    }
    // 6. staff monitor while everyone is active
    const TA = (await call("POST", "/auth/login", null, { email: admin.email, password: pw })).body?.token;
    const monitors = [];
    for (let k = 0; k < 5; k++) monitors.push(await timed("staff monitor (page+summary)", () => call("GET", `/exam-security/tests/${level.id}/monitor?pageSize=100`, TA)));
    // 7. finalize (all at once)
    const fins = await Promise.all(running.map((s) => timed("finalize + grade", () => call("POST", `/module-coding/attempts/${attempt[s.i].id}/finalize`, jwt[s.i], { reason: "manual" }, { "X-Secure-Session": sess[s.i], "X-Exam-Session": attempt[s.i].exam }))));
    const wall = (Date.now() - wall0) / 1000;
    const dbDone = await prisma.moduleCodingAttempt.count({ where: { studentId: { in: students.map((s) => s.id) }, status: { not: "IN_PROGRESS" } } });
    const dbEvents = await prisma.examSecurityEvent.count({ where: { studentId: { in: students.map((s) => s.id) } } });
    const dupAttempts = await prisma.moduleCodingAttempt.groupBy({ by: ["studentId"], where: { studentId: { in: students.map((s) => s.id) } }, _count: true, having: { studentId: { _count: { gt: 1 } } } });
    console.log(`N=${N}  wall=${wall.toFixed(1)}s  logged-in=${live.length}  sessions=${sess.filter(Boolean).length}  started=${running.length}  finalized-in-db=${dbDone}  security-events-stored=${dbEvents}  duplicate-attempts=${dupAttempts.length}  monitor-summary-active-peak=${monitors[0]?.body?.summary?.active ?? "n/a"}`);
    console.log("  step".padEnd(34) + "n".padStart(6) + "p50".padStart(8) + "p95".padStart(8) + "p99".padStart(8) + "max".padStart(8) + "  errors");
    for (const [k, v] of Object.entries(lat)) console.log(`  ${k.padEnd(32)}${String(v.length).padStart(6)}${(pct(v, 50) + "ms").padStart(8)}${(pct(v, 95) + "ms").padStart(8)}${(pct(v, 99) + "ms").padStart(8)}${(Math.max(...v) + "ms").padStart(8)}  ${errs[k] || 0}`);
    if (Object.keys(codes).length) console.log("  error detail:", JSON.stringify(codes));
  } finally {
    await prisma.moduleCodingTest.update({ where: { id: level.id }, data: original }).catch((e) => console.log("restore failed:", e.message));
    await prisma.courseAcademicGroupAssignment.deleteMany({ where: { academicGroupId: grp.id } });
    await cleanup();
  }
  process.exit(0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
