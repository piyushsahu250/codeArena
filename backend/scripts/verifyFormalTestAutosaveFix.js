// Real-HTTP verification that the identical codeSavedSeq INT4-overflow bug fix also applies
// cleanly to the Formal Test system (submissions.js's /autosave, tests.js's resume + my-result
// routes) — same root cause, same fix, verified independently since it's a separate route file.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");
const API_BASE = process.env.HEALTH_CHECK_API_BASE || "http://127.0.0.1:4000/api";
let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { console.log(`  [PASS] ${label}`); pass++; }
  else { console.log(`  [FAIL] ${label}${detail ? ` (${detail})` : ""}`); fail++; }
}
async function j(res) { try { return await res.json(); } catch { return null; } }

async function main() {
  let testId, questionId, userId, jti;
  try {
    const institute = await prisma.institute.findFirst({ select: { id: true } });
    const email = `formaltest-autosave-check-${Date.now()}@example.invalid`;
    const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
    const user = await prisma.user.create({ data: { name: "Autosave Check Student", email, passwordHash, role: "STUDENT", instituteId: institute?.id || null } });
    userId = user.id;
    const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
    jti = jwt.decode(token).jti;
    const headers = { "content-type": "application/json", Authorization: `Bearer ${token}` };

    const question = await prisma.question.create({
      data: {
        title: "Autosave Check Q", description: "Return the sum of two integers.", questionType: "CODING", difficulty: "EASY", points: 10,
        testCases: { create: [{ input: "2 3", expected: "5", isHidden: false }] },
      },
    });
    questionId = question.id;
    const test = await prisma.test.create({
      data: {
        title: "Autosave Check Test", durationMin: 30, startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 3_600_000),
        createdById: user.id, questions: { create: [{ questionId, order: 0 }] },
      },
    });
    testId = test.id;

    console.log("=== Formal Test: start (creates attempt) ===");
    const startRes = await fetch(`${API_BASE}/tests/${testId}/start`, { method: "POST", headers });
    const startBody = await j(startRes);
    check("Start succeeds (200)", startRes.status === 200, `got ${startRes.status}: ${JSON.stringify(startBody)}`);
    check("Resume response's submissions array is present and empty (no crash)", Array.isArray(startBody?.submissions) && startBody.submissions.length === 0, JSON.stringify(startBody?.submissions));

    console.log("\n=== Formal Test: autosave with a real Date.now() seq (the exact overflow case) ===");
    const autosaveRes = await fetch(`${API_BASE}/submissions/autosave`, {
      method: "POST", headers,
      body: JSON.stringify({ attemptId: startBody.attemptId, questionId, language: "python", code: "a,b=map(int,input().split())\nprint(a+b)", seq: Date.now() }),
    });
    check("Autosave succeeds (200, not the INT4-overflow 500)", autosaveRes.status === 200, `got ${autosaveRes.status}: ${JSON.stringify(await j(autosaveRes))}`);

    const rawSubmission = await prisma.submission.findUnique({ where: { attemptId_questionId: { attemptId: startBody.attemptId, questionId } } });
    check("codeSavedSeq stored as a real BigInt matching Date.now()'s magnitude", typeof rawSubmission?.codeSavedSeq === "bigint" && rawSubmission.codeSavedSeq > 1_000_000_000_000n, String(rawSubmission?.codeSavedSeq));

    console.log("\n=== Formal Test: resume (start again) returns the autosaved code, no crash, no codeSavedSeq leak ===");
    const resumeRes = await fetch(`${API_BASE}/tests/${testId}/start`, { method: "POST", headers });
    const resumeBody = await j(resumeRes);
    check("Resume succeeds (200)", resumeRes.status === 200, `got ${resumeRes.status}`);
    const restoredSub = resumeBody?.submissions?.find((s) => s.questionId === questionId);
    check("Resume includes the autosaved submission", !!restoredSub, JSON.stringify(resumeBody?.submissions));
    check("Resume response never leaks codeSavedSeq", restoredSub && !("codeSavedSeq" in restoredSub), JSON.stringify(restoredSub));

    console.log("\n=== Formal Test: submit-code (explicit) + my-result never leaks codeSavedSeq ===");
    await fetch(`${API_BASE}/submissions/submit-code`, { method: "POST", headers, body: JSON.stringify({ attemptId: startBody.attemptId, questionId, language: "python", code: "a,b=map(int,input().split())\nprint(a+b)" }) });
    const finalizeRes = await fetch(`${API_BASE}/submissions/finalize/${startBody.attemptId}`, { method: "POST", headers, body: JSON.stringify({}) });
    check("Manual finalize succeeds (200)", finalizeRes.status === 200, `got ${finalizeRes.status}: ${JSON.stringify(await j(finalizeRes))}`);
    const myResultRes = await fetch(`${API_BASE}/tests/${testId}/my-result`, { headers });
    const myResultBody = await j(myResultRes);
    check("my-result succeeds (200, not a BigInt-serialization crash)", myResultRes.status === 200, `got ${myResultRes.status}: ${JSON.stringify(myResultBody)}`);
    const resultSub = myResultBody?.submissions?.find((s) => s.questionId === questionId);
    check("my-result never leaks codeSavedSeq", resultSub && !("codeSavedSeq" in resultSub), JSON.stringify(resultSub));
  } catch (e) {
    console.error("Script error:", e);
    fail++;
  } finally {
    if (testId) {
      await prisma.submission.deleteMany({ where: { attempt: { testId } } }).catch(() => {});
      await prisma.testAttempt.deleteMany({ where: { testId } }).catch(() => {});
      await prisma.testQuestion.deleteMany({ where: { testId } }).catch(() => {});
      await prisma.test.delete({ where: { id: testId } }).catch(() => {});
    }
    if (questionId) { await prisma.testCase.deleteMany({ where: { questionId } }).catch(() => {}); await prisma.question.delete({ where: { id: questionId } }).catch(() => {}); }
    if (jti) await prisma.loginSession.deleteMany({ where: { token: jti } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
