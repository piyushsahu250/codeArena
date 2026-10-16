// Database-backed check of POST /api/exam-security/test-events (Copilot key / AI-assistant shortcut signals for formal tests). Proves the server, not the page, is the
// authority: ownership, institute isolation, role, policy switch, attempt state, allowed types, bounded metadata, no forged student id, flood and cap limits, and that
// a signal never penalises or submits an attempt. Disposable data only (@example.invalid users, ZZ-VERIFY AI tests and institutes), removed afterwards.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_API || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const rand = () => crypto.randomBytes(18).toString("base64url");

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
async function login(email, password) {
  const r = await call("POST", "/auth/login", null, { email, password });
  if (!r.body?.token) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.body.token;
}
async function cleanup() {
  const tests = await prisma.test.findMany({ where: { title: { startsWith: "ZZ-VERIFY AI shortcut" } }, select: { id: true } });
  const ids = tests.map((t) => t.id);
  if (ids.length) {
    const attempts = await prisma.testAttempt.findMany({ where: { testId: { in: ids } }, select: { id: true } });
    const aids = attempts.map((a) => a.id);
    if (aids.length) { await prisma.examSecurityEvent.deleteMany({ where: { attemptId: { in: aids } } }); await prisma.testViolation.deleteMany({ where: { attemptId: { in: aids } } }); }
    await prisma.testAttempt.deleteMany({ where: { testId: { in: ids } } });
    await prisma.test.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-aisig-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { code: { in: ["ZZAIA", "ZZAIB"] } } });
}

async function main() {
  await cleanup();
  const A = await prisma.institute.create({ data: { name: "ZZ-VERIFY AI shortcut A", code: "ZZAIA" } });
  const B = await prisma.institute.create({ data: { name: "ZZ-VERIFY AI shortcut B", code: "ZZAIB" } });
  const pw = { s1: rand(), s2: rand(), sb: rand(), staff: rand() };
  const mk = async (tag, role, instituteId, password) => prisma.user.create({ data: { name: `Verify AI ${tag}`, email: `verify-aisig-${tag}-${Date.now()}@example.invalid`, passwordHash: await bcrypt.hash(password, 10), role, instituteId, mustChangePassword: false } });
  const staff = await mk("staff", "INSTITUTE_ADMIN", A.id, pw.staff);
  const s1 = await mk("s1", "STUDENT", A.id, pw.s1);
  const s2 = await mk("s2", "STUDENT", A.id, pw.s2);
  const sb = await mk("sb", "STUDENT", B.id, pw.sb);
  const now = Date.now();
  const mkTest = (suffix, extra = {}) => prisma.test.create({ data: { title: `ZZ-VERIFY AI shortcut ${suffix}`, durationMin: 60, startTime: new Date(now - 3600000), endTime: new Date(now + 6 * 3600000), isPublished: true, createdById: staff.id, instituteId: A.id, ...extra } });
  const tOn = await mkTest("on", { securityPolicy: { blockAiShortcuts: true } });
  const tOff = await mkTest("off");
  const aOn = await prisma.testAttempt.create({ data: { testId: tOn.id, studentId: s1.id, status: "IN_PROGRESS", startedAt: new Date(now - 60000) } });
  const aOff = await prisma.testAttempt.create({ data: { testId: tOff.id, studentId: s1.id, status: "IN_PROGRESS", startedAt: new Date(now - 60000) } });
  const aDone = await prisma.testAttempt.create({ data: { testId: tOn.id, studentId: s2.id, status: "SUBMITTED", startedAt: new Date(now - 600000), submittedAt: new Date(now - 300000) } });
  const t1 = await login(s1.email, pw.s1);
  const t2 = await login(s2.email, pw.s2);
  const tb = await login(sb.email, pw.sb);
  const ts = await login(staff.email, pw.staff);
  const sig = (extra = {}) => ({ type: "COPILOT_KEY_SIGNAL", metadata: { code: "F23", key: "F23", metaKey: true, shiftKey: true, cancelable: true, defaultPrevented: true, cancelAttempted: true, count: 1, clientAt: now, ...extra } });
  const rows = (attemptId) => prisma.examSecurityEvent.findMany({ where: { attemptKind: "TEST", attemptId } });
  const P = "/exam-security/test-events";

  check("no token is refused", (await call("POST", P, null, { attemptId: aOn.id, events: [sig()] })).status === 401);
  check("staff cannot use the student intake", [403, 401].includes((await call("POST", P, ts, { attemptId: aOn.id, events: [sig()] })).status));
  check("another student of the same institute cannot report on this attempt (404, looks nonexistent)", (await call("POST", P, t2, { attemptId: aOn.id, events: [sig()] })).status === 404);
  check("a student of another institute cannot either", (await call("POST", P, tb, { attemptId: aOn.id, events: [sig()] })).status === 404);
  check("an unknown attempt id is a 404", (await call("POST", P, t1, { attemptId: crypto.randomUUID(), events: [sig()] })).status === 404);
  check("a missing, empty or non-string attemptId/events is a 400", (await call("POST", P, t1, {})).status === 400 && (await call("POST", P, t1, { attemptId: aOn.id, events: [] })).status === 400 && (await call("POST", P, t1, { attemptId: { $ne: null }, events: [sig()] })).status === 400);

  const off = await call("POST", P, t1, { attemptId: aOff.id, events: [sig()] });
  check("a test whose policy has the switch off accepts nothing", off.status === 200 && off.body.accepted === 0 && off.body.disabled === true && (await rows(aOff.id)).length === 0, JSON.stringify(off.body));
  const done = await call("POST", P, t2, { attemptId: aDone.id, events: [sig()] });
  check("a submitted attempt accepts nothing", done.status === 200 && done.body.accepted === 0 && done.body.closed === true && (await rows(aDone.id)).length === 0, JSON.stringify(done.body));

  const forged = sig({ studentId: s2.id, role: "ADMIN", extra: "x", code: "F23".padEnd(500, "x") });
  const ok = await call("POST", P, t1, { attemptId: aOn.id, studentId: s2.id, events: [forged, { type: "TAB_SWITCH", metadata: {} }, { type: "CLIPBOARD_ATTEMPT", metadata: {} }, { type: "copilot_key_signal", metadata: { code: "F23" } }] });
  const saved = await rows(aOn.id);
  check("only the allowed signal types are stored; others are ignored", ok.status === 200 && ok.body.accepted === 2 && saved.length === 2 && saved.every((r) => r.type === "COPILOT_KEY_SIGNAL"), JSON.stringify(ok.body));
  check("the student id comes from the session, never from the request", saved.every((r) => r.studentId === s1.id));
  check("the institute and kind are set by the server", saved.every((r) => r.instituteId === A.id && r.attemptKind === "TEST" && r.testId === tOn.id));
  const meta = saved.find((r) => r.metadata && r.metadata.cancelable !== undefined)?.metadata || {};
  check("metadata keeps only the allowed keys and clips long strings", !("studentId" in meta) && !("role" in meta) && !("extra" in meta) && String(meta.code || "").length <= 200, JSON.stringify(meta).slice(0, 160));
  check("severity is LOW (an observation, set by the server)", saved.every((r) => r.severity === "LOW"));

  const flood = await call("POST", P, t1, { attemptId: aOn.id, events: Array.from({ length: 50 }, () => sig()) });
  check("a 50-event batch is cut to at most 10 rows", flood.status === 200 && flood.body.accepted <= 10, JSON.stringify(flood.body));
  const have = (await rows(aOn.id)).length;
  await prisma.examSecurityEvent.createMany({ data: Array.from({ length: Math.max(0, 200 - have) }, () => ({ attemptKind: "TEST", attemptId: aOn.id, studentId: s1.id, testId: tOn.id, type: "COPILOT_KEY_SIGNAL", severity: "LOW", instituteId: A.id })) });
  const capped = await call("POST", P, t1, { attemptId: aOn.id, events: [sig()] });
  check("per-attempt storage is capped", capped.status === 200 && capped.body.accepted === 0 && capped.body.capped === true, JSON.stringify(capped.body));

  const after = await prisma.testAttempt.findUnique({ where: { id: aOn.id }, select: { status: true, tabSwitchCount: true, totalScore: true } });
  check("signals never penalise or submit the attempt", after.status === "IN_PROGRESS" && after.tabSwitchCount === 0 && (await prisma.testViolation.count({ where: { attemptId: aOn.id } })) === 0, JSON.stringify(after));

  await cleanup();
  if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
  console.log("AI shortcut intake verification: all passed");
}
main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); }).finally(() => prisma.$disconnect());
