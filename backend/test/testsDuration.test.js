// The rules for changing a formal test's duration while it is running (modules/tests/tests.duration.domain.js). Deadlines are DERIVED (attempt start + duration), so these tests pin down what that means
// for students who started at different times, and the policy for reductions. The database, concurrency, authorization and audit side is covered by scripts/verifyLiveDuration.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDuration, deadlineAt, planDurationChange, confirmationsNeeded, windowState, IMMEDIATE_EXPIRY_MS } = require("../src/modules/tests/tests.duration.domain");
const { deadlineOf } = require("../src/modules/submissions/submissions.domain");

const at = (h, m) => new Date(Date.UTC(2026, 9, 28, h, m, 0));
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

test("duration input: whole minutes from 1 to 720 only", () => {
  assert.deepEqual(parseDuration(60), { value: 60 });
  assert.deepEqual(parseDuration("45"), { value: 45 });
  assert.deepEqual(parseDuration(" 45 "), { value: 45 });
  for (const bad of [0, -5, 721, 30.5, "30.5", "1e2", "", "abc", null, undefined, NaN, Infinity, {}, [], "0x10", "99999"]) assert.ok(parseDuration(bad).error, `${JSON.stringify(bad)} must be refused`);
});

// TEST 1 and TEST 2 of the specification: the new deadline is measured from each student's own start, never from the moment of the change.
test("30 -> 60 minutes: each student's deadline is their own start plus 60 (10:00 -> 11:00, 10:15 -> 11:15, 10:25 -> 11:25), changed at 10:20", () => {
  const starts = [at(10, 0), at(10, 15), at(10, 25)];
  assert.deepEqual(starts.map((s) => hhmm(deadlineAt(s, 30))), ["10:30", "10:45", "10:55"]);
  assert.deepEqual(starts.map((s) => hhmm(deadlineAt(s, 60))), ["11:00", "11:15", "11:25"]);
  const plan = planDurationChange({ startedAts: starts.slice(0, 2), oldMin: 30, newMin: 60, now: at(10, 20) });
  assert.equal(plan.eligible, 2);
  assert.equal(hhmm(plan.earliestNewDeadline), "11:00");
  assert.equal(hhmm(plan.latestNewDeadline), "11:15");
  assert.notEqual(hhmm(plan.earliestNewDeadline), "11:20", "not measured from the moment of the change");
});

test("the model is derived: the server's own deadlineOf gives the same numbers, so every enforcing endpoint agrees", () => {
  const a = { startedAt: at(10, 0), test: { durationMin: 30 } };
  assert.equal(hhmm(deadlineOf(a)), "10:30");
  a.test.durationMin = 60;
  assert.equal(hhmm(deadlineOf(a)), "11:00");
  assert.equal(deadlineOf(a), deadlineAt(at(10, 0), 60));
});

test("applying the same change twice cannot extend anything twice (the result depends only on start and duration)", () => {
  const starts = [at(10, 0), at(10, 15)];
  const once = planDurationChange({ startedAts: starts, oldMin: 30, newMin: 60, now: at(10, 20) });
  const again = planDurationChange({ startedAts: starts, oldMin: 30, newMin: 60, now: at(10, 21) });
  assert.equal(once.latestNewDeadline, again.latestNewDeadline);
  assert.equal(once.earliestNewDeadline, again.earliestNewDeadline);
});

// TEST 3
test("120 running attempts: all are eligible and all get a later deadline", () => {
  const starts = Array.from({ length: 120 }, (_, i) => new Date(at(10, 0).getTime() + i * 5000));
  const plan = planDurationChange({ startedAts: starts, oldMin: 30, newMin: 60, now: at(10, 20) });
  assert.equal(plan.eligible, 120);
  assert.equal(plan.movedLater, 120);
  assert.equal(plan.movedEarlier, 0);
  assert.equal(plan.wouldExpireNow, 0);
  assert.deepEqual(confirmationsNeeded({ oldMin: 30, newMin: 60, plan }), { reduction: false, expiry: false }, "an increase needs no confirmation");
});

test("a start time that is not a date is skipped, never counted", () => {
  const plan = planDurationChange({ startedAts: [at(10, 0), "garbage", null, undefined], oldMin: 30, newMin: 60, now: at(10, 20) });
  assert.equal(plan.eligible, 1);
});

// TEST 12: reductions
test("60 -> 45 minutes: every deadline moves earlier and the reduction must be confirmed", () => {
  const starts = [at(10, 0), at(10, 15), at(10, 25)];
  const plan = planDurationChange({ startedAts: starts, oldMin: 60, newMin: 45, now: at(10, 30) });
  assert.equal(plan.movedEarlier, 3);
  assert.equal(plan.movedLater, 0);
  assert.equal(plan.wouldExpireNow, 0, "10:00 + 45 = 10:45 is still ahead at 10:30");
  assert.deepEqual(confirmationsNeeded({ oldMin: 60, newMin: 45, plan }), { reduction: true, expiry: false });
});

test("a reduction that leaves a student past the new deadline, or within five minutes of it, needs a second confirmation", () => {
  const starts = [at(10, 0), at(10, 15), at(10, 40)];
  const plan = planDurationChange({ startedAts: starts, oldMin: 60, newMin: 45, now: at(10, 43) }); // 10:00 -> 10:45 (2 min left), 10:15 -> 11:00, 10:40 -> 11:25
  assert.equal(plan.wouldExpireNow, 0);
  assert.equal(plan.wouldExpireSoon, 1);
  assert.deepEqual(confirmationsNeeded({ oldMin: 60, newMin: 45, plan }), { reduction: true, expiry: true });
  const past = planDurationChange({ startedAts: starts, oldMin: 60, newMin: 30, now: at(10, 43) }); // 10:00 -> 10:30 (13 min ago), 10:15 -> 10:45 (2 min left)
  assert.equal(past.wouldExpireNow, 1);
  assert.equal(past.wouldExpireSoon, 2);
  assert.equal(IMMEDIATE_EXPIRY_MS, 5 * 60 * 1000);
});

test("a reduction with nobody running needs no confirmation (there is nothing to disrupt)", () => {
  const plan = planDurationChange({ startedAts: [], oldMin: 60, newMin: 30, now: at(10, 0) });
  assert.deepEqual(confirmationsNeeded({ oldMin: 60, newMin: 30, plan }), { reduction: false, expiry: false });
});

test("running attempts already past their old deadline are counted separately (abandoned, not yet closed)", () => {
  const plan = planDurationChange({ startedAts: [at(9, 0), at(10, 0)], oldMin: 30, newMin: 60, now: at(10, 20) });
  assert.equal(plan.pastOldDeadline, 1);
  assert.equal(plan.eligible, 2);
});

// TEST 11: the hard closing time is informational only
test("a separate closing time is not changed and does not clamp anyone: deadlines after it are only counted", () => {
  const starts = [at(10, 0), at(10, 50)];
  const plan = planDurationChange({ startedAts: starts, oldMin: 30, newMin: 60, endTime: at(11, 30), now: at(10, 55) });
  assert.equal(plan.afterWindowClose, 1, "10:50 + 60 = 11:50 is after 11:30");
  assert.equal(hhmm(plan.latestNewDeadline), "11:50", "the deadline is not cut back to the closing time (existing rule: the window only gates NEW starts)");
  assert.equal(planDurationChange({ startedAts: starts, oldMin: 30, newMin: 60, endTime: null, now: at(10, 55) }).afterWindowClose, 0);
});

test("the test's place in time comes from its own schedule", () => {
  const t = { startTime: at(10, 0), endTime: at(12, 0) };
  assert.equal(windowState(t, at(9, 0)), "scheduled");
  assert.equal(windowState(t, at(11, 0)), "live");
  assert.equal(windowState(t, at(13, 0)), "closed");
});
