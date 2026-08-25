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
