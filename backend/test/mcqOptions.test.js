// Regression coverage for utils/mcqOptions.js — the write-time gate for every MCQ/TRUE_FALSE/
// MULTISELECT question (create, edit, bulk-import all funnel through normalizeOptions). Added
// specifically so the duplicate-option bug the Question Completeness Audit surfaced this session
// (5 real PracticeQuestion rows found with byte-identical repeated options, invisible until then)
// can never silently regress — run with `npm test` (plain node:test, no extra dependency needed).
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeOptions, normalizeCorrectIndices } = require("../src/utils/mcqOptions");

describe("normalizeOptions — MCQ", () => {
  test("accepts a valid MCQ with 2+ options and one correct answer", () => {
    const result = normalizeOptions("MCQ", ["4 bytes", "2 bytes", "8 bytes"], [0]);
    assert.deepEqual(result, { options: ["4 bytes", "2 bytes", "8 bytes"], correctAnswer: [0] });
  });

  test("rejects fewer than 2 options", () => {
    assert.throws(() => normalizeOptions("MCQ", ["only one"], [0]), /at least 2 options/);
  });

  test("rejects fewer than 2 options after blank ones are dropped", () => {
    assert.throws(() => normalizeOptions("MCQ", ["real option", "   ", ""], [0]), /at least 2 options/);
  });

  test("trims whitespace-only options out before counting/validating", () => {
    const result = normalizeOptions("MCQ", ["  A  ", "B", "   "], [0]);
    assert.deepEqual(result.options, ["A", "B"]);
  });

  test("rejects a byte-for-byte duplicate option by default", () => {
    assert.throws(
      () => normalizeOptions("MCQ", ["Same text", "Different", "Same text"], [0]),
      /duplicate option/
    );
  });

  test("does NOT treat a case-different option as a duplicate — real questions rely on this", () => {
    // e.g. a question testing whether toUpperCase() mutates in place: "HELLO" vs "hello" must be
    // two legitimately distinct options, not flagged as duplicates.
    const result = normalizeOptions("MCQ", ["HELLO", "hello", "Goodbye"], [0]);
    assert.equal(result.options.length, 3);
  });

  test("checkDuplicates:false skips the duplicate check (PATCH's untouched-options fallback)", () => {
    const result = normalizeOptions("MCQ", ["Same", "Same"], [0], { checkDuplicates: false });
    assert.deepEqual(result.options, ["Same", "Same"]);
  });

  test("rejects zero correct answers", () => {
    assert.throws(() => normalizeOptions("MCQ", ["A", "B"], []), /at least one correct answer/);
  });

  // NOTE: normalizeCorrectIndices itself already truncates to the first index whenever isMulti is
  // false (`unique.slice(0, 1)`), before normalizeOptions's own "only one correct answer" check
  // ever sees more than one — so that check can never actually throw via this path today. Asserting
  // the REAL current behavior here (silent truncation, not a rejection) rather than the behavior
  // the dead code implies, so this test can't give a false sense that multi-answer MCQ input is
  // being rejected when it's actually just quietly narrowed to the first answer.
  test("plain MCQ with multiple indices silently keeps only the first (documented current behavior, not a rejection)", () => {
    const result = normalizeOptions("MCQ", ["A", "B", "C"], [0, 1]);
    assert.deepEqual(result.correctAnswer, [0]);
  });

  test("rejects a correct-answer index outside the option range", () => {
    // normalizeCorrectIndices filters out-of-range indices entirely, so this surfaces as "no
    // correct answer" rather than a distinct out-of-range error — asserting that end-to-end
    // behavior here, not just the internal filtering.
    assert.throws(() => normalizeOptions("MCQ", ["A", "B"], [5]), /at least one correct answer/);
  });
});

describe("normalizeOptions — MULTISELECT", () => {
  test("allows multiple correct answers", () => {
    const result = normalizeOptions("MULTISELECT", ["A", "B", "C"], [0, 2]);
    assert.deepEqual(result.correctAnswer, [0, 2]);
  });

  test("still rejects duplicate options", () => {
    assert.throws(() => normalizeOptions("MULTISELECT", ["A", "A", "B"], [0, 1]), /duplicate option/);
  });
});

describe("normalizeOptions — TRUE_FALSE", () => {
  test("always produces exactly True/False options regardless of input", () => {
    const result = normalizeOptions("TRUE_FALSE", ["ignored", "also ignored"], [0]);
    assert.deepEqual(result.options, ["True", "False"]);
  });

  test("accepts a text correct answer (\"True\"/\"False\"), not just an index", () => {
    const result = normalizeOptions("TRUE_FALSE", [], "False");
    assert.deepEqual(result.correctAnswer, [1]);
  });

  test("rejects a correct answer that isn't True or False", () => {
    assert.throws(() => normalizeOptions("TRUE_FALSE", [], "Maybe"), /correct answer of True or False/);
  });
});

describe("normalizeCorrectIndices — bulk-import text parsing", () => {
  const options = ["Alpha", "Beta", "Gamma", "Delta"];

  test("resolves a 1-based option number from spreadsheet text", () => {
    assert.deepEqual(normalizeCorrectIndices("2", options, false), [1]);
  });

  test("resolves option text case-insensitively", () => {
    assert.deepEqual(normalizeCorrectIndices("gamma", options, false), [2]);
  });

  test("resolves comma-separated multi-select answers", () => {
    assert.deepEqual(normalizeCorrectIndices("Alpha, Gamma", options, true).sort(), [0, 2]);
  });

  test("falls back to matching the WHOLE raw string when comma-splitting finds nothing — a single-answer option that itself contains a comma", () => {
    const listOptions = ["Samkhya, Yoga, Nyaya", "Vedanta", "Mimamsa"];
    assert.deepEqual(normalizeCorrectIndices("Samkhya, Yoga, Nyaya", listOptions, false), [0]);
  });

  test("an out-of-range numeric answer resolves to nothing (not silently wrong)", () => {
    assert.deepEqual(normalizeCorrectIndices("99", options, false), []);
  });
});
