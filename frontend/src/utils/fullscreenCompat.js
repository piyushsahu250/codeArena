// Cross-browser Fullscreen API helpers -- the exam pages previously called only the standard
// `document.documentElement.requestFullscreen()` / `document.fullscreenElement`, with no fallback
// to the vendor-prefixed variants older/non-Chromium browsers still require (Safari <16.4 uses
// `webkitRequestFullscreen`/`webkitFullscreenElement`; older Firefox used `mozRequestFullScreen`;
// legacy Edge/IE used `msRequestFullscreen`). On a browser that only exposes a prefixed API, the
// standard call was silently a no-op (optional-chained on an undefined method), which reads
// identically to "the student's browser rejected fullscreen" even though a working alternative was
// available the whole time. This does NOT make fullscreen work on browsers with no Fullscreen
// support at all for arbitrary elements (notably iOS Safari, which only supports it for <video>) --
// that's a genuine, undetectable-in-advance platform limitation, not something any JS fallback can
// paper over; getFullscreenElement()/requestFullscreenCompat() simply return false/reject there,
// same as they always did, so callers can detect and honestly surface it instead of pretending.

function fullscreenTarget(el) {
  return el || document.documentElement;
}

export function requestFullscreenCompat(el) {
  const target = fullscreenTarget(el);
  const fn = target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen;
  if (!fn) return Promise.reject(new Error("Fullscreen API not supported in this browser"));
  // Some prefixed implementations (old WebKit/IE) return undefined instead of a Promise --
  // wrap in Promise.resolve so every caller can uniformly .then/.catch/await this.
  return Promise.resolve(fn.call(target));
}

export function exitFullscreenCompat() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (!fn) return Promise.resolve();
  return Promise.resolve(fn.call(document));
}

// Capability check (does this browser have ANY usable Fullscreen API at all), distinct from
// requestFullscreenCompat's actual runtime request -- used by preflight/capability screens (e.g.
// ReadinessChecklist.jsx) that need to warn "this browser doesn't support fullscreen" BEFORE the
// student even starts. Checking only the standard `requestFullscreen` (as this used to) incorrectly
// told a Safari-<16.4-class browser fullscreen was unsupported, when it actually is via the
// prefixed API this checks too.
export function supportsFullscreen() {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen);
}

export function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null;
}

// Registers a fullscreenchange listener across every vendor-prefixed event name and returns a
// single cleanup function that removes all of them -- callers add one handler, not four.
export function onFullscreenChange(handler) {
  const events = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"];
  events.forEach((evt) => document.addEventListener(evt, handler));
  return () => events.forEach((evt) => document.removeEventListener(evt, handler));
}
