// REGRESSION (reported 2026-11-04 on the live "Module 1 Assessment: Three-line greeting"): the editor showed "# Read input via input(), print your answer" for a program that takes no input, and the
// same sample case was listed twice. 102 of the 105 assessment problems had no starter at all, and six had a repeated sample. These tests pin the content and the repair script. Pure: no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { modules } = require("../content/python");
const { starterFor, takesInput } = require("../content/python/starter");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8").replace(/\r\n/g, "\n");
const questions = modules.flatMap((m) => [m.module.assessment, ...(m.module.mocks || [])].filter(Boolean).flatMap((a) => a.questions.map((q) => ({ a, q }))));

test("a starter says what the program is expected to do with input, truthfully", () => {
  assert.match(starterFor({ testCases: [{ input: "", expected: "x", isHidden: false }] }), /no input/i);
  assert.match(starterFor({ testCases: [{ input: "5\n", expected: "x", isHidden: false }] }), /input\(\)/);
  assert.equal(takesInput([{ input: "  \n" }]), false, "whitespace is not input");
  assert.equal(takesInput([{ input: "" }, { input: "3" }]), true, "one case with input is enough");
  assert.equal(starterFor({ starter: "name = 1\n", testCases: [] }), "name = 1\n", "a starter an author wrote is never replaced");
});

test("every assessment and mock problem gets a starter that is not the generic fallback", () => {
  assert.ok(questions.length >= 100, `expected the course's assessment problems, got ${questions.length}`);
  for (const { a, q } of questions) {
    const s = starterFor(q);
    assert.ok(s && s.trim().length > 0, `${a.title} / ${q.title}: no starter`);
    assert.ok(!/Read input via input\(\), print your answer/.test(s), `${q.title}: still the generic line`);
    if (q.starter && String(q.starter).trim()) continue; // an authored scaffold says what its author wants; only the generated wording is held to the cases
    const says = /no input/i.test(s);
    assert.equal(says, !takesInput(q.testCases), `${a.title} / ${q.title}: the starter ${says ? "says no input" : "mentions input"} but the cases ${takesInput(q.testCases) ? "do" : "do not"} take input`);
  }
});

test("a generated starter is only comments, so it can never pass a problem by itself", () => {
  for (const { a, q } of questions) {
    if (q.starter && String(q.starter).trim()) continue; // an authored scaffold is allowed to contain code
    const code = starterFor(q).split("\n").filter((l) => l.trim());
    assert.ok(code.every((l) => l.trim().startsWith("#")), `${a.title} / ${q.title}: generated starter contains code`);
    assert.ok(q.testCases.every((c) => c.expected.trim() !== ""), `${q.title}: an empty expected output would be passed by an empty program`);
  }
});

test("no problem lists the same sample case twice", () => {
  for (const { a, q } of questions) {
    const seen = new Set();
    for (const c of q.testCases.filter((t) => !t.isHidden)) {
      const k = JSON.stringify([c.input, c.expected]);
      assert.ok(!seen.has(k), `${a.title} / ${q.title}: sample shown twice`);
      seen.add(k);
    }
  }
});

test("the seed uses the shared starter, and the repair script only removes repeated samples and fills missing starters", () => {
  const seed = read("scripts", "seedPythonCourse.js");
  assert.match(seed, /starterCodeByLanguage: \{ python: starterFor\(q\) \}/, "new installs get the starter at seed time");
  const fix = read("scripts", "syncPythonAssessmentQuestions.js");
  assert.match(fix, /testCase\.deleteMany\(\{ where: \{ id: \{ in: deletes \}, isHidden: false \} \}\)/, "deletes only visible samples");
  assert.ok(!/question\.update\([^)]*description|statement/.test(fix.replace(/\/\/.*$/gm, "")), "never rewrites a statement");
  assert.match(fix, /if \(!existing \|\| !String\(existing\)\.trim\(\)\)/, "a starter someone wrote is never overwritten");
  assert.match(fix, /--plan/, "has a dry run");
});
