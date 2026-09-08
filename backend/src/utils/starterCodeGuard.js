// Guards against a coding question/task's student-facing starter code already being a complete,
// correct solution -- confirmed live 2026-09-07 as a real, actively-exploited issue: a staff
// member had pasted working solutions into starterCodeByLanguage instead of a non-solving
// template, on 5 questions in a live test, letting any student Run/Submit the untouched starter
// and get ACCEPTED with zero effort. That incident was fixed as a one-time data cleanup for
// those 5 rows; this is the "by default, going forward" half of the fix -- a save-time check, so
// the same authoring mistake can't quietly ship again on ANY surface that authors its own coding
// starter code (Question Bank's routes/questions.js, and Project-Based Learning's ProjectTask via
// routes/learning.js -- kept here, shared, rather than copy-pasted into each, since both need the
// exact same check against the exact same shape: starterCodeByLanguage + testCases +
// evaluationType + functionSignature).
//
// Reuses the platform's own judge (judgeSubmission via runQueued -- the same fair, concurrency-
// limited queue every live student Run/Submit call already goes through) to actually RUN the
// starter code against the real test cases, rather than a text-similarity heuristic -- the only
// way to know for certain "does this code already solve the problem" is to run it, the same way
// questions.js's own POST /validate-test-cases already does for an admin's reference solution.
// This asks the same judge the opposite question: does the STUDENT-FACING starter code already
// pass, instead of does the private reference solution pass.
//
// Deliberately a forward-looking guard, not a retroactive re-check: callers should only invoke
// this when the current request actually supplies starterCodeByLanguage, so editing an unrelated
// field (title, difficulty, instructions, ...) on an already-existing question/task never
// re-triggers it against content the caller never touched -- a full retroactive sweep of existing
// content is a separate, deliberately-throttled audit job, not something a single live save
// request should pay the judge-queue cost of. A starter template that fails to even compile is
// exactly the safe case, not an error to surface -- judgeSubmission() itself already reports that
// as a normal (non-ACCEPTED) verdict, so no separate try/catch branch is needed here for it.
const { judgeSubmission } = require("./judge");
const { runQueued } = require("./queue");

async function guardStarterCodeIsNotSolution({ starterCodeByLanguage, testCases, evaluationType, functionSignature, timeLimitMs, memoryLimitKb, comparisonMode, floatAbsoluteTolerance, floatRelativeTolerance }) {
  if (!starterCodeByLanguage || typeof starterCodeByLanguage !== "object") return null;
  const cases = Array.isArray(testCases) ? testCases : [];
  if (cases.length === 0) return null;
  for (const [language, code] of Object.entries(starterCodeByLanguage)) {
    if (!code || !code.trim()) continue;
    // Graded with the SAME comparisonMode the question will actually use for students -- checking
    // with a stricter default (TRIM) than the question's real, looser configured mode (e.g.
    // FLOAT_TOLERANCE) could let a starter template through that a student's identical output
    // would score ACCEPTED on for real, since the guard would have been comparing under different
    // rules than actual grading ever will.
    const result = await runQueued(() =>
      judgeSubmission({ language, code, testCases: cases, timeLimitMs: timeLimitMs || 2000, memoryLimitKb: memoryLimitKb || undefined, evaluationType, functionSignature, comparisonMode, floatAbsoluteTolerance, floatRelativeTolerance })
    );
    if (result.verdict === "ACCEPTED") {
      return `The starter code for ${language} already passes every test case -- it looks like a working solution, not a starting template. Replace it with a non-solving template (e.g. "// Write your solution here"), or move the real solution to the Reference Solution field instead, which is never shown to students.`;
    }
  }
  return null;
}

module.exports = { guardStarterCodeIsNotSolution };
