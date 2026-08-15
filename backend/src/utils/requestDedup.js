// Coalesces concurrent duplicate calls (double-click, network retry, a React re-render firing
// twice) sharing the same key into ONE in-flight execution — the second caller gets the exact
// same promise/result as the first, instead of both independently doing the work (and, for a
// judge job, occupying two queue slots for what's really one request). Self-healing by
// construction: the Map entry is removed the instant the promise settles (success or failure),
// so a process restart just starts with an empty Map — no stale locks are possible, and this
// never becomes a source of truth for anything (same posture as cache.js's TTL store).
const inFlight = new Map();

function dedupe(key, fn) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = Promise.resolve()
    .then(fn)
    .finally(() => {
      if (inFlight.get(key) === p) inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p;
}

// For diagnostic logging only (e.g. "a double-click was coalesced") — call BEFORE dedupe(key, fn)
// to know whether this call is about to join an already-running one.
function isInFlight(key) {
  return inFlight.has(key);
}

module.exports = { dedupe, isInFlight };
