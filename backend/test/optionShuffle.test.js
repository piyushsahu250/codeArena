// Regression coverage for utils/optionShuffle.js. answerIndexSetsMatch is new (added alongside
// the AI Question Generator's independent answer-verification pass); shuffleQuestionOptions was
// previously untested despite being the exact mechanism that defeats an LLM's own answer-position
// bias (spec: "randomization must happen after validating the answer... never change the correct
// answer merely to balance positions, instead reorder the options while preserving it"). Run with
// `npm test`.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { shuffleQuestionOptions, toOriginalSelection, answerIndexSetsMatch } = require("../src/utils/optionShuffle");

describe("answerIndexSetsMatch", () => {
  test("same indices, any order, are a match", () => {
    assert.equal(answerIndexSetsMatch([0], [0]), true);
    assert.equal(answerIndexSetsMatch([1, 3], [3, 1]), true);
    assert.equal(answerIndexSetsMatch([0, 1, 2], [2, 0, 1]), true);
  });

  test("different indices, or different counts, are not a match", () => {
    assert.equal(answerIndexSetsMatch([0], [1]), false);
    assert.equal(answerIndexSetsMatch([0, 1], [0]), false);
    assert.equal(answerIndexSetsMatch([], [0]), false);
  });

  test("uses real numeric comparison, not lexicographic string sort", () => {
    // Array.prototype.sort()'s default would put 10 before 2 ("10" < "2" as strings) -- this must
    // still recognize these as the same set.
    assert.equal(answerIndexSetsMatch([2, 10], [10, 2]), true);
  });

  test("non-array input never throws, just doesn't match", () => {
    assert.equal(answerIndexSetsMatch(null, [0]), false);
    assert.equal(answerIndexSetsMatch([0], undefined), false);
  });
});

describe("shuffleQuestionOptions — the mechanism that defeats correct-answer position bias", () => {
  test("the correct answer's TEXT is preserved even though its position moves", () => {
    const options = ["Alpha", "Beta", "Gamma", "Delta"];
    const { options: shuffled, correctAnswer } = shuffleQuestionOptions(options, [0], "seed-1");
    assert.equal(shuffled[correctAnswer[0]], "Alpha"); // whatever position it landed at, it's still the right text
    assert.equal(shuffled.length, 4);
    assert.deepEqual([...shuffled].sort(), [...options].sort()); // same set of options, just reordered
  });

  test("different seeds produce different orderings (real randomization, not a no-op)", () => {
    const options = ["A", "B", "C", "D", "E", "F"];
    const results = new Set();
    for (let i = 0; i < 8; i++) {
      const { options: shuffled } = shuffleQuestionOptions(options, [0], `seed-${i}`);
      results.add(shuffled.join(","));
    }
    assert.ok(results.size > 1, "expected at least some variation across different seeds");
  });

  test("the same seed always reproduces the same permutation (stable for a given identity)", () => {
    const options = ["A", "B", "C", "D"];
    const a = shuffleQuestionOptions(options, [1], "same-seed");
    const b = shuffleQuestionOptions(options, [1], "same-seed");
    assert.deepEqual(a.options, b.options);
    assert.deepEqual(a.correctAnswer, b.correctAnswer);
  });

  test("multi-select correct answers (array) are remapped together, not just the first", () => {
    const options = ["A", "B", "C", "D"];
    const { options: shuffled, correctAnswer } = shuffleQuestionOptions(options, [0, 2], "seed-multi");
    const correctTexts = correctAnswer.map((i) => shuffled[i]).sort();
    assert.deepEqual(correctTexts, ["A", "C"]);
  });

  test("fewer than 2 options is left untouched (nothing meaningful to shuffle)", () => {
    const result = shuffleQuestionOptions(["Only one"], [0], "seed");
    assert.deepEqual(result.options, ["Only one"]);
    assert.deepEqual(result.correctAnswer, [0]);
  });

  test("toOriginalSelection inverts shuffleQuestionOptions's own permutation", () => {
    const options = ["A", "B", "C", "D", "E"];
    const { order, correctAnswer } = shuffleQuestionOptions(options, [3], "seed-invert");
    assert.deepEqual(toOriginalSelection(correctAnswer, order), [3]);
  });
});
