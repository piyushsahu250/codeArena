// Pure rules for changing the duration of a formal test while students are taking it. No database, no HTTP (unit-tested in test/testsDuration.test.js).
//
// THE TIMING MODEL (one, and it already existed): a student's deadline is their server-recorded attempt start plus the test's configured duration, derived every time it is needed
// (submissions.domain.js deadlineOf). It is never stored per attempt and never clamped to the test's scheduled window: the window (startTime..endTime) only decides whether a NEW attempt
// may START; it does not shorten or lengthen anyone's own time. So changing Test.durationMin moves every running attempt's deadline, each one measured from ITS OWN start, and cannot
// restart a timer, add the whole new duration on top of the time left, or apply twice. That single write is what this feature makes safe (preview, confirmation, concurrency check,
// audit) and what it tells the students about (utils/deadlineSync.js on the page).
const MIN_DURATION_MIN = 1;
const MAX_DURATION_MIN = 720;
// A shortened deadline that lands inside this margin counts as "closes almost at once" and needs its own confirmation.
const IMMEDIATE_EXPIRY_MS = 5 * 60 * 1000;
const MINUTE = 60 * 1000;

// The requested duration as a whole number of minutes, or an error message. Strings that are not plain integers ("30.5", "1e2", "") are refused.
function parseDuration(input) {
  const n = typeof input === "number" ? input : typeof input === "string" && /^\d{1,4}$/.test(input.trim()) ? Number(input.trim()) : NaN;
  if (!Number.isInteger(n)) return { error: "Duration must be a whole number of minutes" };
  if (n < MIN_DURATION_MIN || n > MAX_DURATION_MIN) return { error: `Duration must be between ${MIN_DURATION_MIN} and ${MAX_DURATION_MIN} minutes` };
  return { value: n };
}

const deadlineAt = (startedAt, minutes) => new Date(startedAt).getTime() + minutes * MINUTE;

// What a change would do to the attempts that are IN_PROGRESS right now. `startedAts` are the start times of exactly those attempts. Each deadline is startedAt + minutes, so the answer
// depends only on when each student started and on the two durations, never on when the administrator pressed the button.
//   movedLater / movedEarlier   attempts whose deadline gets later / earlier (all of one kind: the sign of newMin - oldMin)
//   pastOldDeadline             running attempts that had already passed their OLD deadline (abandoned or offline: the server has not closed them yet)
//   wouldExpireNow              attempts whose NEW deadline is already in the past (the server will close them on its next sweep, which keeps and grades what was saved)
//   wouldExpireSoon             attempts whose new deadline is less than five minutes away (includes the ones above)
//   afterWindowClose            attempts whose new deadline falls after the test's scheduled closing time (informational: the closing time is not changed by this)
function planDurationChange({ startedAts, oldMin, newMin, endTime = null, now = Date.now() }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const end = endTime ? new Date(endTime).getTime() : null;
  const plan = { eligible: 0, movedLater: 0, movedEarlier: 0, unchanged: 0, pastOldDeadline: 0, wouldExpireNow: 0, wouldExpireSoon: 0, afterWindowClose: 0, earliestNewDeadline: null, latestNewDeadline: null };
  for (const s of startedAts || []) {
    if (s === null || s === undefined || s === "") continue; // new Date(null) is the 1970 epoch: a missing start is not an attempt
    const started = new Date(s).getTime();
    if (!Number.isFinite(started)) continue;
    plan.eligible += 1;
    const before = deadlineAt(started, oldMin);
    const after = deadlineAt(started, newMin);
    if (after > before) plan.movedLater += 1; else if (after < before) plan.movedEarlier += 1; else plan.unchanged += 1;
    if (before < nowMs) plan.pastOldDeadline += 1;
    if (after <= nowMs) plan.wouldExpireNow += 1;
    if (after - nowMs < IMMEDIATE_EXPIRY_MS) plan.wouldExpireSoon += 1;
    if (end !== null && after > end) plan.afterWindowClose += 1;
    if (plan.earliestNewDeadline === null || after < plan.earliestNewDeadline) plan.earliestNewDeadline = after;
    if (plan.latestNewDeadline === null || after > plan.latestNewDeadline) plan.latestNewDeadline = after;
  }
  return plan;
}

// The confirmations a change needs before it may be applied. An increase needs none. A decrease that moves any running deadline earlier needs "reduction" confirmed, and one that leaves any
// running attempt past its new deadline or within five minutes of it needs "expiry" confirmed as well. Nothing is ever applied silently.
function confirmationsNeeded({ oldMin, newMin, plan }) {
  const reduction = newMin < oldMin && plan.movedEarlier > 0;
  const expiry = newMin < oldMin && plan.wouldExpireSoon > 0;
  return { reduction, expiry };
}

// The test's place in time, from its own schedule (not from attempts): "scheduled" before startTime, "live" between startTime and endTime, "closed" after endTime.
function windowState(test, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (test.startTime && nowMs < new Date(test.startTime).getTime()) return "scheduled";
  if (test.endTime && nowMs > new Date(test.endTime).getTime()) return "closed";
  return "live";
}

module.exports = { MIN_DURATION_MIN, MAX_DURATION_MIN, IMMEDIATE_EXPIRY_MS, parseDuration, deadlineAt, planDurationChange, confirmationsNeeded, windowState };
