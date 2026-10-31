// Real HTTP integration tests for Test Management (folders, per-person marks, archiving, Test Series and their assignments, the student's view and the sequential lock). They talk to the
// running API on localhost:4000 and use rows they create themselves (two institutes, staff, an administrator, academic groups, students, small tests), removed afterwards. With
// REQUIRE_INTEGRATION=1 (set by the CI integration job) a missing prerequisite FAILS the file instead of skipping it, so a green run there always means the tests ran.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");

const PORT = 4000;
const tag = `tmgmt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let lastCall = "";
const strictEqual = assert.equal;
assert.equal = (actual, expected, message) => strictEqual(actual, expected, message || `last call: ${lastCall}`);

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ hostname: "localhost", port: PORT, path, method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let chunks = "";
      res.on("data", (d) => (chunks += d));
      res.on("end", () => { lastCall = `${method} ${path.replace(/[0-9a-f-]{36}/g, "<id>")} -> ${res.statusCode} ${chunks.slice(0, 300)}`; try { resolve({ status: res.statusCode, body: JSON.parse(chunks || "{}"), raw: chunks }); } catch { resolve({ status: res.statusCode, body: {}, raw: chunks }); } });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const tokenFor = (u) => jwt.sign({ id: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "30m" });
const F = { created: { users: [], institutes: [], tests: [], series: [] } };
let ready = false;
function notReady(reason) { ready = false; if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(`testManagement integration prerequisites missing: ${reason}`); }

async function mkUser(role, instituteId, label, extra = {}) {
  const u = await prisma.user.create({ data: { name: `${label} ${tag}`, email: `${tag}-${label}@example.test`, passwordHash: "not-a-real-hash", role, instituteId, registrationNumber: role === "STUDENT" ? `PRN-${tag}-${label}`.slice(0, 40) : null, ...extra } });
  F.created.users.push(u.id);
  return u;
}
const HOUR = 3600e3;
async function mkTest(owner, title, over = {}) {
  const t = await prisma.test.create({ data: { title: `${title} ${tag}`, startTime: new Date(Date.now() - HOUR), endTime: new Date(Date.now() + 5 * HOUR), createdById: owner.id, instituteId: F.instA, isPublished: true, ...over } });
  const q = await prisma.question.create({ data: { description: `${tag} 1+1?`, questionType: "MCQ", options: ["1", "2"], correctAnswer: [1], points: 10, instituteId: null } });
  await prisma.testQuestion.create({ data: { testId: t.id, questionId: q.id } });
  F.created.tests.push(t.id);
  return t;
}

test.before(async () => {
  let reachable = false;
  try { reachable = (await request("GET", "/api/health", null)).status === 200; } catch { reachable = false; }
  if (!reachable) return notReady("the API is not answering on localhost:4000");
  if (!process.env.JWT_SECRET) return notReady("JWT_SECRET is not set");
  try {
    const A = await prisma.institute.create({ data: { name: `${tag}-A` } });
    const B = await prisma.institute.create({ data: { name: `${tag}-B` } });
    F.created.institutes.push(A.id, B.id);
    F.instA = A.id; F.instB = B.id;
    const cse = await prisma.department.create({ data: { name: `CSE ${tag}`, instituteId: A.id } });
    const aiml = await prisma.department.create({ data: { name: `AIML ${tag}`, instituteId: A.id } });
    F.g1 = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2025-2028", departmentId: cse.id, section: "Section A" } });
    F.g2 = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2025-2028", departmentId: aiml.id, section: "Section A" } });
    F.admin = await mkUser("ADMIN", A.id, "admin");
    F.adminB = await mkUser("ADMIN", B.id, "adminB");
    F.staff1 = await mkUser("STAFF", A.id, "staff1");
    F.staff2 = await mkUser("STAFF", A.id, "staff2");
    F.s1 = await mkUser("STUDENT", A.id, "s1", { academicGroupId: F.g1.id });
    F.s2 = await mkUser("STUDENT", A.id, "s2", { academicGroupId: F.g2.id });
    F.tok = Object.fromEntries(["admin", "adminB", "staff1", "staff2", "s1", "s2"].map((k) => [k, tokenFor(F[k])]));
    ready = true;
  } catch (err) { return notReady(`could not create fixtures: ${String(err.message).slice(0, 300)}`); }
});

test.after(async () => {
  if (!ready && !F.created.users.length) { await prisma.$disconnect(); return; }
  const ids = F.created.users;
  await prisma.testSeries.deleteMany({ where: { createdById: { in: ids } } }).catch(() => {});
  await prisma.testAttempt.deleteMany({ where: { testId: { in: F.created.tests } } }).catch(() => {});
  await prisma.test.deleteMany({ where: { id: { in: F.created.tests } } }).catch(() => {});
  await prisma.testFolder.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => {});
  await prisma.question.deleteMany({ where: { description: { startsWith: tag } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: F.created.institutes } } }).catch(() => {});
  await prisma.department.deleteMany({ where: { instituteId: { in: F.created.institutes } } }).catch(() => {});
  await prisma.institute.deleteMany({ where: { id: { in: F.created.institutes } } }).catch(() => {});
  await prisma.$disconnect();
});

const list = (tok, qs = "") => request("GET", `/api/test-management/tests?${qs}`, tok);
const ids = (res) => res.body.rows.map((r) => r.id);

test("folders are private to their owner; moving a test never changes its assignment or its results; deleting a folder keeps the tests", async (t) => {
  if (!ready) return t.skip("not ready");
  const t1 = await mkTest(F.staff1, "Internal 1");
  const t2 = await mkTest(F.staff1, "Internal 2");
  await prisma.testAcademicGroup.create({ data: { testId: t1.id, academicGroupId: F.g1.id } });
  await prisma.testAttempt.create({ data: { testId: t1.id, studentId: F.s1.id, status: "SUBMITTED", submittedAt: new Date(), totalScore: 7 } });
  const f = await request("POST", "/api/test-management/folders", F.tok.staff1, { name: "CSE Internal Assessments", department: "CSE" });
  assert.equal(f.status, 201);
  assert.equal((await request("POST", "/api/test-management/folders", F.tok.staff1, { name: "CSE Internal Assessments" })).status, 409, "a duplicate name is refused");
  const mv = await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "move", testIds: [t1.id, t2.id], folderId: f.body.id });
  assert.equal(mv.body.succeeded, 2);
  assert.deepEqual(ids(await list(F.tok.staff1, `folderId=${f.body.id}`)).sort(), [t1.id, t2.id].sort());
  const groups = await prisma.testAcademicGroup.count({ where: { testId: t1.id } });
  const attempt = await prisma.testAttempt.findFirst({ where: { testId: t1.id, studentId: F.s1.id } });
  assert.equal(groups, 1, "the assignment is unchanged by moving");
  assert.equal(attempt.totalScore, 7, "the stored result is unchanged by moving");
  // another staff member cannot see, use, rename or delete that folder
  assert.equal((await list(F.tok.staff2, `folderId=${f.body.id}`)).status, 404);
  assert.equal((await request("PATCH", `/api/test-management/folders/${f.body.id}`, F.tok.staff2, { name: "mine now" })).status, 404);
  assert.equal((await request("DELETE", `/api/test-management/folders/${f.body.id}`, F.tok.staff2)).status, 404);
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.staff2, { action: "move", testIds: [t1.id], folderId: f.body.id })).status, 404, "cannot file into someone else's folder");
  // the folder list shows the count; deleting it keeps the tests
  const folders = await request("GET", "/api/test-management/folders", F.tok.staff1);
  assert.equal(folders.body.folders.find((x) => x.id === f.body.id).tests, 2);
  const del = await request("DELETE", `/api/test-management/folders/${f.body.id}`, F.tok.staff1);
  assert.equal(del.body.testsReleased, 2);
  assert.ok(await prisma.test.findUnique({ where: { id: t1.id } }) && await prisma.test.findUnique({ where: { id: t2.id } }), "the tests still exist");
  assert.ok(ids(await list(F.tok.staff1)).includes(t1.id), "and are still in All Tests");
});

test("star and hide are the person's own: they do not appear for anyone else and hiding changes nothing for students", async (t) => {
  if (!ready) return t.skip("not ready");
  const tt = await mkTest(F.staff1, "Shared view");
  await prisma.testShare.create({ data: { testId: tt.id, staffId: F.staff2.id, sharedByUserId: F.staff1.id, sharedByName: "staff1" } }).catch(() => {});
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "star", testIds: [tt.id] })).body.succeeded, 1);
  assert.ok(ids(await list(F.tok.staff1, "view=starred")).includes(tt.id));
  assert.ok(!ids(await list(F.tok.staff2, "view=starred")).includes(tt.id), "starred only for the person who starred it");
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "hide", testIds: [tt.id] })).body.succeeded, 1);
  assert.ok(!ids(await list(F.tok.staff1)).includes(tt.id), "hidden from my default view");
  assert.ok(ids(await list(F.tok.staff1, "view=hidden")).includes(tt.id));
  assert.ok(ids(await list(F.tok.staff2)).includes(tt.id), "still in the other person's view");
  const stu = await request("GET", "/api/tests", F.tok.s1);
  assert.ok(stu.body.some((x) => x.id === tt.id), "hiding does not touch what a student sees");
  await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "unhide", testIds: [tt.id] });
  assert.ok(ids(await list(F.tok.staff1)).includes(tt.id));
});

test("published and active are different: a published test can be switched off, students then cannot start it, and nothing is deleted", async (t) => {
  if (!ready) return t.skip("not ready");
  const tt = await mkTest(F.staff1, "Switch off");
  const noConfirm = await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "deactivate", testIds: [tt.id] });
  assert.equal(noConfirm.status, 409, "switching off needs a confirmation");
  assert.equal(noConfirm.body.needsConfirmation, true);
  const off = await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "deactivate", testIds: [tt.id], confirm: true });
  assert.equal(off.body.succeeded, 1);
  const row = (await list(F.tok.staff1, "view=inactive")).body.rows.find((r) => r.id === tt.id);
  assert.ok(row, "listed under Inactive");
  assert.equal(row.lifecycle.published, true);
  assert.equal(row.lifecycle.active, false);
  assert.ok(!(await request("GET", "/api/tests", F.tok.s1)).body.some((x) => x.id === tt.id), "not offered to students");
  const start = await request("POST", `/api/tests/${tt.id}/start`, F.tok.s1);
  assert.equal(start.status, 403, "a student cannot begin a new attempt");
  await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "activate", testIds: [tt.id] });
  assert.equal((await request("POST", `/api/tests/${tt.id}/start`, F.tok.s1)).status, 200, "switched back on, a student can start");
});

test("archiving keeps every result readable, takes the test off student lists, and can be undone; staff cannot change another person's test", async (t) => {
  if (!ready) return t.skip("not ready");
  const tt = await mkTest(F.staff1, "Old assessment", { endTime: new Date(Date.now() - 2 * HOUR), startTime: new Date(Date.now() - 6 * HOUR) });
  await prisma.testAttempt.create({ data: { testId: tt.id, studentId: F.s1.id, status: "SUBMITTED", submittedAt: new Date(), totalScore: 9 } });
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "archive", testIds: [tt.id], confirm: true })).body.succeeded, 1);
  assert.ok(ids(await list(F.tok.staff1, "view=archived")).includes(tt.id));
  assert.ok(!ids(await list(F.tok.staff1)).includes(tt.id), "not in the default view");
  assert.ok(!(await request("GET", "/api/tests", F.tok.s1)).body.some((x) => x.id === tt.id), "not in the student's list");
  const byGroup = await request("GET", `/api/test-management/tests/${tt.id}/results-by-group`, F.tok.staff1);
  assert.equal(byGroup.status, 200, "historical results are still reachable");
  assert.equal(byGroup.body.groups.reduce((a, g) => a + g.attempted, 0), 1);
  assert.equal((await prisma.testAttempt.findFirst({ where: { testId: tt.id } })).totalScore, 9, "the stored mark is unchanged");
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "restore", testIds: [tt.id] })).body.succeeded, 1);
  assert.ok(ids(await list(F.tok.staff1)).includes(tt.id));
  // another staff member cannot even see it, and the answer is the same as for a test that does not exist
  const other = await request("POST", "/api/test-management/tests/bulk", F.tok.staff2, { action: "archive", testIds: [tt.id], confirm: true });
  assert.equal(other.body.succeeded, 0);
  assert.equal(other.body.results[0].message, "Test not found.");
  // a shared test: the other person may mark it for themselves but not change the test
  await prisma.testShare.create({ data: { testId: tt.id, staffId: F.staff2.id, sharedByUserId: F.staff1.id, sharedByName: "staff1" } }).catch(() => {});
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.staff2, { action: "star", testIds: [tt.id] })).body.succeeded, 1);
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.adminB, { action: "star", testIds: [tt.id] })).body.succeeded, 0, "another institute sees nothing");
});

test("a bulk action reports each test; one failure does not hide the others", async (t) => {
  if (!ready) return t.skip("not ready");
  const a = await mkTest(F.staff1, "Bulk a");
  const b = await mkTest(F.staff1, "Bulk b", { isActive: false });
  const r = await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "deactivate", testIds: [a.id, b.id, "00000000-0000-0000-0000-000000000000"], confirm: true });
  assert.equal(r.body.requested, 3);
  assert.equal(r.body.succeeded, 1);
  assert.equal(r.body.failed, 2);
  assert.deepEqual(r.body.results.map((x) => x.message || "ok"), ["ok", "Already inactive.", "Test not found."]);
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "star", testIds: [] })).status, 400);
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.staff1, { action: "explode", testIds: [a.id] })).status, 400);
  assert.equal((await request("POST", "/api/test-management/tests/bulk", F.tok.s1, { action: "star", testIds: [a.id] })).status, 403, "students cannot use Test Management");
});

async function makeSeries(owner, tests, over = {}) {
  const res = await request("POST", "/api/test-management/series", owner, { title: `Java series ${tag}`, description: "Placement preparation", testIds: tests.map((x) => x.id), ...over });
  assert.equal(res.status, 201, res.raw);
  F.created.series.push(res.body.id);
  return res.body;
}
const window = (o = {}) => ({ startAt: new Date(Date.now() - HOUR).toISOString(), noExpiry: true, ...o });

test("a series is built from existing tests, can be reordered, and removing a test from it deletes nothing", async (t) => {
  if (!ready) return t.skip("not ready");
  const tests = [await mkTest(F.staff1, "S-A"), await mkTest(F.staff1, "S-B"), await mkTest(F.staff1, "S-C")];
  const s = await makeSeries(F.tok.staff1, tests);
  assert.deepEqual(s.items.map((i) => i.testId), tests.map((x) => x.id));
  const reordered = await request("PUT", `/api/test-management/series/${s.id}`, F.tok.staff1, { version: s.version, testIds: [tests[2].id, tests[0].id, tests[1].id] });
  assert.deepEqual(reordered.body.items.map((i) => i.testId), [tests[2].id, tests[0].id, tests[1].id]);
  assert.equal((await request("PUT", `/api/test-management/series/${s.id}`, F.tok.staff1, { version: s.version, title: "stale" })).status, 409, "a stale save loses");
  const fewer = await request("PUT", `/api/test-management/series/${s.id}`, F.tok.staff1, { version: reordered.body.version, testIds: [tests[0].id] });
  assert.equal(fewer.body.items.length, 1);
  assert.ok(await prisma.test.findUnique({ where: { id: tests[1].id } }), "the removed test still exists");
  // a test the person cannot use, a duplicate, and publishing an empty series are all refused
  const foreign = await mkTest(F.staff2, "Not mine");
  assert.equal((await request("PUT", `/api/test-management/series/${s.id}`, F.tok.staff1, { testIds: [foreign.id] })).status, 400);
  assert.equal((await request("PUT", `/api/test-management/series/${s.id}`, F.tok.staff1, { testIds: [tests[0].id, tests[0].id] })).status, 400);
  const empty = await makeSeries(F.tok.staff1, [], { title: `Empty ${tag}` });
  assert.equal((await request("POST", `/api/test-management/series/${empty.id}/action/publish`, F.tok.staff1)).status, 400);
  // another staff member's series is invisible to them; the administrator of the institute sees it
  assert.equal((await request("GET", `/api/test-management/series/${s.id}`, F.tok.staff2)).status, 404);
  assert.equal((await request("GET", `/api/test-management/series/${s.id}`, F.tok.admin)).status, 200);
  assert.equal((await request("GET", `/api/test-management/series/${s.id}`, F.tok.adminB)).status, 404, "another institute");
});

test("assigning: a confirmation is required, No Expiry stores no end date, a duplicate is reported, other groups and other staff are kept out", async (t) => {
  if (!ready) return t.skip("not ready");
  const tests = [await mkTest(F.staff1, "A-1"), await mkTest(F.staff1, "A-2")];
  for (const x of tests) await prisma.testAcademicGroup.create({ data: { testId: x.id, academicGroupId: F.g1.id } });
  const s = await makeSeries(F.tok.staff1, tests);
  assert.equal((await request("POST", `/api/test-management/series/${s.id}/action/publish`, F.tok.staff1)).body.lifecycle.published, true);
  const preview = await request("POST", `/api/test-management/series/${s.id}/assignments/preview`, F.tok.staff1, { academicGroupIds: [F.g1.id, F.g2.id] });
  assert.equal(preview.status, 200, preview.raw);
  assert.deepEqual(preview.body.targets.find((x) => x.id === F.g1.id).missing, [], "g1 already has both tests");
  assert.equal(preview.body.targets.find((x) => x.id === F.g2.id).missing.length, 2, "g2 would not be able to open them");
  assert.equal((await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff1, { academicGroupIds: [F.g1.id], ...window() })).status, 409, "needs confirm");
  assert.equal((await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff1, { academicGroupIds: [F.g1.id], confirm: true, ...window({ endAt: new Date(Date.now() + HOUR).toISOString() }) })).status, 400, "an end date contradicts No Expiry");
  const made = await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff1, { academicGroupIds: [F.g1.id], confirm: true, ...window(), instructions: "Bring your ID" });
  assert.equal(made.status, 201, made.raw);
  const row = await prisma.testSeriesAssignment.findFirst({ where: { seriesId: s.id, academicGroupId: F.g1.id } });
  assert.equal(row.endAt, null, "no artificial expiry timestamp");
  assert.equal(row.noExpiry, true);
  const again = await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff1, { academicGroupIds: [F.g1.id], confirm: true, ...window() });
  assert.equal(again.body.created.length, 0);
  assert.equal(again.body.duplicates.length, 1, "the existing assignment is shown, not duplicated");
  assert.equal(await prisma.testSeriesAssignment.count({ where: { seriesId: s.id } }), 1);
  // authorisation
  assert.equal((await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff2, { academicGroupIds: [F.g1.id], confirm: true, ...window() })).status, 404, "not their series");
  const foreignGroup = await prisma.academicGroup.create({ data: { instituteId: F.instB, batch: "2025", departmentId: (await prisma.department.create({ data: { name: `X ${tag}`, instituteId: F.instB } })).id, section: "A" } });
  assert.equal((await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff1, { academicGroupIds: [foreignGroup.id], confirm: true, ...window() })).status, 403, "another institute's group");
  assert.equal((await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff1, { poolIds: ["00000000-0000-0000-0000-000000000000"], confirm: true, ...window() })).status, 403, "staff cannot assign to a Talent Pool");
});

test("students see only series assigned to them, with correct progress; unpublished, inactive and expired series are closed", async (t) => {
  if (!ready) return t.skip("not ready");
  const tests = [await mkTest(F.staff1, "P-1"), await mkTest(F.staff1, "P-2")];
  for (const x of tests) await prisma.testAcademicGroup.create({ data: { testId: x.id, academicGroupId: F.g1.id } });
  const s = await makeSeries(F.tok.staff1, tests);
  await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff1, { academicGroupIds: [F.g1.id], confirm: true, ...window() });
  const mine = () => request("GET", "/api/test-management/student/series", F.tok.s1);
  assert.ok(!(await mine()).body.series.some((x) => x.id === s.id), "a draft series is not visible");
  await request("POST", `/api/test-management/series/${s.id}/action/publish`, F.tok.staff1);
  const card = (await mine()).body.series.find((x) => x.id === s.id);
  assert.ok(card);
  assert.deepEqual([card.total, card.completed, card.pending, card.percent, card.availability.available, card.window.noExpiry], [2, 0, 2, 0, true, true]);
  assert.ok(!(await request("GET", "/api/test-management/student/series", F.tok.s2)).body.series.some((x) => x.id === s.id), "a student of another group does not see it");
  assert.equal((await request("GET", `/api/test-management/student/series/${s.id}`, F.tok.s2)).status, 404, "nor can they open it by id");
  await prisma.testAttempt.create({ data: { testId: tests[0].id, studentId: F.s1.id, status: "SUBMITTED", submittedAt: new Date(), totalScore: 10 } });
  const after = (await request("GET", `/api/test-management/student/series/${s.id}`, F.tok.s1)).body;
  assert.deepEqual([after.completed, after.pending, after.percent], [1, 1, 50], "progress follows the attempts");
  assert.deepEqual(after.items.map((i) => i.state), ["COMPLETED", "AVAILABLE"]);
  assert.ok(!JSON.stringify(after).includes(F.s2.id), "no one else's data");
  await request("POST", `/api/test-management/series/${s.id}/action/deactivate`, F.tok.staff1);
  assert.ok(!(await mine()).body.series.some((x) => x.id === s.id), "an inactive series is closed");
  await request("POST", `/api/test-management/series/${s.id}/action/activate`, F.tok.staff1);
  const a = await prisma.testSeriesAssignment.findFirst({ where: { seriesId: s.id } });
  await prisma.testSeriesAssignment.update({ where: { id: a.id }, data: { noExpiry: false, endAt: new Date(Date.now() - 60e3), startAt: new Date(Date.now() - 2 * HOUR) } });
  const expired = (await mine()).body.series.find((x) => x.id === s.id);
  assert.equal(expired.availability.reason, "EXPIRED");
  assert.equal(expired.action, null, "no Start or Continue once expired");
  assert.ok((await request("GET", `/api/test-management/student/series/${s.id}`, F.tok.s1)).body.items.every((i) => i.canOpen === false));
});

test("sequential mode locks the next test on the server until the previous one is done; flexible mode locks nothing", async (t) => {
  if (!ready) return t.skip("not ready");
  const tests = [await mkTest(F.staff1, "Q-1"), await mkTest(F.staff1, "Q-2")];
  for (const x of tests) await prisma.testAcademicGroup.create({ data: { testId: x.id, academicGroupId: F.g1.id } });
  const s = await makeSeries(F.tok.staff1, tests, { accessMode: "SEQUENTIAL", unlockRule: "ATTEMPTED" });
  await request("POST", `/api/test-management/series/${s.id}/action/publish`, F.tok.staff1);
  await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff1, { academicGroupIds: [F.g1.id], confirm: true, ...window() });
  const locked = await request("POST", `/api/tests/${tests[1].id}/start`, F.tok.s1);
  assert.equal(locked.status, 403, "the second test is refused even if the page is bypassed");
  assert.equal(locked.body.code, "SERIES_LOCKED");
  assert.equal((await request("POST", `/api/tests/${tests[0].id}/start`, F.tok.s1)).status, 200, "the first opens");
  await prisma.testAttempt.updateMany({ where: { testId: tests[0].id, studentId: F.s1.id }, data: { status: "SUBMITTED", submittedAt: new Date(), totalScore: 1 } });
  assert.equal((await request("POST", `/api/tests/${tests[1].id}/start`, F.tok.s1)).status, 200, "after the first is done the second opens");
  const flex = await request("PUT", `/api/test-management/series/${s.id}`, F.tok.staff1, { accessMode: "FLEXIBLE" });
  assert.equal(flex.body.accessMode, "FLEXIBLE");
});

test("the series report counts each group separately and exports only authorised data", async (t) => {
  if (!ready) return t.skip("not ready");
  const tests = [await mkTest(F.staff1, "R-1")];
  await prisma.testAcademicGroup.createMany({ data: [{ testId: tests[0].id, academicGroupId: F.g1.id }, { testId: tests[0].id, academicGroupId: F.g2.id }] });
  const s = await makeSeries(F.tok.staff1, tests);
  await request("POST", `/api/test-management/series/${s.id}/action/publish`, F.tok.staff1);
  await request("POST", `/api/test-management/series/${s.id}/assignments`, F.tok.staff1, { academicGroupIds: [F.g1.id, F.g2.id], confirm: true, ...window() });
  await prisma.testAttempt.create({ data: { testId: tests[0].id, studentId: F.s1.id, status: "SUBMITTED", submittedAt: new Date(), totalScore: 10 } });
  const rep = await request("GET", `/api/test-management/series/${s.id}/report`, F.tok.staff1);
  assert.equal(rep.status, 200, rep.raw);
  assert.deepEqual([rep.body.summary.students, rep.body.summary.completedAll, rep.body.summary.notStarted], [2, 1, 1]);
  assert.equal(rep.body.byGroup.length, 2, "one row per group, never merged");
  assert.deepEqual(rep.body.byGroup.map((g) => g.completedAll).sort(), [0, 1]);
  const only = await request("GET", `/api/test-management/series/${s.id}/report?academicGroupId=${F.g2.id}`, F.tok.staff1);
  assert.equal(only.body.rows.length, 1);
  assert.equal(only.body.rows[0].completed, 0);
  assert.equal((await request("GET", `/api/test-management/series/${s.id}/report`, F.tok.staff2)).status, 404);
  const csv = await request("GET", `/api/test-management/series/${s.id}/report.csv`, F.tok.staff1);
  assert.equal(csv.status, 200);
  assert.ok(csv.raw.includes(F.s1.name) && csv.raw.includes("Completion %"));
  assert.equal((await request("GET", `/api/test-management/series/${s.id}/report.csv`, F.tok.staff2)).status, 404);
  assert.equal((await request("GET", `/api/test-management/series/${s.id}/report`, F.tok.s1)).status, 403, "students cannot read reports");
});

test("existing workflows still work: an ordinary assigned test is listed and can be started with no series involved", async (t) => {
  if (!ready) return t.skip("not ready");
  const tt = await mkTest(F.staff1, "Plain");
  await prisma.testAcademicGroup.create({ data: { testId: tt.id, academicGroupId: F.g1.id } });
  assert.ok((await request("GET", "/api/tests", F.tok.s1)).body.some((x) => x.id === tt.id));
  assert.equal((await request("POST", `/api/tests/${tt.id}/start`, F.tok.s1)).status, 200);
  assert.ok(!(await request("GET", "/api/tests", F.tok.s2)).body.some((x) => x.id === tt.id), "another group does not see it");
  const ov = await request("GET", "/api/test-management/overview", F.tok.staff1);
  assert.equal(ov.status, 200);
  assert.ok(ov.body.tests.all >= 1 && "starred" in ov.body.tests && "series" in ov.body);
});
