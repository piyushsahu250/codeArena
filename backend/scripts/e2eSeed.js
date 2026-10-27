// Disposable accounts and data for the browser E2E suite (frontend/e2e). Everything created here is named "ZZ E2E ..." / e2e-*@example.invalid and
// is removed by --cleanup. Prints one JSON document with the credentials on stdout (passwords are random per run, never stored anywhere else).
//   node scripts/e2eSeed.js --seed      create and print
//   node scripts/e2eSeed.js --cleanup   remove everything this script created
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { generateTempPassword } = require("../src/utils/password");

const TAG = "ZZ E2E";
async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.test.deleteMany({ where: { instituteId: { in: ids } } }); // attempts + submissions cascade
  await prisma.question.deleteMany({ where: { title: { startsWith: `${TAG} ` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-", endsWith: "@example.invalid" } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

async function seed() {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} Alpha Institute ${ts}`, code: "E2EA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} Beta Institute ${ts}`, code: "E2EB" } });
  const dept = await prisma.department.create({ data: { name: "E2E Computer Science", instituteId: A.id } });
  const group = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: dept.id, section: "Section A" } });
  const mk = async (key, name, role, instituteId, extra = {}) => {
    const password = crypto.randomBytes(18).toString("base64url");
    const u = await prisma.user.create({ data: { name, email: `e2e-${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(password, 10), role, instituteId, mustChangePassword: false, ...extra } });
    return { id: u.id, name, email: u.email, password, role, instituteId };
  };
  const users = {
    student: await mk("student", "Ela Student", "STUDENT", A.id, { department: "E2E Computer Science", academicGroupId: group.id, program: "B.Tech", rollNumber: "101", registrationNumber: "PRN-ELA-7001" }),
    student2: await mk("student2", "Ben Student", "STUDENT", A.id, { department: "E2E Computer Science", academicGroupId: group.id, rollNumber: "102", registrationNumber: "PRN-BEN-7002" }),
    student3: await mk("student3", "Cal Student", "STUDENT", A.id, { department: "E2E Computer Science", academicGroupId: group.id, rollNumber: "103", registrationNumber: "PRN-CAL-7003" }),
    student4: await mk("student4", "Dan Student", "STUDENT", A.id, { department: "E2E Computer Science", academicGroupId: group.id, rollNumber: "104", registrationNumber: "PRN-DAN-7004" }),
    studentB: await mk("studentb", "Zed Other", "STUDENT", B.id),
    staff: await mk("staff", "Sam Staff", "STAFF", A.id, { department: "E2E Computer Science" }),
    clerk: await mk("clerk", "Cora Clerk", "CLERK", A.id),
    instAdmin: await mk("instadmin", "Ivy Admin", "INSTITUTE_ADMIN", A.id),
    platform: await mk("platform", "Pat Platform", "ADMIN", null),
  };
  // Accounts that must choose a personal password at first sign-in, for frontend/e2e/tests/firstLogin.spec.js. They are NOT in `users` (no other spec may sign in with them), and each is
  // used by one test only, because a successful password change consumes the temporary password. Same shape as the passwords the platform really issues (generateTempPassword).
  // They live in an institute of their own, so no count or list that another spec asserts on (the students of Alpha, a group's leaderboard) changes.
  const G = await prisma.institute.create({ data: { name: `${TAG} Gamma Institute ${ts}`, code: "E2EG" } });
  const mkFirst = async (key, name) => {
    const password = generateTempPassword();
    const u = await prisma.user.create({ data: { name, email: `e2e-${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(password, 10), role: "STUDENT", instituteId: G.id, mustChangePassword: true } });
    return { id: u.id, name, email: u.email, password, role: "STUDENT", instituteId: G.id };
  };
  const firstLogin = {
    journey: await mkFirst("flogin-journey", "Fay First"),
    rules: await mkFirst("flogin-rules", "Gus Rules"),
    network: await mkFirst("flogin-network", "Hal Network"),
    double: await mkFirst("flogin-double", "Ivo Double"),
    guard: await mkFirst("flogin-guard", "Jon Guard"),
    access: await mkFirst("flogin-access", "Kim Access"),
    wrong: await mkFirst("flogin-wrong", "Lee Wrong"),
  };
  const mkQ = (n) => prisma.question.create({ data: { title: `${TAG} Question ${n}`, description: `E2E question ${n}: pick option B`, questionType: "MCQ", difficulty: "EASY", points: 5, options: ["Option A", "Option B", "Option C"], correctAnswer: [1], instituteId: A.id } });
  const questions = [await mkQ(1), await mkQ(2)];
  const now = Date.now();
  const mkTest = (title, extra = {}) => prisma.test.create({
    data: {
      title, durationMin: 20, startTime: new Date(now - 60000), endTime: new Date(now + 6 * 3600000), isPublished: true, showResults: true, requireFullscreen: false,
      createdById: users.staff.id, instituteId: A.id, academicGroups: { create: [{ academicGroupId: group.id }] },
      questions: { create: questions.map((q, order) => ({ questionId: q.id, order })) }, ...extra,
    },
  });
  const test = await mkTest(`${TAG} Standard Test`);
  const proctored = await mkTest(`${TAG} Proctored Test`, { securityLevel: "PROCTORED" });
  const fsTest = await mkTest(`${TAG} Fullscreen Test`, { requireFullscreen: true });
  // Coding questions (full-program and function-based) for the keyboard regression: a real Monaco editor inside a timed test, with and without proctoring.
  const FH = require("../src/utils/functionHarness");
  const fnSig = { methodName: "addNums", returnType: "int", params: [{ name: "a", type: "int" }, { name: "b", type: "int" }] };
  const fnFields = FH.resolveCodingFields({ evaluationType: "FUNCTION", functionSignature: fnSig });
  const cases = { create: [{ input: "1 2", expected: "3", isHidden: false }, { input: "5 6", expected: "11", isHidden: true }] };
  const codeFull = await prisma.question.create({ data: { title: `${TAG} Code Full`, description: "E2E coding (full program): read two integers and print the sum.", questionType: "CODING", difficulty: "EASY", points: 10, instituteId: A.id, evaluationType: "STDIO", testCases: cases } });
  const codeFn = await prisma.question.create({ data: { title: `${TAG} Code Function`, description: "E2E coding (function): return a + b.", questionType: "CODING", difficulty: "EASY", points: 10, instituteId: A.id, evaluationType: "FUNCTION", functionSignature: fnSig, starterCodeByLanguage: fnFields.starterCodeByLanguage, testCases: { create: [{ input: "1\n2", expected: "3", isHidden: false }, { input: "5\n6", expected: "11", isHidden: true }] } } });
  const mkCodingTest = (title, extra = {}) => prisma.test.create({
    data: {
      title, durationMin: 30, startTime: new Date(now - 60000), endTime: new Date(now + 6 * 3600000), isPublished: true, showResults: true, requireFullscreen: false,
      createdById: users.staff.id, instituteId: A.id, academicGroups: { create: [{ academicGroupId: group.id }] },
      questions: { create: [codeFull, codeFn].map((q, order) => ({ questionId: q.id, order })) }, ...extra,
    },
  });
  const companyTest = await mkTest(`${TAG} Company Test`, { company: "ZZCO" });
  // A plain test for the exam-window spec (an emulated phone shrinks its window and the page must report it once, as a counted violation).
  const windowTest = await mkTest(`${TAG} Window Test`);
  // Tests for the Copilot key / AI-assistant shortcut signals: one with the policy on, one with it off.
  const aiShortcutTest = await mkTest(`${TAG} AI Shortcut Test`, { securityPolicy: { blockAiShortcuts: true } });
  const aiShortcutOffTest = await mkTest(`${TAG} AI Shortcut Off Test`);
  // A finished test with three submitted attempts, for the staff leaderboard search tests.
  const resultsTest = await mkTest(`${TAG} Results Test`);
  // Lifecycle states on the staff leaderboard: finished, auto-submitted, still inside its own time, and past its own time but not yet closed (its running score is the highest). The test lasts 60 minutes (it was 20) and the expired attempt began 120 minutes ago, so that a slow CI runner, which can reach this spec 15 minutes or more after seeding, cannot turn the "in progress" attempt (began 5 minutes before seeding) into an expired one.
  const statusTest = await mkTest(`${TAG} Status Test`, { durationMin: 60 });
  for (const [u, status, startedMinAgo, score] of [[users.student, "SUBMITTED", 15, 9], [users.student2, "IN_PROGRESS", 5, 7], [users.student3, "IN_PROGRESS", 120, 8], [users.student4, "AUTO_SUBMITTED", 40, 4]]) {
    await prisma.testAttempt.create({ data: { testId: statusTest.id, studentId: u.id, status, totalScore: score, startedAt: new Date(now - startedMinAgo * 60000), submittedAt: status === "IN_PROGRESS" ? null : new Date(now - 60000), questionOrder: questions.map((q) => q.id) } });
  }
  for (const [u, score] of [[users.student, 9], [users.student2, 6], [users.student3, 3]]) {
    await prisma.testAttempt.create({ data: { testId: resultsTest.id, studentId: u.id, status: "SUBMITTED", totalScore: score, startedAt: new Date(now - 30 * 60000), submittedAt: new Date(now - 10 * 60000), questionOrder: questions.map((q) => q.id) } });
  }
  // One finished attempt with a proctoring log: a right-click and a first copy (warnings), a repeated copy (counted, escalated) and a full-screen exit (counted): 2 strikes.
  const violationsTest = await mkTest(`${TAG} Violations Test`);
  const violationsAttempt = await prisma.testAttempt.create({ data: { testId: violationsTest.id, studentId: users.student.id, status: "SUBMITTED", totalScore: 9, tabSwitchCount: 2, startedAt: new Date(now - 90 * 60000), submittedAt: new Date(now - 10 * 60000), questionOrder: questions.map((q) => q.id) } });
  for (const [type, severity, penalized, minutesAgo] of [["RIGHT_CLICK", "SUSPICIOUS", false, 80], ["COPY", "SUSPICIOUS", false, 70], ["COPY", "SUSPICIOUS", true, 69], ["FULLSCREEN_EXIT", "CONFIRMED_VIOLATION", true, 20]]) {
    await prisma.testViolation.create({ data: { attemptId: violationsAttempt.id, type, severity, penalized, createdAt: new Date(now - minutesAgo * 60000) } });
  }
  // Two auto-submitted attempts on the same test: Ben's time ran out and the server closed it 10 minutes after the deadline (0 strikes, so nothing about violations explains it), and Cal reached the
  // strike limit with three tab switches. The test lasts 20 minutes, so Ben's deadline was 70 minutes ago and he was closed 60 minutes ago.
  await prisma.testAttempt.create({ data: { testId: violationsTest.id, studentId: users.student2.id, status: "AUTO_SUBMITTED", totalScore: 4, tabSwitchCount: 0, startedAt: new Date(now - 90 * 60000), submittedAt: new Date(now - 60 * 60000), questionOrder: questions.map((q) => q.id) } });
  const limitAttempt = await prisma.testAttempt.create({ data: { testId: violationsTest.id, studentId: users.student3.id, status: "AUTO_SUBMITTED", totalScore: 3, tabSwitchCount: 3, startedAt: new Date(now - 50 * 60000), submittedAt: new Date(now - 43 * 60000), questionOrder: questions.map((q) => q.id) } });
  for (const minutesAgo of [47, 45, 43]) {
    await prisma.testViolation.create({ data: { attemptId: limitAttempt.id, type: "TAB_SWITCH", severity: "CONFIRMED_VIOLATION", penalized: true, createdAt: new Date(now - minutesAgo * 60000) } });
  }
  const codingTest = await mkCodingTest(`${TAG} Coding Test`);
  const codingProctored = await mkCodingTest(`${TAG} Coding Proctored Test`, { securityLevel: "PROCTORED" });
  console.log(JSON.stringify({ users, firstLogin, institutes: { A: { id: A.id, name: A.name }, B: { id: B.id, name: B.name } }, testId: test.id, companyTestId: companyTest.id, aiShortcutTestId: aiShortcutTest.id, aiShortcutOffTestId: aiShortcutOffTest.id, resultsTestId: resultsTest.id, statusTestId: statusTest.id, violationsTestId: violationsTest.id, windowTestId: windowTest.id, codingTestId: codingTest.id, codingProctoredTestId: codingProctored.id, proctoredTestId: proctored.id, fullscreenTestId: fsTest.id, questionTexts: ["E2E question 1: pick option B", "E2E question 2: pick option B"] }));
}

(async () => {
  if (process.argv.includes("--cleanup")) { await cleanup(); console.error("e2e data removed"); }
  else if (process.argv.includes("--seed")) await seed();
  else { console.error("usage: --seed | --cleanup"); process.exit(2); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
