// Regression test for src/utils/finalizeRetry.js (automatic submit at time-up must not retry every second and blink the screen). Pure logic.
// Run: node frontend/scripts/finalizeRetryRegression.mjs
import { AUTO_RETRY_AFTER_FAILURE_MS, AUTO_RETRY_AFTER_PREMATURE_MS, shouldAutoFinalize } from "../src/utils/finalizeRetry.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const base = { remainingSec: 0, inFlight: false, finalized: false, now: 1_000_000 };

check("time left: no automatic submit", shouldAutoFinalize({ ...base, remainingSec: 5 }) === false);
check("time up, nothing tried yet: submit", shouldAutoFinalize(base) === true);
check("time up and a submit is already running: wait", shouldAutoFinalize({ ...base, inFlight: true }) === false);
check("already submitted: never again", shouldAutoFinalize({ ...base, finalized: true }) === false);

// the reported blink: a failed submit must not be retried on the very next tick
check("1 s after a failure: wait (this is the blink)", shouldAutoFinalize({ ...base, lastFailureAt: base.now - 1000 }) === false);
check("14 s after a failure: wait", shouldAutoFinalize({ ...base, lastFailureAt: base.now - 14000 }) === false);
check("15 s after a failure: try again", shouldAutoFinalize({ ...base, lastFailureAt: base.now - AUTO_RETRY_AFTER_FAILURE_MS }) === true);
check("a long time after a failure: try again", shouldAutoFinalize({ ...base, lastFailureAt: base.now - 120000 }) === true);

// "time is not up yet" from the server
check("1 s after a premature answer: wait", shouldAutoFinalize({ ...base, lastPrematureAt: base.now - 1000 }) === false);
check("5 s after a premature answer: try again", shouldAutoFinalize({ ...base, lastPrematureAt: base.now - AUTO_RETRY_AFTER_PREMATURE_MS }) === true);

// simulate 60 one-second ticks with a permanently failing server: before the fix there were 60 attempts, now there are at most 4
let attempts = 0; let lastFailureAt = 0; let inFlight = false; let failedUntil = 0;
for (let t = 0; t < 60; t++) {
  const now = base.now + t * 1000;
  if (inFlight && now >= failedUntil) { inFlight = false; lastFailureAt = now; } // each attempt takes ~6 s (3 tries with backoff) and fails
  if (shouldAutoFinalize({ remainingSec: 0, inFlight, finalized: false, lastFailureAt, now })) { attempts++; inFlight = true; failedUntil = now + 6000; }
}
check("a server that keeps failing gets at most 4 automatic attempts a minute, not 60", attempts >= 1 && attempts <= 4, `attempts ${attempts}`);

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
