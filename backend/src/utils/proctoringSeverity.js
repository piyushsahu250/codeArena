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
//
// Mapping onto the "INFO / WARNING / SUSPICIOUS / VIOLATION / CRITICAL" 5-level language used in
// the platform's proctoring policy docs: NORMAL = INFO, INTERRUPTION = WARNING, SUSPICIOUS stays
// SUSPICIOUS, CONFIRMED_VIOLATION = VIOLATION. There is no separate CRITICAL tier as a distinct
// *severity* value — MAX_VIOLATIONS auto-submit/termination (tests.js/moduleCoding.js/interview.js)
// is what "critical" means in practice here: the consequence of enough CONFIRMED_VIOLATION-tier
// events, not a 5th classification level. Four levels were kept (not renamed to five) specifically
// so every existing TestViolation/ModuleCodingViolation/InterviewSession row already written under
// the old names stays valid without a data migration.
const VIOLATION_SEVERITY = {
  // CONFIRMED_VIOLATION — leaving or breaking the proctored environment itself.
  TAB_SWITCH: "CONFIRMED_VIOLATION",
  FULLSCREEN_EXIT: "CONFIRMED_VIOLATION",
  CAMERA_DROPPED: "CONFIRMED_VIOLATION",
  MIC_DROPPED: "CONFIRMED_VIOLATION",

  // SUSPICIOUS — a restricted action, or a heuristic with a real false-positive rate.
  MULTI_MONITOR: "SUSPICIOUS",
  DEVTOOLS: "SUSPICIOUS", // docked-devtools size heuristic — best-effort, not proof
  COPY: "SUSPICIOUS",
  PASTE: "SUSPICIOUS",
  CUT: "SUSPICIOUS",
  RIGHT_CLICK: "SUSPICIOUS",
  DRAG_ATTEMPT: "SUSPICIOUS",
  PRINT_SCREEN_ATTEMPT: "SUSPICIOUS",
  // Added 2026-09-11 as part of the mobile/desktop proctoring redesign: the page-hidden effect
  // (TestTaking.jsx / useProctoring.js) used to have exactly one threshold — hidden < 3s said
  // nothing, hidden >= 3s reported plain TAB_SWITCH (CONFIRMED_VIOLATION, penalized on the very
  // first occurrence). That made a genuinely normal short interruption — answering an incoming
  // call, dismissing a notification that needed a tap, an app-switcher glance — cost a full,
  // immediate strike the instant it ran a few seconds past a benign glance, with nothing between
  // "free" and "penalized" to reflect that it might not have been cheating at all. This is the
  // graduated middle tier that gap needed: the page-hidden effect now reports TAB_SWITCH_BRIEF
  // (not TAB_SWITCH) once the hide has lasted past the short grace window but is still under the
  // long one, and only escalates to plain TAB_SWITCH if the page is STILL hidden once the long
  // window elapses — see TAB_SWITCH_LONG_GRACE_MS in both frontend implementations. A single
  // short absence never costs anything; the same SUSPICIOUS-escalation machinery below still
  // turns a *repeated* pattern of short absences into a real strike, and a sustained absence past
  // the long window is unaffected — still an immediate CONFIRMED_VIOLATION, exactly as before.
  TAB_SWITCH_BRIEF: "SUSPICIOUS",

  // INTERRUPTION — environmental signals that are usually innocent.
  FACE_MISSING: "INTERRUPTION",
  MULTIPLE_FACES: "INTERRUPTION",
  REFRESH_ATTEMPT: "INTERRUPTION", // the browser's own confirm dialog is the real deterrent
  NETWORK_LOSS: "INTERRUPTION",
  // A device rotating between portrait/landscape — logged so an admin reviewing an attempt sees
  // it happened, never a basis for suspicion on its own (see the orientationchange handling next
  // to the SCREEN_OVERLAY_DETECTED heuristic in both frontend implementations, which re-baselines
  // on rotation specifically so the rotation itself is never misread as the overlay heuristic below).
  ORIENTATION_CHANGE: "INTERRUPTION",
  // Moved out of SUSPICIOUS on 2026-09-10: this is a viewport-shrink heuristic, and the shrink an
  // on-screen keyboard opening produces is byte-for-byte the same signal — on a phone/tablet it
  // fired every time a student focused the code editor, and enough of those in one attempt
  // escalated into a penalized strike for nothing but typing, on a live exam. The client-side
  // check tries to exclude "an input/editor is focused," but the keyboard-open animation and the
  // moment focus moves away with the keyboard still closing both slip past it. Still logged for
  // admin review — just never counted toward the violation limit. A genuine "switched away to
  // search" still shows up as TAB_SWITCH (document.hidden), which is unaffected.
  SCREEN_OVERLAY_DETECTED: "INTERRUPTION",
  // Moved out of SUSPICIOUS on 2026-09-09: a Test/Coding Assessment's own Monaco editor uses
  // ordinary keyboard shortcuts for real editing (Ctrl+S save-muscle-memory, Ctrl+/ comment,
  // Ctrl+F find, Ctrl+D duplicate-line, etc.) — TestTaking.jsx/useProctoring.js's blockKeys only
  // matches a narrow allowlist (Ctrl+S/P/U/W/N/T/R/Tab, F5/F11), but a student legitimately using
  // even a few of those while coding hit SUSPICIOUS_ESCALATION_THRESHOLD and got penalized a
  // strike for normal typing, on a live exam. Still blocked (preventDefault) and still logged for
  // admin review — just never counted toward the violation limit, no matter how often it recurs.
  BROWSER_SHORTCUT: "INTERRUPTION",
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
