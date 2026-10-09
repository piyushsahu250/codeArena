// Every database query used by the submissions module lives here, so the service reads as rules and the queries can be reviewed (and indexed) in one place.
const prisma = require("../../prisma");
const { recomputeAttemptScore } = require("../../utils/gradeAttempt");

const TEST_FOR_WINDOW = { durationMin: true, securityLevel: true, securityPolicy: true };

// The attempt plus what the write rules need: the test's duration/security and its question list (the legacy fallback for the assigned set).
const findAttempt = (attemptId) =>
  prisma.testAttempt.findUnique({ where: { id: attemptId }, include: { test: { select: { ...TEST_FOR_WINDOW, questions: { select: { questionId: true } } } } } });

const findAttemptForFinalize = (attemptId) =>
  prisma.testAttempt.findUnique({ where: { id: attemptId }, include: { test: { select: TEST_FOR_WINDOW } } });

const findAttemptRow = (attemptId) => prisma.testAttempt.findUnique({ where: { id: attemptId } });

const findQuestionForRun = (questionId) =>
  prisma.question.findUnique({ where: { id: questionId }, include: { testCases: { where: { isHidden: false } } } });

const findQuestion = (questionId) => prisma.question.findUnique({ where: { id: questionId } });

const findQuestionWithCases = (questionId) => prisma.question.findUnique({ where: { id: questionId }, include: { testCases: true } });

const findSubmission = (attemptId, questionId) => prisma.submission.findUnique({ where: { attemptId_questionId: { attemptId, questionId } } });

// Atomic and race-safe: only applies if this request's seq is not older than what is stored (a reordered network request must not clobber newer code),
// then creates the row if none exists. A unique-constraint failure on create means a row with a newer seq already exists: the stale write is correctly dropped.
async function saveDraftIfNotStale({ attemptId, questionId, studentId, language, code, seq }) {
  const updated = await prisma.submission.updateMany({
    where: { attemptId, questionId, codeSavedSeq: { lte: seq } },
    data: { language: language || "", code: code || "", codeSavedSeq: seq },
  });
  if (updated.count === 0) {
    await prisma.submission.create({
      data: { attemptId, questionId, studentId, language: language || "", code: code || "", verdict: "PENDING", codeSavedSeq: seq },
    }).catch((err) => { if (err.code !== "P2002") throw err; });
  }
}

// Resets the row to ungraded for a fresh explicit submit (creating it if needed); grading then fills it in.
const upsertCodeForGrading = ({ attemptId, questionId, studentId, language, code }) =>
  prisma.submission.upsert({
    where: { attemptId_questionId: { attemptId, questionId } },
    update: { language: language || "", code: code || "", verdict: "PENDING", score: 0, passedCases: 0, totalCases: 0, timeMs: null, memoryKb: null },
    create: { attemptId, questionId, studentId, language: language || "", code: code || "", verdict: "PENDING" },
  });

const restoreSubmission = (id, prior) =>
  prisma.submission.update({
    where: { id },
    data: {
      code: prior.code, language: prior.language, verdict: prior.verdict, score: prior.score,
      passedCases: prior.passedCases, totalCases: prior.totalCases, timeMs: prior.timeMs, memoryKb: prior.memoryKb,
    },
  });

// One transaction: replace the prior answer for this question, create the new graded one, recompute the attempt total. Without it a crash partway could leave
// TestAttempt.totalScore stale, or briefly show zero submissions for the question.
async function replaceQuizSubmission({ attemptId, questionId, studentId, language, code, score, result }) {
  let submission;
  await prisma.$transaction(async (tx) => {
    await tx.submission.deleteMany({ where: { attemptId, questionId } });
    submission = await tx.submission.create({
      data: { attemptId, questionId, studentId, language, code, score, passedCases: result.passedCases, totalCases: result.totalCases, verdict: result.verdict },
    });
    await recomputeAttemptScore(attemptId, tx);
  });
  return submission;
}

// Atomic claim: only the first of several racing finalize calls flips the status (count 1); the others are no-ops.
const claimFinalize = (attemptId, status) =>
  prisma.testAttempt.updateMany({ where: { id: attemptId, status: "IN_PROGRESS" }, data: { status, submittedAt: new Date() } });

module.exports = {
  findAttempt, findAttemptForFinalize, findAttemptRow, findQuestionForRun, findQuestion, findQuestionWithCases, findSubmission,
  saveDraftIfNotStale, upsertCodeForGrading, restoreSubmission, replaceQuizSubmission, claimFinalize,
};
