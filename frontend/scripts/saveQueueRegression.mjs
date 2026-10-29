// Regression test for the interview answer autosave queue. Pure (injected send and timers), no DOM. Run: node frontend/scripts/saveQueueRegression.mjs
import { createSaveQueue, isPermanentSaveError, worstStatus } from "../src/utils/saveQueue.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };
const tick = () => new Promise((r) => setImmediate(r));
const settleAll = async () => { for (let i = 0; i < 6; i++) await tick(); };

// A fake clock: setTimer only records; fire() runs the oldest pending timer.
function fakeClock() {
  const timers = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
    pending: () => timers.filter((t) => t.live),
    fire: () => { const t = timers.find((x) => x.live); if (t) { t.live = false; t.fn(); } },
  };
}
// A send whose every call can be answered by hand.
function manualSend() {
  const calls = [];
  const send = (key, text) => new Promise((resolve, reject) => calls.push({ key, text, resolve, reject }));
  return { send, calls };
}
const httpError = (status) => Object.assign(new Error("http " + status), { response: { status } });

// 1. one request at a time, the newest text always goes last
{
  const clock = fakeClock(); const m = manualSend(); const statuses = [];
  const q = createSaveQueue({ send: m.send, onStatus: (k, s) => statuses.push(s), ...clock });
  q.push("q1", "a"); await settleAll();
  q.push("q1", "ab"); q.push("q1", "abc"); await settleAll();
  check("only the first request is in flight while it is unanswered", m.calls.length === 1 && m.calls[0].text === "a");
  check("status is saving, not saved, while a request is unanswered", q.status("q1") === "saving");
  m.calls[0].resolve(); await settleAll();
  check("then exactly one more request goes out, with the NEWEST text (intermediate text is coalesced)", m.calls.length === 2 && m.calls[1].text === "abc");
  check("not saved yet: the newest text is still being sent", q.status("q1") === "saving");
  m.calls[1].resolve(); await settleAll();
  check("saved only after the newest text was confirmed", q.status("q1") === "saved" && statuses.at(-1) === "saved");
  check("it never reported saved before the end", statuses.filter((s) => s === "saved").length === 1);
}

// 2. out-of-order responses cannot lead to an older text being sent last
{
  const clock = fakeClock(); const m = manualSend();
  const q = createSaveQueue({ send: m.send, ...clock });
  q.push("q1", "one"); await settleAll();
  q.push("q1", "two"); await settleAll();
  m.calls[0].resolve(); await settleAll();
  m.calls[1].resolve(); await settleAll();
  check("requests are sent in the order typed, one after the other", m.calls.map((c) => c.text).join(",") === "one,two");
}

// 3. a network failure is retried with growing delays, then succeeds, and the text is never lost
{
  const clock = fakeClock(); const m = manualSend(); const statuses = [];
  const q = createSaveQueue({ send: m.send, onStatus: (k, s) => statuses.push(s), retryDelaysMs: [1000, 3000], ...clock });
  q.push("q1", "typed"); await settleAll();
  m.calls[0].reject(new Error("Network Error")); await settleAll();
  check("a network failure shows reconnecting, not saved", q.status("q1") === "retrying");
  check("the first retry waits 1000 ms", clock.pending().length === 1 && clock.pending()[0].ms === 1000);
  clock.fire(); await settleAll();
  check("the retry sends the same text again", m.calls.length === 2 && m.calls[1].text === "typed");
  m.calls[1].reject(httpError(503)); await settleAll();
  check("a 503 is also retried, with the next delay", clock.pending()[0].ms === 3000 && q.status("q1") === "retrying");
  clock.fire(); await settleAll();
  m.calls[2].reject(new Error("timeout")); await settleAll();
  check("the last delay repeats instead of giving up", clock.pending()[0].ms === 3000);
  clock.fire(); await settleAll();
  m.calls[3].resolve(); await settleAll();
  check("after the connection returns the text is saved", q.status("q1") === "saved" && !statuses.includes("failed"));
}

// 4. new typing during a retry wait is sent at once and replaces the waiting retry
{
  const clock = fakeClock(); const m = manualSend();
  const q = createSaveQueue({ send: m.send, ...clock });
  q.push("q1", "first"); await settleAll();
  m.calls[0].reject(new Error("Network Error")); await settleAll();
  q.push("q1", "first and more"); await settleAll();
  check("new text goes out immediately and the waiting retry is cancelled", m.calls.length === 2 && m.calls[1].text === "first and more" && clock.pending().length === 0);
}

// 5. permanent errors stop, do not retry, and say failed
{
  const clock = fakeClock(); const m = manualSend();
  const q = createSaveQueue({ send: m.send, ...clock });
  q.push("q1", "x"); await settleAll();
  m.calls[0].reject(httpError(409)); await settleAll();
  check("a 409 (session closed) is failed, with no retry scheduled", q.status("q1") === "failed" && clock.pending().length === 0);
  check("flush after a permanent failure resolves false at once", (await q.flush("q1")) === false);
  q.push("q1", "xy"); await settleAll();
  check("typing again after a failure tries again", m.calls.length === 2);
}

// 6. 408 and 429 are retryable, other 4xx are not, no response is retryable
{
  check("429 and 408 are retryable", !isPermanentSaveError(httpError(429)) && !isPermanentSaveError(httpError(408)));
  check("400, 403, 404, 409, 413 are permanent", [400, 403, 404, 409, 413].every((s) => isPermanentSaveError(httpError(s))));
  check("5xx and no response are retryable", !isPermanentSaveError(httpError(500)) && !isPermanentSaveError(new Error("Network Error")) && !isPermanentSaveError(undefined));
}

// 7. flush resolves only when the newest text is confirmed
{
  const clock = fakeClock(); const m = manualSend();
  const q = createSaveQueue({ send: m.send, ...clock });
  q.push("q1", "a"); await settleAll();
  let done = null;
  q.flush("q1").then((v) => { done = v; });
  await settleAll();
  check("flush waits while a request is unanswered", done === null);
  m.calls[0].resolve(); await settleAll();
  check("flush resolves true once it is confirmed", done === true);
  check("flush on an idle key resolves true", (await createSaveQueue({ send: m.send, ...clock }).flush("none")) === true);
}

// 8. keys are independent
{
  const clock = fakeClock(); const m = manualSend();
  const q = createSaveQueue({ send: m.send, ...clock });
  q.push("q1", "a"); q.push("q2", "b"); await settleAll();
  check("two questions can each have a request in flight", m.calls.length === 2);
  m.calls[0].resolve(); await settleAll();
  check("q1 is saved while q2 is still saving", q.status("q1") === "saved" && q.status("q2") === "saving");
  check("the summary is the worst of them", q.summary() === "saving");
}

// 9. pushing the same text again sends nothing; dispose stops everything
{
  const clock = fakeClock(); const m = manualSend();
  const q = createSaveQueue({ send: m.send, ...clock });
  q.push("q1", "same"); await settleAll(); m.calls[0].resolve(); await settleAll();
  q.push("q1", "same"); await settleAll();
  check("an unchanged text is not sent again", m.calls.length === 1);
  q.push("q1", "changed"); await settleAll();
  q.dispose();
  m.calls[1].reject(new Error("Network Error")); await settleAll();
  check("after dispose no retry is scheduled and nothing more is sent", clock.pending().length === 0 && m.calls.length === 2);
  q.push("q1", "after"); await settleAll();
  check("after dispose pushes are ignored", m.calls.length === 2);
}

// 10. retryNow retries without waiting
{
  const clock = fakeClock(); const m = manualSend();
  const q = createSaveQueue({ send: m.send, ...clock });
  q.push("q1", "t"); await settleAll();
  m.calls[0].reject(new Error("Network Error")); await settleAll();
  q.retryNow(); await settleAll();
  check("retryNow sends again immediately (the browser says it is back online)", m.calls.length === 2 && clock.pending().length === 0);
}

check("worstStatus orders failed > retrying > saving > saved > idle", worstStatus(["saved", "saving"]) === "saving" && worstStatus(["saving", "retrying", "saved"]) === "retrying" && worstStatus(["retrying", "failed"]) === "failed" && worstStatus([]) === "idle");

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("Save queue regression: all passed");
