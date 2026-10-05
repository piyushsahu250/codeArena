// One-off: end-to-end Run + Submit verification of the REAL "TCS Codevita 9" test's exact 5
// questions, via a disposable, temporary Test (published, no real students assigned) so the real
// "TCS Codevita 9" test's own Draft/publish state is never touched. Exercises the actual
// submissions.js pipeline (compile, execute, judge, score) a real student attempt would use.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";
const REAL_TEST_ID = "1a429557-590d-4f08-8851-351826f88574";

// Solutions attempted in good faith against each problem's real statement/constraints. Confidence
// noted per-question -- a WRONG_ANSWER verdict here still proves the pipeline (compile/execute/
// judge/score) works; it does not by itself prove the question's own content is wrong.
const SOLUTIONS = {
  "String Pair": { // sum digits of each number in the array; parity/value -> word; "greater 100" if sum>100
    language: "python",
    code: `n = int(input())
a = list(map(int, input().split()))
WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten"]
total = sum(sum(int(d) for d in str(x)) for x in a)
if total > 100:
    print("greater 100")
elif total <= 10:
    print(WORDS[total])
else:
    print(total)
`,
  },
  "Moving Average": { // count crossovers between short(X)-day and long(Y)-day moving averages
    language: "python",
    code: `x, y = map(int, input().split())
n = int(input())
p = list(map(float, input().split()))
def ma(k, i):
    return sum(p[i-k+1:i+1]) / k
count = 0
prev = None
for i in range(y-1, n):
    diff = ma(x, i) - ma(y, i)
    sign = 1 if diff > 0 else (-1 if diff < 0 else 0)
    if prev is not None and sign != 0 and prev != 0 and sign != prev:
        count += 1
    if sign != 0:
        prev = sign
print(count)
`,
  },
};

async function main() {
  const questions = await prisma.question.findMany({
    where: { id: { in: ["cb986cbd-dbdd-4695-9bcf-785e8530e135", "0f73ace1-aa5c-4f57-aa0c-53957bf28be2", "a85117bd-8737-47c0-8cc4-e676f6024062", "9c5308bd-fa02-48fe-a6a0-01428f0f1434", "01d04300-701f-4d96-bcbb-59741242db3d"] } },
  });
  const institute = await prisma.institute.findFirst({ where: { name: { contains: "Sanjivani", mode: "insensitive" } } });
  const admin = await prisma.user.findFirst({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } } });

  const email = `verify-tcs-e2e-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const student = await prisma.user.create({
    data: { name: "Verify TCS E2E", email, passwordHash: await bcrypt.hash(password, 10), role: "STUDENT", instituteId: institute.id, mustChangePassword: false },
  });

  const now = Date.now();
  const tempTest = await prisma.test.create({
    data: {
      title: `Verify TCS Codevita 9 E2E ${now}`, durationMin: 60, passingMarks: 0, showResults: true,
      startTime: new Date(now - 60_000), endTime: new Date(now + 60 * 60_000), isPublished: true,
      requireFullscreen: false, createdById: admin.id, instituteId: null,
      questions: { create: questions.map((q, i) => ({ questionId: q.id, order: i })) },
    },
  });
  console.log("Created temp test:", tempTest.id, "(disposable -- real 'TCS Codevita 9' test's Draft state untouched)\n");

  let attemptId = null;
  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: ${JSON.stringify(loginBody)}`);
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };

    const startRes = await fetch(`${BASE}/tests/${tempTest.id}/start`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const startBody = await startRes.json();
    if (!startRes.ok) throw new Error(`start failed: ${JSON.stringify(startBody)}`);
    attemptId = startBody.id;
    console.log("Attempt started:", attemptId, "\n");

    for (const q of questions) {
      const sol = SOLUTIONS[q.title];
      const startedAt = Date.now();
      if (sol) {
        const runRes = await fetch(`${BASE}/submissions/run`, { method: "POST", headers: auth, body: JSON.stringify({ attemptId, questionId: q.id, language: sol.language, code: sol.code }) });
        const runBody = await runRes.json();
        const runMs = Date.now() - startedAt;
        console.log(`[RUN]    "${q.title}" (${runMs}ms) — verdict=${runBody.verdict || runBody.error}`);

        const subStart = Date.now();
        const subRes = await fetch(`${BASE}/submissions/submit-code`, { method: "POST", headers: auth, body: JSON.stringify({ attemptId, questionId: q.id, language: sol.language, code: sol.code }) });
        const subBody = await subRes.json();
        const subMs = Date.now() - subStart;
        console.log(`[SUBMIT] "${q.title}" (${subMs}ms) — verdict=${subBody.verdict || subBody.error}, passed=${subBody.passedCases}/${subBody.totalCases}, time=${subBody.timeMs}ms mem=${subBody.memoryKb}KB\n`);
      } else {
        // No attempted solution for this one (complex simulation, higher risk of a hand-solved
        // bug under time pressure) -- still prove the pipeline itself (compile/execute/judge)
        // works by submitting the question's OWN unmodified starter code, which will compile and
        // run (producing a real, honest WRONG_ANSWER/empty-output verdict, not an error) --
        // proves infra health without claiming a false content-correctness result.
        const starter = q.starterCodeByLanguage?.python || "pass";
        const subStart = Date.now();
        const subRes = await fetch(`${BASE}/submissions/submit-code`, { method: "POST", headers: auth, body: JSON.stringify({ attemptId, questionId: q.id, language: "python", code: starter }) });
        const subBody = await subRes.json();
        const subMs = Date.now() - subStart;
        console.log(`[SUBMIT-STARTER-ONLY] "${q.title}" (${subMs}ms) — verdict=${subBody.verdict || subBody.error} (pipeline-health check only, not a content-correctness claim)\n`);
      }
    }

    const finalRes = await fetch(`${BASE}/submissions/finalize/${attemptId}`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    const finalBody = await finalRes.json();
    console.log("Finalize:", finalRes.ok ? `OK — totalScore=${finalBody.totalScore}` : JSON.stringify(finalBody));
  } finally {
    if (attemptId) {
      await prisma.submission.deleteMany({ where: { attemptId } }).catch(() => {});
      await prisma.testAttempt.delete({ where: { id: attemptId } }).catch(() => {});
    }
    await prisma.testQuestion.deleteMany({ where: { testId: tempTest.id } }).catch(() => {});
    await prisma.test.delete({ where: { id: tempTest.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: student.id } }).catch(() => {});
    console.log("\nCleaned up temp test/attempt/student.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
