// The module practice tests of the Python course (content/python/moduleTest.js). REGRESSION: the course had none, so every module could be unlocked, and the certificate earned, by
// clicking "Mark as Complete" on each lesson without answering a single question. These tests pin the properties that make the tests fair and honest.
const test = require("node:test");
const assert = require("node:assert/strict");
const { modules } = require("../content/python");
const { withModuleTests, buildTest, pickQuestions, TITLE, SIZE, MINIMUM, CHOICE } = require("../content/python/moduleTest");

const lessonsOf = (m) => m.module.chapters.flatMap((c) => c.lessons);
const testOf = (m) => lessonsOf(m).find((l) => l.moduleTest);

test("every module with enough choice questions ends with exactly one practice test; the projects module has none", () => {
  let withTest = 0;
  for (const m of modules) {
    const own = lessonsOf(m).filter((l) => !l.moduleTest);
    const usable = own.reduce((n, l) => n + (l.quiz || []).filter((q) => CHOICE.has(q.type)).length, 0);
    const tests = lessonsOf(m).filter((l) => l.moduleTest);
    if (usable >= MINIMUM) { assert.equal(tests.length, 1, m.module.title); withTest++; } else assert.equal(tests.length, 0, m.module.title);
  }
  assert.equal(withTest, 23);
  assert.equal(testOf(modules.find((m) => /Real-World Projects/.test(m.module.title))), undefined);
});

test("the test is the last lesson of its module", () => {
  for (const m of modules) {
    const t = testOf(m); if (!t) continue;
    const chapters = m.module.chapters, last = chapters[chapters.length - 1];
    assert.equal(last.lessons[last.lessons.length - 1], t, m.module.title);
    assert.equal(t.title, TITLE);
  }
});

test("a test holds 12 choice questions, taken from that module's own lessons, unchanged", () => {
  for (const m of modules) {
    const t = testOf(m); if (!t) continue;
    assert.equal(t.quiz.length, SIZE, m.module.title);
    const own = new Map();
    for (const l of lessonsOf(m)) if (!l.moduleTest) for (const q of l.quiz || []) own.set(q.prompt, q);
    for (const q of t.quiz) {
      assert.ok(CHOICE.has(q.type), `${q.type} is a choice type`);
      const src = own.get(q.prompt);
      assert.ok(src, `copied from the module: ${q.prompt.slice(0, 40)}`);
      assert.deepEqual(q.options, src.options);
      assert.equal(q.correctAnswer, src.correctAnswer);
      assert.ok(Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer < q.options.length);
      assert.ok(q.explanation && q.explanation.length > 12, "explained after every attempt");
    }
    assert.equal(new Set(t.quiz.map((q) => q.prompt)).size, t.quiz.length, "no question twice");
  }
});

test("no fill-in-the-blank question gates a module (an exact-text answer could block a student unfairly)", () => {
  for (const m of modules) { const t = testOf(m); if (t) assert.ok(t.quiz.every((q) => q.type !== "FILL_BLANK" && q.type !== "CODING"), m.module.title); }
});

test("the questions are spread over the module's lessons, not taken from one", () => {
  for (const m of modules) {
    const t = testOf(m); if (!t) continue;
    const taught = lessonsOf(m).filter((l) => !l.moduleTest && (l.quiz || []).some((q) => CHOICE.has(q.type))).length;
    const owners = new Set(t.quiz.map((q) => lessonsOf(m).findIndex((l) => !l.moduleTest && (l.quiz || []).some((x) => x.prompt === q.prompt))));
    assert.ok(owners.size >= Math.min(taught, SIZE), `${m.module.title}: ${owners.size} lessons represented of ${taught}`);
  }
});

test("the pick is deterministic, and adding the tests twice adds nothing", () => {
  const m = modules[0].module;
  const a = buildTest({ chapters: m.chapters.map((c) => ({ ...c, lessons: c.lessons.filter((l) => !l.moduleTest) })) });
  const b = buildTest({ chapters: m.chapters.map((c) => ({ ...c, lessons: c.lessons.filter((l) => !l.moduleTest) })) });
  assert.deepEqual(a.quiz.map((q) => q.prompt), b.quiz.map((q) => q.prompt));
  const before = modules.map((x) => lessonsOf(x).length);
  withModuleTests(modules);
  assert.deepEqual(modules.map((x) => lessonsOf(x).length), before);
});

test("with the platform's 70% pass mark a 12-question test needs 9 correct answers, and the page says so", () => {
  const passes = (correct, total) => Math.round((correct / total) * 100) >= 70; // the server's own arithmetic (routes/learning.js test-submit)
  assert.equal(passes(8, 12), false);
  assert.equal(passes(9, 12), true);
  const { renderLesson } = require("../content/python/render");
  const html = renderLesson(testOf(modules[0]));
  assert.match(html, /<strong>9 correct answers<\/strong>/);
  assert.match(html, /70%/);
  assert.match(html, /retake/i);
});

test("a module with too few questions gets no test, and an empty pool is handled", () => {
  assert.deepEqual(pickQuestions([]), []);
  assert.equal(buildTest({ chapters: [{ lessons: [{ title: "x", quiz: [{ type: "MCQ", prompt: "p", options: ["a", "b"], correctAnswer: 0, explanation: "e" }] }] }] }), null);
});
