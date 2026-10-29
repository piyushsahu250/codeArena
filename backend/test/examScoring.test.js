const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/utils/examScoring");

// ---- multiple choice -------------------------------------------------------------------------------------------------------------------------------------------------------
test("a correct answer earns the marks, a wrong one costs the negative marks, no answer costs nothing", () => {
  assert.deepEqual(S.scoreMcq({ selected: "B", correct: "B", marks: 2, negativePerWrong: 0.5 }), { outcome: "CORRECT", score: 2 });
  assert.deepEqual(S.scoreMcq({ selected: "A", correct: "B", marks: 2, negativePerWrong: 0.5 }), { outcome: "INCORRECT", score: -0.5 });
  assert.deepEqual(S.scoreMcq({ selected: null, correct: "B", marks: 2, negativePerWrong: 0.5 }), { outcome: "UNANSWERED", score: 0 });
  assert.deepEqual(S.scoreMcq({ selected: "", correct: "B", marks: 2, negativePerWrong: 1 }), { outcome: "UNANSWERED", score: 0 });
  assert.deepEqual(S.scoreMcq({ selected: [], correct: "B", marks: 2, negativePerWrong: 1 }), { outcome: "UNANSWERED", score: 0 });
  const noNegative = S.scoreMcq({ selected: "A", correct: "B", marks: 2 });
  assert.equal(noNegative.outcome, "INCORRECT");
  assert.equal(Math.abs(noNegative.score), 0, "no negative marking configured: a wrong answer costs nothing");
});

test("multiple select is all-or-nothing, and order and repeats do not matter", () => {
  assert.equal(S.scoreMcq({ selected: ["B", "A"], correct: ["A", "B"], marks: 3 }).outcome, "CORRECT");
  assert.equal(S.scoreMcq({ selected: ["A", "A", "B"], correct: ["A", "B"], marks: 3 }).outcome, "CORRECT");
  assert.equal(S.scoreMcq({ selected: ["A"], correct: ["A", "B"], marks: 3 }).outcome, "INCORRECT");
  assert.equal(S.scoreMcq({ selected: ["A", "B", "C"], correct: ["A", "B"], marks: 3 }).outcome, "INCORRECT");
  assert.equal(S.scoreMcq({ selected: 1, correct: "1", marks: 1 }).outcome, "CORRECT", "an index and its string are the same option");
});

test("an item with no valid answer key is excluded and reported, never scored from a guess", () => {
  assert.equal(S.scoreMcq({ selected: "A", correct: null, marks: 1 }).outcome, "KEY_MISSING");
  assert.equal(S.scoreMcq({ selected: "A", correct: [], marks: 1 }).outcome, "KEY_MISSING");
  assert.equal(S.scoreMcq({ selected: "A", correct: undefined, marks: 1 }).score, null);
});

const item = (topic, selected, correct, extra = {}) => ({ topic, marks: 2, selected, correct, negativePerWrong: 0.5, ...extra });

test("an objective section adds up marks, counts and topic-wise results", () => {
  const r = S.summarizeObjectiveSection({
    key: "APTITUDE", maxMarks: 10,
    items: [item("Percentages", "A", "A"), item("Percentages", "B", "A"), item("Ratios", "C", "C"), item("Ratios", null, "C"), item("Probability", "D", "D")],
  });
  assert.equal(r.key, "APTITUDE");
  assert.equal(r.obtained, 5.5, "2 + (-0.5) + 2 + 0 + 2");
  assert.equal(r.correct, 3);
  assert.equal(r.incorrect, 1);
  assert.equal(r.unanswered, 1);
  assert.equal(r.attempted, 4);
  assert.equal(r.percent, 55);
  assert.equal(r.status, "FINAL");
  assert.deepEqual(r.byTopic.Percentages, { maxMarks: 4, obtained: 1.5, correct: 1, total: 2, percent: 37.5 });
  assert.deepEqual(r.byTopic.Ratios, { maxMarks: 4, obtained: 2, correct: 1, total: 2, percent: 50 });
  assert.equal(r.byTopic.Probability.percent, 100);
});

test("a section never scores below zero by default, and never above its maximum", () => {
  const allWrong = S.summarizeObjectiveSection({ key: "TECHNICAL", maxMarks: 10, items: [item("DBMS", "A", "B"), item("DBMS", "A", "B")] });
  assert.equal(allWrong.obtained, 0);
  const allowed = S.summarizeObjectiveSection({ key: "TECHNICAL", maxMarks: 10, floorAtZero: false, items: [item("DBMS", "A", "B"), item("DBMS", "A", "B")] });
  assert.equal(allowed.obtained, -1);
  const over = S.summarizeObjectiveSection({ key: "TECHNICAL", maxMarks: 3, items: [item("OS", "A", "A"), item("OS", "A", "A")] });
  assert.equal(over.obtained, 3, "capped at the section maximum");
});

test("subject-wise results are kept for the technical section, and items without a key are counted apart", () => {
  const r = S.summarizeObjectiveSection({
    key: "TECHNICAL", maxMarks: 8,
    items: [item("Joins", "A", "A", { subject: "SQL" }), item("Normal forms", "B", "A", { subject: "DBMS" }), item("Paging", "A", "A", { subject: "OS" }), item("Paging", "A", null, { subject: "OS" })],
  });
  assert.equal(r.keyMissing, 1);
  assert.equal(r.questions, 4);
  assert.equal(r.correct, 2);
  assert.equal(r.bySubject.SQL.obtained, 2);
  assert.equal(r.bySubject.OS.total, 1, "the item without a key is not part of the subject result");
});

test("an empty objective section is final with zero marks and zero percent, without dividing by zero", () => {
  const r = S.summarizeObjectiveSection({ key: "APTITUDE", maxMarks: 10, items: [] });
  assert.equal(r.obtained, 0);
  assert.equal(r.percent, 0);
  assert.equal(r.status, "FINAL");
});

// ---- coding ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const problem = (id, maxMarks, submitted, judge) => ({ id, maxMarks, submitted, judge });

test("coding marks are proportional to the hidden test cases passed", () => {
  const r = S.summarizeCodingSection({ maxMarks: 30, problems: [problem("p1", 10, true, { status: "OK", passed: 5, total: 5 }), problem("p2", 10, true, { status: "OK", passed: 3, total: 6 }), problem("p3", 10, false)] });
  assert.equal(r.obtained, 15);
  assert.equal(r.status, "FINAL");
  assert.equal(r.problems, 3);
  assert.equal(r.attempted, 2);
  assert.equal(r.solved, 1);
  assert.equal(r.testsPassed, 8);
  assert.equal(r.testsFailed, 3);
  assert.deepEqual(r.perProblem.map((p) => p.status), ["SOLVED", "PARTIAL", "NOT_ATTEMPTED"]);
});

test("a compile error or runtime error is the student's result: zero for that problem, counted, section still final", () => {
  const r = S.summarizeCodingSection({ maxMarks: 20, problems: [problem("p1", 10, true, { status: "COMPILE_ERROR" }), problem("p2", 10, true, { status: "RUNTIME_ERROR", passed: 1, total: 4 })] });
  assert.equal(r.status, "FINAL", "a compile error that reports no totals is still a result, not a judge failure");
  assert.equal(r.compileFailures, 1);
  assert.equal(r.runtimeFailures, 1);
  assert.equal(r.obtained, 2.5, "the runtime-error problem keeps credit for the cases that did pass");
  assert.equal(r.perProblem[0].obtained, 0);
});

test("a judge failure is NOT a wrong answer: the problem is pending and the section is not final", () => {
  for (const status of ["JUDGE_ERROR", "TIMEOUT_INFRA", undefined, "SOMETHING_NEW"]) {
    const r = S.summarizeCodingSection({ maxMarks: 20, problems: [problem("p1", 10, true, { status: "OK", passed: 5, total: 5 }), problem("p2", 10, true, status === undefined ? undefined : { status })] });
    assert.equal(r.status, "PENDING", String(status));
    assert.equal(r.obtained, null, "no final mark while a problem has no judge result");
    assert.equal(r.provisionalObtained, 10, "what is known so far is kept, labelled provisional");
    assert.equal(r.pendingItems, 1);
    assert.equal(r.perProblem[1].status, "JUDGE_PENDING");
    assert.equal(r.perProblem[1].obtained, null, "never a zero");
  }
  const noTotals = S.summarizeCodingSection({ maxMarks: 10, problems: [problem("p1", 10, true, { status: "OK" })] });
  assert.equal(noTotals.status, "PENDING", "'OK' with no test totals cannot be scored");
});

test("time and memory limit results are the student's, not infrastructure failures", () => {
  const r = S.summarizeCodingSection({ maxMarks: 10, problems: [problem("p1", 10, true, { status: "TIME_LIMIT_EXCEEDED", passed: 2, total: 5 })] });
  assert.equal(r.status, "FINAL");
  assert.equal(r.obtained, 4);
  assert.equal(r.perProblem[0].status, "TIME_LIMIT_EXCEEDED");
});

test("a coding score never exceeds the section maximum and a passed count above the total is clamped", () => {
  const r = S.summarizeCodingSection({ maxMarks: 5, problems: [problem("p1", 10, true, { status: "OK", passed: 9, total: 5 })] });
  assert.equal(r.testsPassed, 5);
  assert.equal(r.obtained, 5);
});

// ---- AI interview -------------------------------------------------------------------------------------------------------------------------------------------------------------
const turn = (id, maxMarks, answered, skipped, evaluation) => ({ id, maxMarks, answered, skipped, evaluation });

test("scored interview answers add up, and skipped questions are a final zero", () => {
  const r = S.summarizeInterviewSection({ maxMarks: 20, turns: [turn("q1", 5, true, false, { status: "DONE", score: 4, confidence: 0.8 }), turn("q2", 5, true, false, { status: "DONE", score: 3.5 }), turn("q3", 5, false, true), turn("q4", 5, true, true)] });
  assert.equal(r.status, "FINAL");
  assert.equal(r.obtained, 7.5);
  assert.equal(r.answered, 2);
  assert.equal(r.skipped, 2);
  assert.equal(r.perQuestion[0].confidence, 0.8);
  assert.equal(r.perQuestion[1].confidence, null, "no confidence is invented when the evaluator gave none");
});

test("an evaluation that is pending or failed never becomes a zero: the section stays pending with the figures so far", () => {
  const r = S.summarizeInterviewSection({ maxMarks: 15, turns: [turn("q1", 5, true, false, { status: "DONE", score: 4 }), turn("q2", 5, true, false, { status: "PENDING" }), turn("q3", 5, true, false, { status: "FAILED" })] });
  assert.equal(r.status, "PENDING");
  assert.equal(r.obtained, null);
  assert.equal(r.provisionalObtained, 4);
  assert.equal(r.pendingItems, 1);
  assert.equal(r.failedItems, 1);
  assert.deepEqual(r.perQuestion.map((q) => q.status), ["SCORED", "EVALUATION_PENDING", "EVALUATION_FAILED"]);
  assert.equal(r.perQuestion[1].obtained, null);
  const missing = S.summarizeInterviewSection({ maxMarks: 5, turns: [turn("q1", 5, true, false, undefined)] });
  assert.equal(missing.status, "PENDING", "an answer with no evaluation yet is pending");
});

test("a malformed or out-of-range score is rejected as a failed evaluation, not clamped and not zeroed", () => {
  for (const bad of [{ status: "DONE", score: -1 }, { status: "DONE", score: 6 }, { status: "DONE", score: "4" }, { status: "DONE", score: NaN }, { status: "DONE" }]) {
    const r = S.summarizeInterviewSection({ maxMarks: 5, turns: [turn("q1", 5, true, false, bad)] });
    assert.equal(r.status, "PENDING", JSON.stringify(bad));
    assert.equal(r.failedItems, 1);
    assert.equal(r.perQuestion[0].status, "EVALUATION_FAILED");
  }
});

// ---- proctoring --------------------------------------------------------------------------------------------------------------------------------------------------------------
test("automatically detected events are observations: nothing counts as a confirmed violation until a reviewer confirms it", () => {
  const events = [
    { type: "TAB_SWITCH", severity: "CONFIRMED_VIOLATION", requiresReview: true, reviewStatus: "PENDING" },
    { type: "TAB_SWITCH", severity: "CONFIRMED_VIOLATION", requiresReview: true, reviewStatus: null },
    { type: "CAMERA_DROPPED", severity: "CONFIRMED_VIOLATION", requiresReview: true, reviewStatus: "DISMISSED" },
    { type: "FACE_MISSING", severity: "INTERRUPTION", requiresReview: false, reviewStatus: null },
    { type: "FULLSCREEN_EXIT", severity: "CONFIRMED_VIOLATION", requiresReview: true, reviewStatus: "CONFIRMED" },
  ];
  const r = S.summarizeProctoringEvents(events);
  assert.equal(r.total, 5);
  assert.equal(r.confirmedViolations, 1, "only the reviewer-confirmed one");
  assert.equal(r.dismissed, 1);
  assert.equal(r.reviewed, 2);
  assert.equal(r.reviewRequiredPending, 2);
  assert.equal(r.reviewStatus, "REVIEW_PENDING");
  assert.deepEqual(r.byCategory, { TAB_SWITCH: 2, CAMERA_DROPPED: 1, FACE_MISSING: 1, FULLSCREEN_EXIT: 1 });
});

test("a student with many tab switches and no review has zero confirmed violations", () => {
  const events = Array.from({ length: 12 }, () => ({ type: "TAB_SWITCH", severity: "CONFIRMED_VIOLATION", requiresReview: true, reviewStatus: "PENDING" }));
  const r = S.summarizeProctoringEvents(events);
  assert.equal(r.confirmedViolations, 0);
  assert.equal(r.reviewRequiredPending, 12);
});

test("no events, or bad input, summarise cleanly", () => {
  assert.deepEqual(S.summarizeProctoringEvents([]), { total: 0, byCategory: {}, reviewRequiredPending: 0, reviewed: 0, dismissed: 0, confirmedViolations: 0, reviewStatus: "NO_EVENTS" });
  assert.equal(S.summarizeProctoringEvents(undefined).total, 0);
  const reviewedAll = S.summarizeProctoringEvents([{ type: "COPY", requiresReview: true, reviewStatus: "DISMISSED" }]);
  assert.equal(reviewedAll.reviewStatus, "NO_OPEN_REVIEW");
});

// ---- the consolidated result -------------------------------------------------------------------------------------------------------------------------------------------
const finalSection = (key, maxMarks, obtained) => ({ key, maxMarks, obtained, percent: Math.round((obtained / maxMarks) * 10000) / 100, status: "FINAL" });
const four = (over = {}) => [
  finalSection("APTITUDE", 25, 18), finalSection("TECHNICAL", 25, 15), finalSection("CODING", 30, 24), finalSection("AI_INTERVIEW", 20, 10), ...Object.values(over),
].filter((s, i, a) => a.findIndex((x) => x.key === s.key) === i);
const replace = (list, section) => list.map((s) => (s.key === section.key ? section : s));

test("the result adds the four sections, with percentage, pass or fail, and strongest and weakest section", () => {
  const r = S.buildExamResult({ sections: four(), totalMarks: 100, passing: { passingMarks: 40 }, proctoring: S.summarizeProctoringEvents([]), policy: { reviewRequired: true } });
  assert.equal(r.ok, true);
  assert.equal(r.obtained, 67, "18 + 15 + 24 + 10");
  assert.equal(r.percent, 67);
  assert.equal(r.passed, true);
  assert.equal(r.final, true);
  assert.equal(r.provisional, false);
  assert.equal(r.status, "COMPLETED");
  assert.equal(r.strongestSection, "CODING", "24/30 = 80%, ahead of aptitude at 72%");
  assert.equal(r.weakestSection, "AI_INTERVIEW", "10/20 = 50%");
  assert.deepEqual(r.sections.map((s) => s.key), ["APTITUDE", "TECHNICAL", "CODING", "AI_INTERVIEW"]);
});

test("pass or fail follows the configured criteria exactly, by marks or by percentage", () => {
  const base = { sections: four(), totalMarks: 100, proctoring: S.summarizeProctoringEvents([]) };
  assert.equal(S.buildExamResult({ ...base, passing: { passingMarks: 67 } }).passed, true, "equal to the threshold passes");
  assert.equal(S.buildExamResult({ ...base, passing: { passingMarks: 68 } }).passed, false);
  assert.equal(S.buildExamResult({ ...base, passing: { passingPercent: 67 } }).passed, true);
  assert.equal(S.buildExamResult({ ...base, passing: { passingPercent: 67.01 } }).passed, false);
});

test("a pending section makes the whole result provisional: no pass or fail is decided and nothing is final", () => {
  const pending = { key: "AI_INTERVIEW", maxMarks: 20, obtained: null, provisionalObtained: 6, percent: null, status: "PENDING" };
  const r = S.buildExamResult({ sections: replace(four(), pending), totalMarks: 100, passing: { passingMarks: 40 }, proctoring: S.summarizeProctoringEvents([]) });
  assert.equal(r.ok, true);
  assert.equal(r.status, "EVALUATION_PENDING");
  assert.equal(r.final, false);
  assert.equal(r.provisional, true);
  assert.equal(r.passed, null, "undecided, not false");
  assert.equal(r.obtained, 63, "18 + 15 + 24 + the 6 known so far");
  assert.deepEqual(r.pendingSections, ["AI_INTERVIEW"]);
  assert.equal(r.weakestSection, "TECHNICAL", "only final sections are compared");
});

test("a result is not final and not publishable while a section is pending or a required review is open", () => {
  const pending = { key: "CODING", maxMarks: 30, obtained: null, provisionalObtained: 10, percent: null, status: "PENDING" };
  const provisional = S.buildExamResult({ sections: replace(four(), pending), totalMarks: 100, passing: { passingMarks: 40 }, proctoring: S.summarizeProctoringEvents([]) });
  const p1 = S.canPublishResult(provisional);
  assert.equal(p1.ok, false);
  assert.equal(p1.code, "EVALUATION_PENDING");

  const openReview = S.summarizeProctoringEvents([{ type: "TAB_SWITCH", requiresReview: true, reviewStatus: "PENDING" }]);
  const underReview = S.buildExamResult({ sections: four(), totalMarks: 100, passing: { passingMarks: 40 }, proctoring: openReview, policy: { reviewRequired: true } });
  assert.equal(underReview.status, "UNDER_REVIEW");
  assert.equal(underReview.final, true, "the marks are final; publication waits for the review");
  assert.equal(S.canPublishResult(underReview).code, "UNDER_REVIEW");

  const noPolicy = S.buildExamResult({ sections: four(), totalMarks: 100, passing: { passingMarks: 40 }, proctoring: openReview, policy: { reviewRequired: false } });
  assert.equal(noPolicy.status, "COMPLETED", "events do not hold the result when the examination does not require review");
  assert.equal(S.canPublishResult(noPolicy).ok, true);
  assert.equal(S.canPublishResult(noPolicy, { reviewOpen: true }).code, "UNDER_REVIEW");
  assert.equal(S.canPublishResult(null).code, "NO_RESULT");
  assert.equal(S.canPublishResult({ ok: false }).code, "NO_RESULT");
});

test("a result needs all four sections and marks that add up to the examination total", () => {
  const three = S.buildExamResult({ sections: four().filter((s) => s.key !== "CODING"), totalMarks: 100, passing: { passingMarks: 40 } });
  assert.equal(three.ok, false);
  assert.equal(three.code, "SECTIONS_MISSING");
  const mismatch = S.buildExamResult({ sections: four(), totalMarks: 90, passing: { passingMarks: 40 } });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "MARKS_MISMATCH");
});

test("the same inputs always give the same result (deterministic, no hidden state)", () => {
  const args = { sections: four(), totalMarks: 100, passing: { passingMarks: 40 }, proctoring: S.summarizeProctoringEvents([]) };
  assert.deepEqual(S.buildExamResult(args), S.buildExamResult(args));
});

test("section results flow into the consolidated result end to end", () => {
  const aptitude = S.summarizeObjectiveSection({ key: "APTITUDE", maxMarks: 25, items: Array.from({ length: 10 }, (_, i) => item("Percentages", i < 8 ? "A" : "B", "A", { marks: 2.5, negativePerWrong: 0 })) });
  const technical = S.summarizeObjectiveSection({ key: "TECHNICAL", maxMarks: 25, items: Array.from({ length: 10 }, (_, i) => item("DBMS", i < 6 ? "A" : null, "A", { marks: 2.5, negativePerWrong: 0, subject: "DBMS" })) });
  const coding = S.summarizeCodingSection({ maxMarks: 30, problems: [problem("p1", 15, true, { status: "OK", passed: 10, total: 10 }), problem("p2", 15, true, { status: "OK", passed: 5, total: 10 })] });
  const interview = S.summarizeInterviewSection({ maxMarks: 20, turns: [turn("q1", 10, true, false, { status: "DONE", score: 8 }), turn("q2", 10, true, false, { status: "DONE", score: 6 })] });
  const r = S.buildExamResult({ sections: [aptitude, technical, coding, interview], totalMarks: 100, passing: { passingPercent: 50 }, proctoring: S.summarizeProctoringEvents([]) });
  assert.equal(aptitude.obtained, 20);
  assert.equal(technical.obtained, 15);
  assert.equal(coding.obtained, 22.5);
  assert.equal(interview.obtained, 14);
  assert.equal(r.obtained, 71.5);
  assert.equal(r.percent, 71.5);
  assert.equal(r.passed, true);
  assert.equal(r.strongestSection, "APTITUDE");
});
