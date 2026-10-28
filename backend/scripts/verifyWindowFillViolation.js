// Live check (audit batch 18): an exam window that stays smaller than the screen or moves (reported by the page as WINDOW_NOT_FILLING_SCREEN) is a CONFIRMED violation counted from the first
// occurrence, recorded once per situation (a duplicate inside the window is acknowledged and not counted again), decided by the SERVER (nothing the client sends changes severity or the count),
// reachable only by the attempt's own student, visible to the test's staff with the published rule, and hidden from another institute. Independent episodes count separately and the strike
// limit auto-submits. Throwaway institutes, users, a test and an attempt; cleans up after itself. Needs the API on localhost:4000 (or VERIFY_API) and a database.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ WFV";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
let ipSeq = 0;
const nextIp = () => `203.0.113.${150 + ++ipSeq}`;
async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { OR: [{ email: { startsWith: "zz-wfv-" } }, { instituteId: { in: ids } }] }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { studentId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { contains: "zz-wfv-" } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-wfv-" } }] } });
  await prisma.testAttempt.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.test.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }] } });
  await prisma.question.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { description: { startsWith: TAG } }] } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  try {
    const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZWA" } });
    const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZWB" } });
    const dept = await prisma.department.create({ data: { name: `${TAG} dept`, instituteId: A.id } });
    const group = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: dept.id, section: "Section A" } });
    const pw = {};
    const mk = async (key, role, instituteId, extra = {}) => {
      pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
      return prisma.user.create({ data: { name: `ZZ WFV ${key}`, email: `zz-wfv-${key.toLowerCase()}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
    };
    const U = { staffA: await mk("staffA", "STAFF", A.id), staffB: await mk("staffB", "STAFF", B.id), stuA: await mk("stuA", "STUDENT", A.id, { academicGroupId: group.id, department: dept.name }), stuA2: await mk("stuA2", "STUDENT", A.id, { academicGroupId: group.id, department: dept.name }) };
    const T = {};
    for (const [k, u] of Object.entries(U)) T[k] = (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
    check("test users could sign in", Object.values(T).every(Boolean));

    const q = await prisma.question.create({ data: { description: `${TAG} q ${ts}`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], points: 1, instituteId: A.id } });
    const now = Date.now();
    const test = await prisma.test.create({ data: { title: `${TAG} test ${ts}`, durationMin: 30, startTime: new Date(now - 60000), endTime: new Date(now + 3600000), isPublished: true, showResults: false, requireFullscreen: false, createdById: U.staffA.id, instituteId: A.id, academicGroups: { create: [{ academicGroupId: group.id }] }, questions: { create: [{ questionId: q.id, order: 0 }] } } });
    const attempt = await prisma.testAttempt.create({ data: { testId: test.id, studentId: U.stuA.id, status: "IN_PROGRESS", startedAt: new Date(), questionOrder: [q.id] } });
    const report = (token, extra = {}) => call("POST", `/tests/attempts/${attempt.id}/violation`, token, { type: "WINDOW_NOT_FILLING_SCREEN", ...extra });
    const stored = () => prisma.testViolation.findMany({ where: { attemptId: attempt.id, type: "WINDOW_NOT_FILLING_SCREEN" }, orderBy: { createdAt: "asc" } });
    const strikes = async () => (await prisma.testAttempt.findUnique({ where: { id: attempt.id } })).tabSwitchCount;
    const backdate = (seconds) => prisma.testViolation.updateMany({ where: { attemptId: attempt.id, type: "WINDOW_NOT_FILLING_SCREEN" }, data: { createdAt: new Date(Date.now() - seconds * 1000) } });

    // ---- who may report
    check("an anonymous report is refused", (await call("POST", `/tests/attempts/${attempt.id}/violation`, null, { type: "WINDOW_NOT_FILLING_SCREEN" })).status === 401);
    check("another student cannot report on this attempt", (await report(T.stuA2)).status === 403);
    check("staff cannot report as a student", (await report(T.staffA)).status === 403);
    check("nothing was recorded by those refusals", (await stored()).length === 0 && (await strikes()) === 0);

    // ---- the first occurrence is a confirmed, counted violation; the client cannot choose otherwise
    const r1 = await report(T.stuA, { severity: "INTERRUPTION", penalized: false, confirmed: false });
    check("the first occurrence is CONFIRMED and counted (the client's own severity and penalized flags are ignored)", r1.status === 200 && r1.json.severity === "CONFIRMED_VIOLATION" && r1.json.penalized === true && r1.json.tabSwitchCount === 1, JSON.stringify(r1.json));
    check("exactly one record exists, penalized", (await stored()).length === 1 && (await stored())[0].penalized === true && (await stored())[0].severity === "CONFIRMED_VIOLATION");

    // ---- duplicates inside the window are acknowledged, not counted
    const dup = await report(T.stuA);
    check("the same situation reported again at once is acknowledged as a duplicate and not counted", dup.status === 200 && dup.json.deduplicated === true && dup.json.penalized === false && dup.json.tabSwitchCount === 1, JSON.stringify(dup.json));
    check("still exactly one record and one strike", (await stored()).length === 1 && (await strikes()) === 1);
    const burst = await Promise.all([report(T.stuA), report(T.stuA), report(T.stuA)]);
    check("a burst of duplicates adds at most one more record (concurrent requests)", (await stored()).length <= 2 && burst.every((b) => b.status === 200), `records ${(await stored()).length}`);
    await prisma.testViolation.deleteMany({ where: { attemptId: attempt.id, type: "WINDOW_NOT_FILLING_SCREEN" } });
    await prisma.testAttempt.update({ where: { id: attempt.id }, data: { tabSwitchCount: 0 } });
    await prisma.testViolation.create({ data: { attemptId: attempt.id, type: "WINDOW_NOT_FILLING_SCREEN", severity: "CONFIRMED_VIOLATION", penalized: true } });
    await prisma.testAttempt.update({ where: { id: attempt.id }, data: { tabSwitchCount: 1 } });

    // ---- independent episodes count separately, and the strike limit auto-submits
    await backdate(40);
    const r2 = await report(T.stuA);
    check("an independent episode after the window is a second strike", r2.status === 200 && r2.json.penalized === true && r2.json.tabSwitchCount === 2 && !r2.json.deduplicated, JSON.stringify(r2.json));
    await backdate(40);
    const r3 = await report(T.stuA);
    check("the third independent episode reaches the limit and auto-submits the attempt", r3.status === 200 && r3.json.tabSwitchCount === 3 && r3.json.autoSubmitted === true, JSON.stringify(r3.json));
    check("the stored attempt is AUTO_SUBMITTED with 3 strikes", (await prisma.testAttempt.findUnique({ where: { id: attempt.id } })).status === "AUTO_SUBMITTED" && (await strikes()) === 3);
    const late = await report(T.stuA);
    check("a report after the attempt ended changes nothing", late.status === 200 && (await strikes()) === 3 && (await stored()).length === 3);

    // ---- review: staff of the institute see the finding with the published rule; another institute does not
    const log = await call("GET", `/tests/admin/attempts/${attempt.id}/violations`, T.staffA);
    const ev = log.json && (log.json.events || []).filter((e) => e.type === "WINDOW_NOT_FILLING_SCREEN");
    check("the test's staff see the three events", log.status === 200 && ev && ev.length === 3, `status ${log.status}`);
    check("each is a published-rule finding (WINDOW_FILL, confirmed policy violation, counted)", ev && ev.every((e) => e.evidence && e.evidence.policy && e.evidence.policy.ruleId === "WINDOW_FILL" && e.evidence.classification === "CONFIRMED_POLICY_VIOLATION" && e.penalized === true), JSON.stringify(ev && ev[0] && ev[0].evidence && ev[0].evidence.policy).slice(0, 160));
    check("the finding says what was measured and what it does not show", ev && /smaller than the screen/.test(ev[0].evidence.policy.description + ev[0].evidence.policy.shows) && /Which app was beside/.test(ev[0].evidence.policy.doesNotShow));
    check("staff of another institute cannot open the log", (await call("GET", `/tests/admin/attempts/${attempt.id}/violations`, T.staffB)).status === 403);
    check("a student cannot open the staff log", (await call("GET", `/tests/admin/attempts/${attempt.id}/violations`, T.stuA)).status === 403);
  } finally {
    await cleanup();
  }
  console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.log("SCRIPT CRASHED", e.stack || e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
