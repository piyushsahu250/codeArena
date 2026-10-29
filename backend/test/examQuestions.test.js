const { test } = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../src/utils/examQuestions");

const apt = (over = {}) => ({ id: "a1", prompt: "What is 20% of 50?", options: ["5", "10", "15", "20"], correctAnswer: 1, aptitudeCategory: "QUANTITATIVE", ...over });
const tech = (over = {}) => ({ id: "t1", description: "Which is a stack operation?", options: ["push", "enqueue", "insert at tail"], correctAnswer: [0], questionType: "MCQ", ...over });

// ---- answer keys -----------------------------------------------------------------------------------------------------------------------------------------------------------------
test("a question with one clear key is valid", () => {
  assert.equal(Q.validateObjectiveQuestion(apt(), "APTITUDE").valid, true);
  assert.deepEqual(Q.validateObjectiveQuestion(apt(), "APTITUDE").key, [1]);
  assert.equal(Q.validateObjectiveQuestion(tech(), "TECHNICAL").valid, true);
});

test("a question without a usable key is excluded, with the reason", () => {
  const reason = (q, kind) => Q.validateObjectiveQuestion(q, kind).reason;
  assert.equal(reason(apt({ correctAnswer: null }), "APTITUDE"), "KEY_INVALID");
  assert.equal(reason(apt({ correctAnswer: undefined }), "APTITUDE"), "KEY_INVALID");
  assert.equal(reason(apt({ correctAnswer: 7 }), "APTITUDE"), "KEY_INVALID", "key outside the options");
  assert.equal(reason(apt({ correctAnswer: -1 }), "APTITUDE"), "KEY_INVALID");
  assert.equal(reason(apt({ correctAnswer: "1" }), "APTITUDE"), "KEY_INVALID", "a string is not an index");
  assert.equal(reason(apt({ correctAnswer: [] }), "APTITUDE"), "KEY_INVALID");
  assert.equal(reason(apt({ correctAnswer: [1, 1] }), "APTITUDE"), "KEY_INVALID", "the same index twice is ambiguous");
  assert.equal(reason(apt({ options: ["only one"] }), "APTITUDE"), "OPTIONS_MISSING");
  assert.equal(reason(apt({ options: null }), "APTITUDE"), "OPTIONS_MISSING");
  assert.equal(reason(apt({ options: ["5", "", "15", "20"] }), "APTITUDE"), "OPTION_EMPTY");
  assert.equal(reason(apt({ options: ["10", "10 ", "15", "20"] }), "APTITUDE"), "DUPLICATE_OPTIONS", "two identical options make the key ambiguous");
  assert.equal(reason(apt({ prompt: "  " }), "APTITUDE"), "TEXT_MISSING");
  assert.equal(reason(null, "APTITUDE"), "MISSING");
});

test("single-answer questions cannot have two keys; multiple select can; true/false needs two options", () => {
  assert.equal(Q.validateObjectiveQuestion(apt({ correctAnswer: [0, 1] }), "APTITUDE").reason, "SINGLE_ANSWER_EXPECTED");
  assert.equal(Q.validateObjectiveQuestion(tech({ correctAnswer: [0, 1] }), "TECHNICAL").reason, "SINGLE_ANSWER_EXPECTED");
  assert.equal(Q.validateObjectiveQuestion(tech({ questionType: "MULTISELECT", correctAnswer: [0, 2] }), "TECHNICAL").valid, true);
  assert.equal(Q.validateObjectiveQuestion(tech({ questionType: "TRUE_FALSE", options: ["True", "False"], correctAnswer: [1] }), "TECHNICAL").valid, true);
  assert.equal(Q.validateObjectiveQuestion(tech({ questionType: "TRUE_FALSE", options: ["True", "False", "Maybe"], correctAnswer: [1] }), "TECHNICAL").reason, "TRUE_FALSE_NEEDS_TWO_OPTIONS");
});

test("correctIndices returns a sorted copy or null", () => {
  assert.deepEqual(Q.correctIndices(["a", "b", "c"], [2, 0]), [0, 2]);
  assert.deepEqual(Q.correctIndices(["a", "b", "c"], 1), [1]);
  assert.equal(Q.correctIndices(["a", "b"], [5]), null);
  assert.equal(Q.correctIndices("no", 0), null);
});

// ---- marks ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
test("marks are split exactly: the parts always add up to the section maximum", () => {
  assert.deepEqual(Q.splitMarks(10, 4), [2.5, 2.5, 2.5, 2.5]);
  assert.deepEqual(Q.splitMarks(10, 3), [3.34, 3.33, 3.33]);
  for (const [max, n] of [[25, 20], [30, 7], [100, 13], [0.07, 3], [99.99, 11]]) {
    const parts = Q.splitMarks(max, n);
    assert.equal(parts.length, n);
    assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), Math.round(max * 100), `${max} over ${n}`);
    assert.ok(parts.every((p) => p >= 0));
  }
  assert.deepEqual(Q.splitMarks(10, 0), []);
  assert.deepEqual(Q.splitMarks(10, 1.5), []);
});

// ---- selection --------------------------------------------------------------------------------------------------------------------------------------------------------------------
test("selection is deterministic: the same attempt always gets the same questions", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `q${i}`);
  const a = Q.selectSeeded(ids, 10, "attempt-1");
  assert.deepEqual(Q.selectSeeded(ids, 10, "attempt-1"), a);
  assert.deepEqual(Q.selectSeeded([...ids].reverse(), 10, "attempt-1"), a, "database row order does not matter");
  assert.notEqual(JSON.stringify(Q.selectSeeded(ids, 10, "attempt-2")), JSON.stringify(a), "another attempt gets another paper");
  assert.equal(new Set(a).size, 10, "no repeats");
  assert.equal(Q.selectSeeded(ids, 100, "x").length, 40, "never more than exist");
  assert.equal(Q.selectSeeded(["a", "a", "b"], 5, "x").length, 2, "duplicate ids collapse");
});

test("selection by distribution takes the requested count per topic, never reuses a question, and reports a shortage", () => {
  const pools = { QUANTITATIVE: ["q1", "q2", "q3", "q4"], LOGICAL: ["l1", "l2"], VERBAL: ["v1"] };
  const r = Q.selectByDistribution(pools, [{ group: "QUANTITATIVE", count: 2 }, { group: "LOGICAL", count: 2 }, { group: "VERBAL", count: 3 }], "seed");
  assert.equal(r.selected.filter((s) => s.group === "QUANTITATIVE").length, 2);
  assert.equal(r.selected.filter((s) => s.group === "LOGICAL").length, 2);
  assert.equal(r.selected.filter((s) => s.group === "VERBAL").length, 1);
  assert.deepEqual(r.shortages, [{ group: "VERBAL", needed: 3, available: 1 }]);
  const ids = r.selected.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const overlapping = Q.selectByDistribution({ A: ["x", "y"], B: ["x", "y"] }, [{ group: "A", count: 2 }, { group: "B", count: 2 }], "s");
  assert.equal(overlapping.selected.length, 2, "a question that is in two pools is used once");
  assert.equal(overlapping.shortages.length, 1);
  assert.deepEqual(Q.selectByDistribution({}, [{ group: "A", count: 1 }], "s").shortages, [{ group: "A", needed: 1, available: 0 }]);
});

test("option order is a stable permutation per attempt and question, and maps back to the original options", () => {
  const order = Q.optionOrderFor(5, "att:q1");
  assert.deepEqual(Q.optionOrderFor(5, "att:q1"), order);
  assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4]);
  // the student picks position 2 of what was shown; the server finds the original option
  assert.equal(Q.toOriginalIndices(2, order), order[2]);
  assert.deepEqual(Q.toOriginalIndices([0, 3], order), [order[0], order[3]]);
  assert.equal(Q.toOriginalIndices(9, order), null, "a position that was never shown maps to nothing");
  assert.equal(Q.toOriginalIndices(-1, order), null);
});

// ---- answers ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
test("an objective answer must be an existing option, once, and one only unless multiple select", () => {
  const norm = (p, ctx) => Q.normalizeAnswerPayload("APTITUDE", p, ctx);
  assert.deepEqual(norm({ selected: 2 }, { optionCount: 4 }), { ok: true, value: { selected: 2 } });
  assert.deepEqual(norm({ selected: null }, { optionCount: 4 }), { ok: true, value: { selected: null } }, "clearing a choice");
  assert.equal(norm({ selected: 4 }, { optionCount: 4 }).code, "SELECTION_INVALID");
  assert.equal(norm({ selected: -1 }, { optionCount: 4 }).code, "SELECTION_INVALID");
  assert.equal(norm({ selected: "1" }, { optionCount: 4 }).code, "SELECTION_INVALID");
  assert.equal(norm({ selected: [1, 2] }, { optionCount: 4, multiple: false }).code, "SELECTION_INVALID");
  assert.deepEqual(norm({ selected: [3, 1] }, { optionCount: 4, multiple: true }), { ok: true, value: { selected: [1, 3] } });
  assert.equal(norm({ selected: [1, 1] }, { optionCount: 4, multiple: true }).code, "SELECTION_INVALID");
  assert.equal(norm(null, { optionCount: 4 }).code, "PAYLOAD_INVALID");
  assert.equal(norm([1], { optionCount: 4 }).code, "PAYLOAD_INVALID");
});

test("interview answers are text with a limit; coding answers are code in a supported, allowed language", () => {
  assert.deepEqual(Q.normalizeAnswerPayload("AI_INTERVIEW", { text: "hello", input: "SPEECH" }), { ok: true, value: { text: "hello", input: "SPEECH" } });
  assert.equal(Q.normalizeAnswerPayload("AI_INTERVIEW", { text: "x", input: "weird" }).value.input, "TYPED");
  assert.equal(Q.normalizeAnswerPayload("AI_INTERVIEW", { text: 5 }).code, "TEXT_REQUIRED");
  assert.equal(Q.normalizeAnswerPayload("AI_INTERVIEW", { text: "a".repeat(Q.MAX_ANSWER_CHARS + 1) }).code, "TEXT_TOO_LONG");
  assert.deepEqual(Q.normalizeAnswerPayload("CODING", { code: "print(1)", language: "Python" }), { ok: true, value: { code: "print(1)", language: "python" } });
  assert.equal(Q.normalizeAnswerPayload("CODING", { code: "x", language: "cobol" }).code, "LANGUAGE_INVALID");
  assert.equal(Q.normalizeAnswerPayload("CODING", { code: "x", language: "java" }, { allowedLanguages: ["python"] }).code, "LANGUAGE_NOT_ALLOWED");
  assert.equal(Q.normalizeAnswerPayload("CODING", { code: 42, language: "java" }).code, "CODE_REQUIRED");
  assert.equal(Q.normalizeAnswerPayload("CODING", { code: "a".repeat(Q.MAX_CODE_CHARS + 1), language: "java" }).code, "CODE_TOO_LONG");
  assert.equal(Q.normalizeAnswerPayload("NOPE", { text: "x" }).code, "SECTION_INVALID");
});

test("an answer counts as given only when it has content", () => {
  assert.equal(Q.isAnswerNonEmpty("APTITUDE", { selected: 0 }), true, "option 0 is an answer");
  assert.equal(Q.isAnswerNonEmpty("APTITUDE", { selected: null }), false);
  assert.equal(Q.isAnswerNonEmpty("TECHNICAL", { selected: [] }), false);
  assert.equal(Q.isAnswerNonEmpty("TECHNICAL", { selected: [2] }), true);
  assert.equal(Q.isAnswerNonEmpty("AI_INTERVIEW", { text: "   " }), false);
  assert.equal(Q.isAnswerNonEmpty("AI_INTERVIEW", { text: "words" }), true);
  assert.equal(Q.isAnswerNonEmpty("CODING", { code: "\n\n" }), false);
  assert.equal(Q.isAnswerNonEmpty("CODING", { code: "int main(){}" }), true);
  assert.equal(Q.isAnswerNonEmpty("CODING", null), false);
});

// ---- what a student sees ---------------------------------------------------------------------------------------------------------------------------------------------------
test("a student never receives the answer key, explanation or model answer", () => {
  const q = { ...apt(), explanation: "20% of 50 is 10", correctAnswer: 1 };
  const shown = Q.sanitizeObjective(q, "APTITUDE", null);
  const text = JSON.stringify(shown);
  assert.ok(!("correctAnswer" in shown));
  assert.ok(!("explanation" in shown));
  assert.ok(!text.includes("20% of 50 is 10"));
  assert.deepEqual(shown.options, ["5", "10", "15", "20"]);
  const t = Q.sanitizeObjective({ ...tech(), questionType: "MULTISELECT", correctAnswer: [0, 2], explanation: "secret" }, "TECHNICAL", null);
  assert.equal(t.multiple, true);
  assert.ok(!JSON.stringify(t).includes("secret"));
  const i = Q.sanitizeInterview({ id: "i1", prompt: "Tell me about yourself", category: "HR", expectedKeywords: ["team"], modelAnswer: "secret answer" });
  assert.ok(!("expectedKeywords" in i) && !JSON.stringify(i).includes("secret"));
});

test("options are shown in the attempt's own order", () => {
  const order = [2, 0, 3, 1];
  const shown = Q.sanitizeObjective(apt(), "APTITUDE", order);
  assert.deepEqual(shown.options, ["15", "5", "20", "10"]);
  assert.deepEqual(Q.sanitizeObjective(apt(), "APTITUDE", [0, 1]).options, ["5", "10", "15", "20"], "an order of the wrong length is ignored");
});

test("a coding problem shows sample cases only, never the hidden ones", () => {
  const cases = [{ input: "1 2", expected: "3", explanation: "sum", isHidden: false }, { input: "SECRET", expected: "SECRET", isHidden: true }];
  const q = { id: "c1", title: "Sum", description: "Add", testCases: cases, timeLimitMs: 2000, evaluationType: "STDIO", questionType: "CODING", referenceSolution: { java: "secret solution" } };
  const shown = Q.sanitizeCoding(q, cases.filter((c) => !c.isHidden), ["python"]);
  assert.deepEqual(shown.samples, [{ input: "1 2", expected: "3", explanation: "sum" }]);
  assert.ok(!JSON.stringify(shown).includes("SECRET"));
  assert.ok(!JSON.stringify(shown).includes("secret solution"));
  assert.deepEqual(shown.languages, ["python"]);
  assert.equal(Q.sanitizeCoding(q, [], []).languages, null);
});
