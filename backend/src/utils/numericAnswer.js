// Pure parse + grade logic for NUMERICAL-type questions (math tests). Zero dependencies so it can
// be unit-tested directly — see backend/test/numericAnswer.test.js. Used by the question
// create/edit routes (to normalise the author's expected answer) and by the quiz-answer grading
// path in routes/submissions.js.
//
// Design notes:
//  - A fraction "a/b", a decimal "0.5", and "2/4" all parse to the same float, so mathematically
//    equivalent forms are accepted automatically — no "acceptEquivalentForms" flag needed.
//  - Negative signs are preserved ("-3/4" -> -0.75, "-2.5" -> -2.5). Leading "+" is allowed.
//  - A handful of everyday unicode maths characters are folded to ASCII first (− minus, ×, ÷, ½
//    etc.) so a student pasting from a rendered equation or a phone keyboard isn't marked wrong
//    for a character they can't easily avoid.
//  - Grouping commas in plain integers ("1,000") are stripped; a comma is otherwise not a decimal
//    separator here (the platform's audience writes "1000.5", not "1000,5").
//  - Scientific notation ("1.2e3", "6.02E23") is accepted.
//  - Anything that isn't a clean single number (words, ranges, multiple numbers, bare operators)
//    returns null — the grader treats null as "no valid answer entered" = wrong, never a crash.

const UNICODE_FOLD = [
  [/[−–—－]/g, "-"], // minus sign, en/em dash, fullwidth hyphen -> hyphen-minus
  [/[×⋅∗＊]/g, "*"], // ×, ⋅, ∗, fullwidth * -> *
  [/[÷∕⁄／]/g, "/"], // ÷, ∕, ⁄, fullwidth / -> /
  [/½/g, "1/2"], [/⅓/g, "1/3"], [/⅔/g, "2/3"], [/¼/g, "1/4"], [/¾/g, "3/4"],
  [/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 0x30)], // fullwidth digits
];

function foldToAscii(raw) {
  // Trim SURROUNDING whitespace only. Internal whitespace is deliberately NOT collapsed, so
  // "1 2" stays two tokens and is correctly rejected as "not one number" rather than silently
  // becoming 12.
  let s = String(raw).replace(/^\s+|\s+$/g, "");
  for (const [re, rep] of UNICODE_FOLD) s = s.replace(re, rep);
  return s;
}

// Parses a single numeric value from a string. Returns a finite Number, or null if the input
// isn't exactly one clean number.
function parseNumericValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let s = foldToAscii(raw);
  if (s === "") return null;

  // Strip a single leading "+" (but never a leading "-", which is significant).
  if (s.startsWith("+")) s = s.slice(1);

  // Fraction "a/b" (either part may be a decimal or negative, e.g. "-3/4", "1.5/2").
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    const v = num / den;
    return Number.isFinite(v) ? v : null;
  }

  // Plain integer/decimal, optionally with grouping commas ("1,000") or scientific notation.
  const plain = s.replace(/,(?=\d{3}\b)/g, ""); // remove grouping commas only
  if (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(plain)) {
    const v = Number(plain);
    return Number.isFinite(v) ? v : null;
  }

  return null;
}

// Normalises an author's expected answer at question-save time. Returns
// { numericAnswer, numericAnswerDisplay } or throws a descriptive error the create/edit route
// surfaces to the author. `rawTolerance` is validated separately by the caller.
function normalizeExpectedNumeric(rawExpected) {
  const display = String(rawExpected ?? "").trim();
  if (display === "") throw new Error("Numerical questions need an expected answer");
  const value = parseNumericValue(display);
  if (value === null) {
    throw new Error(`"${display}" isn't a number CodeArena can grade — enter an integer, a decimal (0.5), or a fraction (1/2), optionally negative`);
  }
  return { numericAnswer: value, numericAnswerDisplay: display };
}

// Grades a student's typed answer against the stored expected value + tolerance.
// tolerance is an ABSOLUTE tolerance; 0 (or null) means exact match. Returns a shape compatible
// with routes/submissions.js's gradeQuizAnswer (passedCases/totalCases/verdict/details).
function gradeNumericAnswer(question, studentRaw) {
  const expected = typeof question.numericAnswer === "number" ? question.numericAnswer : null;
  const tolerance = Math.abs(Number(question.numericTolerance) || 0);
  const student = parseNumericValue(studentRaw);

  let isMatch = false;
  if (expected !== null && student !== null) {
    // A tiny epsilon on top of an explicit-zero tolerance absorbs floating-point representation
    // error only (e.g. 0.1 + 0.2 !== 0.3) — it never makes a genuinely different answer pass.
    const effectiveTol = tolerance > 0 ? tolerance : Math.max(Math.abs(expected), 1) * 1e-9;
    isMatch = Math.abs(student - expected) <= effectiveTol;
  }

  return {
    passedCases: isMatch ? 1 : 0,
    totalCases: 1,
    verdict: isMatch ? "ACCEPTED" : "WRONG_ANSWER",
    details: [{ verdict: isMatch ? "PASSED" : "WRONG_ANSWER" }],
  };
}

module.exports = { parseNumericValue, normalizeExpectedNumeric, gradeNumericAnswer };
