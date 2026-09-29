// Regression test for a real, confirmed feature gap found 2026-09-29 while extending "reattempt"
// support to every test type on the platform: Readiness Tests had NO admin-facing way at all to
// reset a student's attempt count once they'd used up ReadinessSubject.maxAttempts -- unlike
// Formal Tests (tests.js's "Allow Reattempt") and Module Coding Assessments (moduleCoding.js's
// reset-attempts route), both of which already had this lever. Fixed by adding
// DELETE /admin/subjects/:id/students/:studentId/attempts, which deletes the student's finalized
// (COMPLETED/EXPIRED) ReadinessAssessment rows for this subject (optionally scoped to one
// assessmentMode) so POST /assessments's maxAttempts count naturally drops. Same live-HTTP-server
// infra as learningCourses.integration.test.js (see its header comment for why), disposable data
// cleaned up in a finally block.
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

test("admin can reset a student's readiness attempts once they've used up maxAttempts", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let subjectId;
  try {
    const subject = await prisma.readinessSubject.create({
      data: {
        name: `Regression Readiness-Reattempt Subject ${Date.now()}`,
        instituteId: null,
        topics: [{ name: "DSA", subtopics: [] }],
        questionTypesAllowed: ["MCQ"],
        defaultBtlDistribution: { "3": 100 },
        assessmentModes: [{ key: "TEST", label: "Test", btlMin: 3, btlMax: 3 }],
        readinessThresholds: [{ label: "JOB_READY", min: 75 }, { label: "FOUNDATION_REQUIRED", min: 0 }],
        maxAttempts: 1,
      },
    });
    subjectId = subject.id;

    await prisma.readinessAssessment.create({
      data: { subjectId, studentId: student.id, assessmentMode: "TEST", blueprint: { target: {}, actual: {} }, status: "COMPLETED", submittedAt: new Date(), durationMin: 30 },
    });

    const beforeReset = await httpRequest("POST", "/api/readiness/assessments", studentToken, { subjectId, assessmentMode: "TEST", questionCount: 1 });
    assert.equal(beforeReset.status, 403);
    assert.equal(beforeReset.body.maxAttemptsReached, true, "the student must genuinely be capped before any reset");

    const reset = await httpRequest("DELETE", `/api/readiness/admin/subjects/${subjectId}/students/${student.id}/attempts`, superAdminToken, {});
    assert.equal(reset.status, 200, `failed to reset readiness attempts: ${JSON.stringify(reset.body)}`);
    assert.equal(reset.body.deletedCount, 1);

    const remaining = await prisma.readinessAssessment.count({ where: { subjectId, studentId: student.id } });
    assert.equal(remaining, 0, "the finalized assessment must actually be deleted, not just reported as reset");

    // A fresh attempt is now allowed -- the response won't be a real 200 here (this disposable
    // subject has no real question bank), but it must NOT be the maxAttempts 403 anymore, proving
    // the cap itself was genuinely lifted rather than the reset being a no-op.
    const afterReset = await httpRequest("POST", "/api/readiness/assessments", studentToken, { subjectId, assessmentMode: "TEST", questionCount: 1 });
    assert.notEqual(afterReset.status, 403);
    if (afterReset.status === 403) assert.notEqual(afterReset.body.maxAttemptsReached, true);
  } finally {
    if (subjectId) {
      await prisma.readinessAssessment.deleteMany({ where: { subjectId } }).catch(() => {});
      await prisma.readinessSubject.delete({ where: { id: subjectId } }).catch(() => {});
    }
  }
});
