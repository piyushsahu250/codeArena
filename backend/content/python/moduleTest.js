"use strict";
// The final "Module Practice Test" of each module, built from the choice questions that module's own lessons already carry (nothing new is written, nothing is invented).
//
// Why it exists: the platform unlocks the next module, and issues the course certificate, only when every lesson of a module is COMPLETED. An ordinary lesson can be marked
// complete with one click, so without a test a student could unlock every module and earn the certificate without answering anything. A lesson flagged isModuleTest cannot be
// marked complete by hand: the server grades all its questions together (pass mark 70 %, unlimited retakes, answers explained after each try) and only a pass completes it.
//
// Choice questions only (multiple choice, output prediction, debugging): their answers are option positions, so grading never depends on how a student spells something.
const CHOICE = new Set(["MCQ", "OUTPUT_PREDICTION", "DEBUG"]);
const SIZE = 12;      // questions per test; with the platform's 70 % pass mark that is 9 correct
const MINIMUM = 8;    // a module with fewer usable questions gets no test (the projects module has none)
const TITLE = "Module Practice Test";

// Round-robin over the module's lessons (first question of each lesson, then the second of each, ...) so every lesson is represented and the pick is the same on every run.
function pickQuestions(lessons) {
  const pools = lessons.map((L) => (L.quiz || []).filter((q) => CHOICE.has(q.type)));
  const picked = [];
  for (let round = 0; picked.length < SIZE; round++) {
    let tookAny = false;
    for (const pool of pools) {
      if (round < pool.length && picked.length < SIZE) { picked.push(pool[round]); tookAny = true; }
    }
    if (!tookAny) break;
  }
  return picked;
}

function buildTest(mod) {
  const lessons = mod.chapters.flatMap((c) => c.lessons).filter((L) => !L.moduleTest);
  const questions = pickQuestions(lessons);
  if (questions.length < MINIMUM) return null;
  return {
    title: TITLE,
    minutes: 15,
    moduleTest: true,
    covers: lessons.filter((L) => (L.quiz || []).some((q) => CHOICE.has(q.type))).map((L) => L.title),
    quiz: questions.map((q) => ({ type: q.type, prompt: q.prompt, options: q.options, correctAnswer: q.correctAnswer, explanation: q.explanation })),
  };
}

// Adds the test as the last lesson of the module's last chapter. Safe to call twice.
function withModuleTests(modules) {
  for (const m of modules) {
    const mod = m.module;
    if (mod.chapters.some((c) => c.lessons.some((L) => L.moduleTest))) continue;
    const test = buildTest(mod);
    if (test) mod.chapters[mod.chapters.length - 1].lessons.push(test);
  }
  return modules;
}

module.exports = { withModuleTests, buildTest, pickQuestions, TITLE, SIZE, MINIMUM, CHOICE };
