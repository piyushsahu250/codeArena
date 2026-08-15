const prisma = require("../prisma");
const { judgeSubmission } = require("./judge");
const { runQueued } = require("./queue");
const { issueCertificate } = require("./certificates");
const { getCertificateGatingTestIds } = require("./gatingLevels");

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
  const score = result.totalCases > 0 ? Math.round((result.passedCases / result.totalCases) * 100) : 0;
  await prisma.moduleCodingSubmission.update({
    where: { id: sub.id },
    data: {
      passedCases: result.passedCases, totalCases: result.totalCases, verdict: result.verdict, score,
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
      moduleCodingTest: {
        include: {
          module: { include: { course: true } },
          chapter: { include: { module: { include: { course: true } } } },
        },
      },
      questions: { include: { question: { include: { testCases: true } } } },
      submissions: true,
      student: { include: { institute: true } },
    },
  });
  if (!attempt) return null;

  const submissionByQuestion = new Map(attempt.submissions.map((s) => [s.questionId, s]));

  // Sequential, not Promise.all: this platform's Prisma pool is deliberately small (see
  // prisma.js) — grading every pending question of a whole class's synchronized finalize burst
  // concurrently was already identified as a real trigger for Postgres pool-timeout errors
  // elsewhere in this codebase (see gradeAttempt.js's identical rationale for Formal Tests). A
  // module-coding attempt only has a few questions, so this costs a little wall-clock time in
  // exchange for not reintroducing that same failure mode here.
  for (const { question } of attempt.questions) {
    const sub = submissionByQuestion.get(question.id);
    if (!sub || sub.verdict !== "PENDING") continue;
    await gradeOneModuleCodingSubmission(sub, question);
  }

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

  // Auto-issue ONE CODING_ASSESSMENT certificate per student per COURSE, once every certificate-
  // gating test/Level in the course has been passed (see gatingLevels.js: every legacy Module-
  // direct test, plus every Level in a Chapter marked countsTowardCertificate) — not one
  // certificate per module (that used to flood a student with a separate certificate for every
  // module they passed; a student finishing all of "Java"'s coding assessments should get a
  // single course-wide certificate, the same way LEARNING_MODULE certificates already work for
  // lesson completion). Idempotency is the
  // studentId+courseId+type DB unique constraint (see schema.prisma's Certificate model) — a
  // second issueCertificate() call for the same course is a no-op via the findUnique check below,
  // and a pass is permanent per this platform's "no downgrade on retake" convention, so this only
  // ever needs to fire once.
  //
  // Deliberately runs BEFORE the attempt's status flips to SUBMITTED/AUTO_SUBMITTED below:
  // routes/moduleCoding.js's /finalize treats `status !== "IN_PROGRESS"` as "already finalized,
  // short-circuit" for idempotency — if the status flip happened first and the process crashed
  // (or issueCertificate's .catch() swallowed a real failure) before this block ran, a retried
  // finalize call would short-circuit before ever reaching certificate issuance again, silently
  // leaving a student who passed without the certificate they earned.
  if (passed) {
    const course = attempt.moduleCodingTest.chapter?.module?.course ?? attempt.moduleCodingTest.module?.course;
    if (course) {
      const testIds = await getCertificateGatingTestIds(prisma, course.id);
      const passedTestIds = new Set(
        (
          await prisma.moduleCodingAttempt.findMany({
            where: { studentId: attempt.studentId, moduleCodingTestId: { in: testIds }, passed: true, id: { not: attemptId } },
            select: { moduleCodingTestId: true },
            distinct: ["moduleCodingTestId"],
          })
        ).map((a) => a.moduleCodingTestId)
      );
      // This attempt's own pass isn't written to the DB yet (that happens below) — count it now
      // so a student whose *this* attempt completes the set is correctly recognized immediately,
      // not just on their next attempt.
      passedTestIds.add(attempt.moduleCodingTestId);
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

  return { ...updated, questionBreakdown };
}

module.exports = { gradeModuleCodingAttempt, gradeOneModuleCodingSubmission };
