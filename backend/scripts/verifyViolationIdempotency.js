// Live check (audit batch 20): a violation report from the exam page carries a unique event id (an idempotency key), and the server counts each id at most once. REGRESSION / GAP:
//   * a report whose answer was lost (a network blip) and was sent again counted twice: a retried TAB_SWITCH was two strikes, a retried COPY escalated a suspicious pattern early;
//   * two violations arriving together could lose a strike (the count was read, then written back as an absolute number): three tab switches at once could leave the count at 1;
//   * the page had no queue: a report that could not be sent was lost.
// Now: the same event id on the same attempt is acknowledged with the recorded outcome and written once (also under concurrent requests), different ids stay independent incidents, a malformed id
// is refused, a page without ids behaves as before, the count is incremented in the database and the attempt is closed in the same transaction, and the staff log shape is unchanged.
// Throwaway institutes, users, a test and attempts; cleans up after itself. Needs the API on localhost:4000 (or VERIFY_API) and a database.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ VID";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
let ipSeq = 0;
const nextIp = () => `203.0.113.${20 + (++ipSeq % 200)}`;
async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}
const eid = () => crypto.randomUUID();

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { OR: [{ email: { startsWith: "zz-vid-" } }, { instituteId: { in: ids } }] }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { studentId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { contains: "zz-vid-" } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-vid-" } }] } });
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
    const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZVA" } });
    const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZVB" } });
    const dept = await prisma.department.create({ data: { name: `${TAG} dept`, instituteId: A.id } });
    const group = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: dept.id, section: "Section A" } });
    const pw = {};
    const mk = async (key, role, instituteId, extra = {}) => {
      pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
      return prisma.user.create({ data: { name: `ZZ VID ${key}`, email: `zz-vid-${key.toLowerCase()}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
    };
    const U = { staffA: await mk("staffA", "STAFF", A.id), staffB: await mk("staffB", "STAFF", B.id), s1: await mk("s1", "STUDENT", A.id, { academicGroupId: group.id, department: dept.name }), s2: await mk("s2", "STUDENT", A.id, { academicGroupId: group.id, department: dept.name }), s3: await mk("s3", "STUDENT", A.id, { academicGroupId: group.id, department: dept.name }) };
    const T = {};
    for (const [k, u] of Object.entries(U)) T[k] = (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
    check("test users could sign in", Object.values(T).every(Boolean));

    const q = await prisma.question.create({ data: { description: `${TAG} q ${ts}`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], points: 1, instituteId: A.id } });
    const now = Date.now();
    const test = await prisma.test.create({ data: { title: `${TAG} test ${ts}`, durationMin: 30, startTime: new Date(now - 60000), endTime: new Date(now + 3600000), isPublished: true, showResults: false, requireFullscreen: false, createdById: U.staffA.id, instituteId: A.id, academicGroups: { create: [{ academicGroupId: group.id }] }, questions: { create: [{ questionId: q.id, order: 0 }] } } });
    const mkAttempt = (u) => prisma.testAttempt.create({ data: { testId: test.id, studentId: u.id, status: "IN_PROGRESS", startedAt: new Date(), questionOrder: [q.id] } });
    const a1 = await mkAttempt(U.s1); const a2 = await mkAttempt(U.s2); const a3 = await mkAttempt(U.s3);
    const post = (token, attempt, type, extra = {}) => call("POST", `/tests/attempts/${attempt.id}/violation`, token, { type, ...extra });
    const rows = (attempt, where = {}) => prisma.testViolation.findMany({ where: { attemptId: attempt.id, ...where }, orderBy: { createdAt: "asc" } });
    const strikes = async (attempt) => (await prisma.testAttempt.findUnique({ where: { id: attempt.id } })).tabSwitchCount;

    // ---------- who may report, and what is refused ----------
    check("an anonymous report is refused", (await call("POST", `/tests/attempts/${a1.id}/violation`, null, { type: "COPY", eventId: eid() })).status === 401);
    check("another student cannot report on this attempt, with or without an event id", (await post(T.s2, a1, "COPY", { eventId: eid() })).status === 403 && (await post(T.s2, a1, "COPY")).status === 403);
    for (const bad of ["short", "has space in it", "x".repeat(70), "semi;colon;12345", 12345678]) check(`a malformed event id (${JSON.stringify(bad).slice(0, 24)}) is refused with 400`, (await post(T.s1, a1, "COPY", { eventId: bad })).status === 400);
    check("nothing was recorded by the refusals", (await rows(a1)).length === 0 && (await strikes(a1)) === 0);

    // ---------- an older page (no event id) behaves exactly as before ----------
    const old = await post(T.s3, a3, "COPY");
    check("a report without an event id is processed as before, and its answer has no new fields", old.status === 200 && old.json.severity === "SUSPICIOUS" && old.json.penalized === false && !("eventId" in old.json) && !("acknowledged" in old.json), JSON.stringify(old.json));
    check("it is stored with no event id", (await rows(a3)).length === 1 && (await rows(a3))[0].clientEventId === null);

    // ---------- a retry of the same event is acknowledged, never counted twice ----------
    const E1 = eid();
    const c1 = await post(T.s1, a1, "COPY", { eventId: E1, clientAt: Date.now() - 4000 });
    check("a report with an event id is recorded and acknowledged", c1.status === 200 && c1.json.acknowledged === true && c1.json.eventId === E1 && c1.json.duplicate === undefined, JSON.stringify(c1.json));
    const stored = (await rows(a1))[0];
    check("the event id and the page's claimed time are stored; the record's own time is the server's", stored.clientEventId === E1 && stored.clientAt && Math.abs(stored.clientAt.getTime() - (Date.now() - 4000)) < 60000 && Math.abs(stored.createdAt.getTime() - Date.now()) < 30000);
    const r1 = await post(T.s1, a1, "COPY", { eventId: E1 });
    check("the same event sent again (a retry) is acknowledged as a duplicate with the recorded outcome", r1.status === 200 && r1.json.duplicate === true && r1.json.acknowledged === true && r1.json.severity === "SUSPICIOUS" && r1.json.penalized === false, JSON.stringify(r1.json));
    check("and nothing was written a second time", (await rows(a1, { type: "COPY" })).length === 1);
    const c2 = await post(T.s1, a1, "COPY", { eventId: eid() });
    check("a different event id is a separate incident, recorded on its own", c2.status === 200 && c2.json.duplicate === undefined && (await rows(a1, { type: "COPY" })).length === 2);
    const impl = await post(T.s1, a1, "COPY", { eventId: E1 });
    check("a retry of the FIRST copy does not push the suspicious pattern over the escalation threshold", impl.json.duplicate === true && (await strikes(a1)) === 0 && (await rows(a1, { type: "COPY" })).length === 2);

    // ---------- a retried strike is one strike ----------
    const E3 = eid();
    const t1 = await post(T.s1, a1, "TAB_SWITCH", { eventId: E3 });
    check("a tab switch is a strike", t1.json.penalized === true && t1.json.tabSwitchCount === 1 && (await strikes(a1)) === 1, JSON.stringify(t1.json));
    const t1b = await post(T.s1, a1, "TAB_SWITCH", { eventId: E3 });
    check("the same tab switch sent again (the first answer was lost) is NOT a second strike", t1b.json.duplicate === true && t1b.json.tabSwitchCount === 1 && (await strikes(a1)) === 1 && (await rows(a1, { type: "TAB_SWITCH" })).length === 1, JSON.stringify(t1b.json));
    const t2 = await post(T.s1, a1, "TAB_SWITCH", { eventId: eid() });
    check("a separate tab switch later is its own strike (each independent incident stays auditable)", t2.json.penalized === true && t2.json.tabSwitchCount === 2 && (await rows(a1, { type: "TAB_SWITCH" })).length === 2);

    // ---------- the same id sent many times at once ----------
    const E4 = eid();
    const burst = await Promise.all(Array.from({ length: 6 }, () => post(T.s2, a2, "TAB_SWITCH", { eventId: E4 })));
    check("six identical requests at once: all succeed", burst.every((b) => b.status === 200), burst.map((b) => b.status).join(","));
    check("exactly one record and one strike were written", (await rows(a2, { type: "TAB_SWITCH" })).length === 1 && (await strikes(a2)) === 1, `rows ${(await rows(a2, { type: "TAB_SWITCH" })).length}, strikes ${await strikes(a2)}`);
    check("exactly one answer is the original, the rest are duplicates", burst.filter((b) => b.json.duplicate !== true).length === 1 && burst.filter((b) => b.json.duplicate === true).length === 5);

    // ---------- the same id on another attempt is allowed (the key is per attempt) ----------
    const reuse = await post(T.s3, a3, "TAB_SWITCH", { eventId: E4 });
    check("an event id is unique per attempt, not across the platform", reuse.status === 200 && reuse.json.duplicate === undefined && reuse.json.tabSwitchCount === 1);

    // ---------- different incidents at once: no strike is lost ----------
    const a4s = await mk("s4", "STUDENT", A.id, { academicGroupId: group.id, department: dept.name });
    const tok4 = (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: a4s.email, password: pw.s4 }) })).json()).token;
    const a4 = await mkAttempt(a4s);
    const trio = await Promise.all([post(tok4, a4, "TAB_SWITCH", { eventId: eid() }), post(tok4, a4, "TAB_SWITCH", { eventId: eid() }), post(tok4, a4, "TAB_SWITCH", { eventId: eid() })]);
    const final4 = await prisma.testAttempt.findUnique({ where: { id: a4.id } });
    check("three different tab switches at once: all three are recorded", trio.every((t) => t.status === 200) && (await rows(a4, { type: "TAB_SWITCH" })).length === 3);
    check("none of the strikes was lost (the count is incremented in the database)", final4.tabSwitchCount === 3, `count ${final4.tabSwitchCount}`);
    check("the third strike closed the attempt, and every answer says so", final4.status === "AUTO_SUBMITTED" && trio.filter((t) => t.json.autoSubmitted === true).length >= 1 && trio.every((t) => t.json.tabSwitchCount >= 1));

    // ---------- after the attempt is closed ----------
    const late = await post(tok4, a4, "TAB_SWITCH", { eventId: eid() });
    check("a report after the attempt closed is acknowledged and changes nothing", late.status === 200 && late.json.autoSubmitted === true && late.json.acknowledged === true && (await rows(a4)).length === 3 && (await strikes(a4)) === 3, JSON.stringify(late.json));

    // ---------- the client's claimed time is never trusted ----------
    const odd = await post(T.s3, a3, "COPY", { eventId: eid(), clientAt: 1000 });
    const oddRow = (await rows(a3, { type: "COPY" })).pop();
    check("an implausible claimed time (1970) is ignored, the server's time is used", odd.status === 200 && oddRow.clientAt === null && Math.abs(oddRow.createdAt.getTime() - Date.now()) < 30000);

    // ---------- review: the staff log has the same shape as before and does not expose the keys ----------
    const log = await call("GET", `/tests/admin/attempts/${a1.id}/violations`, T.staffA);
    check("the staff log lists the events", log.status === 200 && log.json.events.length === (await rows(a1)).length, `status ${log.status}`);
    check("each event keeps the shape it always had and shows no idempotency key", log.json.events.every((e) => ["id", "type", "severity", "penalized", "createdAt"].every((k) => k in e) && !("clientEventId" in e) && !("clientAt" in e)));
    check("staff of another institute cannot read the log", (await call("GET", `/tests/admin/attempts/${a1.id}/violations`, T.staffB)).status === 403);
  } finally {
    await cleanup();
  }
  console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.log("SCRIPT CRASHED", e.stack || e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
