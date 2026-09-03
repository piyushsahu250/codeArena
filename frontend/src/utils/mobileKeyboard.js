// Best-effort, cross-browser signal for "the on-screen virtual keyboard is very likely open right
// now" -- shared by every proctoring implementation (useProctoring.js, TestTaking.jsx) so the fix
// lives in exactly one place instead of being re-derived per call site.
//
// Why this exists: opening a mobile keyboard is not itself a proctoring-relevant event, but it has
// a real, well-documented side effect that WAS being misread as one -- Android Chrome (and some
// other mobile browsers) automatically exits the Fullscreen API the instant a text input/editor
// gains focus and the software keyboard opens. That is a platform quirk, not the student pressing
// Escape or switching away, yet it fires the exact same `fullscreenchange` event a genuine exit
// does. Without something to tell the two apart, every tap into the code editor on a phone counted
// as a fullscreen-exit violation.
//
// The VisualViewport API (window.visualViewport) is preferred where available -- it reports the
// area of the page actually visible to the user, so a keyboard opening shrinks it directly and
// reliably on Android Chrome/Firefox and iOS Safari/Chrome alike. Where it's unavailable (older
// WebViews) this falls back to window.innerHeight, a strictly weaker signal (it can't by itself
// tell a keyboard apart from a real orientation change or an actual resize) -- which is exactly why
// a bare shrink is never treated as sufficient on its own: every caller also requires that an
// editable element is (or was just) focused before calling it a keyboard, so a real tab-switch or
// app-switch with no field focused is never exempted.
const RECENT_FOCUS_WINDOW_MS = 1200; // covers the blur->focus handoff gap some mobile browsers leave activeElement in mid-tap
const DEFAULT_SHRINK_RATIO = 0.2;

function isEditableElement(el) {
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export function isTouchDevice() {
  return typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches);
}

// Tracks viewport height + recent-focus state and exposes `isKeyboardLikelyOpen()`. Optionally
// invokes `onKeyboardClose` once, the first time the viewport returns to its prior height after
// having been flagged as keyboard-shrunk -- used to retry re-entering fullscreen only once the
// keyboard actually closes, instead of immediately (and pointlessly, since browsers require a
// fresh user gesture) while it's still open.
export function createKeyboardSignal({ shrinkRatio = DEFAULT_SHRINK_RATIO, onKeyboardClose } = {}) {
  const viewport = typeof window !== "undefined" ? window.visualViewport : null;
  const target = viewport || window;
  let baseline = viewport ? viewport.height : window.innerHeight;
  let lastEditableFocusAt = 0;
  let flaggedOpen = false;

  function currentHeight() {
    return viewport ? viewport.height : window.innerHeight;
  }

  function isRecentlyFocusedEditable() {
    return isEditableElement(document.activeElement) || Date.now() - lastEditableFocusAt < RECENT_FOCUS_WINDOW_MS;
  }

  function isKeyboardLikelyOpen() {
    const height = currentHeight();
    if (height >= baseline) return false;
    const ratio = (baseline - height) / baseline;
    return ratio >= shrinkRatio && isRecentlyFocusedEditable();
  }

  function onFocusIn(e) {
    if (isEditableElement(e.target)) lastEditableFocusAt = Date.now();
  }

  function onResize() {
    const height = currentHeight();
    if (height >= baseline) {
      baseline = height;
      if (flaggedOpen) {
        flaggedOpen = false;
        onKeyboardClose?.();
      }
      return;
    }
    if (isKeyboardLikelyOpen()) {
      flaggedOpen = true;
    }
  }

  document.addEventListener("focusin", onFocusIn);
  target.addEventListener("resize", onResize);

  return {
    isKeyboardLikelyOpen,
    destroy() {
      document.removeEventListener("focusin", onFocusIn);
      target.removeEventListener("resize", onResize);
    },
  };
}
