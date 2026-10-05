// One-off: real end-to-end verification of the "Full Mock Interview" flow (isMock: true — HR 3 +
// Technical 3 + Coding 2) against the live API on this instance, post-migration. Exercises the
// exact path that previously got stuck on "Loading the next question..." — create session, answer
// every question (including a real CODING answer through the judge), confirm the session
// finalizes with a report. Creates one disposable STUDENT (random password, @example.invalid
// email) and deletes it plus the session afterward.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

async function main() {
  const disabled = await prisma.featureSetting.findMany({ where: { featureKey: "ai_mock_interview", enabled: false }, select: { instituteId: true } });
  const disabledIds = disabled.map((d) => d.instituteId);
  const institute = await prisma.institute.findFirst({ where: { id: { notIn: disabledIds }, isActive: true } });
  if (!institute) throw new Error("No institute with ai_mock_interview enabled found to attach the temp student to");

  const email = `verify-mock-interview-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name: "Verify Mock Interview", email, passwordHash, role: "STUDENT", instituteId: institute.id, mustChangePassword: false },
  });
  console.log("Created temp student:", user.id, email);

  let sessionId = null;
  try {
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
    const token = loginBody.token;
    console.log("Login OK, token acquired");
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const startRes = await fetch(`${BASE}/interview/sessions`, {
      method: "POST", headers: auth, body: JSON.stringify({ isMock: true, config: { difficulty: "MEDIUM" } }),
    });
    const startBody = await startRes.json();
    if (!startRes.ok) throw new Error(`session start failed: HTTP ${startRes.status} ${JSON.stringify(startBody)}`);
    sessionId = startBody.session.id;
    const questions = startBody.questions;
    console.log(`Session created: ${sessionId}, questions: ${questions.length} (expect 8: 3 HR + 3 TECHNICAL + 2 CODING)`);
    if (questions.length === 0) throw new Error("Zero questions returned — mock interview question bank may be empty on this instance");

    for (const q of questions) {
      const realId = q.id.includes(":") ? q.id.split(":").pop() : q.id;
      let payload;
      if (q.category === "CODING") {
        payload = { questionId: realId, code: "print('hello from verification')", language: "python", timeTakenSec: 5 };
      } else if (q.category === "APTITUDE") {
        payload = { questionId: realId, answerText: "0", timeTakenSec: 3 };
      } else {
        payload = { questionId: realId, answerText: "This is a verification test answer covering the relevant concepts.", timeTakenSec: 5 };
      }
      const ansRes = await fetch(`${BASE}/interview/sessions/${sessionId}/answer`, { method: "POST", headers: auth, body: JSON.stringify(payload) });
      const ansBody = await ansRes.json();
      if (!ansRes.ok) throw new Error(`answer failed for ${q.category} (${realId}): HTTP ${ansRes.status} ${JSON.stringify(ansBody)}`);
      console.log(`  [${q.category}] answered OK — score=${ansBody.answer?.score ?? "n/a"}${ansBody.immediateResult ? `, judge verdict=${ansBody.immediateResult.verdict}` : ""}`);
    }

    const finalRes = await fetch(`${BASE}/interview/sessions/${sessionId}/finalize`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const finalBody = await finalRes.json();
    if (!finalRes.ok) throw new Error(`finalize failed: HTTP ${finalRes.status} ${JSON.stringify(finalBody)}`);
    console.log("Finalize OK — status:", finalBody.session?.status, "overallScore:", finalBody.report?.overallScore);

    console.log("\n=== FULL MOCK INTERVIEW FLOW: PASS ===");
  } finally {
    if (sessionId) {
      await prisma.interviewAnswer.deleteMany({ where: { sessionId } }).catch(() => {});
      await prisma.interviewSession.delete({ where: { id: sessionId } }).catch(() => {});
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log("Cleaned up temp student and session.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
