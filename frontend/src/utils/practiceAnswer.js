// How a checked practice question is shown. Pure, so scripts/practiceAnswerRegression.mjs can test it without a browser.
//
// `result` is the answer of POST /learning/practice/:id/check: { correct, correctAnswer, explanation }. For a choice question `correctAnswer` is a position in the options AS THE
// STUDENT WAS SHOWN THEM (the server shuffles options per student and answers in that same order); for a fill-in-the-blank it is the expected text.

// Style for one option after the question was checked: the right one turns green, a wrong choice turns red, the rest stay as they were.
export function optionHighlight(result, idx, selected) {
  if (!result) return {};
  if (idx === Number(result.correctAnswer)) return { background: "var(--success-bg)", borderColor: "var(--mint)" };
  if (!result.correct && idx === selected) return { background: "var(--danger-bg)", borderColor: "var(--rust)" };
  return {};
}

// The correct answer in words, or "" when it cannot be named (so nothing misleading is shown).
export function correctAnswerText(question, result) {
  if (!result) return "";
  if (question.type === "FILL_BLANK") return result.correctAnswer == null ? "" : String(result.correctAnswer);
  const position = Number(result.correctAnswer);
  if (result.correctAnswer == null || result.correctAnswer === "" || !Number.isInteger(position)) return "";
  const opt = (question.options || [])[position];
  return opt == null ? "" : String(opt);
}
