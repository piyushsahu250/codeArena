const prisma = require("../prisma");
const { judgeSubmission } = require("./judge");
const { runQueued } = require("./queue");
const { issueCertificate } = require("./certificates");

// Grades one ModuleCodingSubmission row against its question's hidden test cases (falling back to
// the full case set for a legacy question predating the admin CMS's >=2-hidden-cases requirement)
// and writes the result back onto that row. Shared by the explicit per-question Submit button
// (routes/moduleCoding.js) and the bulk end-of-attempt grading pass below.
async function gradeOneModuleCodingSubmission(sub, question) {
  const hiddenCases = question.testCases.filter((tc) => tc.isHidden);
  const gradingCases = hiddenCases.length > 0 ? hiddenCases : question.testCases;
  const result = await runQueued(() =>
    judgeSubmission({
      language: sub.language, code: sub.code, testCases: gradingCases, timeLimitMs: question.timeLimitMs,
      memoryLimitKb: question.memoryLimitKb || undefined, evaluationType: question.evaluationType, functionSignature: question.functionSignature,
    })
  );
  await prisma.moduleCodingSubmission.update({
    where: { id: sub.id },
    data: {
      passedCases: result.passedCases, totalCases: result.totalCases, verdict: result.verdict,
      timeMs: result.maxTimeMs ?? null, memoryKb: result.maxMemoryKb ?? null,
    },
  });
  return result;
}

// Grades every still-PENDING coding submission for a module-coding attempt (a question the
// candidate never explicitly clicked Submit for — they're allowed to skip around) against its
// HIDDEN test cases, then finalizes the whole attempt: computes the overall score as a simple
// average of per-question pass percentage (these questions don't carry a points field the way
// exam Questions do), marks it SUBMITTED/AUTO_SUBMITTED, and records pass/fail against the
// test's passing percent. A question the student never touched (no submission row at all) counts
// as 0% — still included in the denominator, so skipping questions can't inflate the average.
// Idempotent on the grading half: safe to call on an attempt with nothing pending.
async function gradeModuleCodingAttempt(attemptId, { reason } = {}) {
  const attempt = await prisma.moduleCodingAttempt.findUnique({
    where: { id: attemptId },
    include: {
      moduleCodingTest: { include: { module: { include: { course: true } } } },
      questions: { include: { question: { include: { testCases: true } } } },
      submissions: true,
      student: { include: { institute: true } },
    },
  });
  if (!attempt) return null;

  const submissionByQuestion = new Map(attempt.submissions.map((s) => [s.questionId, s]));

  await Promise.all(
    attempt.questions.map(async ({ question }) => {
      const sub = submissionByQuestion.get(question.id);
      if (!sub || sub.verdict !== "PENDING") return;
      await gradeOneModuleCodingSubmission(sub, question);
    })
  );

  const freshSubmissions = await prisma.moduleCodingSubmission.findMany({ where: { attemptId } });
  const submissionByQuestion2 = new Map(freshSubmissions.map((s) => [s.questionId, s]));

  const totalQuestions = attempt.questions.length;
  let sumPercent = 0;
  // Per-question detail for the post-submit result view — never includes hidden test case
  // input/expected/actual, just the aggregate counts/score/perf already safe to show (same
  // shape the student's own Run button already exposes for visible cases).
  const questionBreakdown = [];
  attempt.questions.forEach(({ question, order }, idx) => {
    const sub = submissionByQuestion2.get(question.id);
    const percent = sub && sub.totalCases > 0 ? Math.round((sub.passedCases / sub.totalCases) * 100) : 0;
    if (sub && sub.totalCases > 0) sumPercent += percent;
    questionBreakdown.push({
      questionId: question.id,
      order: order ?? idx,
      title: question.title || `Question ${idx + 1}`,
      passedCases: sub?.passedCases ?? 0,
      totalCases: sub?.totalCases ?? 0,
      score: percent,
      verdict: sub?.verdict ?? "PENDING",
      timeMs: sub?.timeMs ?? null,
      memoryKb: sub?.memoryKb ?? null,
    });
  });
  const score = totalQuestions > 0 ? Math.round(sumPercent / totalQuestions) : 0;
  const passed = score >= attempt.moduleCodingTest.passingPercent;

  const updated = await prisma.moduleCodingAttempt.update({
    where: { id: attemptId },
    data: {
      status: reason ? "AUTO_SUBMITTED" : "SUBMITTED",
      score,
      passed,
      submittedAt: new Date(),
      autoSubmitReason: reason || null,
    },
  });

  // Auto-issue ONE CODING_ASSESSMENT certificate per student per COURSE, once every module in the
  // course that has an active coding test has been passed — not one certificate per module (that
  // used to flood a student with a separate certificate for every module they passed; a student
  // finishing all of "Java"'s coding assessments should get a single course-wide certificate, the
  // same way LEARNING_MODULE certificates already work for lesson completion). Idempotency is the
  // studentId+courseId+type DB unique constraint (see schema.prisma's Certificate model) — a
  // second issueCertificate() call for the same course is a no-op via the findUnique check below,
  // and a pass is permanent per this platform's "no downgrade on retake" convention, so this only
  // ever needs to fire once.
  if (passed) {
    const course = attempt.moduleCodingTest.module?.course;
    if (course) {
      const gatedModules = await prisma.courseModule.findMany({
        where: { courseId: course.id, codingTest: { isActive: true } },
        select: { codingTest: { select: { id: true } } },
      });
      const testIds = gatedModules.map((m) => m.codingTest.id);
      const passedTestIds = new Set(
        (
          await prisma.moduleCodingAttempt.findMany({
            where: { studentId: attempt.studentId, moduleCodingTestId: { in: testIds }, passed: true },
            select: { moduleCodingTestId: true },
            distinct: ["moduleCodingTestId"],
          })
        ).map((a) => a.moduleCodingTestId)
      );
      const allModulesPassed = testIds.length > 0 && testIds.every((id) => passedTestIds.has(id));

      if (allModulesPassed) {
        const already = await prisma.certificate.findUnique({
          where: { studentId_courseId_type: { studentId: attempt.studentId, courseId: course.id, type: "CODING_ASSESSMENT" } },
        });
        if (!already) {
          await issueCertificate({
            type: "CODING_ASSESSMENT",
            studentId: attempt.studentId,
            courseId: course.id,
            title: `${course.name} Coding Assessment`,
            instituteCode: attempt.student.institute?.code,
            programCode: course.slug,
          }).catch((err) => console.error("Coding-assessment certificate issuance failed:", err));
        }
      }
    }
  }

  return { ...updated, questionBreakdown };
}

module.exports = { gradeModuleCodingAttempt, gradeOneModuleCodingSubmission };
