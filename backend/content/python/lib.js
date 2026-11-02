// Shared constructors for module files (Modules 5 onward; earlier modules define the same helpers locally).
"use strict";
const mcq = (prompt, options, answer, explanation, type = "MCQ") => ({ type, prompt, options, correctAnswer: answer, explanation });
const blank = (prompt, answer, explanation) => ({ type: "FILL_BLANK", prompt, correctAnswer: answer, explanation });
// cases: [[stdin, expected], ...]; the first two are shown as samples, every case is also used as a hidden case.
const task = (title, statement, starter, solution, cases, hiddenCases = cases) => ({
  title, statement, starter, solution,
  testCases: [...cases.slice(0, 2).map(([input, expected]) => ({ input, expected, isHidden: false })), ...hiddenCases.map(([input, expected]) => ({ input, expected, isHidden: true }))],
});
module.exports = { mcq, blank, task };
