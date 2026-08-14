// Structural gate run before a CODING/SQL question can transition to VERIFIED (spec: "validate
// ... before an assessment becomes official"). This is a structural check, not a semantic one —
// Question has no stored reference-solution field to execute through the judge, so this catches
// the concrete "broken question" failure mode that IS checkable: too few test cases to actually
// grade a submission, a FUNCTION-mode question with no function signature for the judge to build
// a driver around, or an SQL question with no schema to run test cases against. Same minimums the
// PATCH /:id route already enforces when test cases are edited directly — reused here rather than
// re-invented, so a question can never reach VERIFIED below the bar this platform already sets for
// "gradable."
const MIN_CASES = { CODING: { visible: 2, hidden: 10 }, SQL: { visible: 1, hidden: 5 } };

function validateQuestionForVerification(question, testCases) {
  const reasons = [];
  const cases = Array.isArray(testCases) ? testCases : [];
  const visible = cases.filter((tc) => !tc.isHidden).length;
  const hidden = cases.filter((tc) => tc.isHidden).length;

  if (question.questionType === "CODING") {
    if (visible < MIN_CASES.CODING.visible) reasons.push(`Needs at least ${MIN_CASES.CODING.visible} visible sample test cases (has ${visible})`);
    if (hidden < MIN_CASES.CODING.hidden) reasons.push(`Needs at least ${MIN_CASES.CODING.hidden} hidden test cases (has ${hidden})`);
    if (question.evaluationType === "FUNCTION") {
      const sig = question.functionSignature;
      if (!sig || !sig.methodName || !sig.returnType || !Array.isArray(sig.params)) {
        reasons.push("FUNCTION-mode question is missing a valid function signature");
      }
    }
  } else if (question.questionType === "SQL") {
    if (!question.sqlSchema || !question.sqlSchema.trim()) reasons.push("Missing SQL schema (table setup / seed data)");
    if (visible < MIN_CASES.SQL.visible) reasons.push(`Needs at least ${MIN_CASES.SQL.visible} visible sample test case (has ${visible})`);
    if (hidden < MIN_CASES.SQL.hidden) reasons.push(`Needs at least ${MIN_CASES.SQL.hidden} hidden test cases (has ${hidden})`);
  }
  return reasons;
}

module.exports = { validateQuestionForVerification };
