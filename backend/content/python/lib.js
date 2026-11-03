// Shared constructors for module files (Modules 5 onward; earlier modules define the same helpers locally).
"use strict";
const mcq = (prompt, options, answer, explanation, type = "MCQ") => ({ type, prompt, options, correctAnswer: answer, explanation });
const blank = (prompt, answer, explanation) => ({ type: "FILL_BLANK", prompt, correctAnswer: answer, explanation });
// cases: [[stdin, expected], ...]; the first two are shown as samples, every case is also used as a hidden case.
const task = (title, statement, starter, solution, cases, hiddenCases = cases) => ({
  title, statement, starter, solution,
  testCases: [...cases.slice(0, 2).map(([input, expected]) => ({ input, expected, isHidden: false })), ...hiddenCases.map(([input, expected]) => ({ input, expected, isHidden: true }))],
});
// Interview-bank problem (Modules 21 onward): a task plus the structured fields the PracticeQuestion table already has
// (difficulty, tags, estimated time, intended complexity, learning objective, hint). d is E, M or H.
// The style tag says what kind of assessment the problem practises; no problem is claimed to come from any named company.
const DIFF = { E: "EASY", M: "MEDIUM", H: "HARD" };
const STYLE = { E: "style: campus online-assessment", M: "style: product-company interview", H: "style: advanced interview or contest" };
const MINUTES = { E: 10, M: 20, H: 35 };
const prob = ({ t, d, tags, tc, sc, goal, s, inp, out, con, edge, hint, sol, c, min }) => {
  const base = task(t, s, "# Read the input from standard input and print the answer.\n", sol, c);
  base.meta = { difficulty: DIFF[d], tags: [...tags, STYLE[d]], timeComplexity: tc, spaceComplexity: sc, goal, inputFormat: inp, outputFormat: out, constraints: con || null, edgeCases: edge || null, hints: hint ? [hint] : [], minutes: min || MINUTES[d] };
  return base;
};
module.exports = { mcq, blank, task, prob };
