// Unit tests for the assessment manifest rules (no database): what a valid question draw is, and what an attempt is scored out of.
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateManifest, configuredCount, scoreBases, hasManifest } = require("../src/utils/attemptManifest");

const tq = (ids) => ids.map((questionId) => ({ questionId }));
const ids = (n, prefix = "q") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

test("any configured count is accepted, not just 30", () => {
  for (const n of [1, 7, 28, 30, 45]) {
    const all = ids(n);
    assert.equal(validateManifest({ questionSelectionMode: "FIXED", questions: tq(all) }, all).ok, true, `n=${n}`);
  }
});

test("30 configured but only 28 valid questions: refused with a message that names both numbers", () => {
  const bank = ids(28);
  const v = validateManifest({ questionSelectionMode: "RANDOM", randomQuestionsPerStudent: 30, questions: tq(bank) }, bank);
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("COUNT_MISMATCH"));
  assert.match(v.message, /30/);
  assert.match(v.message, /28/);
});

test("duplicate ids, ids outside the test, and an empty draw are each rejected", () => {
  const base = { questionSelectionMode: "FIXED", questions: tq(["a", "b", "c"]) };
  assert.ok(validateManifest(base, ["a", "a", "c"]).errors.includes("DUPLICATE_IDS"));
  assert.ok(validateManifest(base, ["a", "b", "z"]).errors.includes("NOT_IN_TEST"));
  assert.ok(validateManifest({ questionSelectionMode: "FIXED", questions: [] }, []).errors.includes("EMPTY"));
});

test("RANDOM mode is configured by questions per student, FIXED by the question list", () => {
  assert.equal(configuredCount({ questionSelectionMode: "RANDOM", randomQuestionsPerStudent: 12, questions: tq(ids(40)) }), 12);
  assert.equal(configuredCount({ questionSelectionMode: "FIXED", questions: tq(ids(40)) }), 40);
});

// a fake database client: just enough of prisma.question / prisma.test for scoreBases
function fakeClient({ questions, tests = [] }) {
  return {
    question: { findMany: async ({ where }) => questions.filter((q) => where.id.in.includes(q.id)) },
    test: { findMany: async ({ where }) => tests.filter((t) => where.id.in.includes(t.id)) },
  };
}

test("an attempt is scored out of ITS OWN questions, with 28 answered of 30 still out of 30", async () => {
  const all = ids(40).map((id) => ({ id, points: 2 }));
  const mine = ids(30);
  const out = await scoreBases(fakeClient({ questions: all }), [{ id: "a1", testId: "t", questionOrder: mine }]);
  assert.deepEqual(out.get("a1"), { expectedCount: 30, maxScore: 60, source: "MANIFEST", missingQuestionCount: 0 });
});

test("a question removed from the test (or deleted) still counts for the attempt that was given it, and is reported when gone", async () => {
  const stillThere = [{ id: "q1", points: 5 }, { id: "q2", points: 5 }];
  const out = await scoreBases(fakeClient({ questions: stillThere }), [{ id: "a", testId: "t", questionOrder: ["q1", "q2", "q3"] }]);
  assert.equal(out.get("a").expectedCount, 3);
  assert.equal(out.get("a").maxScore, 10);
  assert.equal(out.get("a").missingQuestionCount, 1);
});

test("an attempt that predates manifests falls back to the test's list and says so", async () => {
  const client = fakeClient({ questions: [{ id: "q1", points: 4 }, { id: "q2", points: 4 }], tests: [{ id: "t", questions: [{ questionId: "q1" }, { questionId: "q2" }] }] });
  const out = await scoreBases(client, [{ id: "legacy", testId: "t", questionOrder: null }]);
  assert.equal(hasManifest({ questionOrder: null }), false);
  assert.deepEqual(out.get("legacy"), { expectedCount: 2, maxScore: 8, source: "LEGACY_TEST_CONFIG", missingQuestionCount: 0 });
});
