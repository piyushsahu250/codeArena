// Detects OTHER same-origin (this app's own) browser tabs currently open, via BroadcastChannel --
// this is the strongest reliable browser-supported signal available. There is no web API that can
// see tabs of unrelated sites/origins (by design -- a website is never allowed to enumerate a
// user's other open tabs); anything claiming to check "every tab in the browser" would be
// overclaiming. This channel only ever tells us about other CodeArena tabs, which is the honest,
// achievable version of the check.
//
// announceTabPresence() is mounted once, app-wide (see App.jsx), so a Dashboard tab, an LMS tab,
// etc. all participate -- not just other exam tabs. checkOtherTabsOpen() is called by the exam's
// pre-start screen to ask "is anyone else listening?" and count the replies.

const CHANNEL_NAME = "codearena-tab-presence";
const supported = typeof BroadcastChannel !== "undefined";

let channel = null;
let thisTabId = null;

function getChannel() {
  if (!supported) return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  if (!thisTabId) thisTabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return channel;
}

// Call once at app mount. Returns a cleanup function (or a no-op if BroadcastChannel isn't
// supported, so callers don't need to branch on support themselves).
export function announceTabPresence() {
  const ch = getChannel();
  if (!ch) return () => {};
  function onMessage(e) {
    if (e.data?.type === "ping" && e.data.tabId !== thisTabId) {
      ch.postMessage({ type: "pong", tabId: thisTabId });
    }
  }
  ch.addEventListener("message", onMessage);
  return () => ch.removeEventListener("message", onMessage);
}

// Resolves how many OTHER open CodeArena tabs replied within timeoutMs (never counts this tab).
// `supported: false` means the browser has no BroadcastChannel at all -- an honest "cannot check
// this," which callers should treat as "skip the check" rather than a false-negative "all clear."
export function checkOtherTabsOpen(timeoutMs = 400) {
  const ch = getChannel();
  if (!ch) return Promise.resolve({ supported: false, otherTabCount: 0 });
  return new Promise((resolve) => {
    const seen = new Set();
    function onMessage(e) {
      if (e.data?.type === "pong" && e.data.tabId !== thisTabId) seen.add(e.data.tabId);
    }
    ch.addEventListener("message", onMessage);
    ch.postMessage({ type: "ping", tabId: thisTabId });
    setTimeout(() => {
      ch.removeEventListener("message", onMessage);
      resolve({ supported: true, otherTabCount: seen.size });
    }, timeoutMs);
  });
}
