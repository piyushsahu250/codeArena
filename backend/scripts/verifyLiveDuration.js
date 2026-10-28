// Live check (audit batch 19): changing a formal test's duration while students are taking it. REGRESSION / GAP: a deadline is the attempt's own start plus the test's duration, derived by the server,
// so the generic test edit already moved every running attempt's deadline, silently, with no preview, no confirmation for a reduction, no record, and nothing told the open student pages. Now:
//   PATCH /tests/:id/duration (preview: GET /tests/:id/duration-impact) is the guarded way: authorised people only, the version the administrator read must still be current, a repeat of a request
//   does nothing twice, two administrators cannot both win, a reduction needs confirmation, the change and its audit record commit together, completed attempts and answers are untouched,
//   and GET /tests/attempts/:id/clock gives the student page the authoritative deadline.
// Throwaway institutes, users, a test, 120 running attempts and 5 completed ones; cleans up after itself. Needs the API on localhost:4000 (or VERIFY_API) and a database.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const repo = require("../src/modules/tests/tests.duration.repository");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ LDV";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
let ipSeq = 0;
const nextIp = () => `203.0.113.${50 + (++ipSeq % 150)}`;
async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}
const rid = () => crypto.randomBytes(9).toString("base64url");
const MIN = 60000;

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { OR: [{ email: { startsWith: "zz-ldv-" } }, { instituteId: { in: ids } }] }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { studentId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { contains: "zz-ldv-" } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-ldv-" } }] } });
  await prisma.submission.deleteMany({ where: { studentId: { in: uids } } });
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
    const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZLA" } });
    const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZLB" } });
    const dept = await prisma.department.create({ data: { name: `${TAG} dept`, instituteId: A.id } });
    const group = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: dept.id, section: "Section A" } });
    const pw = {};
    const mk = async (key, role, instituteId, extra = {}) => {
      pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
      return prisma.user.create({ data: { name: `ZZ LDV ${key}`, email: `zz-ldv-${key.toLowerCase()}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
    };
    const U = {
      adminA: await mk("adminA", "INSTITUTE_ADMIN", A.id), adminB: await mk("adminB", "INSTITUTE_ADMIN", B.id), owner: await mk("owner", "STAFF", A.id), other: await mk("other", "STAFF", A.id),
      s1: await mk("s1", "STUDENT", A.id, { academicGroupId: group.id, department: dept.name }), s2: await mk("s2", "STUDENT", A.id, { academicGroupId: group.id, department: dept.name }),
      s3: await mk("s3", "STUDENT", A.id, { academicGroupId: group.id, department: dept.name }),
    };
    const T = {};
    for (const [k, u] of Object.entries(U)) T[k] = (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
    check("test users could sign in", Object.values(T).every(Boolean));

    const q = await prisma.question.create({ data: { description: `${TAG} q ${ts}`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], points: 1, instituteId: A.id } });
    const now = Date.now();
    const test = await prisma.test.create({ data: { title: `${TAG} test ${ts}`, durationMin: 30, startTime: new Date(now - 3 * 60 * MIN), endTime: new Date(now + 3 * 60 * MIN), isPublished: true, showResults: false, requireFullscreen: false, createdById: U.owner.id, instituteId: A.id, academicGroups: { create: [{ academicGroupId: group.id }] }, questions: { create: [{ questionId: q.id, order: 0 }] } } });
    const scheduled = await prisma.test.create({ data: { title: `${TAG} scheduled ${ts}`, durationMin: 20, startTime: new Date(now + 24 * 60 * MIN), endTime: new Date(now + 26 * 60 * MIN), isPublished: true, requireFullscreen: false, createdById: U.owner.id, instituteId: A.id, questions: { create: [{ questionId: q.id, order: 0 }] } } });

    // 120 running attempts that started between 1 and 25 minutes ago (all still inside the original 30), 5 completed, and one real student per role of the checks below.
    const bulk = [];
    for (let i = 0; i < 120; i++) bulk.push({ name: `ZZ LDV bulk ${i}`, email: `zz-ldv-bulk${i}-${ts}@example.invalid`, passwordHash: "x", role: "STUDENT", instituteId: A.id, mustChangePassword: false });
    await prisma.user.createMany({ data: bulk });
    const bulkUsers = await prisma.user.findMany({ where: { email: { startsWith: "zz-ldv-bulk", endsWith: `-${ts}@example.invalid` } }, select: { id: true } });
    await prisma.testAttempt.createMany({ data: bulkUsers.slice(0, 120).map((u, i) => ({ testId: test.id, studentId: u.id, status: "IN_PROGRESS", startedAt: new Date(now - (1 + (i % 25)) * MIN), questionOrder: [q.id] })) });
    const done = [];
    for (let i = 0; i < 5; i++) {
      const u = await prisma.user.create({ data: { name: `ZZ LDV done ${i}`, email: `zz-ldv-done${i}-${ts}@example.invalid`, passwordHash: "x", role: "STUDENT", instituteId: A.id, mustChangePassword: false } });
      done.push(await prisma.testAttempt.create({ data: { testId: test.id, studentId: u.id, status: i % 2 ? "AUTO_SUBMITTED" : "SUBMITTED", startedAt: new Date(now - 100 * MIN), submittedAt: new Date(now - 60 * MIN), totalScore: 7 + i, questionOrder: [q.id] } }));
    }
    // s1 started 20 minutes ago, s2 started 40 minutes ago (already past the original 30), s3 started 55 minutes ago.
    const a1 = await prisma.testAttempt.create({ data: { testId: test.id, studentId: U.s1.id, status: "IN_PROGRESS", startedAt: new Date(now - 20 * MIN), questionOrder: [q.id] } });
    const a2 = await prisma.testAttempt.create({ data: { testId: test.id, studentId: U.s2.id, status: "IN_PROGRESS", startedAt: new Date(now - 40 * MIN), questionOrder: [q.id] } });
    const a3 = await prisma.testAttempt.create({ data: { testId: test.id, studentId: U.s3.id, status: "IN_PROGRESS", startedAt: new Date(now - 55 * MIN), questionOrder: [q.id] } });
    await prisma.submission.create({ data: { attemptId: a1.id, questionId: q.id, studentId: U.s1.id, language: "MCQ", code: "[0]", score: 1, passedCases: 1, totalCases: 1, verdict: "ACCEPTED" } });
    const snapshot = async () => ({ done: await prisma.testAttempt.findMany({ where: { id: { in: done.map((d) => d.id) } }, orderBy: { id: "asc" }, select: { id: true, status: true, startedAt: true, submittedAt: true, totalScore: true } }), sub: await prisma.submission.findMany({ where: { attemptId: a1.id }, select: { id: true, code: true, score: true, verdict: true } }), starts: (await prisma.testAttempt.findMany({ where: { testId: test.id, status: "IN_PROGRESS" }, select: { id: true, startedAt: true } })).map((a) => `${a.id}:${a.startedAt.getTime()}`).sort() });
    const before = JSON.stringify(await snapshot());
    const testRow = () => prisma.test.findUnique({ where: { id: test.id } });
    const auditCount = () => prisma.auditLog.count({ where: { action: "TEST_DURATION_CHANGED", details: { path: ["testId"], equals: test.id } } });
    const clock = (token, attemptId) => call("GET", `/tests/attempts/${attemptId}/clock`, token);
    const answer = (token, attempt) => call("POST", "/submissions/submit", token, { attemptId: attempt.id, questionId: q.id, selectedOptions: [0] });

    // ---------- the preview ----------
    const v0 = (await testRow()).version;
    const imp = await call("GET", `/tests/${test.id}/duration-impact?durationMin=60`, T.adminA);
    check("the preview shows the current state and what 60 minutes would do", imp.status === 200 && imp.json.currentDurationMin === 30 && imp.json.originalDurationMin === 30 && imp.json.attempts.active === 123 && imp.json.attempts.completed === 5 && imp.json.attempts.started === 128, JSON.stringify(imp.json && imp.json.attempts));
    check("an increase needs no confirmation and moves every running deadline later", imp.json.plan.eligible === 123 && imp.json.plan.movedLater === 123 && imp.json.plan.movedEarlier === 0 && imp.json.confirmationsNeeded.reduction === false && imp.json.confirmationsNeeded.expiry === false, JSON.stringify(imp.json.plan));
    check("the preview says the scheduled closing time is not changed", imp.json.closingTime.changedByThisAction === false && !!imp.json.closingTime.endTime);

    // ---------- who may ----------
    const body = (over = {}) => ({ durationMin: 60, expectedVersion: v0, requestId: rid(), ...over });
    check("an anonymous request is refused", (await call("PATCH", `/tests/${test.id}/duration`, null, body())).status === 401);
    check("a student cannot change the duration", (await call("PATCH", `/tests/${test.id}/duration`, T.s1, body())).status === 403);
    check("a student cannot read the preview", (await call("GET", `/tests/${test.id}/duration-impact`, T.s1)).status === 403);
    check("staff who neither created nor were given the test cannot change it", (await call("PATCH", `/tests/${test.id}/duration`, T.other, body())).status === 403);
    check("an admin of another institute cannot change it or read the preview", (await call("PATCH", `/tests/${test.id}/duration`, T.adminB, body())).status === 403 && (await call("GET", `/tests/${test.id}/duration-impact`, T.adminB)).status === 403);
    for (const [label, over] of [["zero", { durationMin: 0 }], ["negative", { durationMin: -5 }], ["too large", { durationMin: 5000 }], ["not a number", { durationMin: "abc" }], ["a fraction", { durationMin: 30.5 }], ["no version", { expectedVersion: undefined }], ["a bad request id", { requestId: "x y" }]]) {
      check(`a ${label} request is refused with 400`, (await call("PATCH", `/tests/${test.id}/duration`, T.adminA, body(over))).status === 400);
    }
    check("the same duration is refused (nothing to change)", (await call("PATCH", `/tests/${test.id}/duration`, T.adminA, body({ durationMin: 30 }))).status === 400);
    check("nothing was changed by the refusals", (await testRow()).durationMin === 30 && (await testRow()).version === v0 && (await auditCount()) === 0);

    // ---------- before the change, an attempt past its original deadline is refused (the existing server rule) ----------
    check("before the increase, a student past the original 30 minutes cannot save an answer", [403].includes((await answer(T.s2, a2)).status));
    const c1 = await clock(T.s1, a1.id);
    check("the student's clock: deadline = their own start + 30 minutes", c1.status === 200 && c1.json.deadlineAt === a1.startedAt.getTime() + 30 * MIN && c1.json.durationMin === 30 && Math.abs(c1.json.serverNow - Date.now()) < 5000, JSON.stringify(c1.json));
    check("another student cannot read this attempt's clock", (await clock(T.s2, a1.id)).status === 403);

    // ---------- the increase, by the test's creator (who may edit it) ----------
    const r1 = rid();
    const inc = await call("PATCH", `/tests/${test.id}/duration`, T.owner, body({ requestId: r1, reason: "Students need more time" }));
    check("the creator changes 30 -> 60 and every running attempt is eligible and updated", inc.status === 200 && inc.json.ok === true && inc.json.previousDurationMin === 30 && inc.json.newDurationMin === 60 && inc.json.eligibleAttempts === 123 && inc.json.updatedAttempts === 123 && inc.json.failedAttempts === 0 && inc.json.movedLater === 123, JSON.stringify(inc.json));
    const t1 = await testRow();
    check("the test now has 60 minutes and the next version", t1.durationMin === 60 && t1.version === v0 + 1);
    check("exactly one audit record, with who, from, to, reason, version and counts", (await auditCount()) === 1);
    const aud = await prisma.auditLog.findFirst({ where: { action: "TEST_DURATION_CHANGED", details: { path: ["testId"], equals: test.id } } });
    check("the audit record is complete", aud && aud.adminId === U.owner.id && aud.details.previousDurationMin === 30 && aud.details.newDurationMin === 60 && aud.details.reason === "Students need more time" && aud.details.version === v0 + 1 && aud.details.eligibleAttempts === 123 && aud.details.requestId === r1 && aud.instituteId === A.id, JSON.stringify(aud && aud.details));
    check("completed attempts, running attempts' start times and the saved answer are untouched", JSON.stringify(await snapshot()) === before);
    const c2 = await clock(T.s1, a1.id);
    check("after the change the student's clock gives start + 60 minutes (a refresh or reconnect gets the same answer)", c2.status === 200 && c2.json.deadlineAt === a1.startedAt.getTime() + 60 * MIN && c2.json.durationMin === 60 && c2.json.configVersion === v0 + 1, JSON.stringify(c2.json));
    const c2b = await clock(T.s2, a2.id);
    check("a student who started 40 minutes ago now has 20 minutes left, measured from their own start (not from the change)", c2b.json.deadlineAt === a2.startedAt.getTime() + 60 * MIN, JSON.stringify(c2b.json));
    check("the student who was past the old deadline can save an answer again", (await answer(T.s2, a2)).status === 200);

    // ---------- repeat, stale and concurrent requests ----------
    const rep = await call("PATCH", `/tests/${test.id}/duration`, T.owner, body({ requestId: r1, expectedVersion: v0 }));
    check("a repeat of the same request returns the first outcome and changes nothing", rep.status === 200 && rep.json.repeated === true && rep.json.newDurationMin === 60 && (await testRow()).version === v0 + 1 && (await auditCount()) === 1, JSON.stringify(rep.json));
    const stale = await call("PATCH", `/tests/${test.id}/duration`, T.adminA, body({ durationMin: 90, expectedVersion: v0 }));
    check("a request made from an older version is refused with 409 and changes nothing", stale.status === 409 && stale.json.conflict === true && (await testRow()).durationMin === 60);
    const v1 = (await testRow()).version;
    const [x, y] = await Promise.all([call("PATCH", `/tests/${test.id}/duration`, T.adminA, body({ durationMin: 90, expectedVersion: v1 })), call("PATCH", `/tests/${test.id}/duration`, T.owner, body({ durationMin: 75, expectedVersion: v1 }))]);
    const won = [x, y].filter((r) => r.status === 200); const lost = [x, y].filter((r) => r.status === 409);
    const t2 = await testRow();
    check("two administrators at once: exactly one wins, the other is told to reload", won.length === 1 && lost.length === 1, `${x.status}/${y.status}`);
    check("the winner's duration is the one stored, the version moved once, and there are exactly two audit records in total", t2.durationMin === won[0].json.newDurationMin && t2.version === v1 + 1 && (await auditCount()) === 2);
    check("no running attempt has a mixed or reset start", JSON.stringify((await snapshot()).starts) === JSON.stringify(JSON.parse(before).starts));

    // ---------- reductions ----------
    const v2 = (await testRow()).version;
    const cur = t2.durationMin;
    const red = await call("GET", `/tests/${test.id}/duration-impact?durationMin=40`, T.adminA);
    check("the preview of a reduction says how many deadlines move earlier and who would be closed", red.status === 200 && red.json.plan.movedEarlier === 123 && red.json.plan.wouldExpireNow >= 1 && red.json.confirmationsNeeded.reduction === true && red.json.confirmationsNeeded.expiry === true, JSON.stringify(red.json && red.json.plan));
    const r409 = await call("PATCH", `/tests/${test.id}/duration`, T.adminA, body({ durationMin: 40, expectedVersion: v2 }));
    check("a reduction without confirmation is refused and changes nothing", r409.status === 409 && r409.json.needsConfirmation === "REDUCTION" && (await testRow()).durationMin === cur);
    const r409b = await call("PATCH", `/tests/${test.id}/duration`, T.adminA, body({ durationMin: 40, expectedVersion: v2, confirmReduction: true }));
    check("confirming only the reduction is not enough when some running attempts would be past the new deadline", r409b.status === 409 && r409b.json.needsConfirmation === "EXPIRY" && (await testRow()).durationMin === cur);
    const rOk = await call("PATCH", `/tests/${test.id}/duration`, T.adminA, body({ durationMin: 40, expectedVersion: v2, confirmReduction: true, confirmExpiry: true }));
    check("with both confirmations the reduction is applied and reported", rOk.status === 200 && rOk.json.newDurationMin === 40 && rOk.json.movedEarlier === 123 && (await testRow()).durationMin === 40);
    check("answers and completed attempts are still untouched after the reduction", JSON.stringify(await snapshot()) === before);
    check("the student past the new deadline is refused by the server (their data is kept)", [403].includes((await answer(T.s3, a3)).status) && (await prisma.testAttempt.findUnique({ where: { id: a3.id } })).status === "IN_PROGRESS");

    // ---------- the generic edit may not change the duration of a running test ----------
    const gen = await call("PATCH", `/tests/${test.id}`, T.owner, { durationMin: 120 });
    check("the generic edit form cannot change the duration while attempts are running (409, points to the live tool)", gen.status === 409 && gen.json.liveDurationRequired === true && (await testRow()).durationMin === 40, JSON.stringify(gen.json));

    // ---------- a scheduled test with nobody running ----------
    const sch = await call("GET", `/tests/${scheduled.id}/duration-impact?durationMin=45`, T.owner);
    check("a scheduled test shows state 'scheduled' and no affected attempts", sch.status === 200 && sch.json.test.window === "scheduled" && sch.json.attempts.active === 0);
    const schApply = await call("PATCH", `/tests/${scheduled.id}/duration`, T.owner, { durationMin: 45, expectedVersion: sch.json.test.version, requestId: rid() });
    check("it can be changed ahead of time with no confirmation needed", schApply.status === 200 && schApply.json.eligibleAttempts === 0 && (await prisma.test.findUnique({ where: { id: scheduled.id } })).durationMin === 45);

    // ---------- the change and its record are one unit: a failure part-way rolls everything back ----------
    const vBefore = (await testRow()).version; const auditsBefore = await auditCount();
    let threw = false;
    try { await repo.applyChange({ testId: test.id, expectedVersion: vBefore, newMin: 99, entry: { action: "TEST_DURATION_CHANGED", actorId: U.adminA.id, actorName: "x", actorRole: "INSTITUTE_ADMIN", instituteId: A.id }, makeDetails: () => { throw new Error("simulated failure after the write"); } }); } catch { threw = true; }
    const t3 = await testRow();
    check("a failure after the write rolls the duration and the version back and leaves no audit record", threw && t3.durationMin === 40 && t3.version === vBefore && (await auditCount()) === auditsBefore);
    check("history: the original duration is still the one the test was scheduled with (30)", (await call("GET", `/tests/${test.id}/duration-impact`, T.adminA)).json.originalDurationMin === 30);
  } finally {
    await cleanup();
  }
  console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.log("SCRIPT CRASHED", e.stack || e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
