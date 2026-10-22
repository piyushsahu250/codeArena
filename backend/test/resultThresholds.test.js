// Validation of an examination's marks thresholds. REGRESSION (2026-10 audit): creating an examination checked only "total marks > 0"; editing one only coerced the values
// to numbers and then recomputed every entry. An edit could set total marks to 0, negative or NaN, a passing percentage of 150 or -5, passing marks above the total, or lower
// the total below marks already entered, which stored and published a percentage over 100.
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateExamThresholds: v } = require("../src/utils/resultThresholds");

test("ordinary thresholds pass, with a passing percentage, passing marks, or either one unset", () => {
  assert.equal(v({ totalMarks: 100, passingPercent: 40 }), null);
  assert.equal(v({ totalMarks: 100, passingMarks: 35 }), null);
  assert.equal(v({ totalMarks: 50.5, passingMarks: 20.25, passingPercent: null }), null);
  assert.equal(v({ totalMarks: 100, passingPercent: 0 }), null, "0% is a legal passing percentage");
  assert.equal(v({ totalMarks: 100, passingPercent: 100 }), null);
  assert.equal(v({ totalMarks: 100, passingMarks: 100 }), null, "passing marks equal to the total is allowed");
});

test("total marks must be a finite number above zero", () => {
  for (const total of [0, -5, NaN, Infinity, null, undefined, "100", {}]) assert.match(v({ totalMarks: total, passingPercent: 40 }), /Total marks must be a number greater than 0/, String(total));
});

test("passing percentage must be between 0 and 100", () => {
  for (const p of [-5, 150, 100.01, NaN, Infinity, "40"]) assert.match(v({ totalMarks: 100, passingPercent: p }), /between 0 and 100/, String(p));
});

test("passing marks must be non-negative and not above the total", () => {
  for (const m of [-1, NaN, "35"]) assert.match(v({ totalMarks: 100, passingMarks: m }), /Passing marks must be a number that is not negative/, String(m));
  assert.match(v({ totalMarks: 100, passingMarks: 101 }), /cannot exceed the total marks \(100\)/);
});

test("lowering the total below marks already entered is refused, and names the highest entry", () => {
  assert.match(v({ totalMarks: 80, passingPercent: 40 }, { highestEnteredMarks: 95 }), /already been entered above this total \(highest entered: 95\)/);
  assert.equal(v({ totalMarks: 95, passingPercent: 40 }, { highestEnteredMarks: 95 }), null, "equal to the highest mark is fine");
  assert.equal(v({ totalMarks: 80, passingPercent: 40 }, { highestEnteredMarks: null }), null, "no entries yet");
  assert.equal(v({ totalMarks: 80, passingPercent: 40 }, {}), null);
});

test("the first problem found is reported, so the message is always one clear sentence", () => {
  const msg = v({ totalMarks: 0, passingPercent: 500, passingMarks: -3 });
  assert.equal(typeof msg, "string");
  assert.match(msg, /Total marks/);
});
