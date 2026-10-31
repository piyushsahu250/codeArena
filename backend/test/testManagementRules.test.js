const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/utils/testManagementRules");

const NOW = new Date("2026-10-31T10:00:00Z");
const at = (h) => new Date(NOW.getTime() + h * 3600e3);
const base = { isPublished: true, isActive: true, archivedAt: null, startTime: at(-1), endTime: at(5), passingMarks: 10 };

test("published, active, archived and the time window are four separate things", () => {
  assert.deepEqual(R.lifecycleOf(base, NOW), { published: true, active: true, archived: false, window: "OPEN", studentsCanStart: true });
  assert.equal(R.lifecycleOf({ ...base, isActive: false }, NOW).published, true, "a published test can be inactive");
  assert.equal(R.lifecycleOf({ ...base, isActive: false }, NOW).studentsCanStart, false);
  assert.equal(R.lifecycleOf({ ...base, isPublished: false }, NOW).studentsCanStart, false, "unpublished is never open to a student");
  assert.equal(R.lifecycleOf({ ...base, endTime: at(-0.5) }, NOW).window, "CLOSED");
  assert.equal(R.lifecycleOf({ ...base, endTime: at(-0.5) }, NOW).active, true, "an expired test is not deactivated, and not deleted");
  assert.equal(R.lifecycleOf({ ...base, startTime: at(2) }, NOW).window, "UPCOMING");
  assert.equal(R.lifecycleOf({ ...base, archivedAt: at(-3) }, NOW).studentsCanStart, false);
  assert.equal(R.lifecycleOf({ isPublished: true, startTime: at(-1), endTime: at(1) }, NOW).active, true, "a row without the new column counts as active");
});

test("starred and hidden are the person's own marks, and the default view hides what that person hid and what is archived", () => {
  assert.deepEqual(R.viewWhere("starred", "u1"), { archivedAt: null, userStates: { some: { userId: "u1", starred: true } } });
  assert.deepEqual(R.viewWhere("hidden", "u1"), { userStates: { some: { userId: "u1", hidden: true } } });
  assert.deepEqual(R.viewWhere("all", "u2"), { archivedAt: null, userStates: { none: { userId: "u2", hidden: true } } });
  assert.deepEqual(R.viewWhere("nonsense", "u2"), R.viewWhere("all", "u2"));
  assert.deepEqual(R.viewWhere("archived", "u1"), { archivedAt: { not: null } });
  assert.deepEqual(R.viewWhere("inactive", "u1").isActive, false);
  assert.equal(R.viewWhere("unpublished", "u1").isPublished, false);
  assert.deepEqual(R.TEST_VIEWS, ["all", "active", "inactive", "published", "unpublished", "starred", "hidden", "archived"]);
});

test("bulk actions: personal marks are open to anyone who can see the test, changes to the test itself are for its owner or an admin, and every refusal says why", () => {
  const owns = (t) => t.mine === true;
  const ctx = { owns };
  assert.equal(R.bulkBlockReason("star", { mine: false }, ctx), null);
  assert.equal(R.bulkBlockReason("hide", { mine: false }, ctx), null);
  assert.equal(R.bulkBlockReason("move", { mine: false }, ctx), null);
  assert.match(R.bulkBlockReason("archive", { mine: false }, ctx), /owner/);
  assert.equal(R.bulkBlockReason("archive", { mine: true }, ctx), null);
  assert.equal(R.bulkBlockReason("archive", { mine: true, archivedAt: at(-1) }, ctx), "Already archived.");
  assert.equal(R.bulkBlockReason("restore", { mine: true }, ctx), "Not archived.");
  assert.equal(R.bulkBlockReason("deactivate", { mine: true, isActive: false }, ctx), "Already inactive.");
  assert.equal(R.bulkBlockReason("activate", { mine: true, isActive: true }, ctx), "Already active.");
  assert.match(R.bulkBlockReason("publish", { mine: true, isPublished: false, archivedAt: at(-1) }, ctx), /Restore/);
  assert.equal(R.bulkBlockReason("explode", { mine: true }, ctx), "Unknown action.");
  assert.equal(R.bulkNeedsConfirmation("archive"), true);
  assert.equal(R.bulkNeedsConfirmation("unpublish"), true);
  assert.equal(R.bulkNeedsConfirmation("star"), false);
});

test("an assignment window: No Expiry stores no end, otherwise an end after the start is required", () => {
  const ok = R.validateAssignmentWindow({ startAt: "2026-11-01T09:00:00Z", noExpiry: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.endAt, null, "no artificial expiry timestamp");
  assert.equal(ok.value.noExpiry, true);
  assert.equal(R.validateAssignmentWindow({ startAt: "2026-11-01T09:00:00Z", endAt: "2026-12-01T09:00:00Z", noExpiry: true }).ok, false, "an end date contradicts No Expiry");
  assert.equal(R.validateAssignmentWindow({ startAt: "2026-11-01T09:00:00Z", noExpiry: false }).errors[0].field, "endAt", "an end is required unless No Expiry is on");
  assert.equal(R.validateAssignmentWindow({ startAt: "2026-11-01T09:00:00Z", endAt: "2026-11-01T09:00:00Z" }).ok, false, "end must be after start");
  assert.equal(R.validateAssignmentWindow({ endAt: "2026-12-01T09:00:00Z" }).errors[0].field, "startAt");
  assert.equal(R.validateAssignmentWindow({ startAt: "2026-11-01T09:00:00Z", noExpiry: true, completionDeadline: "2026-10-01T00:00:00Z" }).ok, false);
  assert.equal(R.validateAssignmentWindow({ startAt: "2026-11-01T09:00:00Z", endAt: "2026-12-01T09:00:00Z", completionDeadline: "2027-01-01T00:00:00Z" }).ok, false, "a deadline after the end makes no sense");
  assert.equal(R.validateAssignmentWindow({ startAt: "2026-11-01T09:00:00Z", noExpiry: true, completionDeadline: "2026-12-01T00:00:00Z" }).ok, true);
});

test("a series is available to an assignment only when published, active, not archived, assigned, and inside the window; a series with no expiry never expires", () => {
  const series = { status: "PUBLISHED", isActive: true, archivedAt: null };
  const a = { isActive: true, startAt: at(-2), endAt: at(2), noExpiry: false };
  assert.deepEqual(R.seriesAvailability(series, a, NOW), { available: true, reason: null });
  assert.equal(R.seriesAvailability({ ...series, status: "DRAFT" }, a, NOW).reason, "UNPUBLISHED");
  assert.equal(R.seriesAvailability({ ...series, isActive: false }, a, NOW).reason, "INACTIVE");
  assert.equal(R.seriesAvailability({ ...series, archivedAt: at(-1) }, a, NOW).reason, "ARCHIVED");
  assert.equal(R.seriesAvailability(series, { ...a, isActive: false }, NOW).reason, "ASSIGNMENT_INACTIVE");
  assert.equal(R.seriesAvailability(series, { ...a, startAt: at(1) }, NOW).reason, "NOT_STARTED");
  assert.equal(R.seriesAvailability(series, { ...a, endAt: at(-0.01) }, NOW).reason, "EXPIRED");
  assert.deepEqual(R.seriesAvailability(series, { isActive: true, startAt: at(-1000), endAt: null, noExpiry: true }, new Date("2040-01-01T00:00:00Z")), { available: true, reason: null });
});

const items = [{ testId: "t1", position: 1 }, { testId: "t2", position: 2 }, { testId: "t3", position: 3 }];
const tests = new Map(items.map((i) => [i.testId, { ...base, id: i.testId }]));

test("progress counts completed tests from the attempts that exist, in the configured order, whatever order the rows arrive in", () => {
  const attempts = new Map([["t1", { status: "SUBMITTED", totalScore: 20 }], ["t2", { status: "IN_PROGRESS", totalScore: 0 }]]);
  const p = R.seriesProgress({ items: [...items].reverse(), tests, attempts, mode: "FLEXIBLE", rule: "ATTEMPTED", now: NOW });
  assert.deepEqual(p.rows.map((r) => [r.testId, r.state]), [["t1", "COMPLETED"], ["t2", "IN_PROGRESS"], ["t3", "AVAILABLE"]]);
  assert.deepEqual([p.total, p.completed, p.pending, p.percent], [3, 1, 2, 33]);
  assert.equal(R.seriesProgress({ items, tests, attempts: new Map(), mode: "FLEXIBLE", rule: "ATTEMPTED", now: NOW }).percent, 0);
  assert.equal(R.seriesProgress({ items: [], tests, attempts: new Map(), mode: "FLEXIBLE", rule: "ATTEMPTED", now: NOW }).percent, 0, "an empty series is 0%, not NaN");
  assert.equal(R.seriesProgress({ items, tests, attempts: new Map([["t1", { status: "AUTO_SUBMITTED", totalScore: 0 }]]), mode: "FLEXIBLE", rule: "ATTEMPTED", now: NOW }).rows[0].state, "COMPLETED");
});

test("sequential mode unlocks the next test only after the previous one is attempted (or passed, when that is the rule)", () => {
  const none = R.seriesProgress({ items, tests, attempts: new Map(), mode: "SEQUENTIAL", rule: "ATTEMPTED", now: NOW });
  assert.deepEqual(none.rows.map((r) => r.state), ["AVAILABLE", "LOCKED", "LOCKED"]);
  assert.equal(R.isLockedBySeries(none, "t2"), true);
  assert.equal(R.isLockedBySeries(none, "t1"), false);
  const one = R.seriesProgress({ items, tests, attempts: new Map([["t1", { status: "SUBMITTED", totalScore: 1 }]]), mode: "SEQUENTIAL", rule: "ATTEMPTED", now: NOW });
  assert.deepEqual(one.rows.map((r) => r.state), ["COMPLETED", "AVAILABLE", "LOCKED"]);
  const failed = R.seriesProgress({ items, tests, attempts: new Map([["t1", { status: "SUBMITTED", totalScore: 3 }]]), mode: "SEQUENTIAL", rule: "PASSED", now: NOW });
  assert.deepEqual(failed.rows.map((r) => [r.state, r.passed]), [["COMPLETED", false], ["LOCKED", false], ["LOCKED", false]], "below the passing marks keeps the next test locked");
  assert.match(failed.rows[1].reason, /Pass/);
  const passed = R.seriesProgress({ items, tests, attempts: new Map([["t1", { status: "SUBMITTED", totalScore: 10 }]]), mode: "SEQUENTIAL", rule: "PASSED", now: NOW });
  assert.equal(passed.rows[1].state, "AVAILABLE");
  const flexible = R.seriesProgress({ items, tests, attempts: new Map(), mode: "FLEXIBLE", rule: "PASSED", now: NOW });
  assert.deepEqual(flexible.rows.map((r) => r.state), ["AVAILABLE", "AVAILABLE", "AVAILABLE"], "flexible mode locks nothing");
});

test("a series never bypasses a test's own rules: unpublished, switched-off, archived, not-yet-open and closed tests are unavailable, with the reason", () => {
  const mk = (over) => new Map([["t1", { ...base, ...over }]]);
  const one = [{ testId: "t1", position: 1 }];
  const state = (over) => R.seriesProgress({ items: one, tests: mk(over), attempts: new Map(), mode: "FLEXIBLE", rule: "ATTEMPTED", now: NOW }).rows[0];
  assert.equal(state({}).state, "AVAILABLE");
  assert.deepEqual([state({ isPublished: false }).state, state({ isPublished: false }).reason], ["UNAVAILABLE", "Not published."]);
  assert.equal(state({ isActive: false }).reason, "Switched off.");
  assert.equal(state({ archivedAt: at(-1) }).reason, "Archived.");
  assert.equal(state({ startTime: at(3) }).reason, "Not open yet.");
  assert.equal(state({ endTime: at(-1) }).reason, "The test window has closed.");
  // but a test already completed stays completed, and one in progress stays reachable, even if the test was switched off afterwards
  const done = R.seriesProgress({ items: one, tests: mk({ isActive: false }), attempts: new Map([["t1", { status: "SUBMITTED", totalScore: 5 }]]), mode: "FLEXIBLE", rule: "ATTEMPTED", now: NOW });
  assert.equal(done.rows[0].state, "COMPLETED");
  const running = R.seriesProgress({ items: one, tests: mk({ isActive: false }), attempts: new Map([["t1", { status: "IN_PROGRESS", totalScore: 0 }]]), mode: "FLEXIBLE", rule: "ATTEMPTED", now: NOW });
  assert.equal(running.rows[0].state, "IN_PROGRESS");
});

test("a test the student is not eligible for stays unavailable inside a series, and in sequential mode it holds back what follows", () => {
  const t = new Map([["t1", { ...base, eligible: false }], ["t2", { ...base }]]);
  const two = [{ testId: "t1", position: 1 }, { testId: "t2", position: 2 }];
  const flex = R.seriesProgress({ items: two, tests: t, attempts: new Map(), mode: "FLEXIBLE", rule: "ATTEMPTED", now: NOW });
  assert.deepEqual(flex.rows.map((r) => r.state), ["UNAVAILABLE", "AVAILABLE"]);
  assert.match(flex.rows[0].reason, /not been assigned/);
  const seq = R.seriesProgress({ items: two, tests: t, attempts: new Map(), mode: "SEQUENTIAL", rule: "ATTEMPTED", now: NOW });
  assert.deepEqual(seq.rows.map((r) => r.state), ["UNAVAILABLE", "LOCKED"]);
});
