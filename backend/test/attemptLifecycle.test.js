// The attempt lifecycle shown on the results leaderboard, the export and the admin counts. REGRESSION: the leaderboard trusted the stored status alone, so an attempt
// whose own time had run out (but which the server had not yet closed) still read "In progress", counted as live, and took a rank by its running score.
const test = require("node:test");
const assert = require("node:assert/strict");
const { lifecycleOf, withRanks, STATE } = require("../src/modules/tests/attemptLifecycle");
const d = require("../src/modules/tests/tests.domain");
const { countLiveTestAttempts } = require("../src/utils/liveAttempts");

const MIN = 60 * 1000;
const NOW = new Date("2026-10-14T12:00:00Z");
const ago = (minutes) => new Date(NOW.getTime() - minutes * MIN);
const TEST60 = { durationMin: 60, passingMarks: 5 };
const att = (id, status, startedMinAgo, score = 0, extra = {}) => ({
  id, status, startedAt: ago(startedMinAgo), totalScore: score, tabSwitchCount: 0, submittedAt: /SUBMITTED/i.test(String(status)) ? ago(1) : null,
  student: { name: `S ${id}`, email: `${id}@x.test`, rollNumber: `R-${id}`, registrationNumber: null }, submissions: [], ...extra,
});

test("a finalized attempt is COMPLETED, whatever the casing; the way it ended is kept", () => {
  assert.deepEqual(lifecycleOf({ status: "SUBMITTED" }, TEST60, NOW), { state: STATE.COMPLETED, label: "Completed", detail: "Submitted" });
  assert.equal(lifecycleOf({ status: "AUTO_SUBMITTED" }, TEST60, NOW).detail, "Auto-submitted");
  assert.equal(lifecycleOf({ status: " submitted " }, TEST60, NOW).state, STATE.COMPLETED);
  assert.equal(lifecycleOf({ status: "auto_submitted" }, TEST60, NOW).state, STATE.COMPLETED);
});

test("an attempt inside its own time is IN_PROGRESS, up to and including the deadline instant", () => {
  assert.equal(lifecycleOf(att("a", "IN_PROGRESS", 10), TEST60, NOW).state, STATE.IN_PROGRESS);
  assert.equal(lifecycleOf(att("a", "IN_PROGRESS", 60), TEST60, NOW).state, STATE.IN_PROGRESS, "exactly at the deadline the student can still write");
  assert.equal(lifecycleOf(att("a", "in_progress", 10), TEST60, NOW).state, STATE.IN_PROGRESS);
});

test("REGRESSION: past its own deadline but not yet closed is TIME_EXPIRED, not 'In progress' and not 'Completed'", () => {
  const l = lifecycleOf(att("a", "IN_PROGRESS", 61), TEST60, NOW);
  assert.equal(l.state, STATE.TIME_EXPIRED);
  assert.equal(l.label, "Time expired, not yet closed");
  assert.equal(lifecycleOf(att("a", "IN_PROGRESS", 60 * 24 * 3), TEST60, NOW).state, STATE.TIME_EXPIRED, "days overdue is still expired");
  assert.equal(lifecycleOf(att("a", "IN_PROGRESS", 61), { durationMin: 120 }, NOW).state, STATE.IN_PROGRESS, "a longer test gives the same student more time");
});

test("missing, empty or unrecognised stored status is UNKNOWN, never guessed", () => {
  for (const s of [null, undefined, "", "   ", "COMPLETED", "FINISHED", "PENDING", "ABANDONED", 7]) assert.equal(lifecycleOf({ status: s, startedAt: ago(5) }, TEST60, NOW).state, STATE.UNKNOWN, String(s));
});

test("an attempt whose deadline cannot be computed stays IN_PROGRESS rather than being called expired", () => {
  assert.equal(lifecycleOf({ status: "IN_PROGRESS", startedAt: "not a date" }, TEST60, NOW).state, STATE.IN_PROGRESS);
  assert.equal(lifecycleOf({ status: "IN_PROGRESS", startedAt: ago(500) }, {}, NOW).state, STATE.IN_PROGRESS);
});

test("ranks go only to COMPLETED attempts, in the given order; running scores do not take a place", () => {
  const rows = [
    att("expired", "IN_PROGRESS", 90, 8),
    att("done-a", "SUBMITTED", 70, 7),
    att("active", "IN_PROGRESS", 10, 6),
    att("done-b", "AUTO_SUBMITTED", 80, 5),
    att("odd", "WEIRD", 70, 4),
    att("done-c", "SUBMITTED", 75, 5),
  ].map((a) => ({ a, lifecycle: lifecycleOf(a, TEST60, NOW) }));
  const out = withRanks(rows);
  assert.deepEqual(out.map((r) => [r.a.id, r.rank]), [["expired", null], ["done-a", 1], ["active", null], ["done-b", 2], ["odd", null], ["done-c", 3]]);
  assert.deepEqual(rows.map((r) => r.rank), [undefined, undefined, undefined, undefined, undefined, undefined], "the input is not mutated");
  assert.deepEqual(withRanks([]), []);
});

test("the export ranks finished attempts only, shows the lifecycle in Status and gives no pass/fail to an unfinished one", () => {
  const attempts = [att("expired", "IN_PROGRESS", 90, 9), att("a", "SUBMITTED", 70, 8), att("active", "IN_PROGRESS", 10, 7), att("b", "AUTO_SUBMITTED", 80, 3)];
  const bases = new Map(attempts.map((a) => [a.id, { maxScore: 10, expectedCount: 2 }]));
  const rows = d.resultExportRows(attempts, bases, TEST60, "", "", NOW);
  const by = Object.fromEntries(rows.map((r) => [r.Student, r]));
  assert.deepEqual([by["S a"].Rank, by["S b"].Rank, by["S expired"].Rank, by["S active"].Rank], [1, 2, "", ""]);
  assert.deepEqual([by["S a"].Status, by["S b"].Status, by["S expired"].Status, by["S active"].Status], ["Submitted", "Auto-submitted", "Time expired, not yet closed", "In progress"]);
  assert.deepEqual([by["S a"].Result, by["S b"].Result, by["S expired"].Result, by["S active"].Result], ["Pass", "Fail", "", ""]);
  assert.equal(d.resultExportRows(attempts, bases, TEST60, "", "S b", NOW).length, 1, "a filter narrows the rows and keeps each person rank");
  assert.equal(d.resultExportRows(attempts, bases, TEST60, "", "S b", NOW)[0].Rank, 2);
});

test("admin live counts include only attempts still inside their own time", async () => {
  const rows = [
    { status: "IN_PROGRESS", startedAt: ago(10), test: { durationMin: 60 } },
    { status: "IN_PROGRESS", startedAt: ago(59), test: { durationMin: 60 } },
    { status: "IN_PROGRESS", startedAt: ago(61), test: { durationMin: 60 } },
    { status: "IN_PROGRESS", startedAt: ago(60 * 48), test: { durationMin: 120 } },
  ];
  let seenWhere;
  const fake = { testAttempt: { findMany: async ({ where }) => { seenWhere = where; return rows.map((r) => ({ ...r, startedAt: new Date(Date.now() - (NOW.getTime() - r.startedAt.getTime())) })); } } };
  assert.equal(await countLiveTestAttempts(fake, { studentId: { in: ["x"] } }), 2);
  assert.deepEqual(seenWhere, { studentId: { in: ["x"] }, status: "IN_PROGRESS" }, "the scope filter is kept and only IN_PROGRESS rows are read");
});
