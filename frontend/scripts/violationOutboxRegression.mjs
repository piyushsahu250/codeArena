// Regression test for src/utils/violationOutbox.js (violation reports are queued, retried with backoff and jitter, never lost, never counted twice). Pure logic: a fake server, a fake clock,
// a fake timer and an in-memory storage, so every network failure mode can be driven directly.
// Run: node frontend/scripts/violationOutboxRegression.mjs
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, MAX_QUEUE, backoffDelay, classifyFailure, createViolationOutbox } from "../src/utils/violationOutbox.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const settle = () => new Promise((r) => setImmediate(r));
const httpError = (status) => Object.assign(new Error("http " + status), { response: { status } });
const networkError = () => new Error("Network Error");
function memoryStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; }

function harness({ storage = memoryStorage(), failWith = [], random = () => 0 } = {}) {
  const server = { received: [], seenIds: new Set(), counted: 0 }; // the server counts each id once, like the real endpoint
  const failQueue = [...failWith];
  const timers = [];
  const log = { acks: [], drops: [], changes: [] };
  let id = 0;
  const outbox = createViolationOutbox({
    attemptId: "att1",
    storage, random,
    now: () => 1_000_000 + id,
    newId: () => `event-${String(++id).padStart(4, "0")}`,
    schedule: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return t; },
    cancel: (t) => { t.cancelled = true; },
    send: async (e) => {
      server.received.push(e.eventId);
      const f = failQueue.shift();
      if (f) {
        if (f.lostAnswer) { if (!server.seenIds.has(e.eventId)) { server.seenIds.add(e.eventId); server.counted++; } throw networkError(); } // the server got it, the answer was lost
        throw f;
      }
      const duplicate = server.seenIds.has(e.eventId);
      if (!duplicate) { server.seenIds.add(e.eventId); server.counted++; }
      return { acknowledged: true, eventId: e.eventId, duplicate: duplicate || undefined };
    },
    onAck: (e, d) => log.acks.push({ id: e.eventId, duplicate: !!d.duplicate }),
    onDrop: (e, err) => log.drops.push({ id: e.eventId, why: err.message }),
    onChange: (n) => log.changes.push(n),
  });
  const fireTimer = async () => { const t = timers.filter((x) => !x.cancelled).pop(); if (t) { t.cancelled = true; t.fn(); } await settle(); };
  return { outbox, server, timers, log, fireTimer, storage };
}

// ---- the policy functions
check("backoff grows 2 s, 4 s, 8 s ... and is capped at 60 s (jitter off)", [1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffDelay(n, () => 0)).join(",") === "2000,4000,8000,16000,32000,60000,60000,60000" && BACKOFF_BASE_MS === 2000 && BACKOFF_MAX_MS === 60000);
check("jitter adds up to 30 % and never subtracts", backoffDelay(3, () => 1) === 10400 && backoffDelay(3, () => 0) === 8000 && backoffDelay(30, () => 1) === 78000);
check("no response, 408, 429, 401 and 5xx may pass later; other refusals will not", ["net", 408, 429, 401, 500, 502, 503].every((s) => classifyFailure(s === "net" ? networkError() : httpError(s)) === "retry") && [400, 403, 404, 409, 422].every((s) => classifyFailure(httpError(s)) === "drop"));

// ---- the happy path
{
  const h = harness();
  const id = h.outbox.enqueue({ type: "TAB_SWITCH", reason: "r" });
  await settle();
  check("an event is sent at once with its own id and leaves the queue only when acknowledged", h.server.received[0] === id && h.log.acks.length === 1 && h.outbox.pendingCount() === 0 && h.server.counted === 1);
  check("the queue storage is cleared once everything is acknowledged", h.storage._m.size === 0);
}
// ---- the network is down, then returns
{
  const h = harness({ failWith: [networkError(), networkError()] });
  const id = h.outbox.enqueue({ type: "FULLSCREEN_EXIT", reason: "x" });
  await settle();
  check("a failed send keeps the event queued and schedules a retry with backoff", h.outbox.pendingCount() === 1 && h.log.acks.length === 0 && h.timers.length === 1 && h.timers[0].ms === 2000);
  check("the unsent event is already in storage (a refresh would not lose it)", JSON.parse(h.storage.getItem("ca_violation_outbox_att1"))[0].eventId === id);
  await h.fireTimer();
  check("a second failure doubles the delay", h.timers.at(-1).ms === 4000 && h.outbox.pendingCount() === 1);
  await h.fireTimer();
  check("when the connection returns the event is delivered once, with the SAME id on every try", h.log.acks.length === 1 && h.outbox.pendingCount() === 0 && h.server.received.every((x) => x === id) && h.server.received.length === 3 && h.server.counted === 1);
}
// ---- the answer was lost: the server already has it
{
  const h = harness({ failWith: [{ lostAnswer: true }] });
  const id = h.outbox.enqueue({ type: "TAB_SWITCH", reason: "x" });
  await settle();
  await h.fireTimer();
  check("a report whose ANSWER was lost is sent again, the server recognises the id, and it is counted exactly once", h.server.counted === 1 && h.server.received.length === 2 && h.log.acks.length === 1 && h.log.acks[0].duplicate === true && h.log.acks[0].id === id);
}
// ---- ordering and several events
{
  const h = harness({ failWith: [networkError()] });
  const a = h.outbox.enqueue({ type: "TAB_SWITCH", reason: "1" });
  const b = h.outbox.enqueue({ type: "FULLSCREEN_EXIT", reason: "2" });
  const c = h.outbox.enqueue({ type: "COPY", reason: "3" });
  await settle();
  check("while the first is waiting out its backoff, later events do not jump the queue", h.outbox.pendingCount() === 3 && h.server.received.length === 1);
  await h.fireTimer();
  check("after the retry all three are delivered, oldest first, each counted once", h.log.acks.map((x) => x.id).join() === [a, b, c].join() && h.server.counted === 3);
}
// ---- refusals that will not pass
{
  const h = harness({ failWith: [httpError(403)] });
  const a = h.outbox.enqueue({ type: "TAB_SWITCH", reason: "1" });
  const b = h.outbox.enqueue({ type: "COPY", reason: "2" });
  await settle();
  check("a refusal that will not pass is dropped and reported (not retried for ever), and the next event still goes out", h.log.drops.length === 1 && h.log.drops[0].id === a && h.log.acks.length === 1 && h.log.acks[0].id === b && h.outbox.pendingCount() === 0);
}
{
  const h = harness({ failWith: [httpError(429), httpError(503)] });
  h.outbox.enqueue({ type: "TAB_SWITCH", reason: "1" });
  await settle();
  await h.fireTimer();
  await h.fireTimer();
  check("rate limiting and server errors are retried, then delivered", h.log.acks.length === 1 && h.log.drops.length === 0 && h.server.counted === 1);
}
// ---- a page refresh
{
  const storage = memoryStorage();
  const h1 = harness({ storage, failWith: [networkError()] });
  const id = h1.outbox.enqueue({ type: "TAB_SWITCH", reason: "x" });
  await settle();
  h1.outbox.destroy();
  const h2 = harness({ storage });
  check("after a refresh the unsent event is restored from storage with its original id", h2.outbox.pendingCount() === 1 && h2.outbox.snapshot()[0].eventId === id);
  await h2.outbox.flushNow();
  await settle();
  check("and it is delivered by the new page, once", h2.log.acks.length === 1 && h2.log.acks[0].id === id && h2.outbox.pendingCount() === 0);
}
{
  const storage = memoryStorage(); storage.setItem("ca_violation_outbox_att1", "{not json");
  check("a corrupt storage entry is ignored, not a crash", harness({ storage }).outbox.pendingCount() === 0);
  const s2 = memoryStorage(); s2.setItem("ca_violation_outbox_att1", JSON.stringify([{ eventId: "good-event-1", type: "COPY" }, { nope: 1 }, null, 5]));
  check("entries that are not events are filtered out of a restored queue", harness({ storage: s2 }).outbox.pendingCount() === 1);
}
// ---- the connection returns: flush now, not after the backoff
{
  const h = harness({ failWith: [networkError()] });
  h.outbox.enqueue({ type: "TAB_SWITCH", reason: "x" });
  await settle();
  const pending = h.timers.filter((t) => !t.cancelled).length;
  await h.outbox.flushNow();
  await settle();
  check("when the connection returns the queue is flushed at once and the waiting timer is cancelled", pending === 1 && h.log.acks.length === 1 && h.timers.filter((t) => !t.cancelled).length === 0);
}
// ---- the queue is bounded and the oldest is reported, not lost silently
{
  const h = harness({ failWith: Array.from({ length: 500 }, () => networkError()) });
  for (let i = 0; i < MAX_QUEUE + 5; i++) h.outbox.enqueue({ type: "COPY", reason: String(i) });
  await settle();
  check("the queue is capped, and every event pushed out is reported to the page", h.outbox.pendingCount() === MAX_QUEUE && h.log.drops.length === 5 && h.log.drops.every((d) => d.why === "queue full"));
}
// ---- destroy stops everything
{
  const h = harness({ failWith: [networkError()] });
  h.outbox.enqueue({ type: "TAB_SWITCH", reason: "x" });
  await settle();
  h.outbox.destroy();
  check("destroying the outbox cancels its retry timer (no timers outlive the page)", h.timers.every((t) => t.cancelled));
}
{
  const h = harness({ failWith: [networkError()] });
  h.outbox.enqueue({ type: "COPY", reason: "x" });
  check("the page is told the pending count on every change", h.log.changes[0] === 1);
}

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
