// Real HTTP tests for Mock Interview phase 1: strike counting under concurrency, event validation and de-duplication, and text-answer autosave.
// Same approach as aiInterviewRoutes.integration.test.js: they talk to the running server on localhost:4000 and use real database rows; when the server (or a
// student/question fixture) is not available every test is skipped, so `npm test` still passes on a machine with no server. Each test creates its own session
// and deletes it in a finally block (violations, answers and the report cascade with it).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");

const HOST = "localhost";
const PORT = 4000;

function httpRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { hostname: HOST, port: PORT, path, method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } },
      (res) => {
        let chunks = "";
        res.on("data", (d) => (chunks += d));
        res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(chunks || "{}") }); } catch { resolve({ status: res.statusCode, body: chunks }); } });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

let ready = false;
let student, other, token, otherToken, hrQuestion;
const createdUserIds = [];
let createdQuestionId = null;
const tokenFor = (u) => jwt.sign({ id: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "10m" });

// With REQUIRE_INTEGRATION=1 (set by the CI integration job, which starts the API and seeds the database first) a missing prerequisite FAILS the file instead of
// skipping every test, so a green run there always means the tests really ran.
function notReady(reason) {
  ready = false;
  if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(`interviewPhase1 integration prerequisites missing: ${reason}`);
}

test.before(async () => {
  let reachable = false;
  try { reachable = (await httpRequest("GET", "/api/health", null)).status === 200; } catch { reachable = false; }
  if (!reachable) return notReady("the API is not answering on localhost:4000");
  if (!process.env.JWT_SECRET) return notReady("JWT_SECRET is not set");
  // A database with no students or no HR question (a freshly seeded CI database has neither) gets disposable ones, removed again in the after hook.
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const students = await prisma.user.findMany({ where: { role: "STUDENT" }, take: 2 });
  try {
    while (students.length < 2) {
      const u = await prisma.user.create({ data: { name: `Phase1 Test Student ${students.length + 1}`, email: `phase1-${suffix}-${students.length}@example.test`, passwordHash: "not-a-real-hash", role: "STUDENT" } });
      createdUserIds.push(u.id);
      students.push(u);
    }
    hrQuestion = await prisma.interviewQuestion.findFirst({ where: { category: "HR", isActive: true } });
    if (!hrQuestion) {
      hrQuestion = await prisma.interviewQuestion.create({ data: { category: "HR", prompt: "Phase 1 integration fixture: tell me about a time you worked in a team.", isActive: true } });
      createdQuestionId = hrQuestion.id;
    }
  } catch (err) {
    return notReady(`could not create fixtures: ${String(err.message).slice(0, 300)}`);
  }
  [student, other] = students;
  token = tokenFor(student);
  otherToken = tokenFor(other);
  ready = true;
});

test.after(async () => {
  // Sessions are deleted by each test; the fixtures this file created go last (a question cannot be deleted while an answer still points at it).
  if (createdQuestionId) await prisma.interviewQuestion.delete({ where: { id: createdQuestionId } }).catch(() => {});
  if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
  await prisma.$disconnect(); // otherwise the open database connection keeps the test process alive
});

// A throwaway PROCTORED session in progress for `student`, holding one placeholder answer row for the HR question (as the real session start does).
// isMock is false on purpose: finalizing a mock session e-mails the student, which a test must never do.
async function makeSession(extra = {}) {
  const s = await prisma.interviewSession.create({ data: { studentId: student.id, isMock: false, status: "IN_PROGRESS", securityLevel: "PROCTORED", config: { durationMin: 30 }, ...extra } });
  await prisma.interviewAnswer.create({ data: { sessionId: s.id, questionId: hrQuestion.id, skipped: true } });
  return s;
}
async function cleanup(session) {
  await prisma.codeDraft.deleteMany({ where: { studentId: student.id, contextId: { startsWith: `${session.id}:` } } });
  await prisma.interviewSession.delete({ where: { id: session.id } }).catch(() => {});
}

test("three different strike events sent at the same moment are all counted, and the third ends the session", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  const s = await makeSession();
  try {
    const types = ["TAB_SWITCH", "FULLSCREEN_EXIT", "CAMERA_DROPPED"];
    const results = await Promise.all(types.map((type) => httpRequest("POST", `/api/interview/sessions/${s.id}/violation`, token, { type })));
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
    const final = await prisma.interviewSession.findUnique({ where: { id: s.id }, include: { report: true } });
    const rows = await prisma.interviewViolation.count({ where: { sessionId: s.id } });
    assert.equal(final.violationCount, 3, "no strike may be lost when events race");
    assert.equal(rows, 3);
    assert.equal(final.status, "TERMINATED");
    assert.equal(final.terminationReason, "MAX_VIOLATIONS");
    assert.ok(final.report, "a terminated session still gets its report");
    assert.equal(results.filter((r) => r.body.terminated === true).length, 1, "exactly one request reports the termination");
  } finally { await cleanup(s); }
});

test("the same event sent twice at once is stored and counted once", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  const s = await makeSession();
  try {
    const results = await Promise.all([1, 2, 3].map(() => httpRequest("POST", `/api/interview/sessions/${s.id}/violation`, token, { type: "TAB_SWITCH" })));
    assert.ok(results.every((r) => r.status === 200));
    const final = await prisma.interviewSession.findUnique({ where: { id: s.id } });
    assert.equal(await prisma.interviewViolation.count({ where: { sessionId: s.id } }), 1);
    assert.equal(final.violationCount, 1);
    assert.equal(results.filter((r) => r.body.deduplicated === true).length, 2);
    assert.equal(final.status, "IN_PROGRESS");
  } finally { await cleanup(s); }
});

test("an unknown event type is refused and nothing is stored", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  const s = await makeSession();
  try {
    const r = await httpRequest("POST", `/api/interview/sessions/${s.id}/violation`, token, { type: "MADE_UP_TYPE" });
    assert.equal(r.status, 400);
    const missing = await httpRequest("POST", `/api/interview/sessions/${s.id}/violation`, token, {});
    assert.equal(missing.status, 400);
    assert.equal(await prisma.interviewViolation.count({ where: { sessionId: s.id } }), 0);
  } finally { await cleanup(s); }
});

test("another student cannot report events against someone else's session", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  const s = await makeSession();
  try {
    const r = await httpRequest("POST", `/api/interview/sessions/${s.id}/violation`, otherToken, { type: "TAB_SWITCH" });
    assert.equal(r.status, 403);
    assert.equal(await prisma.interviewViolation.count({ where: { sessionId: s.id } }), 0);
  } finally { await cleanup(s); }
});

test("events on a session that is already closed change nothing", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  const s = await makeSession({ status: "COMPLETED", submittedAt: new Date() });
  try {
    const r = await httpRequest("POST", `/api/interview/sessions/${s.id}/violation`, token, { type: "TAB_SWITCH" });
    assert.equal(r.status, 200);
    assert.equal(r.body.terminated, false);
    assert.equal(await prisma.interviewViolation.count({ where: { sessionId: s.id } }), 0);
  } finally { await cleanup(s); }
});

test("a text draft is saved, confirmed by the server, and restored by the bulk read", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  const s = await makeSession();
  try {
    const save = await httpRequest("POST", `/api/interview/sessions/${s.id}/questions/${hrQuestion.id}/text-draft`, token, { answerText: "My first draft" });
    assert.equal(save.status, 200);
    assert.equal(save.body.ok, true);
    assert.ok(save.body.savedAt);
    const again = await httpRequest("POST", `/api/interview/sessions/${s.id}/questions/${hrQuestion.id}/text-draft`, token, { answerText: "My second, longer draft" });
    assert.equal(again.status, 200);
    const read = await httpRequest("GET", `/api/interview/sessions/${s.id}/text-drafts`, token);
    assert.equal(read.status, 200);
    assert.equal(read.body.drafts[hrQuestion.id], "My second, longer draft", "the latest text wins");
  } finally { await cleanup(s); }
});

test("a draft older than the answer saved with Next is not restored over it", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  const s = await makeSession();
  try {
    await httpRequest("POST", `/api/interview/sessions/${s.id}/questions/${hrQuestion.id}/text-draft`, token, { answerText: "stale draft" });
    await new Promise((r) => setTimeout(r, 50));
    await prisma.interviewAnswer.update({ where: { sessionId_questionId: { sessionId: s.id, questionId: hrQuestion.id } }, data: { answerText: "the saved answer", skipped: false } });
    const read = await httpRequest("GET", `/api/interview/sessions/${s.id}/text-drafts`, token);
    assert.equal(read.body.drafts[hrQuestion.id], undefined);
  } finally { await cleanup(s); }
});

test("text drafts are refused for an unassigned question, a bad body, an over-long body and a closed session", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  const s = await makeSession();
  try {
    const path = (qid) => `/api/interview/sessions/${s.id}/questions/${qid}/text-draft`;
    assert.equal((await httpRequest("POST", path("00000000-0000-0000-0000-000000000000"), token, { answerText: "x" })).status, 404, "a question this session was not given");
    assert.equal((await httpRequest("POST", path(hrQuestion.id), token, { answerText: 12 })).status, 400);
    assert.equal((await httpRequest("POST", path(hrQuestion.id), token, {})).status, 400);
    assert.equal((await httpRequest("POST", path(hrQuestion.id), token, { answerText: "a".repeat(20001) })).status, 413);
    assert.equal((await httpRequest("POST", path(hrQuestion.id), otherToken, { answerText: "x" })).status, 403, "someone else's session");
    await prisma.interviewSession.update({ where: { id: s.id }, data: { status: "COMPLETED", submittedAt: new Date() } });
    assert.equal((await httpRequest("POST", path(hrQuestion.id), token, { answerText: "late" })).status, 409, "closed session");
    const read = await httpRequest("GET", `/api/interview/sessions/${s.id}/text-drafts`, token);
    assert.deepEqual(read.body.drafts, {});
  } finally { await cleanup(s); }
});

test("a text draft is refused after the deadline even if the session is still open", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  const s = await makeSession({ startedAt: new Date(Date.now() - 31 * 60 * 1000) }); // durationMin 30
  try {
    const r = await httpRequest("POST", `/api/interview/sessions/${s.id}/questions/${hrQuestion.id}/text-draft`, token, { answerText: "too late" });
    assert.equal(r.status, 409);
  } finally { await cleanup(s); }
});

test("two finalize requests at once produce one report and both succeed", async (t) => {
  if (!ready) return t.skip("server or fixtures not available");
  // STANDARD level: this test is about the double finalize, not about the one-active-session claim a PROCTORED session needs first.
  const s = await makeSession({ securityLevel: "STANDARD" });
  try {
    const results = await Promise.all([0, 1].map(() => httpRequest("POST", `/api/interview/sessions/${s.id}/finalize`, token, {})));
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
    assert.equal(await prisma.interviewReport.count({ where: { sessionId: s.id } }), 1);
    const final = await prisma.interviewSession.findUnique({ where: { id: s.id } });
    assert.equal(final.status, "COMPLETED");
  } finally { await cleanup(s); }
});
