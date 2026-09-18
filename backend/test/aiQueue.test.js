// Verifies the fix for a real live bug (2026-09-18): bounded CONCURRENCY in aiQueue.js did not
// bound THROUGHPUT over a minute, so a burst of queued AI calls could still exceed Gemini's
// free-tier RPM even with only 2 requests ever in flight at once. See aiQueue.js's own comment for
// the full root-cause writeup.
const { test } = require("node:test");
const assert = require("node:assert/strict");

// AI_RPM_LIMIT is read once at module load — set it before requiring so the test runs fast
// (a real production default of 10 RPM would make this test itself take 6s+ per dispatch).
process.env.AI_RPM_LIMIT = "300"; // 200ms minimum spacing
const { runQueued } = require("../src/utils/aiQueue");

// Order matters here: this must run before any other test in this file dispatches through the
// queue, since the minimum-spacing clock (lastDispatchAt) is module-level state shared across
// every runQueued call in the process, not reset between tests.
test("runQueued runs the very first call immediately with no artificial startup delay", async () => {
  const start = Date.now();
  await runQueued(async () => true);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 150, `a queue with no prior dispatches should not delay the first call, took ${elapsed}ms`);
});

test("runQueued enforces a minimum spacing between dispatches, independent of the concurrency cap", async () => {
  const timestamps = [];
  const results = await Promise.all(
    [1, 2, 3, 4].map(() => runQueued(async () => { timestamps.push(Date.now()); return true; }))
  );
  assert.equal(results.length, 4);
  timestamps.sort((a, b) => a - b);
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    // Generous lower bound (not the full 200ms) to stay robust against CI/host scheduling jitter
    // while still catching a real regression (e.g. the gate being accidentally removed, which
    // would produce near-0ms gaps for every pair, not just an occasionally-tight one).
    assert.ok(gap >= 150, `expected consecutive dispatches to be spaced by ~200ms, got a ${gap}ms gap between dispatch ${i - 1} and ${i}`);
  }
});
