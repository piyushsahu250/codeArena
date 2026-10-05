// One-off: real end-to-end verification of the Resume-Based and Company Round interview flows
// (siblings of the Full Mock flow verified in verifyFullMockInterviewFlow.js) against the live API
// on this instance, post-migration. No active CompanyInterviewProfile exists in production right
// now, so the Company Round exercises the flat HR(2)+Technical(3)+Coding(2)+Managerial(2) fallback
// branch — the only branch currently reachable. Creates one disposable STUDENT + Resume (random
// password, @example.invalid email) and deletes everything afterward.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

async function answerAll(auth, sessionId, questions, label) {
  console.log(`-- ${label}: ${questions.length} question(s) --`);
  for (const q of questions) {
    const realId = q.id.includes(":") ? q.id.split(":").pop() : q.id;
    let payload;
    if (q.category === "CODING") {
      payload = { questionId: realId, code: "print('hello from verification')", language: "python", timeTakenSec: 5 };
    } else if (q.category === "APTITUDE") {
      payload = { questionId: realId, answerText: "0", timeTakenSec: 3 };
    } else {
      payload = { questionId: realId, answerText: "Verification test answer covering the relevant concepts in enough detail.", timeTakenSec: 5 };
    }
    const ansRes = await fetch(`${BASE}/interview/sessions/${sessionId}/answer`, { method: "POST", headers: auth, body: JSON.stringify(payload) });
    const ansBody = await ansRes.json();
    if (!ansRes.ok) throw new Error(`answer failed for ${q.category} (${realId}): HTTP ${ansRes.status} ${JSON.stringify(ansBody)}`);
    console.log(`  [${q.category}] answered OK — score=${ansBody.answer?.score ?? "n/a"}${ansBody.immediateResult ? `, judge verdict=${ansBody.immediateResult.verdict}` : ""}`);
  }
}

async function finalize(auth, sessionId) {
  const finalRes = await fetch(`${BASE}/interview/sessions/${sessionId}/finalize`, { method: "POST", headers: auth, body: JSON.stringify({}) });
  const finalBody = await finalRes.json();
  if (!finalRes.ok) throw new Error(`finalize failed: HTTP ${finalRes.status} ${JSON.stringify(finalBody)}`);
  console.log("Finalize OK — status:", finalBody.session?.status, "overallScore:", finalBody.report?.overallScore);
}

async function cleanupSession(sessionId) {
  if (!sessionId) return;
  await prisma.interviewAnswer.deleteMany({ where: { sessionId } }).catch(() => {});
  await prisma.interviewSession.delete({ where: { id: sessionId } }).catch(() => {});
}

async function main() {
  const disabled = await prisma.featureSetting.findMany({ where: { featureKey: "ai_mock_interview", enabled: false }, select: { instituteId: true } });
  const disabledIds = disabled.map((d) => d.instituteId);
  const institute = await prisma.institute.findFirst({ where: { id: { notIn: disabledIds }, isActive: true } });
  if (!institute) throw new Error("No institute with ai_mock_interview enabled found");

  const email = `verify-resume-company-interview-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name: "Verify Resume Company Interview", email, passwordHash, role: "STUDENT", instituteId: institute.id, mustChangePassword: false },
  });
  console.log("Created temp student:", user.id, email);

  const resume = await prisma.resume.create({
    data: {
      studentId: user.id,
      fullName: "Verify Resume Company Interview",
      skills: [{ category: "Languages", name: "Java", proficiency: "Advanced" }, { category: "Languages", name: "Python", proficiency: "Intermediate" }],
      projects: [{ title: "Library Management System", description: "A CLI app to track book loans.", technologies: "Java, MySQL", role: "Solo developer" }],
      experience: [{ company: "Acme Corp", title: "Intern", employmentType: "Internship", responsibilities: "Built internal tooling", technologies: "Java" }],
    },
  });
  console.log("Created temp resume:", resume.id);

  let resumeSessionId = null, companySessionId = null;
  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };
    console.log("Login OK\n");

    // --- Resume-Based ---
    console.log("=== RESUME-BASED INTERVIEW ===");
    const rStart = await fetch(`${BASE}/interview/sessions`, { method: "POST", headers: auth, body: JSON.stringify({ isResumeBased: true, config: {} }) });
    const rBody = await rStart.json();
    if (!rStart.ok) throw new Error(`resume-based session start failed: HTTP ${rStart.status} ${JSON.stringify(rBody)}`);
    resumeSessionId = rBody.session.id;
    console.log(`Session created: ${resumeSessionId}, questions: ${rBody.questions.length} (expect up to 8, generated from skills/projects/experience)`);
    if (rBody.questions.length === 0) throw new Error("Zero resume-based questions generated");
    await answerAll(auth, resumeSessionId, rBody.questions, "resume-based");
    await finalize(auth, resumeSessionId);

    // --- Company Round ---
    console.log("\n=== COMPANY ROUND INTERVIEW ===");
    const cStart = await fetch(`${BASE}/interview/sessions`, { method: "POST", headers: auth, body: JSON.stringify({ isCompanyRound: true, config: { company: "Verification Test Co", role: "Software Engineer", difficulty: "MEDIUM", experienceLevel: "FRESHER" } }) });
    const cBody = await cStart.json();
    if (!cStart.ok) throw new Error(`company round session start failed: HTTP ${cStart.status} ${JSON.stringify(cBody)}`);
    companySessionId = cBody.session.id;
    console.log(`Session created: ${companySessionId}, questions: ${cBody.questions.length} (expect 9: 2 HR + 3 TECHNICAL + 2 CODING + 2 MANAGERIAL, flat fallback since no active CompanyInterviewProfile exists)`);
    if (cBody.questions.length === 0) throw new Error("Zero company-round questions generated");
    await answerAll(auth, companySessionId, cBody.questions, "company round");
    await finalize(auth, companySessionId);

    console.log("\n=== RESUME-BASED + COMPANY ROUND FLOWS: PASS ===");
  } finally {
    await cleanupSession(resumeSessionId);
    await cleanupSession(companySessionId);
    await prisma.resume.delete({ where: { id: resume.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log("Cleaned up temp student, resume, and sessions.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
