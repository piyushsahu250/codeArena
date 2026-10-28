// A queue between the exam page and the server for violation reports, so that an event is neither lost when the network fails nor counted twice when it is sent again.
// Before: the page posted each report once, logged a failure to the console and forgot it; a report whose ANSWER was lost could not be sent again without the server counting it twice.
// Now: each event gets a unique id when it is detected (an idempotency key the server honours per attempt, backend/src/modules/tests/tests.violationEvent.js), is kept in a queue (and in
// sessionStorage, so a page refresh does not lose it), and is sent oldest first until the server acknowledges it. A failure that may pass (no connection, a timeout, 429, a server error) is
// retried with exponential backoff and jitter; a refusal that will not pass (the attempt is not yours, the report is malformed) is dropped and reported, never retried for ever. An event leaves
// the queue only when the server acknowledged it (a 2xx, including its "duplicate" answer, which means "already recorded"); nothing is acknowledged locally on the server's behalf.
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 60000;
export const BACKOFF_JITTER = 0.3; // adds up to 30 % so a whole room reconnecting does not retry in the same second
export const MAX_QUEUE = 200;

// Delay before attempt number `tries` (1 = after the first failure): 2 s, 4 s, 8 s ... capped at 60 s, plus up to 30 % jitter.
export function backoffDelay(tries, random = Math.random) {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, tries - 1));
  return Math.round(exp * (1 + BACKOFF_JITTER * random()));
}

// "retry": may pass later. "drop": the server refused this report and will refuse it again.
export function classifyFailure(err) {
  const status = err && err.response && err.response.status;
  if (!status) return "retry"; // no response at all: offline, a timeout, a dropped connection
  if (status === 408 || status === 425 || status === 429 || status === 401 || status >= 500) return "retry";
  return "drop";
}

const key = (attemptId) => `ca_violation_outbox_${attemptId}`;

export function createViolationOutbox({ attemptId, send, onAck, onDrop, onChange, storage = typeof sessionStorage !== "undefined" ? sessionStorage : null, now = () => Date.now(), random = Math.random,
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t), newId = () => crypto.randomUUID() } = {}) {
  let queue = [];
  let timer = null;
  let flushing = false;
  let destroyed = false;

  function load() {
    try {
      const raw = storage && storage.getItem(key(attemptId));
      const parsed = raw ? JSON.parse(raw) : [];
      queue = Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.eventId === "string" && typeof e.type === "string") : [];
    } catch { queue = []; }
  }
  function persist() {
    try { if (storage) { if (queue.length) storage.setItem(key(attemptId), JSON.stringify(queue)); else storage.removeItem(key(attemptId)); } } catch { /* storage full or blocked: the in-memory queue still works */ }
    onChange?.(queue.length);
  }
  function remove(event) { const i = queue.indexOf(event); if (i >= 0) queue.splice(i, 1); }
  function clearTimer() { if (timer !== null) { cancel(timer); timer = null; } }

  async function flush() {
    if (flushing || destroyed) return;
    flushing = true;
    clearTimer();
    try {
      while (queue.length > 0 && !destroyed) {
        const event = queue[0];
        let data;
        try {
          data = await send({ type: event.type, eventId: event.eventId, clientAt: event.clientAt });
          remove(event); // by identity: the queue may have been trimmed while this send was in flight
          persist();
        } catch (err) {
          if (classifyFailure(err) === "drop") {
            remove(event);
            persist();
            onDrop?.(event, err);
            continue;
          }
          event.tries = (event.tries || 0) + 1;
          persist();
          if (!destroyed) timer = schedule(() => { timer = null; flush(); }, backoffDelay(event.tries, random));
          break;
        }
        // Outside the try: a page handler that throws must not be mistaken for a failed send (the event IS acknowledged and gone from the queue).
        try { onAck?.(event, data); } catch (err) { console.error("violation acknowledgement handler failed:", err); }
      }
    } finally {
      flushing = false;
    }
  }

  load();
  return {
    // Records an event the moment it is detected and starts sending. Returns the event id (stable across every retry).
    enqueue({ type, reason }) {
      const event = { eventId: newId(), type, reason: reason || "", clientAt: now(), tries: 0 };
      queue.push(event);
      if (queue.length > MAX_QUEUE) { const gone = queue.shift(); onDrop?.(gone, new Error("queue full")); }
      persist();
      if (timer === null) flush(); // while a retry waits out its backoff, a new event does not jump the queue: it goes out with the retry
      return event.eventId;
    },
    // The connection came back or the tab became visible again: try now instead of waiting out the backoff.
    flushNow() { clearTimer(); return flush(); },
    pendingCount: () => queue.length,
    snapshot: () => queue.map((e) => ({ ...e })),
    destroy() { destroyed = true; clearTimer(); },
  };
}
