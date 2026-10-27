// Browser-side secure-assessment helpers for the formal Test page. DETECTION AND PRE-FLIGHT ONLY: the server decides what is
// allowed (start requirements, session ownership, question access, severity). These signals report what a web page can
// honestly observe; they never name an application and never prove malpractice.
//
// Limits (also in docs/EXAM_SECURITY.md): a page cannot see other apps, extensions, system overlays or another device. What
// it CAN see is that its own window stopped being the focused one while still visible (split-screen, a floating assistant, a
// second monitor app) and that its window is only a fraction of the screen.

// A phone or tablet, as the SERVER decides it (the same user-agent pattern as backend examSecurity.isMobileUserAgent), plus the browser's own mobile hint and
// iPadOS in desktop mode. NOT "has a touchscreen": Windows and Chromebook laptops with a touch display report touch points and are ordinary desktops.
export function isMobileDevice(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return false;
  if (nav.userAgentData && nav.userAgentData.mobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(String(nav.userAgent || ""))) return true;
  return nav.platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1;
}

// Fires onLoss once when the page is visible but has not held focus for `graceMs` (a brief focus flicker, a permission prompt
// or a notification pull-down shorter than graceMs is ignored); fires onRestore when focus returns. A hidden page is the tab-
// switch signal's job, so this one only reports "visible but not focused".
export function createFocusLossSignal({ graceMs = 2500, onLoss, onRestore } = {}) {
  let timer = null;
  let reportedAt = 0;
  function clear() { if (timer) { clearTimeout(timer); timer = null; } }
  function onBlur() {
    clear();
    timer = setTimeout(() => {
      timer = null;
      if (document.visibilityState === "visible" && !document.hasFocus()) { reportedAt = Date.now(); onLoss?.(); }
    }, graceMs);
  }
  function onFocus() {
    clear();
    if (reportedAt) { const seconds = Math.round((Date.now() - reportedAt) / 1000); reportedAt = 0; onRestore?.(seconds); }
  }
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  return { destroy() { clear(); window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus); } };
}

// What the page can measure about its own window. `typing` is true while a text field has focus (the on-screen keyboard then shrinks the height, never the width).
export function measureWindow() {
  if (typeof window === "undefined" || !window.screen) return null;
  const vv = window.visualViewport;
  const el = document.activeElement;
  const sh = window.screen.availHeight || window.screen.height;
  const sw = window.screen.availWidth || window.screen.width;
  const portrait = window.matchMedia ? window.matchMedia("(orientation: portrait)").matches : sh >= sw;
  return {
    isMobile: isMobileDevice(), portrait, innerW: vv ? vv.width : window.innerWidth, innerH: vv ? vv.height : window.innerHeight, availW: sw, availH: sh,
    scale: vv ? vv.scale : 1, typing: !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)),
    screenX: typeof window.screenX === "number" ? window.screenX : (window.screenLeft || 0), screenY: typeof window.screenY === "number" ? window.screenY : (window.screenTop || 0),
  };
}

// Is the exam window failing to fill the screen? Pure (the measurements are passed in) so it can be tested. Phones and tablets only: a desktop browser is held to fullscreen by the page itself,
// and leaving it is the fullscreen-exit rule. Pinch-zoom is ignored (it changes the visible size with no other window involved).
//   narrow  - in portrait the window is narrower than the screen: a floating, split-screen or resized window. The on-screen keyboard never changes the width, so this holds while typing.
//   short   - along the long axis the window is below 62 % of the screen (the browser's own bars take up to ~20 %). Ignored while typing (the keyboard shrinks the height).
export function assessWindowFill(m) {
  const fine = { notFilling: false, reason: null };
  if (!m || !m.isMobile || !m.availW || !m.availH) return fine;
  if (Math.abs((m.scale || 1) - 1) > 0.05) return fine;
  const widthRatio = m.innerW / m.availW;
  const heightRatio = m.innerH / m.availH;
  if (m.portrait && widthRatio < 0.9) return { notFilling: true, reason: "narrow", widthRatio, heightRatio };
  if (!m.typing && (m.portrait ? heightRatio < 0.62 : widthRatio < 0.62)) return { notFilling: true, reason: "short", widthRatio, heightRatio };
  return { notFilling: false, reason: null, widthRatio, heightRatio };
}
export const WINDOW_MOVE_PX = 24; // smaller position changes are rounding and animation, not a window being dragged
export const windowMoved = (a, b) => !!a && !!b && (Math.abs(a.screenX - b.screenX) > WINDOW_MOVE_PX || Math.abs(a.screenY - b.screenY) > WINDOW_MOVE_PX);

// Kept for the pre-start check and the older split-screen signal of the other assessment pages.
export function isLikelySplitScreen() {
  return assessWindowFill(measureWindow()).notFilling;
}

// The sustained, once-per-episode rule behind the WINDOW_NOT_FILLING_SCREEN violation. step() is one measurement (the timer calls it; tests call it directly):
//   * the window must fail to fill the screen for `sustainChecks` measurements in a row (a brief glitch, an animation or an incoming-call banner never reaches it);
//   * one episode is reported once (the window being dragged around inside the same episode is the same episode, and its movement is added to the report);
//   * the episode ends after `clearChecks` measurements that fill the screen again, so the NEXT episode is a new, independent report;
//   * `cooldownMs` is the floor between two reports (the server holds the same floor, so a repeated report cannot count twice).
export function createWindowFillMonitor({ measure = measureWindow, now = () => Date.now(), sustainChecks = 3, clearChecks = 2, cooldownMs = 30000, onViolation } = {}) {
  let hits = 0, fills = 0, active = false, lastReportAt = 0, moved = false, previous = null, worst = null;
  return {
    step() {
      const m = measure();
      const a = assessWindowFill(m);
      if (a.notFilling) {
        fills = 0; hits += 1;
        if (windowMoved(previous, m)) moved = true;
        if (!worst || a.widthRatio < worst.widthRatio) worst = a;
        if (hits >= sustainChecks && !active) {
          active = true;
          const t = now();
          if (!lastReportAt || t - lastReportAt >= cooldownMs) {
            lastReportAt = t;
            const pct = Math.round(Math.min(worst.widthRatio, 1) * 100);
            onViolation?.({ reason: moved ? "moved" : a.reason, widthPercent: pct, moved, text: moved ? `the assessment window was moved and is not filling the screen (about ${pct}% of the screen width)` : `the assessment window is not filling the screen (about ${pct}% of the screen width)` });
          }
        }
      } else {
        hits = 0; moved = false; worst = null;
        if (active) { fills += 1; if (fills >= clearChecks) { active = false; fills = 0; } }
      }
      previous = m;
    },
    isActive: () => active,
  };
}
export function createWindowFillWatch({ intervalMs = 2000, ...options } = {}) {
  const monitor = createWindowFillMonitor(options);
  const id = setInterval(() => monitor.step(), intervalMs);
  return { destroy() { clearInterval(id); }, step: () => monitor.step() };
}

// Watches for a sustained split-screen state (two consecutive checks) and reports it, at most once per minute.
export function createSplitScreenWatch({ intervalMs = 4000, onSuspected, onCleared } = {}) {
  let hits = 0, active = false, lastReport = 0;
  const id = setInterval(() => {
    if (isLikelySplitScreen()) {
      hits += 1;
      if (hits >= 2 && !active) {
        active = true;
        if (Date.now() - lastReport > 60000) { lastReport = Date.now(); onSuspected?.(); }
      }
    } else { hits = 0; if (active) { active = false; onCleared?.(); } }
  }, intervalMs);
  return { destroy() { clearInterval(id); } };
}

// Pre-start capability check. `policy` is the server's client policy for the test. Items marked required block the start
// button for PROCTORED tests; the server separately refuses phones when the policy says so.
export function runSecurityCheck(policy) {
  const items = [];
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  let storageOk = false;
  try { localStorage.setItem("__ca_chk", "1"); localStorage.removeItem("__ca_chk"); storageOk = true; } catch { /* blocked */ }
  const proctored = policy?.level === "PROCTORED";
  items.push({ key: "secure", label: "Secure connection (HTTPS)", ok: secure, required: true });
  items.push({ key: "cookies", label: "Cookies and storage enabled", ok: navigator.cookieEnabled !== false && storageOk, required: true });
  if (policy?.requireFullscreen) items.push({ key: "fullscreen", label: "Fullscreen supported", ok: fsOk, required: proctored });
  items.push({ key: "split", label: "Assessment window fills the screen", ok: !isLikelySplitScreen(), required: proctored });
  items.push({ key: "mobile", label: "Device is supported for this assessment", ok: policy?.mobileAllowed !== false || !isMobileDevice(), required: true });
  const ready = items.every((i) => i.ok || !i.required);
  return { items, ready };
}
