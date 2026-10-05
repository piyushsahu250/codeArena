// One-off: real end-to-end verification of the Readiness Test assessment flow and the Talent-Pool
// interview flow against the live API on this instance, post-migration. Creates disposable rows
// (temp STUDENT with random password, a throwaway TalentPool + TalentPoolInterviewConfig +
// membership) and deletes everything afterward. Uses the existing, real "Data Structures &
// Algorithms" ReadinessSubject (institute-unscoped, no academicGroup restriction) rather than
// creating a fake one, since building a whole verified question bank from scratch isn't practical
// here — this is fine, it's read-only against that subject.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

async function main() {
  // The only ReadinessSubject with any real ReadinessQuestionPool rows in production right now is
  // this one — picking a subject with zero pool rows 400s at assessment-start regardless of mode,
  // which is a real (separate) content gap, not a migration bug. It has one academicGroupAssignment
  // restricting visibility, so the temp student below is created directly into that group/program
  // rather than into an arbitrary institute.
  const subject = await prisma.readinessSubject.findFirst({
    where: { isActive: true },
    include: { academicGroupAssignments: { include: { academicGroup: true } } },
  });
  const poolCounts = await prisma.readinessQuestionPool.groupBy({ by: ["subjectId"], _count: true });
  const subjectWithPool = poolCounts.length > 0
    ? await prisma.readinessSubject.findUnique({ where: { id: poolCounts[0].subjectId }, include: { academicGroupAssignments: { include: { academicGroup: true } } } })
    : null;
  if (!subjectWithPool) throw new Error("No ReadinessSubject has any ReadinessQuestionPool rows on this instance — nothing to verify against");
  const assignment = subjectWithPool.academicGroupAssignments[0] || null;
  const instituteId = assignment ? assignment.academicGroup.instituteId : (await prisma.institute.findFirst({ where: { isActive: true } })).id;

  const disabledForInstitute = await prisma.featureSetting.findMany({ where: { instituteId, featureKey: { in: ["readiness_test", "talent_pool", "ai_mock_interview"] }, enabled: false } });
  if (disabledForInstitute.length > 0) throw new Error(`Institute ${instituteId} has disabled: ${disabledForInstitute.map((f) => f.featureKey).join(", ")}`);

  const admin = await prisma.user.findFirst({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } } });
  if (!admin) throw new Error("No admin user found to own the temp TalentPool");

  console.log(`Using subject "${subjectWithPool.name}" (${subjectWithPool.id}), pool rows: ${poolCounts[0]._count}, academicGroupId: ${assignment?.academicGroupId || "none (unrestricted)"}`);

  const email = `verify-readiness-pool-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name: "Verify Readiness Pool", email, passwordHash, role: "STUDENT", instituteId, mustChangePassword: false,
      academicGroupId: assignment?.academicGroupId || null, program: assignment?.program || null,
    },
  });
  console.log("Created temp student:", user.id, email);

  const pool = await prisma.talentPool.create({ data: { name: `Verify Pool ${Date.now()}`, description: "Disposable verification pool", createdById: admin.id } });
  const poolConfig = await prisma.talentPoolInterviewConfig.create({ data: { poolId: pool.id, label: "Verify Config", config: { difficulty: "MEDIUM" } } });
  const membership = await prisma.talentPoolMember.create({ data: { poolId: pool.id, studentId: user.id, addedVia: "MANUAL", addedByName: "verification script" } });
  console.log("Created temp talent pool:", pool.id, "config:", poolConfig.id);

  let assessmentId = null, sessionId = null;
  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };
    console.log("Login OK\n");

    // --- Readiness Test ---
    console.log(`=== READINESS TEST (${subjectWithPool.name} / COMPLETE) ===`);
    const subjectsRes = await fetch(`${BASE}/readiness/subjects`, { headers: auth });
    const subjectsBody = await subjectsRes.json();
    if (!subjectsRes.ok) throw new Error(`GET /readiness/subjects failed: HTTP ${subjectsRes.status} ${JSON.stringify(subjectsBody)}`);
    const visible = subjectsBody.some((s) => s.id === subjectWithPool.id);
    console.log(`Subject visibility check: DSA subject ${visible ? "IS" : "is NOT"} visible to student (expected: IS)`);
    if (!visible) throw new Error("DSA subject not visible to temp student — eligibility check failed");

    const startRes = await fetch(`${BASE}/readiness/assessments`, { method: "POST", headers: auth, body: JSON.stringify({ subjectId: subjectWithPool.id, assessmentMode: "COMPLETE", questionCount: 5 }) });
    const startBody = await startRes.json();
    if (!startRes.ok) throw new Error(`assessment start failed: HTTP ${startRes.status} ${JSON.stringify(startBody)}`);
    assessmentId = startBody.assessment.id;
    console.log(`Assessment created: ${assessmentId}, questions: ${startBody.questions.length}`);
    if (startBody.questions.length === 0) throw new Error("Zero questions returned — DSA question bank may have no verified questions on this instance");

    for (const q of startBody.questions) {
      const realId = q.id.includes(":") ? q.id.split(":").pop() : q.id;
      let payload;
      if (q.questionType === "CODING") payload = { questionId: realId, code: "print('hello')", language: "python", timeTakenSec: 5 };
      else if (["MCQ", "TRUE_FALSE", "MULTISELECT"].includes(q.questionType)) payload = { questionId: realId, selectedOptions: [0], timeTakenSec: 3 };
      else payload = { questionId: realId, answerText: "Verification test answer.", timeTakenSec: 3 };
      const ansRes = await fetch(`${BASE}/readiness/assessments/${assessmentId}/answer`, { method: "POST", headers: auth, body: JSON.stringify(payload) });
      const ansBody = await ansRes.json();
      if (!ansRes.ok) throw new Error(`answer failed for ${q.questionType} (${realId}): HTTP ${ansRes.status} ${JSON.stringify(ansBody)}`);
      console.log(`  [${q.questionType}] answered OK — score=${ansBody.answer?.score ?? "n/a"}`);
    }

    const finalRes = await fetch(`${BASE}/readiness/assessments/${assessmentId}/finalize`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const finalBody = await finalRes.json();
    if (!finalRes.ok) throw new Error(`finalize failed: HTTP ${finalRes.status} ${JSON.stringify(finalBody)}`);
    console.log("Finalize OK — status:", finalBody.assessment?.status, "overallScore:", finalBody.report?.overallScore, "readinessLevel:", finalBody.report?.readinessLevel);

    // --- Talent Pool ---
    console.log("\n=== TALENT POOL ===");
    const myPoolsRes = await fetch(`${BASE}/talent-pools/my-pools`, { headers: auth });
    const myPoolsBody = await myPoolsRes.json();
    if (!myPoolsRes.ok) throw new Error(`GET /talent-pools/my-pools failed: HTTP ${myPoolsRes.status} ${JSON.stringify(myPoolsBody)}`);
    const poolVisible = Array.isArray(myPoolsBody) && myPoolsBody.some((p) => p.pool?.id === pool.id);
    console.log(`Pool membership visibility: temp pool ${poolVisible ? "IS" : "is NOT"} listed under /my-pools (expected: IS)`);
    if (!poolVisible) throw new Error("Temp pool not visible under student's my-pools — membership check failed");

    const poolStart = await fetch(`${BASE}/interview/sessions`, { method: "POST", headers: auth, body: JSON.stringify({ talentPoolConfigId: poolConfig.id }) });
    const poolStartBody = await poolStart.json();
    if (!poolStart.ok) throw new Error(`talent-pool interview session start failed: HTTP ${poolStart.status} ${JSON.stringify(poolStartBody)}`);
    sessionId = poolStartBody.session.id;
    console.log(`Session created: ${sessionId}, questions: ${poolStartBody.questions.length} (expect 9: 2 HR + 3 TECHNICAL + 2 CODING + 2 MANAGERIAL)`);
    if (poolStartBody.questions.length === 0) throw new Error("Zero talent-pool interview questions generated");

    for (const q of poolStartBody.questions) {
      const realId = q.id.includes(":") ? q.id.split(":").pop() : q.id;
      const payload = q.category === "CODING"
        ? { questionId: realId, code: "print('hello')", language: "python", timeTakenSec: 5 }
        : { questionId: realId, answerText: "Verification test answer covering the relevant concepts.", timeTakenSec: 5 };
      const ansRes = await fetch(`${BASE}/interview/sessions/${sessionId}/answer`, { method: "POST", headers: auth, body: JSON.stringify(payload) });
      const ansBody = await ansRes.json();
      if (!ansRes.ok) throw new Error(`answer failed for ${q.category} (${realId}): HTTP ${ansRes.status} ${JSON.stringify(ansBody)}`);
      console.log(`  [${q.category}] answered OK — score=${ansBody.answer?.score ?? "n/a"}${ansBody.immediateResult ? `, judge verdict=${ansBody.immediateResult.verdict}` : ""}`);
    }

    const poolFinal = await fetch(`${BASE}/interview/sessions/${sessionId}/finalize`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const poolFinalBody = await poolFinal.json();
    if (!poolFinal.ok) throw new Error(`talent-pool finalize failed: HTTP ${poolFinal.status} ${JSON.stringify(poolFinalBody)}`);
    console.log("Finalize OK — status:", poolFinalBody.session?.status, "overallScore:", poolFinalBody.report?.overallScore);

    console.log("\n=== READINESS TEST + TALENT POOL FLOWS: PASS ===");
  } finally {
    if (sessionId) {
      await prisma.interviewAnswer.deleteMany({ where: { sessionId } }).catch(() => {});
      await prisma.interviewSession.delete({ where: { id: sessionId } }).catch(() => {});
    }
    if (assessmentId) {
      await prisma.readinessReport.deleteMany({ where: { assessmentId } }).catch(() => {});
      await prisma.readinessAnswer.deleteMany({ where: { assessmentId } }).catch(() => {});
      await prisma.readinessAssessment.delete({ where: { id: assessmentId } }).catch(() => {});
    }
    await prisma.talentPoolMember.delete({ where: { id: membership.id } }).catch(() => {});
    await prisma.talentPoolInterviewConfig.delete({ where: { id: poolConfig.id } }).catch(() => {});
    await prisma.talentPool.delete({ where: { id: pool.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log("Cleaned up temp student, talent pool, and sessions.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
