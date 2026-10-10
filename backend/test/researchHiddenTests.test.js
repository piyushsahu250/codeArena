const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { buildHiddenTests, checkSamples, MAP, PROBLEMS } = require("../src/utils/researchHiddenTests");

const dataDir = path.join(__dirname, "..", "..", "docs", "interview-research", "data");
function codingQuestions() {
  const out = [];
  for (const dir of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) {
    const full = path.join(dataDir, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full).filter((x) => x.endsWith(".json"))) {
      const d = JSON.parse(fs.readFileSync(path.join(full, f), "utf8"));
      for (const q of d.questions) if (q.question_type === "CODING") out.push(q);
    }
  }
  return out;
}

test("every research coding question has a generator and every generator belongs to a question", () => {
  const qs = codingQuestions();
  if (!qs.length) return;
  const ids = new Set(qs.map((q) => q.question_id));
  for (const q of qs) assert.ok(MAP[q.question_id], `no generator for ${q.question_id}`);
  for (const id of Object.keys(MAP)) assert.ok(ids.has(id), `generator for unknown question ${id}`);
});

test("the reference solutions reproduce every visible sample of every coding question", () => {
  for (const q of codingQuestions()) {
    const bad = checkSamples(q.question_id, q.coding.samples);
    assert.deepEqual(bad, [], `${q.question_id} samples`);
  }
});

test("hidden tests build (reference agrees with brute force) with at least 5 distinct cases per question", () => {
  for (const q of codingQuestions()) {
    const { tests } = buildHiddenTests(q.question_id);
    assert.ok(tests.length >= 5, `${q.question_id} has ${tests.length}`);
    assert.ok(tests.every((t) => t.isHidden === true && typeof t.expected === "string" && t.expected.length > 0), `${q.question_id} malformed`);
  }
});

test("hidden tests are deterministic", () => {
  const a = JSON.stringify(buildHiddenTests("INFY-SP-R1-001"));
  const b = JSON.stringify(buildHiddenTests("INFY-SP-R1-001"));
  assert.equal(a, b);
  assert.ok(Object.keys(PROBLEMS).length > 30);
});
