// Pure rules for the Mock Interview proctoring-event endpoint (POST /interview/sessions/:id/violation), kept apart from the route so they run under plain
// Node in test/interviewViolationPolicy.test.js. The severity taxonomy itself (what counts as a strike) stays in proctoringSeverity.js; this file only decides
// whether an incoming event is ACCEPTABLE to record at all: a known type, not a repeat of the same event a moment ago, and not past a per-session cap.
const { VIOLATION_SEVERITY, DUPLICATE_WINDOW_MS } = require("./proctoringSeverity");

// The same event type reported again inside this window is the same physical situation (the browser can fire visibilitychange and blur together, and the page
// re-sends a report whose answer was lost). 2 s is far shorter than any real second episode: a sustained tab switch is only reported after its grace period.
const DEFAULT_DUPLICATE_WINDOW_MS = 2000;

// A session never needs this many event rows: three strikes end it, and the rest are review-only signals. Past the cap further events are acknowledged and
// dropped, so one noisy device (or a hostile client) cannot grow the table without bound.
const MAX_EVENT_ROWS_PER_SESSION = 300;

// Strike limit for a Mock Interview, unchanged from the value that was inline in routes/interview.js.
const MAX_INTERVIEW_VIOLATIONS = 3;

function normalizeViolationType(raw) {
  return String(raw ?? "").trim().toUpperCase().slice(0, 40);
}

// Only types the shared severity map knows are recorded. An unknown string used to be stored as-is (and classified INTERRUPTION), which let any client put
// arbitrary text in the proctoring log. hasOwnProperty, so "CONSTRUCTOR" or "__PROTO__" style names are not found on the prototype chain.
function isKnownViolationType(type) {
  return Object.prototype.hasOwnProperty.call(VIOLATION_SEVERITY, type);
}

function duplicateWindowMs(type) {
  return DUPLICATE_WINDOW_MS[type] ?? DEFAULT_DUPLICATE_WINDOW_MS;
}

// `lastAt`: createdAt of the newest stored event of the same type for this session (Date, ISO string, ms, or null).
function isDuplicateEvent(lastAt, nowMs, windowMs) {
  if (lastAt === null || lastAt === undefined) return false;
  const last = new Date(lastAt).getTime();
  if (!Number.isFinite(last)) return false;
  const age = nowMs - last;
  // A stored time slightly in the future (clock skew between app servers) still counts as "just now".
  return age < windowMs;
}

function exceedsEventCap(storedCount) {
  return storedCount >= MAX_EVENT_ROWS_PER_SESSION;
}

module.exports = {
  DEFAULT_DUPLICATE_WINDOW_MS, MAX_EVENT_ROWS_PER_SESSION, MAX_INTERVIEW_VIOLATIONS,
  normalizeViolationType, isKnownViolationType, duplicateWindowMs, isDuplicateEvent, exceedsEventCap,
};
