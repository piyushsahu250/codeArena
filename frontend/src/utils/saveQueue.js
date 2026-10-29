// Autosave queue for typed interview answers. Pure (the timers and the send function are injected), so scripts/saveQueueRegression.mjs runs it under plain Node.
//
// Guarantees, per key (one key per question):
//  - at most ONE request in flight, so two saves can never reach the server out of order (an older text arriving after a newer one);
//  - while a request is in flight, newer text only replaces "the latest" and is sent once the current request ends: the server always ends with the newest text;
//  - the status is "saved" only after the server confirmed the newest text, never before;
//  - a failure that may pass (offline, timeout, 5xx, 429) is retried with growing delays for as long as the page is open; a failure that will not (other 4xx: session closed, bad
//    request) stops with "failed" and does not hammer the server;
//  - the text is kept in memory the whole time, so nothing typed is discarded when a save fails.
const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 8000, 15000];

export function isPermanentSaveError(err) {
  const status = err?.response?.status;
  if (typeof status !== "number") return false; // no response at all = network or timeout: worth retrying
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

// Worst status wins when several questions are summarised: failed > retrying > saving > saved > idle.
const RANK = { idle: 0, saved: 1, saving: 2, retrying: 3, failed: 4 };
export function worstStatus(statuses) {
  let worst = "idle";
  for (const s of statuses) if ((RANK[s] ?? 0) > RANK[worst]) worst = s;
  return worst;
}

export function createSaveQueue({ send, onStatus = () => {}, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const items = new Map(); // key -> { latest, version, sentVersion, inFlight, retry, timer, status, waiters }
  let disposed = false;

  function get(key) {
    if (!items.has(key)) items.set(key, { latest: "", version: 0, sentVersion: 0, inFlight: false, retry: 0, timer: null, status: "idle", waiters: [] });
    return items.get(key);
  }
  function setStatus(key, it, status) {
    if (it.status === status) return;
    it.status = status;
    onStatus(key, status);
  }
  function settle(it, ok) {
    const waiters = it.waiters;
    it.waiters = [];
    for (const w of waiters) w(ok);
  }

  function run(key) {
    const it = get(key);
    if (disposed || it.inFlight || it.sentVersion === it.version) return;
    clearTimer(it.timer);
    it.timer = null;
    it.inFlight = true;
    setStatus(key, it, it.retry > 0 ? "retrying" : "saving");
    const sendingVersion = it.version;
    const sendingText = it.latest;
    Promise.resolve()
      .then(() => send(key, sendingText))
      .then(() => {
        it.inFlight = false;
        it.retry = 0;
        it.sentVersion = sendingVersion;
        if (it.version > sendingVersion) run(key); // newer text arrived while this one was in flight
        else { setStatus(key, it, "saved"); settle(it, true); }
      })
      .catch((err) => {
        it.inFlight = false;
        if (disposed) return;
        if (isPermanentSaveError(err)) { setStatus(key, it, "failed"); settle(it, false); return; }
        const delay = retryDelaysMs[Math.min(it.retry, retryDelaysMs.length - 1)];
        it.retry += 1;
        setStatus(key, it, "retrying");
        it.timer = setTimer(() => run(key), delay);
      });
  }

  return {
    // Records the newest text for `key` and sends it as soon as no request for that key is in flight.
    push(key, text) {
      const it = get(key);
      if (disposed) return;
      if (text === it.latest && it.version > 0) return; // nothing new
      it.latest = text;
      it.version += 1;
      if (it.status === "failed") it.retry = 0; // new typing after a permanent failure gets a fresh try
      if (!it.inFlight && !it.timer) run(key);
      else if (!it.inFlight && it.timer) { clearTimer(it.timer); it.timer = null; run(key); } // fresh text replaces a waiting retry
      else setStatus(key, it, it.status === "retrying" ? "retrying" : "saving");
    },
    // Retry now instead of waiting for the next scheduled attempt (for example when the browser reports it is back online).
    retryNow() {
      for (const [key, it] of items) if (!it.inFlight && it.sentVersion !== it.version) { clearTimer(it.timer); it.timer = null; run(key); }
    },
    // Resolves true when everything pushed so far for `key` is confirmed saved, false if it ended in "failed".
    flush(key) {
      const it = get(key);
      if (it.sentVersion === it.version && !it.inFlight) return Promise.resolve(true);
      if (it.status === "failed" && !it.inFlight) return Promise.resolve(false); // already ended in a permanent failure: nothing is going to resolve a waiter
      return new Promise((resolve) => it.waiters.push(resolve));
    },
    status(key) { return get(key).status; },
    summary() { return worstStatus([...items.values()].map((i) => i.status)); },
    dispose() {
      disposed = true;
      for (const it of items.values()) { clearTimer(it.timer); settle(it, false); }
    },
  };
}
