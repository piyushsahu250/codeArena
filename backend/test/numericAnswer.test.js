// Regression coverage for utils/numericAnswer.js — the parse + grade logic for NUMERICAL-type
// questions (math tests). Run with `npm test` (plain node:test, no extra dependency needed).
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { parseNumericValue, normalizeExpectedNumeric, gradeNumericAnswer } = require("../src/utils/numericAnswer");

describe("parseNumericValue", () => {
  test("plain integers, positive and negative", () => {
    assert.equal(parseNumericValue("5"), 5);
    assert.equal(parseNumericValue("-5"), -5);
    assert.equal(parseNumericValue("+5"), 5);
    assert.equal(parseNumericValue("0"), 0);
    assert.equal(parseNumericValue("100"), 100);
  });

  test("decimals", () => {
    assert.equal(parseNumericValue("0.5"), 0.5);
    assert.equal(parseNumericValue("-2.5"), -2.5);
    assert.equal(parseNumericValue(".5"), 0.5);
    assert.equal(parseNumericValue("3.14159"), 3.14159);
  });

  test("fractions — equivalent forms collapse to the same value", () => {
    assert.equal(parseNumericValue("1/2"), 0.5);
    assert.equal(parseNumericValue("2/4"), 0.5);
    assert.equal(parseNumericValue("50/100"), 0.5);
    assert.equal(parseNumericValue("-3/4"), -0.75);
    assert.equal(parseNumericValue("3/-4"), -0.75);
    assert.equal(parseNumericValue("1.5/2"), 0.75);
  });

  test("negative signs are never silently stripped", () => {
    assert.ok(parseNumericValue("-5") < 0);
    assert.ok(parseNumericValue("-3/4") < 0);
    assert.ok(parseNumericValue("-2.5") < 0);
    assert.notEqual(parseNumericValue("-5"), parseNumericValue("5"));
  });

  test("everyday unicode maths characters are folded to ASCII", () => {
    assert.equal(parseNumericValue("−5"), -5); // U+2212 minus sign
    assert.equal(parseNumericValue("½"), 0.5);
    assert.equal(parseNumericValue("1÷2"), 0.5);
    assert.equal(parseNumericValue(" 5 "), 5); // surrounding whitespace / nbsp
  });

  test("scientific notation and grouping commas", () => {
    assert.equal(parseNumericValue("1.2e3"), 1200);
    assert.equal(parseNumericValue("6.02E23"), 6.02e23);
    assert.equal(parseNumericValue("1,000"), 1000);
    assert.equal(parseNumericValue("1,000,000"), 1000000);
  });

  test("division by zero and non-finite results return null, never crash", () => {
    assert.equal(parseNumericValue("1/0"), null);
    assert.equal(parseNumericValue("0/0"), null);
  });

  test("anything that isn't exactly one clean number returns null", () => {
    for (const junk of ["", "  ", "abc", "5 apples", "5 to 10", "1 2", "= 5", "x", "5x", "--5", "5/", "/5", "5..5", null, undefined, "NaN", "Infinity"]) {
      assert.equal(parseNumericValue(junk), null, `${JSON.stringify(junk)} should parse to null`);
    }
  });
});

describe("normalizeExpectedNumeric — author's expected answer at save time", () => {
  test("stores the parsed float plus the exact text the author typed", () => {
    assert.deepEqual(normalizeExpectedNumeric("1/2"), { numericAnswer: 0.5, numericAnswerDisplay: "1/2" });
    assert.deepEqual(normalizeExpectedNumeric("  -3.14159 "), { numericAnswer: -3.14159, numericAnswerDisplay: "-3.14159" });
    assert.deepEqual(normalizeExpectedNumeric("100"), { numericAnswer: 100, numericAnswerDisplay: "100" });
  });

  test("rejects an empty or ungradeable expected answer with a clear message", () => {
    assert.throws(() => normalizeExpectedNumeric(""), /need an expected answer/);
    assert.throws(() => normalizeExpectedNumeric("   "), /need an expected answer/);
    assert.throws(() => normalizeExpectedNumeric("about five"), /isn't a number CodeArena can grade/);
  });
});

describe("gradeNumericAnswer", () => {
  const exact = { numericAnswer: 100, numericTolerance: 0 };
  const half = { numericAnswer: 0.5, numericTolerance: 0 };
  const pi = { numericAnswer: 3.14159, numericTolerance: 0.001 };

  function scored(q, raw) {
    return gradeNumericAnswer(q, raw).verdict;
  }

  test("exact integer match — right answer accepted, near-miss rejected", () => {
    assert.equal(scored(exact, "100"), "ACCEPTED");
    assert.equal(scored(exact, "100.0"), "ACCEPTED");
    assert.equal(scored(exact, " 100 "), "ACCEPTED");
    assert.equal(scored(exact, "99"), "WRONG_ANSWER");
    assert.equal(scored(exact, "100.5"), "WRONG_ANSWER");
    assert.equal(scored(exact, "-100"), "WRONG_ANSWER");
  });

  test("equivalent forms of a fraction answer are all accepted (tolerance 0)", () => {
    assert.equal(scored(half, "1/2"), "ACCEPTED");
    assert.equal(scored(half, "0.5"), "ACCEPTED");
    assert.equal(scored(half, "2/4"), "ACCEPTED");
    assert.equal(scored(half, "50/100"), "ACCEPTED");
    assert.equal(scored(half, "0.50"), "ACCEPTED");
    assert.equal(scored(half, "0.6"), "WRONG_ANSWER");
    assert.equal(scored(half, "1/3"), "WRONG_ANSWER");
  });

  test("decimal answer with an explicit tolerance accepts a rounded answer", () => {
    assert.equal(scored(pi, "3.14159"), "ACCEPTED");
    assert.equal(scored(pi, "3.142"), "ACCEPTED"); // within 0.001
    assert.equal(scored(pi, "3.1416"), "ACCEPTED");
    assert.equal(scored(pi, "3.14"), "WRONG_ANSWER"); // 0.00159 away, outside 0.001
    assert.equal(scored(pi, "3"), "WRONG_ANSWER");
  });

  test("floating-point representation error never fails an otherwise-exact answer", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754; a student who types "0.3" for that expected
    // value must still be marked correct even with tolerance 0.
    assert.equal(scored({ numericAnswer: 0.1 + 0.2, numericTolerance: 0 }, "0.3"), "ACCEPTED");
  });

  test("an unparseable or empty student answer is wrong, not a crash", () => {
    assert.equal(scored(exact, ""), "WRONG_ANSWER");
    assert.equal(scored(exact, "   "), "WRONG_ANSWER");
    assert.equal(scored(exact, "hundred"), "WRONG_ANSWER");
    assert.equal(scored(exact, null), "WRONG_ANSWER");
  });

  test("a question with no stored expected value never accepts anything", () => {
    assert.equal(scored({ numericAnswer: null, numericTolerance: 0 }, "5"), "WRONG_ANSWER");
    assert.equal(scored({}, "5"), "WRONG_ANSWER");
  });

  test("negative tolerance is treated as its absolute value, not a bug", () => {
    assert.equal(scored({ numericAnswer: 10, numericTolerance: -0.5 }, "10.3"), "ACCEPTED");
  });

  test("returns the shape the quiz grading path expects", () => {
    const r = gradeNumericAnswer(exact, "100");
    assert.equal(r.passedCases, 1);
    assert.equal(r.totalCases, 1);
    assert.equal(r.verdict, "ACCEPTED");
    assert.ok(Array.isArray(r.details));
  });
});
