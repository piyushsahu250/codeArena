// Regression test for the "Allow Reattempt" bug reported directly, 2026-09-29: an admin granting
// a reattempt only ever deleted the student's old TestAttempt -- it never accounted for the test's
// own startTime/endTime window, so once a test's scheduled window had closed (the single most
// common reason to grant a reattempt in the first place -- a student missed or failed a test that
// already ran), POST /:id/start still rejected the student with "Test window has closed" every
// time, making the feature silently non-functional for its main real-world use case. Fixed with
// TestReattemptGrant: a one-time, single-use pass created alongside the delete and consumed
// (deleted) the moment it actually lets a new attempt through. Same live-HTTP-server infra as
// learningCourses.integration.test.js (see its header comment for why), disposable data cleaned up
// in a finally block.
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
      {
        hostname: HOST, port: PORT, path, method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (d) => (chunks += d));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(chunks || "{}") }); }
          catch { resolve({ status: res.statusCode, body: chunks }); }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

let serverReachable = false;
let superAdmin, superAdminToken;
let student, studentToken;

test.before(async () => {
  try {
    const res = await httpRequest("GET", "/api/health", null);
    serverReachable = res.status === 200;
  } catch {
    serverReachable = false;
  }
  if (!serverReachable || !process.env.JWT_SECRET) return;

  superAdmin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  student = await prisma.user.findFirst({ where: { role: "STUDENT" } });
  if (!superAdmin || !student) { serverReachable = false; return; }
  superAdminToken = tokenFor(superAdmin);
  studentToken = tokenFor(student);
});

test.after(async () => {
  await prisma.$disconnect();
});

test("Allow Reattempt lets a student restart a test whose scheduled window has already closed, exactly once", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let testId, questionId;
  try {
    const test_ = await prisma.test.create({
      data: {
        title: `Regression Reattempt-Window Test ${Date.now()}`,
        // The window is already closed -- the exact real-world scenario an admin grants a
        // reattempt in.
        startTime: new Date(Date.now() - 7200000), endTime: new Date(Date.now() - 3600000),
        createdById: superAdmin.id, isPublished: true,
      },
    });
    testId = test_.id;

    const question = await prisma.question.create({
      data: { description: "1+1=?", questionType: "MCQ", options: ["1", "2"], correctAnswer: [1], instituteId: null },
    });
    questionId = question.id;

    await prisma.testAttempt.create({
      data: { testId, studentId: student.id, status: "SUBMITTED", submittedAt: new Date(), totalScore: 10 },
    });

    const beforeGrant = await httpRequest("POST", `/api/tests/${testId}/start`, studentToken);
    assert.equal(beforeGrant.status, 403, "a student with an already-completed attempt must be rejected before any reattempt is granted");

    const grant = await httpRequest("POST", `/api/tests/${testId}/attempts/${student.id}/reattempt`, superAdminToken);
    assert.equal(grant.status, 200, `failed to grant reattempt: ${JSON.stringify(grant.body)}`);

    const grantRow = await prisma.testReattemptGrant.findUnique({ where: { testId_studentId: { testId, studentId: student.id } } });
    assert.ok(grantRow, "granting a reattempt must create a TestReattemptGrant row");

    const afterGrant = await httpRequest("POST", `/api/tests/${testId}/start`, studentToken);
    assert.equal(afterGrant.status, 200, `a granted reattempt must let the student start again even though the test's own window has closed: ${JSON.stringify(afterGrant.body)}`);
    assert.ok(afterGrant.body.id, "a genuinely new TestAttempt must be created");

    const grantConsumed = await prisma.testReattemptGrant.findUnique({ where: { testId_studentId: { testId, studentId: student.id } } });
    assert.equal(grantConsumed, null, "the grant must be consumed (deleted) the moment it's used, not left as standing permission");

    // Simulate the student abandoning this second attempt too (delete it) and trying a THIRD time
    // -- with the one-time grant already spent, this must be rejected by the ordinary window check
    // again, proving this is a single-use pass, not a permanent bypass.
    await prisma.testAttempt.deleteMany({ where: { testId, studentId: student.id } });
    const thirdAttempt = await httpRequest("POST", `/api/tests/${testId}/start`, studentToken);
    assert.equal(thirdAttempt.status, 403);
    assert.match(thirdAttempt.body.error, /window has closed/i);
  } finally {
    if (questionId) {
      await prisma.submission.deleteMany({ where: { questionId } }).catch(() => {});
    }
    if (testId) {
      await prisma.testReattemptGrant.deleteMany({ where: { testId } }).catch(() => {});
      await prisma.testAttempt.deleteMany({ where: { testId } }).catch(() => {});
      await prisma.test.delete({ where: { id: testId } }).catch(() => {});
    }
    if (questionId) await prisma.question.delete({ where: { id: questionId } }).catch(() => {});
  }
});
