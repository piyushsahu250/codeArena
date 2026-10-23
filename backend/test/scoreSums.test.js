// Overall percentage across several attempts (utils/attemptManifest.js sumScores), shared by the class rank, the talent-pool rank and the pool auto-selection rule. REGRESSION
// (2026-10 audit, batch 9): those three divided by each test's CURRENT question list. For a RANDOM test that list is the whole bank (a student who scored full marks on the two
// questions they were given was scored out of the bank's thirty), and for an edited test it changed old results. attemptManifest.js already stated that every total must come from
// the attempt's own saved question list; these three were missed. Production has no RANDOM test today, so nothing was wrong there yet: this keeps it that way.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { sumScores } = require("../src/utils/attemptManifest");

const pct = (sums, id) => { const s = sums.get(id); return s && s.max > 0 ? (s.score / s.max) * 100 : null; };

test("a student is scored out of what each attempt was given, so a RANDOM draw is not compared with the whole bank", () => {
  // A drew two of a bank of six 10-point questions and got both right (20 of 20). B took a fixed two-question test and got 15 of 20.
  const attempts = [{ id: "a1", studentId: "A", totalScore: 20 }, { id: "b1", studentId: "B", totalScore: 15 }];
  const bases = new Map([["a1", { maxScore: 20 }], ["b1", { maxScore: 20 }]]);
  const sums = sumScores(attempts, bases);
  assert.deepEqual(sums.get("A"), { score: 20, max: 20 });
  assert.equal(pct(sums, "A"), 100);
  assert.equal(pct(sums, "B"), 75);
  assert.ok(pct(sums, "A") > pct(sums, "B"), "full marks outrank 75%, whichever test each took");
});

test("several attempts add up on both sides", () => {
  const attempts = [
    { id: "1", studentId: "S", totalScore: 8 }, { id: "2", studentId: "S", totalScore: 30 }, { id: "3", studentId: "T", totalScore: 5 },
  ];
  const bases = new Map([["1", { maxScore: 10 }], ["2", { maxScore: 100 }], ["3", { maxScore: 10 }]]);
  const sums = sumScores(attempts, bases);
  assert.deepEqual(sums.get("S"), { score: 38, max: 110 });
  assert.deepEqual(sums.get("T"), { score: 5, max: 10 });
  assert.equal(sums.size, 2);
});

test("an attempt with no known base adds nothing to the maximum, and a missing score counts as zero", () => {
  const attempts = [{ id: "x", studentId: "S", totalScore: 4 }, { id: "y", studentId: "S", totalScore: undefined }, { id: "z", studentId: "S", totalScore: null }];
  const sums = sumScores(attempts, new Map([["x", { maxScore: 10 }]])); // y and z have no base at all
  assert.deepEqual(sums.get("S"), { score: 4, max: 10 });
  const none = sumScores([{ id: "q", studentId: "U", totalScore: 3 }], new Map());
  assert.deepEqual(none.get("U"), { score: 3, max: 0 }, "a student whose attempts have no base ends up with max 0, which callers treat as 'no percentage', never as a division by zero");
});

test("no attempts, no students", () => {
  assert.equal(sumScores([], new Map()).size, 0);
});

// The mistake is one copy-and-paste away: the three rules were once copies of each other. A test's maximum must never be summed from the test's current question list.
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}
test("no ranking or selection code sums a test's maximum from its current question list", () => {
  const offenders = [];
  const forbidden = /reduce\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*\w+\s*\+\s*\w+\.question\??\.points/;
  for (const file of sourceFiles(path.join(__dirname, "..", "src"))) {
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*")) return;
      if (forbidden.test(code)) offenders.push(`${path.relative(path.join(__dirname, "..", "src"), file)}:${i + 1}  ${code.slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], "use scoreSumsByStudent / scoreBases (utils/attemptManifest.js): an attempt is scored out of its own saved question list\n" + offenders.join("\n"));
});

test("the scan itself recognises the pattern it exists to catch", () => {
  const forbidden = /reduce\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*\w+\s*\+\s*\w+\.question\??\.points/;
  assert.ok(forbidden.test("const maxByTest = new Map(tests.map((t) => [t.id, t.questions.reduce((s, q) => s + q.question.points, 0)]));"));
  assert.ok(!forbidden.test("const total = list.reduce((s, qId) => s + (points.get(qId) || 0), 0);"));
});
