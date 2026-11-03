// Regression test for src/utils/practiceAnswer.js: after a practice question is checked and the answer is wrong, the student is told the correct answer and sees which option it was.
// REPORTED 2026-11-03: a wrong answer showed only "Not quite" and the explanation, never the right answer. Pure logic, no browser, no server.
// Run: node frontend/scripts/practiceAnswerRegression.mjs
import fs from "node:fs";
import { optionHighlight, correctAnswerText } from "../src/utils/practiceAnswer.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

const mcq = { type: "MCQ", options: ["Only lines with print", "The last line", "A random line", "From the top, one after another"] };

// The screenshot case: the student chose "A random line" (position 2); the right answer is position 3.
{
  const result = { correct: false, correctAnswer: 3, explanation: "Execution proceeds from the first statement downwards." };
  check("a wrong choice is answered with the text of the right option", correctAnswerText(mcq, result) === "From the top, one after another", correctAnswerText(mcq, result));
  check("the right option is highlighted green", optionHighlight(result, 3, 2).borderColor === "var(--mint)");
  check("the wrong choice is highlighted red", optionHighlight(result, 2, 2).borderColor === "var(--rust)");
  check("the other options are left alone", Object.keys(optionHighlight(result, 0, 2)).length === 0 && Object.keys(optionHighlight(result, 1, 2)).length === 0);
}

// A correct answer shows no red anywhere.
{
  const result = { correct: true, correctAnswer: 1 };
  check("a correct choice is green and nothing is red", optionHighlight(result, 1, 1).borderColor === "var(--mint)" && [0, 2, 3].every((i) => Object.keys(optionHighlight(result, i, 1)).length === 0));
}

// Position 0 is a real answer (it is falsy in JavaScript); a numeric string works too.
check("position 0 is named", correctAnswerText(mcq, { correct: false, correctAnswer: 0 }) === "Only lines with print");
check("a numeric string position is named", correctAnswerText(mcq, { correct: false, correctAnswer: "2" }) === "A random line");
check("position 0 is highlighted", optionHighlight({ correct: false, correctAnswer: 0 }, 0, 3).borderColor === "var(--mint)");

// Fill in the blank: the expected text.
check("a fill-in-the-blank names the expected text", correctAnswerText({ type: "FILL_BLANK" }, { correct: false, correctAnswer: "elif" }) === "elif");

// Never show something misleading.
check("nothing is named before the question is checked", correctAnswerText(mcq, null) === "" && Object.keys(optionHighlight(null, 0, 0)).length === 0);
check("an answer that cannot be placed is not guessed", [undefined, null, "", "abc", 9, -1, 1.5].every((v) => correctAnswerText(mcq, { correct: false, correctAnswer: v }) === ""));
check("a question without options does not throw", correctAnswerText({ type: "MCQ" }, { correct: false, correctAnswer: 0 }) === "");
check("a multi-line option keeps its line breaks", correctAnswerText({ type: "MCQ", options: ["1\n2\n3"] }, { correct: false, correctAnswer: 0 }) === "1\n2\n3");

// The page really uses it, and only offers the correct answer when the student was wrong.
{
  const src = fs.readFileSync(new URL("../src/pages/LessonView.jsx", import.meta.url), "utf8");
  check("LessonView imports the helpers", /import \{ optionHighlight, correctAnswerText \} from "\.\.\/utils\/practiceAnswer"/.test(src));
  check("LessonView shows 'Correct answer' only when the answer was wrong", /!result\.correct && correctAnswerText\(question, result\) && \([\s\S]{0,200}Correct answer: /.test(src));
  check("LessonView colours the options through optionHighlight", /\.\.\.optionHighlight\(result, idx, selected\)/.test(src));
}

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
