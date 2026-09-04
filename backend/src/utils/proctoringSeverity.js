// Shared 4-level proctoring severity taxonomy — used identically by tests.js, moduleCoding.js,
// and interview.js's violation-report endpoints. Previously each of those three routes had its
// own copy-pasted PENALIZED_VIOLATION_TYPES allowlist (a binary "counts or doesn't"), which meant
// e.g. a single copy-paste attempt and an actual tab switch/camera drop looked identical to the
// system: both either penalized or not, with no room to say "this is ambiguous, penalize it only
// if it keeps happening." This file replaces that binary model with four levels:
//
//   NORMAL             — benign, not even logged (e.g. the mobile-keyboard/fullscreen-exit
//                         exemption in useProctoring.js/TestTaking.jsx never calls report() at
//                         all for these — there's no event object to classify).
//   INTERRUPTION       — device/environment behavior that often has nothing to do with cheating
//                         (a face briefly out of frame, a benign refresh attempt). Logged for
//                         admin review, NEVER penalized, no matter how often it recurs.
//   SUSPICIOUS         — a restricted action or an ambiguous heuristic (copy/paste, devtools
//                         heuristic, an on-screen-overlay heuristic that can false-positive on
//                         pinch-zoom) — a single occurrence is a soft warning, not a strike, but
//                         SUSPICIOUS_ESCALATION_THRESHOLD occurrences of the SAME OR mixed
//                         SUSPICIOUS types on one attempt escalate the one that crosses the
//                         threshold into a real, penalized strike. This is the actual point of
//                         having four levels instead of two: a single stray right-click or one
//                         false-positive overlay detection costs nothing, but a genuine pattern
//                         still leads to consequences.
//   CONFIRMED_VIOLATION — unambiguous evidence of leaving/breaking the proctored environment
//                         (tab switch past its grace window, fullscreen exit, camera/mic
//                         dropped). Always penalized, on the very first occurrence, exactly like
//                         the old PENALIZED_VIOLATION_TYPES did.
//
// An event type this map doesn't recognize (a future addition, or a client sending garbage)
// classifies as INTERRUPTION, not SUSPICIOUS or CONFIRMED_VIOLATION — the safe default is to
// never penalize something this file doesn't explicitly know about.
const VIOLATION_SEVERITY = {
  // CONFIRMED_VIOLATION — leaving or breaking the proctored environment itself.
  TAB_SWITCH: "CONFIRMED_VIOLATION",
  FULLSCREEN_EXIT: "CONFIRMED_VIOLATION",
  CAMERA_DROPPED: "CONFIRMED_VIOLATION",
  MIC_DROPPED: "CONFIRMED_VIOLATION",

  // SUSPICIOUS — a restricted action, or a heuristic with a real false-positive rate.
  SCREEN_OVERLAY_DETECTED: "SUSPICIOUS", // viewport-shrink heuristic — can false-positive on pinch-zoom
  MULTI_MONITOR: "SUSPICIOUS",
  DEVTOOLS: "SUSPICIOUS", // docked-devtools size heuristic — best-effort, not proof
  BROWSER_SHORTCUT: "SUSPICIOUS",
  COPY: "SUSPICIOUS",
  PASTE: "SUSPICIOUS",
  CUT: "SUSPICIOUS",
  RIGHT_CLICK: "SUSPICIOUS",
  DRAG_ATTEMPT: "SUSPICIOUS",
  PRINT_SCREEN_ATTEMPT: "SUSPICIOUS",

  // INTERRUPTION — environmental signals that are usually innocent.
  FACE_MISSING: "INTERRUPTION",
  MULTIPLE_FACES: "INTERRUPTION",
  REFRESH_ATTEMPT: "INTERRUPTION", // the browser's own confirm dialog is the real deterrent
  NETWORK_LOSS: "INTERRUPTION",
};

// Every SUSPICIOUS_ESCALATION_THRESHOLD-th SUSPICIOUS event on one attempt/session escalates into
// a real, penalized strike — not the 1st, 2nd, 4th, 5th, etc. This is a deliberate, documented
// policy choice (not hidden in the math): occasional restricted-action attempts get a warning:
// only a genuine pattern costs a strike.
const SUSPICIOUS_ESCALATION_THRESHOLD = 3;

// `priorSuspiciousCount` is the number of SUSPICIOUS-severity events already logged for this
// attempt/session BEFORE this one (the caller counts its own violation log table) — this function
// is deliberately pure/stateless so every caller controls exactly how that count is fetched
// (transaction, isolation level, etc.) rather than this file reaching into three different Prisma
// models itself.
function classifyViolation(type, priorSuspiciousCount = 0) {
  const severity = VIOLATION_SEVERITY[type] || "INTERRUPTION";
  if (severity === "CONFIRMED_VIOLATION") {
    return { severity, penalized: true };
  }
  if (severity === "SUSPICIOUS") {
    const countIncludingThis = priorSuspiciousCount + 1;
    const penalized = countIncludingThis % SUSPICIOUS_ESCALATION_THRESHOLD === 0;
    return { severity, penalized };
  }
  return { severity, penalized: false };
}

module.exports = { VIOLATION_SEVERITY, SUSPICIOUS_ESCALATION_THRESHOLD, classifyViolation };
