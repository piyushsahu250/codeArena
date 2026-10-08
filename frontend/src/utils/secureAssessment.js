// Browser-side secure-assessment helpers for the formal Test page. DETECTION AND PRE-FLIGHT ONLY: the server decides what is
// allowed (start requirements, session ownership, question access, severity). These signals report what a web page can
// honestly observe; they never name an application and never prove malpractice.
//
// Limits (also in docs/EXAM_SECURITY.md): a page cannot see other apps, extensions, system overlays or another device. What
// it CAN see is that its own window stopped being the focused one while still visible (split-screen, a floating assistant, a
// second monitor app) and that its window is only a fraction of the screen.

const isTouch = () => typeof window !== "undefined" && (("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0);

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

// True when a touch device is showing the page in a window that is much smaller than the screen in BOTH steady states we can
// measure (split-screen / floating window). Ignored while a text field is focused (the on-screen keyboard shrinks the viewport).
export function isLikelySplitScreen() {
  if (!isTouch() || typeof window === "undefined" || !window.screen) return false;
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return false;
  const vv = window.visualViewport;
  if (vv && Math.abs(vv.scale - 1) > 0.05) return false; // pinch-zoom changes the visible size without any overlay
  const h = vv ? vv.height : window.innerHeight;
  const w = vv ? vv.width : window.innerWidth;
  const sh = window.screen.availHeight || window.screen.height;
  const sw = window.screen.availWidth || window.screen.width;
  if (!sh || !sw) return false;
  const portrait = window.matchMedia ? window.matchMedia("(orientation: portrait)").matches : sh >= sw;
  // Along the long axis the browser UI alone can take ~20 %; below 62 % of the screen is a window sharing the display.
  return portrait ? h / sh < 0.62 : w / sw < 0.62;
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
  items.push({ key: "mobile", label: "Device is supported for this assessment", ok: policy?.mobileAllowed !== false || !isTouch(), required: true });
  const ready = items.every((i) => i.ok || !i.required);
  return { items, ready };
}
