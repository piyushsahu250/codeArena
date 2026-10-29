// Autosave for the section-wise examination. Built on utils/saveQueue.js (one request in flight per item, newest value always last, retries on network failures, "saved" only after
// the server confirmed) and adds the examination's own concurrency rule: every answer carries a version, and a save that lost a race (409 STALE_VERSION) learns the server's current
// version and is sent once more with this tab's newest value. Only one tab holds an examination session, so the newest value here is the one the student means.
// Pure (the network function is injected), so scripts/examAnswerSaverRegression.mjs runs it under plain Node.
import { createSaveQueue } from "./saveQueue.js";

const stable = (payload) => JSON.stringify(payload);

export function createExamAnswerSaver({ put, onStatus = () => {}, retryDelaysMs, setTimer, clearTimer }) {
  const versions = new Map(); // itemRef -> the last version the server confirmed

  async function sendOnce(itemRef, payload, finalize) {
    for (let tries = 0; tries < 2; tries++) {
      try {
        const res = await put(itemRef, { version: versions.get(itemRef) ?? 0, payload, ...(finalize ? { finalize: true } : {}) });
        if (typeof res?.version === "number") versions.set(itemRef, res.version);
        return res;
      } catch (err) {
        const data = err?.response?.data;
        if (tries === 0 && err?.response?.status === 409 && data?.code === "STALE_VERSION" && Number.isInteger(data.currentVersion)) { versions.set(itemRef, data.currentVersion); continue; }
        throw err;
      }
    }
    return undefined;
  }

  const queue = createSaveQueue({ send: (itemRef, serialized) => sendOnce(itemRef, JSON.parse(serialized), false), onStatus, retryDelaysMs, setTimer, clearTimer });

  return {
    // Seeds the versions the server already holds (from the attempt view), so the first save of a restored answer is not a stale one.
    setVersion(itemRef, version) { if (Number.isInteger(version)) versions.set(itemRef, version); },
    versionOf: (itemRef) => versions.get(itemRef) ?? 0,
    save(itemRef, payload) { queue.push(itemRef, stable(payload)); },
    // Sends any pending value for the item first, then the final value with finalize: true (the answer-editing policy "locked after next"). Resolves true when the server confirmed it.
    async finalize(itemRef, payload) {
      const flushed = await queue.flush(itemRef);
      if (!flushed) return false;
      try { await sendOnce(itemRef, payload, true); return true; } catch { return false; }
    },
    flush: (itemRef) => queue.flush(itemRef),
    status: (itemRef) => queue.status(itemRef),
    summary: () => queue.summary(),
    retryNow: () => queue.retryNow(),
    dispose: () => queue.dispose(),
  };
}
