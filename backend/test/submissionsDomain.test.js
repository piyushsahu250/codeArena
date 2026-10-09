// Unit tests for the pure rules and validation of the submissions module (no database, no HTTP).
const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/modules/submissions/submissions.domain");
const { requireIds } = require("../src/modules/submissions/submissions.validation");
const { ServiceError } = require("../src/utils/serviceError");

test("quiz grading is an exact match of the selected set: no partial credit, duplicates ignored, order irrelevant", () => {
  const q = { correctAnswer: [2, 0] };
  assert.equal(d.gradeQuizAnswer(q, [0, 2]).verdict, "ACCEPTED");
  assert.equal(d.gradeQuizAnswer(q, [2, 0, 2]).verdict, "ACCEPTED");
  assert.equal(d.gradeQuizAnswer(q, [0]).verdict, "WRONG_ANSWER");
  assert.equal(d.gradeQuizAnswer(q, [0, 1, 2]).verdict, "WRONG_ANSWER");
  assert.equal(d.gradeQuizAnswer(q, undefined).verdict, "WRONG_ANSWER");
  assert.equal(d.gradeQuizAnswer({ correctAnswer: null }, []).verdict, "ACCEPTED", "no key and nothing selected matches (existing behaviour)");
});

test("shuffled option positions are mapped back to the original indices before grading", () => {
  // position 0 shows original option 2, position 1 shows 0, position 2 shows 1
  const order = [2, 0, 1];
  assert.deepEqual(d.toOriginalIndices([0], order), [2]);
  assert.deepEqual(d.toOriginalIndices([1, 2], order), [0, 1]);
  assert.deepEqual(d.toOriginalIndices([9], order), [], "an out-of-range position is dropped");
  assert.deepEqual(d.toOriginalIndices([1], undefined), [1], "no shuffle recorded: untouched");
  assert.deepEqual(d.toOriginalIndices("nonsense", order), []);
});

test("score is the full points when accepted, otherwise the share of passed cases", () => {
  assert.equal(d.scoreFor({ verdict: "ACCEPTED", passedCases: 1, totalCases: 1 }, 4), 4);
  assert.equal(d.scoreFor({ verdict: "WRONG_ANSWER", passedCases: 0, totalCases: 1 }, 4), 0);
  assert.equal(d.scoreFor({ verdict: "WRONG_ANSWER", passedCases: 1, totalCases: 3 }, 9), 3);
});

test("the assigned question set is the locked manifest, and only legacy attempts fall back to the test's list", () => {
  const withManifest = { questionOrder: ["a", "b"], test: { questions: [{ questionId: "a" }, { questionId: "z" }] } };
  assert.deepEqual(d.assignedQuestionIds(withManifest), ["a", "b"]);
  const legacy = { questionOrder: null, test: { questions: [{ questionId: "a" }, { questionId: "z" }] } };
  assert.deepEqual(d.assignedQuestionIds(legacy), ["a", "z"]);
  const empty = { questionOrder: [], test: { questions: [{ questionId: "q" }] } };
  assert.deepEqual(d.assignedQuestionIds(empty), ["q"]);
});

test("the deadline is the student's own start plus the test duration", () => {
  const startedAt = new Date("2026-10-09T10:00:00Z");
  assert.equal(d.deadlineOf({ startedAt, test: { durationMin: 30 } }), new Date("2026-10-09T10:30:00Z").getTime());
});

test("coding results never expose the per-case details; quiz responses reveal nothing about correctness", () => {
  assert.deepEqual(d.sanitizeCodingResult({ verdict: "ACCEPTED", passedCases: 3, totalCases: 3, details: [{ input: "secret" }] }), { verdict: "ACCEPTED", passedCases: 3, totalCases: 3 });
  assert.deepEqual(d.sanitizeSubmitResponse(), { status: "SUBMITTED" });
});

test("SQL questions are always stored and judged as sql; coding types are recognised", () => {
  assert.equal(d.languageFor({ questionType: "SQL" }, "python"), "sql");
  assert.equal(d.languageFor({ questionType: "CODING" }, "python"), "python");
  assert.ok(d.isCodingType({ questionType: "CODING" }) && d.isCodingType({ questionType: "SQL" }));
  assert.ok(!d.isCodingType({ questionType: "MCQ" }) && !d.isCodingType({ questionType: "NUMERICAL" }));
});

test("a worse resubmission never replaces an already locked-in better result", () => {
  assert.equal(d.shouldRestoreBest({ verdict: "ACCEPTED", score: 10 }, { score: 0 }), true);
  assert.equal(d.shouldRestoreBest({ verdict: "ACCEPTED", score: 10 }, { score: 10 }), false);
  assert.equal(d.shouldRestoreBest({ verdict: "PENDING", score: 0 }, { score: 0 }), false, "an unevaluated draft is not a locked-in result");
  assert.equal(d.shouldRestoreBest(null, { score: 5 }), false);
});

test("stored answers: a typed value for NUMERICAL, option positions as JSON otherwise", () => {
  assert.equal(d.storedAnswer({ questionType: "NUMERICAL" }, undefined, 42), "42");
  assert.equal(d.storedAnswer({ questionType: "NUMERICAL" }, undefined, undefined), "");
  assert.equal(d.storedAnswer({ questionType: "MCQ" }, [1], undefined), "[1]");
  assert.equal(d.storedAnswer({ questionType: "MCQ" }, undefined, undefined), "[]");
});

test("missing or non-text ids are a 400 with a clear message, not a database error", () => {
  assert.deepEqual(requireIds({ attemptId: "a", questionId: "b" }, ["attemptId", "questionId"]), { attemptId: "a", questionId: "b" });
  for (const bad of [{}, null, undefined, { attemptId: "a" }, { attemptId: 5, questionId: "b" }, { attemptId: "", questionId: "b" }, { attemptId: { $ne: 1 }, questionId: "b" }]) {
    assert.throws(() => requireIds(bad, ["attemptId", "questionId"]), (e) => e instanceof ServiceError && e.status === 400 && /required/.test(e.message));
  }
});
