/**
 * Bounded-concurrency queue for outbound Gemini calls — same shape as judge.js's queue.js, kept
 * as a separate instance (own env vars, own counters) since AI-call concurrency needs to be tuned
 * against Gemini's free-tier RPM, not against the judge's CPU/process limits. Free-tier RPM is
 * commonly single digits to low tens depending on model — see AI_STUDIO's rate-limit dashboard for
 * the exact current numbers on the configured key, and tune AI_CONCURRENCY/AI_MAX_QUEUE_SIZE to
 * match rather than trusting a hardcoded number here (Google changes these without versioning).
 */
let active = 0;
const waiting = [];
const MAX_CONCURRENT = Number(process.env.AI_CONCURRENCY || 2);
const MAX_QUEUE_SIZE = Number(process.env.AI_MAX_QUEUE_SIZE || 30);

// Bounded CONCURRENCY alone does not bound THROUGHPUT over a minute — two slots each finishing in
// ~1-3s and immediately picking up the next queued task can still burst well past a single-digit
// free-tier RPM ceiling, which is a rate over time, not an in-flight-request cap. Confirmed live
// (2026-09-18): only 12 AI calls total that day, nowhere near the daily quota, yet 3 got a genuine
// 429 straight from Gemini — the queue was dispatching faster than the per-minute window allowed
// even with concurrency capped at 2. This adds a minimum spacing between consecutive DISPATCHES
// (not per-slot — one shared clock across the whole queue), independent of and in addition to the
// existing MAX_RETRIES backoff in geminiProvider.js (that retries a single call that already got
// rate-limited; this prevents the queue from creating that situation as often in the first place).
const RPM_LIMIT = Number(process.env.AI_RPM_LIMIT || 10);
const MIN_DISPATCH_INTERVAL_MS = Math.ceil(60000 / RPM_LIMIT);
let lastDispatchAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Claims the next dispatch slot and returns how long to wait for it. MUST run synchronously
// (no await before this executes) relative to any other call that could be racing it — two tasks
// admitted under the concurrency cap in the same synchronous tick both call this before either of
// them awaits anything, so advancing lastDispatchAt HERE (not after the wait) is what makes their
// reservations stack instead of both reading the same stale timestamp and firing together. Fixed
// live during testing: the original version computed `wait` from lastDispatchAt but only wrote the
// new value back after sleeping, so two concurrently-admitted tasks both saw the same baseline,
// computed nearly-identical wait times, and dispatched within ~0ms of each other — exactly the
// burst this was meant to prevent.
function reserveNextSlot() {
  const slot = Math.max(Date.now(), lastDispatchAt + MIN_DISPATCH_INTERVAL_MS);
  lastDispatchAt = slot;
  return slot;
}

function runQueued(fn) {
  return new Promise((resolve, reject) => {
    if (active >= MAX_CONCURRENT && waiting.length >= MAX_QUEUE_SIZE) {
      const err = new Error("AI request queue is full — try again shortly");
      err.queueBusy = true;
      reject(err);
      return;
    }
    const task = async () => {
      active++;
      const slot = reserveNextSlot();
      const wait = slot - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        active--;
        const next = waiting.shift();
        if (next) next();
      }
    };
    if (active < MAX_CONCURRENT) task();
    else waiting.push(task);
  });
}

function getQueueStatus() {
  return { active, waiting: waiting.length, maxConcurrent: MAX_CONCURRENT, maxQueueSize: MAX_QUEUE_SIZE };
}

module.exports = { runQueued, getQueueStatus };
