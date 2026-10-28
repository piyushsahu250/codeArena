// Regression test for src/utils/deadlineSync.js (the student page follows the server's deadline when the duration changes). Pure logic: no browser, no network.
// Run: node frontend/scripts/deadlineSyncRegression.mjs
import { SYNC_INTERVAL_MS, applyClockAnswer, secondsLeftAt, deadlineNotice } from "../src/utils/deadlineSync.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const MIN = 60000;
const T0 = Date.UTC(2026, 9, 28, 10, 0, 0); // student started at 10:00 with a 30 minute test
const old = T0 + 30 * MIN;

check("the page asks the server about every 20 seconds", SYNC_INTERVAL_MS === 20000);

// the extension: 30 -> 60 minutes
{
  const r = applyClockAnswer({ currentDeadline: old, answer: { status: "IN_PROGRESS", deadlineAt: T0 + 60 * MIN, serverNow: T0 + 20 * MIN, configVersion: 3 }, deviceNow: T0 + 20 * MIN });
  check("an extended deadline is adopted, reported as later, and is the server's own number (11:00), not 'now + 60'", r.changed === true && r.direction === "later" && r.deadline === T0 + 60 * MIN && r.deltaMs === 30 * MIN && r.configVersion === 3);
  check("with the clock in agreement there is no clock correction", r.clockOffset === 0);
  check("the countdown becomes 40 minutes at 10:20 (11:00 minus 10:20), not 60 and not 70", secondsLeftAt(r.deadline, r.clockOffset, T0 + 20 * MIN) === 40 * 60);
}
// no change
{
  const r = applyClockAnswer({ currentDeadline: old, answer: { status: "IN_PROGRESS", deadlineAt: old, serverNow: T0 + 5 * MIN }, deviceNow: T0 + 5 * MIN });
  check("the same deadline is not a change (no notice every 20 seconds)", r.changed === false && r.direction === null);
  const r2 = applyClockAnswer({ currentDeadline: old, answer: { status: "IN_PROGRESS", deadlineAt: old + 400, serverNow: T0 }, deviceNow: T0 });
  check("a sub-second difference is rounding, not a change", r2.changed === false);
}
// a reduction
{
  const r = applyClockAnswer({ currentDeadline: T0 + 60 * MIN, answer: { status: "IN_PROGRESS", deadlineAt: T0 + 45 * MIN, serverNow: T0 + 10 * MIN }, deviceNow: T0 + 10 * MIN });
  check("a shortened deadline is adopted and reported as earlier", r.changed === true && r.direction === "earlier" && r.deadline === T0 + 45 * MIN);
}
// device clock skew
{
  const r = applyClockAnswer({ currentDeadline: old, answer: { status: "IN_PROGRESS", deadlineAt: T0 + 60 * MIN, serverNow: T0 + 20 * MIN }, deviceNow: T0 + 20 * MIN + 3 * MIN }); // the device is 3 minutes fast
  check("a fast device clock is corrected using the server's time", r.clockOffset === -3 * MIN && secondsLeftAt(r.deadline, r.clockOffset, T0 + 23 * MIN) === 40 * 60);
}
// untrusted answers keep the current deadline
for (const bad of [null, undefined, {}, { deadlineAt: "x", serverNow: 1 }, { deadlineAt: 1, serverNow: NaN }, { status: "IN_PROGRESS" }]) {
  check(`an unusable answer (${JSON.stringify(bad)}) changes nothing`, applyClockAnswer({ currentDeadline: old, answer: bad }) === null);
}
// the attempt ended on the server
check("an attempt the server no longer has in progress is reported as ended, never as a new deadline", applyClockAnswer({ currentDeadline: old, answer: { status: "SUBMITTED", deadlineAt: T0 + 60 * MIN, serverNow: T0 } }).ended === true && applyClockAnswer({ currentDeadline: old, answer: { status: "auto_submitted", deadlineAt: 1, serverNow: 1 } }).ended === true);
// first answer when the page has no deadline yet
check("with no current deadline an answer is adopted but never called a change", applyClockAnswer({ currentDeadline: null, answer: { status: "IN_PROGRESS", deadlineAt: old, serverNow: T0 } }).changed === false);
// the notice
{
  const text = deadlineNotice(T0 + 60 * MIN, "en-GB");
  check("the notice is neutral and carries the revised deadline", /^Your exam duration has been updated by the administrator\. Your revised deadline is \d{2}:\d{2}/.test(text) && !/reason|admin name|because/i.test(text), text);
}
check("time left never goes negative", secondsLeftAt(T0, 0, T0 + 5 * MIN) === 0);

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
