// Display logic for one attempt's proctoring log (staff results page). Pure functions, no React, so every statement the page makes can be tested.
//
// Honesty rules kept from the server (backend utils/evidenceClassification.js, proctoringSeverity.js): a browser signal is an observation, not proof; "Prohibited action observed" says
// what the page saw against the exam's published rules, never why or by whom; only an authorised reviewer can confirm misconduct. The wording below states how an event was COUNTED,
// which follows the server's own flags (`penalized`, `counted`, `severity`) and nothing is inferred from the event's name.

// Plain names for event types. Unknown types fall back to a readable form of the raw name.
export const EVENT_LABEL = {
  TAB_SWITCH: "Left the exam page (tab switch)",
  TAB_SWITCH_BRIEF: "Exam page briefly hidden",
  FULLSCREEN_EXIT: "Left full-screen mode",
  CAMERA_DROPPED: "Camera stopped",
  MIC_DROPPED: "Microphone stopped",
  MULTI_MONITOR: "Second display detected",
  DEVTOOLS: "Window-size change (possible DevTools, unverified)",
  COPY: "Copy attempt",
  PASTE: "Paste attempt",
  CUT: "Cut attempt",
  RIGHT_CLICK: "Right-click on the exam page",
  DRAG_ATTEMPT: "Drag on the exam page",
  PRINT_SCREEN_ATTEMPT: "Print Screen pressed",
  FACE_MISSING: "Face not in view",
  SCREEN_OVERLAY_DETECT: "Possible screen overlay",
  POSSIBLE_EXTERNAL_ASSISTANT: "Exam page lost focus (cause unknown)",
  COPILOT_KEY_SIGNAL: "Assistant key pressed",
  AI_SHORTCUT_DETECTED: "Assistant shortcut pressed",
  SPLIT_SCREEN_SUSPECTED: "Small window (possible split screen)",
};

// What the page could do about an event. A web page asks the browser to cancel an event; it cannot confirm the browser did, and cannot stop leaving the page.
export const ENFORCEMENT_LABEL = {
  BLOCK_ATTEMPTED: "cancel requested, not verified",
  NOT_BLOCKABLE: "cannot be blocked by a web page",
  OBSERVED_ONLY: "recorded only",
};

// How the server classified the evidence of one event. `tone` picks the colour; the words always carry the meaning.
export const OBSERVATION = {
  OBSERVED_EVENT: { label: "Observed (browser signal)", tone: "neutral" },
  SUSPECTED_ACTIVITY: { label: "Suspected, needs review", tone: "warning" },
  INCONCLUSIVE: { label: "Inconclusive", tone: "neutral" },
  POLICY_VIOLATION: { label: "Policy violation", tone: "danger" },
  CONFIRMED_POLICY_VIOLATION: { label: "Prohibited action observed", tone: "danger" },
  CONFIRMED_VIOLATION: { label: "Confirmed by reviewer", tone: "danger" },
};

export function eventLabel(type) {
  const t = String(type || "");
  if (EVENT_LABEL[t]) return EVENT_LABEL[t];
  const words = t.replace(/_/g, " ").toLowerCase().trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown event";
}

export function observationOf(ev) {
  return OBSERVATION[ev?.evidence?.classification] || OBSERVATION.OBSERVED_EVENT;
}

// The exam page losing focus is counted per type: a warning the first time, a strike from the second (backend utils/proctoringSeverity.js, STRIKE_FROM_OCCURRENCE; set 2026-10-25).
// Attempts recorded before that rule counted it through the shared every-third rule, so what the page says must follow what the server actually did to each event, not only the
// rule in force today: `occurrence` is which time (1, 2, ...) this event is among the attempt's events of its type.
const FOCUS_LOSS_TYPE = "POSSIBLE_EXTERNAL_ASSISTANT";

// How one event was counted, from the server's own flags.
//   strike        counted toward the attempt's strike total
//   warning       a restricted action that was not counted on its own (a single occurrence is a soft warning; repeats can be counted)
//   interruption  recorded for review, never counted
//   signal        a keyboard or other signal stored apart from the strike table, never counted
export function countOutcome(ev, occurrence = null) {
  if (ev?.counted === false) return { kind: "signal", reason: "Recorded for review only. This kind of signal is never counted as a strike." };
  if (ev?.type === FOCUS_LOSS_TYPE && Number.isInteger(occurrence)) {
    if (ev.penalized && occurrence >= 2) return { kind: "strike", reason: "Counted because the exam page lost focus more than once. The first time is only a warning." };
    if (!ev.penalized && occurrence === 1) return { kind: "warning", reason: "Warning only. The first time the exam page loses focus is not counted; repeats are." };
    if (!ev.penalized && occurrence >= 2) return { kind: "warning", reason: "Not counted. This repeat was recorded before repeats of this event were counted." };
  }
  if (ev?.penalized) {
    if (ev.severity === "SUSPICIOUS") return { kind: "strike", reason: "Counted because suspicious actions repeated on this attempt and reached the exam's limit for them." };
    if (ev.severity === "CONFIRMED_VIOLATION") return { kind: "strike", reason: "Counted on its first occurrence: leaving or breaking the exam environment is always counted." };
    return { kind: "strike", reason: "Counted under the exam's counting rule." };
  }
  if (ev?.severity === "SUSPICIOUS") return { kind: "warning", reason: "Warning only. A single occurrence of this action is not counted on its own; repeats can be." };
  return { kind: "interruption", reason: "Not counted. This kind of interruption is recorded for review only." };
}

export function formatEventTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function formatEventDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

// Turns the server's event list into display rows in time order, numbers the strikes as they accrue, and summarises. `strikeTotal` is the attempt's own strike count (the number shown in
// the results table); if the counted events listed here do not add up to it, `mismatch` says so rather than hiding the difference.
export function buildViolationLog(events, strikeTotal) {
  const ordered = (Array.isArray(events) ? events : [])
    .map((ev, i) => ({ ev, i, t: new Date(ev?.createdAt).getTime() }))
    .sort((a, b) => (Number.isNaN(a.t) || Number.isNaN(b.t) ? a.i - b.i : a.t - b.t || a.i - b.i));
  let strikes = 0;
  const seenOfType = {};
  const rows = ordered.map(({ ev }) => {
    const type = String(ev?.type || "");
    seenOfType[type] = (seenOfType[type] || 0) + 1; // which time this type has occurred on the attempt, oldest first
    const outcome = countOutcome(ev, seenOfType[type]);
    if (outcome.kind === "strike") strikes += 1;
    return { ev, outcome, strikeNumber: outcome.kind === "strike" ? strikes : null, observation: observationOf(ev), label: eventLabel(ev?.type) };
  });
  const count = (kind) => rows.filter((r) => r.outcome.kind === kind).length;
  const known = typeof strikeTotal === "number" && Number.isFinite(strikeTotal);
  return {
    rows,
    summary: {
      events: rows.length,
      strikes,
      warnings: count("warning"),
      notCounted: count("interruption") + count("signal"),
      prohibited: rows.filter((r) => r.ev?.evidence?.classification === "CONFIRMED_POLICY_VIOLATION").length,
      strikeTotal: known ? strikeTotal : null,
      mismatch: known && strikes !== strikeTotal,
    },
  };
}
