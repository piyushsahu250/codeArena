// Regression test for readiness.js's scoring-policy snapshot (added 2026-09-23, Readiness Tests
// audit / Phase 39 "edit safety"): completed reports were already frozen at finalize time, but an
// admin editing ReadinessSubject.readinessThresholds WHILE a student's attempt was IN_PROGRESS
// used to retroactively change which policy that in-flight attempt got graded against, since
// finalize read the subject's CURRENT row rather than what was in effect when the attempt started.
// Same live-HTTP-server infra as learningCourses.integration.test.js (own header comment explains
// why: no in-process app to boot), skips cleanly when server/fixture data/feature access aren't
// reachable, disposable data cleaned up in a finally block.
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

test("editing a subject's readinessThresholds mid-attempt does not change how an already-in-progress attempt is graded", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let subjectId, assessmentId, questionId;
  try {
    const subject = await prisma.readinessSubject.create({
      data: {
        name: `Regression Scoring-Policy Subject ${Date.now()}`,
        instituteId: null, // platform-global, no assignment needed -- open to every student
        topics: [{ name: "DSA", subtopics: [] }],
        questionTypesAllowed: ["MCQ"],
        defaultBtlDistribution: { "3": 100 },
        assessmentModes: [{ key: "TEST", label: "Test", btlMin: 3, btlMax: 3 }],
        // OLD thresholds: a 50% score lands on "OLD_MID". Chosen so the question below (worth one
        // point, deliberately answered wrong -> 0%) instead lands on "OLD_FLOOR", still uniquely
        // distinguishable from whatever the NEW thresholds below would produce for the same score.
        readinessThresholds: [{ label: "OLD_MID", min: 50 }, { label: "OLD_FLOOR", min: 0 }],
      },
    });
    subjectId = subject.id;

    const question = await prisma.question.create({
      data: {
        title: `Regression Scoring-Policy Question ${Date.now()}`, description: "1 + 1 = ?",
        subject: subject.name, topic: "Arithmetic", btlLevel: 3, questionType: "MCQ", questionStatus: "PUBLISHED", instituteId: null,
        options: ["1", "2", "3", "4"], correctAnswer: [1],
      },
    });
    questionId = question.id;

    const create = await httpRequest("POST", "/api/readiness/assessments", studentToken, { subjectId, assessmentMode: "TEST", questionCount: 1 });
    if (create.status === 403 && create.body?.featureDisabled) return t.skip("readiness_test feature disabled for this fixture student's institute");
    assert.equal(create.status, 200, `failed to start assessment: ${JSON.stringify(create.body)}`);
    assessmentId = create.body.assessment.id;
    assert.equal(create.body.questions.length, 1, "the disposable subject only has one eligible question");
    assert.equal(create.body.questions[0].id, questionId);

    // Admin edits the subject's thresholds WHILE this attempt is still IN_PROGRESS -- the exact
    // scenario the fix targets. New thresholds place a 0% score on a DIFFERENT, distinguishable
    // label than the old ones would have.
    const editThresholds = await httpRequest("PATCH", `/api/readiness/admin/subjects/${subjectId}`, superAdminToken, {
      readinessThresholds: [{ label: "NEW_MID", min: 50 }, { label: "NEW_FLOOR", min: 0 }],
    });
    assert.equal(editThresholds.status, 200);

    // Answer the question WRONG on purpose (deterministic 0% -> hits the *_FLOOR label either way)
    // and finalize.
    const answer = await httpRequest("POST", `/api/readiness/assessments/${assessmentId}/answer`, studentToken, { questionId, selectedOptions: [0] });
    assert.equal(answer.status, 200, `failed to save answer: ${JSON.stringify(answer.body)}`);

    const finalize = await httpRequest("POST", `/api/readiness/assessments/${assessmentId}/finalize`, studentToken, {});
    assert.equal(finalize.status, 200, `failed to finalize: ${JSON.stringify(finalize.body)}`);
    assert.equal(finalize.body.report.readinessLevel, "OLD_FLOOR", "an attempt started before the threshold edit must be graded against the OLD thresholds, not the ones an admin changed mid-attempt");
  } finally {
    if (assessmentId) {
      await prisma.readinessReport.deleteMany({ where: { assessmentId } }).catch(() => {});
      await prisma.readinessAnswer.deleteMany({ where: { assessmentId } }).catch(() => {});
      await prisma.readinessAssessment.delete({ where: { id: assessmentId } }).catch(() => {});
    }
    if (questionId) await prisma.question.delete({ where: { id: questionId } }).catch(() => {});
    if (subjectId) await prisma.readinessSubject.delete({ where: { id: subjectId } }).catch(() => {});
  }
});
