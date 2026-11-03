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
// Interview question (Module 22): a short program, its exact output, three wrong answers that match common misconceptions,
// the explanation, the misconceptions and a follow-up question. level is E, M or H.
// out starting with "!" means the program must raise that exception, for example "!TypeError".
// The program is executed by the validator, so the expected output cannot drift from what Python really does.
const LEVEL = { E: "Easy", M: "Medium", H: "Hard" };
const iq = (level, q, code, out, wrong, why, miscon, follow) => ({
  kind: "OUT", level, levelName: LEVEL[level], q, code, out: out.startsWith("!") ? null : out, err: out.startsWith("!") ? out.slice(1) : null,
  answerText: out.startsWith("!") ? "Raises " + out.slice(1) : out, wrong, why, miscon, follow,
});
let rotation = 0;
// Turns interview questions into output-prediction quiz questions; the correct option rotates through the four positions.
const qaQuiz = (items) => items.map((it) => {
  const slot = rotation++ % 4;
  const options = [...it.wrong];
  options.splice(slot, 0, it.answerText);
  return mcq(`${it.q}\n\n${it.code}`, options, slot,
    `${it.why} Common misconceptions: ${it.miscon} Follow-up: ${it.follow[0]} ${it.follow[1]}`, "OUTPUT_PREDICTION");
});
// ---- Placement practice sets (Module 23): mixed question kinds in one lesson ----
// mc: a concept multiple-choice question. fi: code completion (the blank ___ is replaced by the answer and the program is run).
// db: find the error (the buggy program is run to confirm its symptom and the fixed program to confirm its output).
// An out/symptom starting with "!" means the program must raise that exception.
const mc = (level, prompt, options, answer, why) => ({ kind: "MCQ", level, levelName: LEVEL[level], prompt, options, answer, why });
const fi = (level, prompt, template, answer, out, why) => ({ kind: "FILL", level, levelName: LEVEL[level], prompt, template, answer, out, why });
const db = (level, intent, code, symptom, options, answer, fixed, fixedOut, why) => ({ kind: "DEBUG", level, levelName: LEVEL[level], intent, code, symptom, options, answer, fixed, fixedOut, why });
const setQuiz = (items) => items.map((it) => {
  if (it.kind === "OUT") return qaQuiz([it])[0];
  if (it.kind === "MCQ") return mcq(it.prompt, it.options, it.answer, it.why);
  if (it.kind === "FILL") return blank(`${it.prompt}\n\n${it.template}`, it.answer, it.why);
  const shows = it.symptom.startsWith("!") ? "it raises " + it.symptom.slice(1) : "it prints:\n" + it.symptom;
  return mcq(`Find the error. The program should ${it.intent}, but when run ${shows}\n\n${it.code}\n\nWhat is wrong?`, it.options, it.answer, `${it.why} Fixed program output: ${it.fixedOut}`, "DEBUG");
});
// Project evaluation rubric (Phase 6): the seven criteria add up to 100; functionality and specific describe this project.
const rubric = (functionality, specific) => [
  ["Working program", 30, functionality],
  ["Project-specific quality", 15, specific],
  ["Code quality and structure", 15, "Clear names, small functions, no duplicated code, formatted with a standard tool"],
  ["Testing", 15, "Unit tests for the main logic and the edge cases; the tests pass"],
  ["Error handling and validation", 10, "Bad input never crashes the program and the messages are helpful"],
  ["README and documentation", 10, "Purpose, how to run, example output and project layout"],
  ["Git and repository hygiene", 5, "Small commits with clear messages, a .gitignore and no secrets"],
];
module.exports = { mcq, blank, task, prob, iq, qaQuiz, mc, fi, db, setQuiz, rubric };
