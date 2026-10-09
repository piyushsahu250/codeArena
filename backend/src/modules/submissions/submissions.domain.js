// Pure rules for test submissions: no database, no HTTP. Everything here is unit-tested (test/submissionsDomain.test.js).

// A client-side auto-submit ("reason: time") is only trusted once the server's own clock agrees the deadline has actually passed, within this grace window.
const PREMATURE_FINALIZE_GRACE_MS = 15000;

// The student's own individual deadline: their server-recorded startedAt plus the test's configured duration -- never clamped to the test's scheduled
// availability window (that only gates whether a NEW attempt can be started). Every write endpoint enforces it directly rather than trusting the client timer.
function deadlineOf(attempt) {
  return new Date(attempt.startedAt).getTime() + attempt.test.durationMin * 60 * 1000;
}

// The questions this attempt was given: the manifest locked at start (TestAttempt.questionOrder), or -- only for legacy attempts that predate it -- the test's
// current list.
function assignedQuestionIds(attempt) {
  return Array.isArray(attempt.questionOrder) && attempt.questionOrder.length > 0
    ? attempt.questionOrder
    : (attempt.test.questions || []).map((tq) => tq.questionId);
}

const isCodingType = (question) => question.questionType === "CODING" || question.questionType === "SQL";

// A SQL question is always stored and judged as "sql", whatever the request claims: the judge picks its SQLite path purely from this string.
const languageFor = (question, requested) => (question.questionType === "SQL" ? "sql" : requested);

// When Test.shuffleOptions is on, the student clicked options in a per-attempt shuffled order, so `selectedOptions` arrive as positions in THAT order.
// attempt.optionOrder[questionId][i] is the original index shown at position i; invert it before grading. No entry: pass through untouched.
function toOriginalIndices(selectedOptions, order) {
  if (!order) return selectedOptions;
  return (Array.isArray(selectedOptions) ? selectedOptions : []).map((pos) => order[pos]).filter((v) => v !== undefined);
}

// Exact-match grading for MCQ / TRUE_FALSE / MULTISELECT: the selected set must equal the correct set exactly (no partial credit).
function gradeQuizAnswer(question, selectedOptions) {
  const correct = Array.isArray(question.correctAnswer) ? [...question.correctAnswer].sort() : [];
  const selected = Array.isArray(selectedOptions) ? [...new Set(selectedOptions)].sort() : [];
  const isMatch = correct.length === selected.length && correct.every((v, i) => v === selected[i]);
  return {
    passedCases: isMatch ? 1 : 0,
    totalCases: 1,
    verdict: isMatch ? "ACCEPTED" : "WRONG_ANSWER",
    details: [{ verdict: isMatch ? "PASSED" : "WRONG_ANSWER" }],
  };
}

// Points earned for a graded answer: full points when accepted, otherwise the share of passed cases.
function scoreFor(result, points) {
  return result.verdict === "ACCEPTED" ? points : Math.round((result.passedCases / result.totalCases) * points);
}

// MCQ/TRUE_FALSE/MULTISELECT/NUMERICAL: the response withholds correctness (students only see it after the test ends, if results are published).
function sanitizeSubmitResponse() {
  return { status: "SUBMITTED" };
}

// CODING/SQL: reveals the verdict and case counts (drives the question navigator's live colour) but never the per-case details (hidden inputs and outputs).
function sanitizeCodingResult(result) {
  const { details, ...safe } = result; // eslint-disable-line no-unused-vars
  return safe;
}

// The stored form of a quiz answer: a typed value for NUMERICAL, otherwise the selected option positions as JSON.
function storedAnswer(question, selectedOptions, numericResponse) {
  return question.questionType === "NUMERICAL" ? String(numericResponse ?? "") : JSON.stringify(selectedOptions || []);
}

// A re-submission that scores worse than an already-locked-in result must not replace it: the persisted record keeps the better one.
const shouldRestoreBest = (priorBest, fresh) => !!priorBest && priorBest.verdict !== "PENDING" && !!fresh && priorBest.score > fresh.score;

module.exports = {
  PREMATURE_FINALIZE_GRACE_MS, deadlineOf, assignedQuestionIds, isCodingType, languageFor, toOriginalIndices, gradeQuizAnswer, scoreFor,
  sanitizeSubmitResponse, sanitizeCodingResult, storedAnswer, shouldRestoreBest,
};
