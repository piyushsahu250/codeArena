// The semantic gate that sits next to questionValidation.js's structural one: a stored reference solution is run through the judge against the question's own test
// cases before the question can be marked VERIFIED, so a wrong expected output or a broken solution cannot reach VERIFIED or PUBLISHED undetected. It reuses the
// judgeSubmission() + runQueued() pipeline a real student submission goes through, and is skipped when no reference solution is stored (most older questions
// predate that field: the rule is "verify a solution IF one exists", not "require one").
const { judgeSubmission } = require("../../utils/judgeGateway");
const { runQueued } = require("../../utils/queue");
const { safeErrorMessage } = require("../../utils/errors");

async function validateReferenceSolutions(question, testCases) {
  const reasons = [];
  const solutions = question.referenceSolution;
  if (!solutions || typeof solutions !== "object") return reasons;
  const languages = Object.keys(solutions).filter((lang) => solutions[lang] && String(solutions[lang]).trim());

  for (const language of languages) {
    let result;
    try {
      result = await runQueued(() =>
        judgeSubmission({
          language, code: solutions[language], testCases,
          timeLimitMs: question.timeLimitMs || 2000,
          memoryLimitKb: question.memoryLimitKb || undefined,
          evaluationType: question.evaluationType, functionSignature: question.functionSignature, sqlSchema: question.sqlSchema,
          comparisonMode: question.comparisonMode, floatAbsoluteTolerance: question.floatAbsoluteTolerance, floatRelativeTolerance: question.floatRelativeTolerance,
        })
      );
    } catch (err) {
      // A busy judge queue is an availability problem, not proof the solution is broken, but an unverifiable solution still blocks VERIFIED rather than passing.
      reasons.push(
        err.queueBusy
          ? `Could not validate the ${language} reference solution — code execution is currently busy. Please try again shortly.`
          : `Could not validate the ${language} reference solution: ${safeErrorMessage(err, "unknown error")}`
      );
      continue;
    }
    if (result.passedCases !== result.totalCases) {
      const firstFailure = (result.details || []).find((d) => d.verdict !== "PASSED");
      const evidence = firstFailure
        ? ` (first failure: ${firstFailure.verdict} on input "${String(firstFailure.input ?? "").slice(0, 80)}" — expected "${String(firstFailure.expected ?? "").slice(0, 80)}", got "${String(firstFailure.actual ?? firstFailure.error ?? "").slice(0, 80)}")`
        : "";
      reasons.push(`The stored ${language} reference solution only passes ${result.passedCases}/${result.totalCases} of this question's own test cases${evidence}`);
    }
  }
  return reasons;
}

module.exports = { validateReferenceSolutions };
