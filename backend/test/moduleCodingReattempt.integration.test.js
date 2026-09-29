// Regression test for a bug found alongside tests.js's "Allow Reattempt" fix, 2026-09-29: the
// admin "reset attempts" route's CUSTOM mode (restore N remaining attempts) deleted only the
// chronologically OLDEST finalized attempts needed to reach the desired count -- but a separate,
// unconditional check in POST /module/:moduleId/start ("You have already passed this assessment")
// runs regardless of how many attempts are "remaining", so if the student's PASSED attempt wasn't
// among the oldest ones deleted, the reset silently failed to actually let them retry. Fixed by
// prioritizing any passed attempt into the deletion set. Same live-HTTP-server infra as
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

test("custom-mode attempt reset prioritizes a passed attempt into the deleted set, not just the oldest ones", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let courseId, moduleId, testId, questionId;
  try {
    const course = await prisma.course.create({ data: { slug: `mc-reattempt-regression-${Date.now()}`, name: "MC Reattempt Regression Course", status: "DRAFT" } });
    courseId = course.id;
    const mod = await prisma.courseModule.create({ data: { courseId, title: "M1", order: 0 } });
    moduleId = mod.id;
    const lesson = await prisma.lesson.create({ data: { moduleId, title: "L1", order: 0, content: "hello" } });
    await prisma.lessonProgress.create({ data: { studentId: student.id, lessonId: lesson.id, status: "COMPLETED" } });
    const codingTest = await prisma.moduleCodingTest.create({ data: { moduleId, title: `MC Reattempt Regression Test ${Date.now()}`, maxAttempts: 3, isActive: true } });
    testId = codingTest.id;
    const question = await prisma.question.create({ data: { description: "Reverse a string", questionType: "CODING", moduleCodingTestId: testId, instituteId: null } });
    questionId = question.id;

    // Oldest -> newest: FAIL, PASS, FAIL. The passed attempt is deliberately NOT the oldest, so a
    // naive "delete the N oldest" reset would leave it in place.
    const base = Date.now();
    await prisma.moduleCodingAttempt.create({ data: { moduleCodingTestId: testId, studentId: student.id, status: "SUBMITTED", submittedAt: new Date(base - 30000), startedAt: new Date(base - 31000), passed: false, attemptNumber: 1, score: 40 } });
    await prisma.moduleCodingAttempt.create({ data: { moduleCodingTestId: testId, studentId: student.id, status: "SUBMITTED", submittedAt: new Date(base - 20000), startedAt: new Date(base - 21000), passed: true, attemptNumber: 2, score: 100 } });
    await prisma.moduleCodingAttempt.create({ data: { moduleCodingTestId: testId, studentId: student.id, status: "SUBMITTED", submittedAt: new Date(base - 10000), startedAt: new Date(base - 11000), passed: false, attemptNumber: 3, score: 50 } });

    const reset = await httpRequest("DELETE", `/api/module-coding/admin/tests/${testId}/students/${student.id}/attempts`, superAdminToken, { mode: "custom", attemptsRemaining: 1 });
    assert.equal(reset.status, 200, `failed to reset attempts: ${JSON.stringify(reset.body)}`);

    const remaining = await prisma.moduleCodingAttempt.findMany({ where: { moduleCodingTestId: testId, studentId: student.id } });
    assert.ok(!remaining.some((a) => a.passed), "the passed attempt must be among what gets deleted by a custom reset, regardless of its age");

    const afterReset = await httpRequest("POST", `/api/module-coding/module/${moduleId}/start`, studentToken);
    assert.equal(afterReset.status, 200, `student must be able to start again after the reset, not still blocked by "already passed": ${JSON.stringify(afterReset.body)}`);
    assert.ok(afterReset.body.attemptId, "a genuinely new attempt must be created");
  } finally {
    if (testId) {
      await prisma.moduleCodingAttempt.deleteMany({ where: { moduleCodingTestId: testId } }).catch(() => {});
      await prisma.moduleCodingTest.delete({ where: { id: testId } }).catch(() => {});
    }
    if (questionId) await prisma.question.delete({ where: { id: questionId } }).catch(() => {});
    if (moduleId) {
      await prisma.lessonProgress.deleteMany({ where: { lesson: { moduleId } } }).catch(() => {});
      await prisma.lesson.deleteMany({ where: { moduleId } }).catch(() => {});
      await prisma.courseModule.delete({ where: { id: moduleId } }).catch(() => {});
    }
    if (courseId) await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
  }
});
