// One-off: verify the TCS Medium and Hard tiers are now complete — no fallback banner, and the
// 4 new coding questions' test cases actually accept a genuinely correct solution (not just
// structurally present). Creates one disposable STUDENT per tier tested; deletes it and the
// session afterward. Does NOT touch the real InterviewQuestion rows.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

const CORRECT_SOLUTIONS = {
  "Longest Word in a Sentence": {
    language: "python",
    code: "words = input().split()\nbest = words[0]\nfor w in words[1:]:\n    if len(w) > len(best):\n        best = w\nprint(best)",
  },
  "Matrix Row Sum Maximum": {
    language: "python",
    code: "n, m = map(int, input().split())\nbest_idx, best_sum = 0, None\nfor i in range(n):\n    row = list(map(int, input().split()))\n    s = sum(row)\n    if best_sum is None or s > best_sum:\n        best_sum, best_idx = s, i\nprint(best_idx)",
  },
  "Longest Increasing Subsequence Length": {
    language: "python",
    code: "n = int(input())\na = list(map(int, input().split()))\ndp = [1] * n\nfor i in range(n):\n    for j in range(i):\n        if a[j] < a[i] and dp[j] + 1 > dp[i]:\n            dp[i] = dp[j] + 1\nprint(max(dp) if dp else 0)",
  },
  "Minimum Coins for Amount": {
    language: "python",
    code: "n, amount = map(int, input().split())\ncoins = list(map(int, input().split()))\nINF = float('inf')\ndp = [0] + [INF] * amount\nfor x in range(1, amount + 1):\n    for c in coins:\n        if c <= x and dp[x - c] + 1 < dp[x]:\n            dp[x] = dp[x - c] + 1\nprint(dp[amount] if dp[amount] != INF else -1)",
  },
};

async function testTier(difficulty) {
  const disabled = await prisma.featureSetting.findMany({ where: { featureKey: "ai_mock_interview", enabled: false }, select: { instituteId: true } });
  const disabledIds = disabled.map((d) => d.instituteId);
  const institute = await prisma.institute.findFirst({ where: { id: { notIn: disabledIds }, isActive: true } });

  const email = `verify-tcs-${difficulty.toLowerCase()}-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const user = await prisma.user.create({
    data: { name: `Verify TCS ${difficulty}`, email, passwordHash: await bcrypt.hash(password, 10), role: "STUDENT", instituteId: institute.id, mustChangePassword: false },
  });

  let sessionId = null;
  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };

    const startRes = await fetch(`${BASE}/interview/sessions`, {
      method: "POST", headers: auth, body: JSON.stringify({ isCompanyRound: true, config: { company: "TCS", difficulty, experienceLevel: "FRESHER" } }),
    });
    const startBody = await startRes.json();
    if (!startRes.ok) throw new Error(`[${difficulty}] session start failed: HTTP ${startRes.status} ${JSON.stringify(startBody)}`);
    sessionId = startBody.session.id;
    const fallback = startBody.session.config?.generalFallbackCategories || [];
    console.log(`[${difficulty}] Session created: ${sessionId}, questions: ${startBody.questions.length}, generalFallbackCategories: ${JSON.stringify(fallback)} (expected: [])`);
    if (fallback.length > 0) throw new Error(`[${difficulty}] FALLBACK STILL TRIGGERS for: ${fallback.join(", ")}`);

    for (const q of startBody.questions) {
      const realId = q.id.includes(":") ? q.id.split(":").pop() : q.id;
      if (q.category === "CODING") {
        const sol = CORRECT_SOLUTIONS[q.title];
        if (!sol) throw new Error(`[${difficulty}] No known-correct solution mapped for "${q.title}"`);
        const ansRes = await fetch(`${BASE}/interview/sessions/${sessionId}/answer`, { method: "POST", headers: auth, body: JSON.stringify({ questionId: realId, code: sol.code, language: sol.language, timeTakenSec: 5 }) });
        const ansBody = await ansRes.json();
        if (!ansRes.ok) throw new Error(`[${difficulty}] answer failed for CODING "${q.title}": HTTP ${ansRes.status} ${JSON.stringify(ansBody)}`);
        const verdict = ansBody.immediateResult?.verdict;
        console.log(`  [${difficulty}/CODING] "${q.title}" — verdict=${verdict}, score=${ansBody.answer?.score} (expected: ACCEPTED)`);
        if (verdict !== "ACCEPTED") throw new Error(`[${difficulty}] Correct solution for "${q.title}" did NOT get ACCEPTED — verdict=${verdict}, details=${JSON.stringify(ansBody.immediateResult)}`);
      } else {
        const ansRes = await fetch(`${BASE}/interview/sessions/${sessionId}/answer`, { method: "POST", headers: auth, body: JSON.stringify({ questionId: realId, answerText: "A thoughtful, complete answer covering the relevant concepts.", timeTakenSec: 5 }) });
        const ansBody = await ansRes.json();
        if (!ansRes.ok) throw new Error(`[${difficulty}] answer failed for ${q.category}: HTTP ${ansRes.status} ${JSON.stringify(ansBody)}`);
      }
    }

    const finalRes = await fetch(`${BASE}/interview/sessions/${sessionId}/finalize`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const finalBody = await finalRes.json();
    if (!finalRes.ok) throw new Error(`[${difficulty}] finalize failed: HTTP ${finalRes.status} ${JSON.stringify(finalBody)}`);
    console.log(`[${difficulty}] Finalize OK — overallScore: ${finalBody.report?.overallScore}`);
  } finally {
    if (sessionId) {
      await prisma.interviewAnswer.deleteMany({ where: { sessionId } }).catch(() => {});
      await prisma.interviewSession.delete({ where: { id: sessionId } }).catch(() => {});
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
}

async function main() {
  await testTier("MEDIUM");
  await testTier("HARD");
  console.log("\n=== TCS MEDIUM + HARD FIX: VERIFIED ===");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
