// One-off: verify the TCS Company Round content-gap fix actually resolved the fallback banner,
// and that the two new CODING questions' test cases are genuinely correct (submit real, correct
// solutions and confirm ACCEPTED, not just check structure). Creates one disposable STUDENT
// (random password, @example.invalid email); deletes it and the session afterward. Does NOT touch
// the 6 real InterviewQuestion rows added by addTcsInterviewQuestions.js.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

const CORRECT_SOLUTIONS = {
  "Palindrome Check": {
    language: "python",
    code: "s = input().strip().lower()\nprint('YES' if s == s[::-1] else 'NO')",
  },
  "Second Largest Element": {
    language: "python",
    code: "n = int(input())\na = list(map(int, input().split()))\nd = sorted(set(a), reverse=True)\nprint(d[1] if len(d) > 1 else -1)",
  },
};

async function main() {
  const disabled = await prisma.featureSetting.findMany({ where: { featureKey: "ai_mock_interview", enabled: false }, select: { instituteId: true } });
  const disabledIds = disabled.map((d) => d.instituteId);
  const institute = await prisma.institute.findFirst({ where: { id: { notIn: disabledIds }, isActive: true } });

  const email = `verify-tcs-company-round-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const user = await prisma.user.create({
    data: { name: "Verify TCS Company Round", email, passwordHash: await bcrypt.hash(password, 10), role: "STUDENT", instituteId: institute.id, mustChangePassword: false },
  });
  console.log("Created temp student:", user.id);

  let sessionId = null;
  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };

    const startRes = await fetch(`${BASE}/interview/sessions`, {
      method: "POST", headers: auth, body: JSON.stringify({ isCompanyRound: true, config: { company: "TCS", difficulty: "EASY", experienceLevel: "FRESHER" } }),
    });
    const startBody = await startRes.json();
    if (!startRes.ok) throw new Error(`session start failed: HTTP ${startRes.status} ${JSON.stringify(startBody)}`);
    sessionId = startBody.session.id;
    const fallback = startBody.session.config?.generalFallbackCategories || [];
    console.log(`Session created: ${sessionId}, questions: ${startBody.questions.length}`);
    console.log(`generalFallbackCategories: ${JSON.stringify(fallback)} (expected: [])`);
    if (fallback.length > 0) throw new Error(`FALLBACK BANNER STILL TRIGGERS for: ${fallback.join(", ")}`);

    for (const q of startBody.questions) {
      const realId = q.id.includes(":") ? q.id.split(":").pop() : q.id;
      if (q.category === "CODING") {
        const sol = CORRECT_SOLUTIONS[q.title];
        if (!sol) throw new Error(`No known-correct solution mapped for coding question title "${q.title}"`);
        const ansRes = await fetch(`${BASE}/interview/sessions/${sessionId}/answer`, { method: "POST", headers: auth, body: JSON.stringify({ questionId: realId, code: sol.code, language: sol.language, timeTakenSec: 5 }) });
        const ansBody = await ansRes.json();
        if (!ansRes.ok) throw new Error(`answer failed for CODING "${q.title}": HTTP ${ansRes.status} ${JSON.stringify(ansBody)}`);
        const verdict = ansBody.immediateResult?.verdict;
        console.log(`  [CODING] "${q.title}" — verdict=${verdict}, score=${ansBody.answer?.score} (expected: ACCEPTED)`);
        if (verdict !== "ACCEPTED") throw new Error(`Correct solution for "${q.title}" did NOT get ACCEPTED — verdict=${verdict}, details=${JSON.stringify(ansBody.immediateResult)}`);
      } else {
        const ansRes = await fetch(`${BASE}/interview/sessions/${sessionId}/answer`, { method: "POST", headers: auth, body: JSON.stringify({ questionId: realId, answerText: "A thoughtful, complete answer covering the relevant concepts in detail.", timeTakenSec: 5 }) });
        const ansBody = await ansRes.json();
        if (!ansRes.ok) throw new Error(`answer failed for ${q.category}: HTTP ${ansRes.status} ${JSON.stringify(ansBody)}`);
        console.log(`  [${q.category}] answered OK — score=${ansBody.answer?.score}`);
      }
    }

    const finalRes = await fetch(`${BASE}/interview/sessions/${sessionId}/finalize`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const finalBody = await finalRes.json();
    if (!finalRes.ok) throw new Error(`finalize failed: HTTP ${finalRes.status} ${JSON.stringify(finalBody)}`);
    console.log("Finalize OK — overallScore:", finalBody.report?.overallScore);

    console.log("\n=== TCS COMPANY ROUND FIX: VERIFIED ===");
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
