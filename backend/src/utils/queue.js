/**
 * Bounded-concurrency helpers so a single low-resource instance (Render free
 * tier: 0.1 CPU / 512MB) degrades gracefully — requests queue instead of all
 * spawning child processes at once and taking the container down.
 */

let active = 0;
const waiting = [];
const MAX_CONCURRENT_SUBMISSIONS = Number(process.env.JUDGE_CONCURRENCY || 2);
// Previously unbounded — under enough concurrent load the `waiting` array could grow without
// limit, with every queued caller just waiting indefinitely for a slot with no feedback. A cap
// lets callers fail fast with a distinguishable, recoverable error instead.
const MAX_QUEUE_SIZE = Number(process.env.JUDGE_MAX_QUEUE_SIZE || 20);

// Runs `fn` once fewer than MAX_CONCURRENT_SUBMISSIONS judge jobs are in flight;
// otherwise queues it (FIFO) until a slot frees up. Rejects immediately (err.queueBusy = true)
// if the queue is already at MAX_QUEUE_SIZE, rather than growing it unboundedly.
function runQueued(fn) {
  return new Promise((resolve, reject) => {
    if (active >= MAX_CONCURRENT_SUBMISSIONS && waiting.length >= MAX_QUEUE_SIZE) {
      const err = new Error("Judge queue is full");
      err.queueBusy = true;
      reject(err);
      return;
    }
    const task = async () => {
      active++;
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
    if (active < MAX_CONCURRENT_SUBMISSIONS) task();
    else waiting.push(task);
  });
}

// Lets the frontend show "N ahead of you" instead of a silent spinner during heavy load —
// this instance can only run MAX_CONCURRENT_SUBMISSIONS judge jobs at once, so under a
// large concurrent class this counter is the honest picture of what's actually happening.
function getQueueStatus() {
  return { active, waiting: waiting.length, maxConcurrent: MAX_CONCURRENT_SUBMISSIONS, maxQueueSize: MAX_QUEUE_SIZE };
}

// Runs fn(item, index) over items with at most `limit` in flight at once,
// preserving result order (unlike a plain Promise.all over an unbounded map).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, worker));
  return results;
}

module.exports = { runQueued, mapWithConcurrency, getQueueStatus };
