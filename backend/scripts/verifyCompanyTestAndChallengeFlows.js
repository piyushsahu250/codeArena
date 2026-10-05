// One-off: real end-to-end verification of a company-tagged placement Test (Test.company set —
// same TestTaking.jsx pipeline as a plain Formal Test, verified two rounds ago, but the
// company-tagged path itself was untested) and the Daily + Weekly Challenge flows, against the
// live API on this instance post-migration. Reuses an existing global (institute-unscoped) Daily/
// WeeklyChallenge for today/this week if one already exists in production (read-only in that
// case); otherwise creates a disposable one from an existing question and deletes it afterward.
// Creates one disposable STUDENT (random password, @example.invalid email) and deletes everything
// it created when done.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

function dayStart(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function isoWeekStart(d) {
  const x = dayStart(d);
  const day = x.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

async function main() {
  const disabled = await prisma.featureSetting.findMany({ where: { featureKey: "coding_challenge", enabled: false }, select: { instituteId: true } });
  const disabledIds = disabled.map((d) => d.instituteId);
  const institute = await prisma.institute.findFirst({ where: { id: { notIn: disabledIds }, isActive: true } });
  if (!institute) throw new Error("No institute with coding_challenge enabled found");

  const admin = await prisma.user.findFirst({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } } });
  if (!admin) throw new Error("No admin user found to own the temp Test");

  const codingQuestion = await prisma.question.findFirst({ where: { questionType: "CODING", testCases: { some: {} } }, include: { testCases: true } });
  if (!codingQuestion) throw new Error("Expected at least one CODING question to exist on this platform");

  const email = `verify-company-challenge-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name: "Verify Company Challenge", email, passwordHash, role: "STUDENT", instituteId: institute.id, mustChangePassword: false },
  });
  console.log("Created temp student:", user.id, email);

  const now = Date.now();
  const companyTest = await prisma.test.create({
    data: {
      title: `Verification TCS Mock Test ${now}`, company: "TCS", durationMin: 30, passingMarks: 0, showResults: true,
      startTime: new Date(now - 60_000), endTime: new Date(now + 60 * 60_000), isPublished: true,
      requireFullscreen: false, createdById: admin.id, instituteId: null,
      questions: { create: [{ questionId: codingQuestion.id, order: 0 }] },
    },
  });
  console.log("Created temp company-tagged Test:", companyTest.id, "(company: TCS)");

  const today = dayStart(new Date());
  let dailyChallenge = await prisma.dailyChallenge.findFirst({ where: { date: today, instituteId: null, academicGroupId: null, isActive: true } });
  let dailyChallengeCreatedByUs = false;
  if (!dailyChallenge) {
    dailyChallenge = await prisma.dailyChallenge.create({ data: { date: today, questionId: codingQuestion.id, isActive: true } });
    dailyChallengeCreatedByUs = true;
  }
  console.log(`Daily Challenge for today: ${dailyChallenge.id} (${dailyChallengeCreatedByUs ? "created disposable" : "reused existing production row, read-only"})`);

  const weekStart = isoWeekStart(new Date());
  let weeklyChallenge = await prisma.weeklyChallenge.findFirst({ where: { weekStart, instituteId: null, academicGroupId: null, isActive: true } });
  let weeklyChallengeCreatedByUs = false;
  if (!weeklyChallenge) {
    weeklyChallenge = await prisma.weeklyChallenge.create({ data: { weekStart, questionId: codingQuestion.id, isActive: true } });
    weeklyChallengeCreatedByUs = true;
  }
  console.log(`Weekly Challenge for this week: ${weeklyChallenge.id} (${weeklyChallengeCreatedByUs ? "created disposable" : "reused existing production row, read-only"})`);

  let companyAttemptId = null;
  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };
    console.log("Login OK\n");

    // --- Company-Tagged Placement Test ---
    console.log("=== COMPANY-TAGGED TEST (TCS Mock Test) ===");
    const startRes = await fetch(`${BASE}/tests/${companyTest.id}/start`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const startBody = await startRes.json();
    if (!startRes.ok) throw new Error(`company test start failed: HTTP ${startRes.status} ${JSON.stringify(startBody)}`);
    companyAttemptId = startBody.id;
    console.log(`Attempt created: ${companyAttemptId}`);

    const subRes = await fetch(`${BASE}/submissions/submit-code`, { method: "POST", headers: auth, body: JSON.stringify({ attemptId: companyAttemptId, questionId: codingQuestion.id, language: "python", code: "print('hello')" }) });
    const subBody = await subRes.json();
    if (!subRes.ok) throw new Error(`submit-code failed: HTTP ${subRes.status} ${JSON.stringify(subBody)}`);
    console.log(`  submitted — verdict=${subBody.verdict}, passed=${subBody.passedCases}/${subBody.totalCases}`);

    const finalRes = await fetch(`${BASE}/submissions/finalize/${companyAttemptId}`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const finalBody = await finalRes.json();
    if (!finalRes.ok) throw new Error(`finalize failed: HTTP ${finalRes.status} ${JSON.stringify(finalBody)}`);
    console.log("Finalize OK — status:", finalBody.status, "totalScore:", finalBody.totalScore);

    // --- Daily Challenge ---
    console.log("\n=== DAILY CHALLENGE ===");
    const dcTodayRes = await fetch(`${BASE}/challenges/daily/today`, { headers: auth });
    const dcTodayBody = await dcTodayRes.json();
    if (!dcTodayRes.ok) throw new Error(`GET /challenges/daily/today failed: HTTP ${dcTodayRes.status} ${JSON.stringify(dcTodayBody)}`);
    if (!dcTodayBody.challenge) throw new Error("GET /challenges/daily/today returned no challenge");
    console.log(`Today's challenge resolved: ${dcTodayBody.challenge.id}, question: ${dcTodayBody.question.title || dcTodayBody.question.id}`);

    const dcRunRes = await fetch(`${BASE}/challenges/daily/${dailyChallenge.id}/run`, { method: "POST", headers: auth, body: JSON.stringify({ language: "python", code: "print('hello')" }) });
    const dcRunBody = await dcRunRes.json();
    if (!dcRunRes.ok) throw new Error(`daily run failed: HTTP ${dcRunRes.status} ${JSON.stringify(dcRunBody)}`);
    console.log(`  [run] verdict=${dcRunBody.verdict}`);

    const dcSubRes = await fetch(`${BASE}/challenges/daily/${dailyChallenge.id}/submit`, { method: "POST", headers: auth, body: JSON.stringify({ language: "python", code: "print('hello')" }) });
    const dcSubBody = await dcSubRes.json();
    if (!dcSubRes.ok) throw new Error(`daily submit failed: HTTP ${dcSubRes.status} ${JSON.stringify(dcSubBody)}`);
    console.log(`  [submit] verdict=${dcSubBody.verdict}, passed=${dcSubBody.passedCases}/${dcSubBody.totalCases}`);

    // --- Weekly Challenge ---
    console.log("\n=== WEEKLY CHALLENGE ===");
    const wcCurrentRes = await fetch(`${BASE}/challenges/weekly/current`, { headers: auth });
    const wcCurrentBody = await wcCurrentRes.json();
    if (!wcCurrentRes.ok) throw new Error(`GET /challenges/weekly/current failed: HTTP ${wcCurrentRes.status} ${JSON.stringify(wcCurrentBody)}`);
    if (!wcCurrentBody.challenge) throw new Error("GET /challenges/weekly/current returned no challenge");
    console.log(`This week's challenge resolved: ${wcCurrentBody.challenge.id}, question: ${wcCurrentBody.question.title || wcCurrentBody.question.id}`);

    const wcRunRes = await fetch(`${BASE}/challenges/weekly/${weeklyChallenge.id}/run`, { method: "POST", headers: auth, body: JSON.stringify({ language: "python", code: "print('hello')" }) });
    const wcRunBody = await wcRunRes.json();
    if (!wcRunRes.ok) throw new Error(`weekly run failed: HTTP ${wcRunRes.status} ${JSON.stringify(wcRunBody)}`);
    console.log(`  [run] verdict=${wcRunBody.verdict}`);

    const wcSubRes = await fetch(`${BASE}/challenges/weekly/${weeklyChallenge.id}/submit`, { method: "POST", headers: auth, body: JSON.stringify({ language: "python", code: "print('hello')" }) });
    const wcSubBody = await wcSubRes.json();
    if (!wcSubRes.ok) throw new Error(`weekly submit failed: HTTP ${wcSubRes.status} ${JSON.stringify(wcSubBody)}`);
    console.log(`  [submit] verdict=${wcSubBody.verdict}, passed=${wcSubBody.passedCases}/${wcSubBody.totalCases}`);

    console.log("\n=== COMPANY TEST + DAILY/WEEKLY CHALLENGE FLOWS: PASS ===");
  } finally {
    if (companyAttemptId) {
      await prisma.submission.deleteMany({ where: { attemptId: companyAttemptId } }).catch(() => {});
      await prisma.testAttempt.delete({ where: { id: companyAttemptId } }).catch(() => {});
    }
    await prisma.testQuestion.deleteMany({ where: { testId: companyTest.id } }).catch(() => {});
    await prisma.test.delete({ where: { id: companyTest.id } }).catch(() => {});
    await prisma.dailyChallengeSubmission.deleteMany({ where: { dailyChallengeId: dailyChallenge.id, studentId: user.id } }).catch(() => {});
    await prisma.weeklyChallengeSubmission.deleteMany({ where: { weeklyChallengeId: weeklyChallenge.id, studentId: user.id } }).catch(() => {});
    if (dailyChallengeCreatedByUs) await prisma.dailyChallenge.delete({ where: { id: dailyChallenge.id } }).catch(() => {});
    if (weeklyChallengeCreatedByUs) await prisma.weeklyChallenge.delete({ where: { id: weeklyChallenge.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log("Cleaned up temp student, company test, and any disposable challenge rows (real production challenges, if reused, were left untouched).");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
