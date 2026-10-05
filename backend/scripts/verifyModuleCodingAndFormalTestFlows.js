// One-off: real end-to-end verification of the Module Coding Test flow (LMS) and the Formal Test
// flow against the live API on this instance, post-migration. Uses the real seeded "Introduction
// to Java" module (marking its lessons complete for the temp student to pass the lock-gate — the
// normal path is watching them, this just satisfies the same DB state) and a throwaway Formal Test
// built from two already-existing questions (one CODING, one MCQ) so real content isn't touched.
// Creates one disposable STUDENT (random password, @example.invalid email) and deletes everything
// afterward, including the disposable Test/TestQuestion rows (never the underlying Questions).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

async function main() {
  const disabled = await prisma.featureSetting.findMany({ where: { featureKey: { in: ["lms", "compiler"] }, enabled: false }, select: { instituteId: true } });
  const disabledIds = disabled.map((d) => d.instituteId);
  const institute = await prisma.institute.findFirst({ where: { id: { notIn: disabledIds }, isActive: true } });
  if (!institute) throw new Error("No institute with lms + compiler enabled found");

  const admin = await prisma.user.findFirst({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } } });
  if (!admin) throw new Error("No admin user found to own the temp Test");

  const module_ = await prisma.courseModule.findFirst({
    where: { title: "Introduction to Java" },
    include: { lessons: { select: { id: true } }, codingTest: true },
  });
  if (!module_ || !module_.codingTest) throw new Error("Expected the seeded 'Introduction to Java' module + coding test to exist");

  const codingQuestion = await prisma.question.findFirst({ where: { questionType: "CODING", testCases: { some: {} } }, include: { testCases: true } });
  const mcqQuestion = await prisma.question.findFirst({ where: { questionType: "MCQ" } });
  if (!codingQuestion || !mcqQuestion) throw new Error("Expected at least one CODING and one MCQ question to exist on this platform");

  const email = `verify-module-formal-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name: "Verify Module Formal", email, passwordHash, role: "STUDENT", instituteId: institute.id, mustChangePassword: false },
  });
  console.log("Created temp student:", user.id, email);

  // Satisfies getModuleLockMap's lessonsComplete gate for THIS module only — real students get
  // here by actually watching the lessons; this reproduces the same completed-progress DB state.
  await prisma.lessonProgress.createMany({
    data: module_.lessons.map((l) => ({ studentId: user.id, lessonId: l.id, status: "COMPLETED", completedAt: new Date() })),
  });
  console.log(`Marked ${module_.lessons.length} lesson(s) complete for module "Introduction to Java"`);

  const now = Date.now();
  const test = await prisma.test.create({
    data: {
      title: `Verification Formal Test ${now}`, durationMin: 30, passingMarks: 0, showResults: true,
      startTime: new Date(now - 60_000), endTime: new Date(now + 60 * 60_000), isPublished: true,
      requireFullscreen: false, createdById: admin.id, instituteId: null, // null = platform-wide, open to everyone
      questions: { create: [{ questionId: codingQuestion.id, order: 0 }, { questionId: mcqQuestion.id, order: 1 }] },
    },
  });
  console.log("Created temp Formal Test:", test.id);

  let moduleAttemptId = null, testAttemptId = null;
  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };
    console.log("Login OK\n");

    // --- Module Coding Test ---
    console.log("=== MODULE CODING TEST (Introduction to Java) ===");
    const startRes = await fetch(`${BASE}/module-coding/module/${module_.id}/start`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const startBody = await startRes.json();
    if (!startRes.ok) throw new Error(`module coding start failed: HTTP ${startRes.status} ${JSON.stringify(startBody)}`);
    moduleAttemptId = startBody.attemptId;
    console.log(`Attempt created: ${moduleAttemptId}, questions: ${startBody.questions.length}`);
    if (startBody.questions.length === 0) throw new Error("Zero module coding questions returned");

    for (const q of startBody.questions) {
      const runRes = await fetch(`${BASE}/module-coding/attempts/${moduleAttemptId}/run`, { method: "POST", headers: auth, body: JSON.stringify({ questionId: q.id, language: "python", code: "print('hello')" }) });
      const runBody = await runRes.json();
      if (!runRes.ok) throw new Error(`run failed for ${q.id}: HTTP ${runRes.status} ${JSON.stringify(runBody)}`);
      console.log(`  [run] question ${q.id} — verdict=${runBody.verdict}`);

      const subRes = await fetch(`${BASE}/module-coding/attempts/${moduleAttemptId}/submit-code`, { method: "POST", headers: auth, body: JSON.stringify({ questionId: q.id, language: "python", code: "print('hello')" }) });
      const subBody = await subRes.json();
      if (!subRes.ok) throw new Error(`submit-code failed for ${q.id}: HTTP ${subRes.status} ${JSON.stringify(subBody)}`);
      console.log(`  [submit-code] question ${q.id} — verdict=${subBody.verdict}, passed=${subBody.passedCases}/${subBody.totalCases}`);
    }

    const modFinalRes = await fetch(`${BASE}/module-coding/attempts/${moduleAttemptId}/finalize`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const modFinalBody = await modFinalRes.json();
    if (!modFinalRes.ok) throw new Error(`module coding finalize failed: HTTP ${modFinalRes.status} ${JSON.stringify(modFinalBody)}`);
    console.log("Finalize OK — status:", modFinalBody.status ?? modFinalBody.attempt?.status, "passed:", modFinalBody.passed ?? modFinalBody.attempt?.passed);

    // --- Formal Test ---
    console.log("\n=== FORMAL TEST ===");
    const testStartRes = await fetch(`${BASE}/tests/${test.id}/start`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const testStartBody = await testStartRes.json();
    if (!testStartRes.ok) throw new Error(`formal test start failed: HTTP ${testStartRes.status} ${JSON.stringify(testStartBody)}`);
    testAttemptId = testStartBody.id;
    console.log(`Attempt created: ${testAttemptId}`);

    const codeSubRes = await fetch(`${BASE}/submissions/submit-code`, { method: "POST", headers: auth, body: JSON.stringify({ attemptId: testAttemptId, questionId: codingQuestion.id, language: "python", code: "print('hello')" }) });
    const codeSubBody = await codeSubRes.json();
    if (!codeSubRes.ok) throw new Error(`submit-code failed: HTTP ${codeSubRes.status} ${JSON.stringify(codeSubBody)}`);
    console.log(`  [CODING] submitted — verdict=${codeSubBody.verdict}, passed=${codeSubBody.passedCases}/${codeSubBody.totalCases}`);

    const mcqSubRes = await fetch(`${BASE}/submissions/submit`, { method: "POST", headers: auth, body: JSON.stringify({ attemptId: testAttemptId, questionId: mcqQuestion.id, selectedOptions: [0] }) });
    const mcqSubBody = await mcqSubRes.json();
    if (!mcqSubRes.ok) throw new Error(`submit (MCQ) failed: HTTP ${mcqSubRes.status} ${JSON.stringify(mcqSubBody)}`);
    console.log(`  [MCQ] submitted — submissionId=${mcqSubBody.submissionId}`);

    const testFinalRes = await fetch(`${BASE}/submissions/finalize/${testAttemptId}`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const testFinalBody = await testFinalRes.json();
    if (!testFinalRes.ok) throw new Error(`formal test finalize failed: HTTP ${testFinalRes.status} ${JSON.stringify(testFinalBody)}`);
    console.log("Finalize OK — status:", testFinalBody.status, "totalScore:", testFinalBody.totalScore);

    console.log("\n=== MODULE CODING + FORMAL TEST FLOWS: PASS ===");
  } finally {
    if (testAttemptId) {
      await prisma.submission.deleteMany({ where: { attemptId: testAttemptId } }).catch(() => {});
      await prisma.testAttempt.delete({ where: { id: testAttemptId } }).catch(() => {});
    }
    await prisma.testQuestion.deleteMany({ where: { testId: test.id } }).catch(() => {});
    await prisma.test.delete({ where: { id: test.id } }).catch(() => {});
    if (moduleAttemptId) {
      await prisma.moduleCodingSubmission.deleteMany({ where: { attemptId: moduleAttemptId } }).catch(() => {});
      await prisma.moduleCodingAttemptQuestion.deleteMany({ where: { attemptId: moduleAttemptId } }).catch(() => {});
      await prisma.moduleCodingAttempt.delete({ where: { id: moduleAttemptId } }).catch(() => {});
    }
    await prisma.lessonProgress.deleteMany({ where: { studentId: user.id, lessonId: { in: module_.lessons.map((l) => l.id) } } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log("Cleaned up temp student, test, and attempts.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
