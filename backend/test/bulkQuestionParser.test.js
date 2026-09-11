// Regression coverage for utils/bulkQuestionParser.js's pure helpers — added as part of the bulk
// question upload redesign to lock down the new letter-list normalization (splitLetterList) and
// the existing letter->option-number mapping it depends on. Run with `npm test`.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { letterToOptionNumber, splitLetterList, resolveCorrectLetterToken } = require("../src/utils/bulkQuestionParser");

describe("letterToOptionNumber", () => {
  test("maps A-F (case-insensitive) to a 1-based option number", () => {
    assert.equal(letterToOptionNumber("A"), "1");
    assert.equal(letterToOptionNumber("a"), "1");
    assert.equal(letterToOptionNumber("D"), "4");
    assert.equal(letterToOptionNumber("f"), "6");
  });

  test("anything outside A-F returns empty string, never a crash", () => {
    assert.equal(letterToOptionNumber("G"), "");
    assert.equal(letterToOptionNumber(""), "");
    assert.equal(letterToOptionNumber(null), "");
    assert.equal(letterToOptionNumber("1"), "");
    // "ABCDEF".indexOf("") and "ABCDEF".indexOf("AB") are both 0 in plain JavaScript (a substring
    // match at the very start) -- these two guard against that indexOf quirk specifically.
    assert.equal(letterToOptionNumber("AB"), "");
    assert.equal(letterToOptionNumber(undefined), "");
  });
});

describe("splitLetterList — Multiple-Selection 'Correct Options' separator normalization", () => {
  test("all four documented separator conventions split into the same letter tokens", () => {
    assert.deepEqual(splitLetterList("A,C,D"), ["A", "C", "D"]);
    assert.deepEqual(splitLetterList("A, C, D"), ["A", "C", "D"]);
    assert.deepEqual(splitLetterList("A C D"), ["A", "C", "D"]);
    assert.deepEqual(splitLetterList("A+C+D"), ["A", "C", "D"]);
    assert.deepEqual(splitLetterList("a,c,d"), ["a", "c", "d"]);
  });

  test("mixed/messy separators and surrounding whitespace still resolve", () => {
    assert.deepEqual(splitLetterList("  A ,  C,D  "), ["A", "C", "D"]);
    assert.deepEqual(splitLetterList("a, c d"), ["a", "c", "d"]);
  });

  test("a single letter is not a list -- returns null so the caller's normal single-answer path handles it", () => {
    assert.equal(splitLetterList("A"), null);
    assert.equal(splitLetterList(""), null);
    assert.equal(splitLetterList(null), null);
  });

  test("free-text answers are never misread as a letter list", () => {
    // Real English words made only of A-F letters -- must NOT be treated as a letter list, or a
    // genuine single-answer MCQ whose correct text happens to be one of these would be corrupted.
    assert.equal(splitLetterList("face"), null);
    assert.equal(splitLetterList("decaf"), null);
    assert.equal(splitLetterList("New Delhi"), null);
    assert.equal(splitLetterList("Paris"), null);
  });

  test("a letter list with an out-of-range or non-letter token is rejected outright, not partially parsed", () => {
    assert.equal(splitLetterList("A,C,G"), null); // G is not a valid option letter (A-F only)
    assert.equal(splitLetterList("A,2,C"), null);
  });
});

describe("resolveCorrectLetterToken — single Correct Option cell auto-correction", () => {
  test("bare letters, any case, with surrounding whitespace", () => {
    assert.equal(resolveCorrectLetterToken("A"), "1");
    assert.equal(resolveCorrectLetterToken("a"), "1");
    assert.equal(resolveCorrectLetterToken(" a "), "1");
    assert.equal(resolveCorrectLetterToken("D"), "4");
  });

  test("prefixed forms: Option/Answer/Choice + letter", () => {
    assert.equal(resolveCorrectLetterToken("option a"), "1");
    assert.equal(resolveCorrectLetterToken("Option A"), "1");
    assert.equal(resolveCorrectLetterToken("Answer C"), "3");
    assert.equal(resolveCorrectLetterToken("Choice D"), "4");
  });

  test("trailing/surrounding punctuation: 'A.', 'a)', '(A)'", () => {
    assert.equal(resolveCorrectLetterToken("A."), "1");
    assert.equal(resolveCorrectLetterToken("a)"), "1");
    assert.equal(resolveCorrectLetterToken("(A)"), "1");
    assert.equal(resolveCorrectLetterToken("(a)"), "1");
  });

  test("free text, numbers, and anything not a clean single letter reference returns null untouched", () => {
    assert.equal(resolveCorrectLetterToken("Paris"), null);
    assert.equal(resolveCorrectLetterToken("2"), null);
    assert.equal(resolveCorrectLetterToken(""), null);
    assert.equal(resolveCorrectLetterToken("AB"), null); // two letters together is not a single reference
    assert.equal(resolveCorrectLetterToken("G"), null); // out of A-F range
  });
});
