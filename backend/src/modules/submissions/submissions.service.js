// Business rules for test submissions: run sample cases, autosave a coding draft, submit code, record a quiz answer, finalize an attempt.
// No req/res here: failures that are the caller's fault are thrown as ServiceError (the controller maps them to HTTP); the one HTTP-shaped dependency, the
// secure-session check, is passed in as `guards.session(attempt)` (returns false when it has already answered the request).
const { judgeSubmission } = require("../../utils/judgeGateway");
const { runQueued } = require("../../utils/queue");
const { gradePendingCodingSubmissions, gradeCodingSubmission, recomputeAttemptScore } = require("../../utils/gradeAttempt");
const { processGamification } = require("../../utils/gamification");
const { gradeNumericAnswer } = require("../../utils/numericAnswer");
const { ServiceError } = require("../../utils/serviceError");
const repo = require("./submissions.repository");
const domain = require("./submissions.domain");
const { requireIds } = require("./submissions.validation");

const HANDLED = Symbol("handled"); // the session guard already wrote the response

// Ownership, state and time checks shared by every write: the attempt must be the caller's own, still in progress, pass the secure-session check, and be inside
// the student's own deadline. Returns the attempt, or HANDLED when the session guard answered.
async function openWritableAttempt(attemptId, userId, guards) {
  const attempt = await repo.findAttempt(attemptId);
  if (!attempt || attempt.studentId !== userId) throw new ServiceError(403, "Invalid attempt");
  if (attempt.status !== "IN_PROGRESS") throw new ServiceError(403, "This test attempt is already finalized");
  if (!(await guards.session(attempt))) return HANDLED;
  if (Date.now() > domain.deadlineOf(attempt)) throw new ServiceError(403, "Time is up for this test");
  return attempt;
}

function assertAssigned(attempt, questionId) {
  if (!domain.assignedQuestionIds(attempt).includes(questionId)) throw new ServiceError(403, "This question is not part of your test");
}

// Run code against the sample (non-hidden) cases only, for self-check: not tied to an attempt and saves nothing. A question is runnable only if it is shared
// (no institute) or belongs to the requesting student's own institute.
async function runSample({ body, requesterInstituteId }) {
  const { questionId } = requireIds(body, ["questionId"]);
  const question = await repo.findQuestionForRun(questionId);
  if (!question) throw new ServiceError(404, "Question not found");
  if (!domain.isCodingType(question)) throw new ServiceError(400, "Run is only available for coding questions");
  if (question.instituteId && question.instituteId !== requesterInstituteId) throw new ServiceError(403, "You can only run questions under your own institute");
  return runQueued(() =>
    judgeSubmission({
      language: domain.languageFor(question, body.language), code: body.code, testCases: question.testCases, timeLimitMs: question.timeLimitMs,
      memoryLimitKb: question.memoryLimitKb || undefined, evaluationType: question.evaluationType, functionSignature: question.functionSignature,
      sqlSchema: question.sqlSchema, comparisonMode: question.comparisonMode, floatAbsoluteTolerance: question.floatAbsoluteTolerance, floatRelativeTolerance: question.floatRelativeTolerance,
    })
  );
}

// Save the current coding draft with no judging. A client-supplied monotonic `seq` orders saves: an older one never overwrites newer code.
async function autosaveDraft({ body, userId, guards }) {
  const { attemptId, questionId } = requireIds(body, ["attemptId", "questionId"]);
  const seq = BigInt(Math.trunc(Number.isFinite(Number(body.seq)) ? Number(body.seq) : Date.now()));
  const attempt = await openWritableAttempt(attemptId, userId, guards);
  if (attempt === HANDLED) return HANDLED;
  assertAssigned(attempt, questionId);
  const question = await repo.findQuestion(questionId);
  if (!question) throw new ServiceError(404, "Question not found");
  if (!domain.isCodingType(question)) throw new ServiceError(400, "Autosave is only for coding questions");
  await repo.saveDraftIfNotStale({ attemptId, questionId, studentId: userId, language: domain.languageFor(question, body.language), code: body.code, seq });
  return { status: "SAVED" };
}

// Explicit per-question Submit: save the code and grade it at once against the HIDDEN cases. A resubmission that scores worse than an already locked-in result
// is reported honestly to the student, but the persisted record keeps the better one.
async function submitCode({ body, userId, guards }) {
  const { attemptId, questionId } = requireIds(body, ["attemptId", "questionId"]);
  const attempt = await openWritableAttempt(attemptId, userId, guards);
  if (attempt === HANDLED) return HANDLED;
  assertAssigned(attempt, questionId);
  const question = await repo.findQuestionWithCases(questionId);
  if (!question) throw new ServiceError(404, "Question not found");
  if (!domain.isCodingType(question)) throw new ServiceError(400, "Submit is only for coding questions");
  const language = domain.languageFor(question, body.language);

  const priorBest = await repo.findSubmission(attemptId, questionId);
  const sub = await repo.upsertCodeForGrading({ attemptId, questionId, studentId: userId, language, code: body.code });
  const { judgeResult, submission: fresh } = await gradeCodingSubmission(sub, question);
  if (domain.shouldRestoreBest(priorBest, fresh)) await repo.restoreSubmission(sub.id, priorBest);
  await recomputeAttemptScore(attemptId);
  return domain.sanitizeCodingResult(judgeResult);
}

// Record an MCQ / TRUE_FALSE / MULTISELECT / NUMERICAL answer: graded at once, correctness withheld. A new answer replaces the previous one for the question.
async function submitQuizAnswer({ body, userId, guards }) {
  const { attemptId, questionId } = requireIds(body, ["attemptId", "questionId"]);
  const attempt = await openWritableAttempt(attemptId, userId, guards);
  if (attempt === HANDLED) return HANDLED;
  const question = await repo.findQuestion(questionId);
  if (!question) throw new ServiceError(404, "Question not found");
  if (domain.isCodingType(question)) throw new ServiceError(400, "Coding/SQL questions are auto-saved via /autosave, not /submit");
  // The question must be one of THIS attempt's questions. Without this check a student could answer any question on the platform and have its points added to
  // their total (measured before this check existed: answering an unassigned 4-point question raised the score by 4).
  assertAssigned(attempt, questionId);

  const isNumeric = question.questionType === "NUMERICAL";
  const result = isNumeric
    ? gradeNumericAnswer(question, body.numericResponse)
    : domain.gradeQuizAnswer(question, domain.toOriginalIndices(body.selectedOptions, attempt.optionOrder?.[questionId]));
  const submission = await repo.replaceQuizSubmission({
    attemptId, questionId, studentId: userId, language: question.questionType,
    code: domain.storedAnswer(question, body.selectedOptions, body.numericResponse), score: domain.scoreFor(result, question.points), result,
  });
  return { submissionId: submission.id, execution: domain.sanitizeSubmitResponse() };
}

// Close the attempt: grade every still-pending coding draft, then mark it SUBMITTED (or AUTO_SUBMITTED when past the deadline). Idempotent, and never blocked by the
// deadline. A "time" call before the server agrees time is up is not honoured.
async function finalizeAttempt({ attemptId, reason, userId, guards }) {
  const attempt = await repo.findAttemptForFinalize(attemptId);
  if (!attempt || attempt.studentId !== userId) throw new ServiceError(403, "Invalid attempt");
  if (attempt.status !== "IN_PROGRESS") return attempt;
  if (!(await guards.session(attempt))) return HANDLED;
  if (reason === "time") {
    const remainingMs = domain.deadlineOf(attempt) - Date.now();
    if (remainingMs > domain.PREMATURE_FINALIZE_GRACE_MS) return { premature: true, deadline: domain.deadlineOf(attempt), serverNow: Date.now() };
  }
  await gradePendingCodingSubmissions(attempt.id);
  const isLate = Date.now() > domain.deadlineOf(attempt);
  const claim = await repo.claimFinalize(attemptId, isLate ? "AUTO_SUBMITTED" : "SUBMITTED");
  const updated = await repo.findAttemptRow(attemptId);
  let gamification = null;
  if (claim.count > 0) {
    try {
      gamification = await processGamification(userId, { xpActivities: ["TEST_COMPLETE"], xpMeta: { attemptId: attempt.id }, streakEligible: true });
    } catch (e) {
      console.error("gamification failed", e);
    }
  }
  return { ...updated, gamification };
}

module.exports = { HANDLED, runSample, autosaveDraft, submitCode, submitQuizAnswer, finalizeAttempt };
