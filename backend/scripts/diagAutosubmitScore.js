// Standalone diagnostic (no cleanup) for the score=0 finding in verifyModuleCodingAutosubmit.js.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");
const API_BASE = "http://127.0.0.1:4000/api";
async function j(res) { try { return await res.json(); } catch { return null; } }

async function main() {
  const institute = await prisma.institute.findFirst({ select: { id: true } });
  const email = `diag-autosubmit-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  const user = await prisma.user.create({ data: { name: "Diag Student", email, passwordHash, role: "STUDENT", instituteId: institute?.id || null } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const headers = { "content-type": "application/json", Authorization: `Bearer ${token}` };

  const course = await prisma.course.create({ data: { slug: `diag-${Date.now()}`, name: "Diag Course", status: "DRAFT" } });
  const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: "Diag Module" } });
  const lesson = await prisma.lesson.create({ data: { moduleId: mod.id, title: "Diag Lesson", content: "x", order: 0 } });
  await prisma.lessonProgress.create({ data: { studentId: user.id, lessonId: lesson.id, status: "COMPLETED", completedAt: new Date() } });
  const question = await prisma.question.create({
    data: { title: "Diag Q", description: "sum", questionType: "CODING", difficulty: "EASY", points: 10,
      testCases: { create: [{ input: "2 3", expected: "5", isHidden: false }, { input: "10 20", expected: "30", isHidden: true }] } },
  });
  const test = await prisma.moduleCodingTest.create({ data: { moduleId: mod.id, title: "Diag Test", questionCount: 1, timeLimitMin: 1, passingPercent: 50, maxAttempts: null, requireFullscreen: false, allowedLanguages: ["python"] } });
  await prisma.question.update({ where: { id: question.id }, data: { moduleCodingTestId: test.id } });

  const startRes = await fetch(`${API_BASE}/module-coding/module/${mod.id}/start`, { method: "POST", headers });
  const startBody = await j(startRes);
  console.log("START:", startRes.status, JSON.stringify(startBody));

  const code = "a,b=map(int,input().split())\nprint(a+b)";
  const autosaveRes = await fetch(`${API_BASE}/module-coding/attempts/${startBody.attemptId}/autosave`, { method: "POST", headers, body: JSON.stringify({ questionId: question.id, language: "python", code, seq: Date.now() }) });
  console.log("AUTOSAVE:", autosaveRes.status, JSON.stringify(await j(autosaveRes)));

  const subAfterAutosave = await prisma.moduleCodingSubmission.findUnique({ where: { attemptId_questionId: { attemptId: startBody.attemptId, questionId: question.id } } });
  console.log("SUBMISSION ROW AFTER AUTOSAVE:", JSON.stringify(subAfterAutosave));

  // Also try a direct /run to see if the judge itself handles this code+language correctly.
  const runRes = await fetch(`${API_BASE}/module-coding/attempts/${startBody.attemptId}/run`, { method: "POST", headers, body: JSON.stringify({ questionId: question.id, language: "python", code }) });
  console.log("RUN RESULT:", runRes.status, JSON.stringify(await j(runRes)));

  await prisma.moduleCodingAttempt.update({ where: { id: startBody.attemptId }, data: { startedAt: new Date(Date.now() - 2 * 60 * 1000) } });
  const finalizeRes = await fetch(`${API_BASE}/module-coding/attempts/${startBody.attemptId}/finalize`, { method: "POST", headers, body: JSON.stringify({ reason: "TIME_EXPIRED" }) });
  console.log("FINALIZE:", finalizeRes.status, JSON.stringify(await j(finalizeRes)));

  const subAfterFinalize = await prisma.moduleCodingSubmission.findUnique({ where: { attemptId_questionId: { attemptId: startBody.attemptId, questionId: question.id } } });
  console.log("SUBMISSION ROW AFTER FINALIZE:", JSON.stringify(subAfterFinalize));

  console.log("\nDIAG_IDS", JSON.stringify({ userId: user.id, courseId: course.id, moduleId: mod.id, lessonId: lesson.id, questionId: question.id, testId: test.id, attemptId: startBody.attemptId }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
