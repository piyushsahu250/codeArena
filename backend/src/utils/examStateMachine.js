// Section-wise examination: the attempt and section state machines and the deadline rules. Pure functions (no database, no clock of their own: the caller passes the SERVER's
// time), unit-tested in test/examStateMachine.test.js. The routes must call these before every write, and the database layer must back them with a conditional update
// (`WHERE status = <expected>`) so two concurrent requests cannot both win a transition.
//
// ATTEMPT:  CREATED -> READINESS_CHECK -> IN_PROGRESS -> SUBMITTED -> EVALUATING -> COMPLETED
//           IN_PROGRESS -> EXPIRED -> EVALUATING (the deadline passed: what was saved is still scored)
//           ABANDONED and INVALIDATED are terminal; INVALIDATED needs an authorised, audited admin action and can follow any state except itself.
// SECTION:  LOCKED -> IN_PROGRESS -> COMPLETED, strictly in order A, B, C, D. A section is opened only when every earlier one is COMPLETED and none is IN_PROGRESS.
const { SECTION_KEYS } = require("./examBlueprint");

const ATTEMPT = Object.freeze({
  CREATED: "CREATED", READINESS_CHECK: "READINESS_CHECK", IN_PROGRESS: "IN_PROGRESS", SUBMITTED: "SUBMITTED", EVALUATING: "EVALUATING", COMPLETED: "COMPLETED",
  EXPIRED: "EXPIRED", ABANDONED: "ABANDONED", INVALIDATED: "INVALIDATED",
});
const SECTION = Object.freeze({ LOCKED: "LOCKED", IN_PROGRESS: "IN_PROGRESS", COMPLETED: "COMPLETED" });

const ATTEMPT_TRANSITIONS = Object.freeze({
  [ATTEMPT.CREATED]: [ATTEMPT.READINESS_CHECK, ATTEMPT.ABANDONED, ATTEMPT.INVALIDATED],
  [ATTEMPT.READINESS_CHECK]: [ATTEMPT.IN_PROGRESS, ATTEMPT.ABANDONED, ATTEMPT.INVALIDATED],
  [ATTEMPT.IN_PROGRESS]: [ATTEMPT.SUBMITTED, ATTEMPT.EXPIRED, ATTEMPT.ABANDONED, ATTEMPT.INVALIDATED],
  [ATTEMPT.SUBMITTED]: [ATTEMPT.EVALUATING, ATTEMPT.INVALIDATED],
  [ATTEMPT.EXPIRED]: [ATTEMPT.EVALUATING, ATTEMPT.INVALIDATED],
  [ATTEMPT.EVALUATING]: [ATTEMPT.COMPLETED, ATTEMPT.INVALIDATED],
  [ATTEMPT.COMPLETED]: [ATTEMPT.INVALIDATED],
  [ATTEMPT.ABANDONED]: [ATTEMPT.INVALIDATED],
  [ATTEMPT.INVALIDATED]: [],
});
const SECTION_TRANSITIONS = Object.freeze({
  [SECTION.LOCKED]: [SECTION.IN_PROGRESS],
  [SECTION.IN_PROGRESS]: [SECTION.COMPLETED],
  [SECTION.COMPLETED]: [],
});

function canTransitionAttempt(from, to) {
  return (ATTEMPT_TRANSITIONS[from] || []).includes(to);
}
// `actor` matters for INVALIDATED only: a student can never invalidate (or reset) a formal attempt.
function checkAttemptTransition(from, to, { actor = "SYSTEM" } = {}) {
  if (!ATTEMPT_TRANSITIONS[from]) return { ok: false, code: "UNKNOWN_STATE", message: `Unknown attempt state ${from}.` };
  if (to === ATTEMPT.INVALIDATED && actor !== "ADMIN") return { ok: false, code: "NOT_AUTHORISED", message: "Only an authorised administrator can invalidate an attempt." };
  if (!canTransitionAttempt(from, to)) return { ok: false, code: "INVALID_TRANSITION", message: `An attempt cannot move from ${from} to ${to}.` };
  return { ok: true };
}
function canTransitionSection(from, to) {
  return (SECTION_TRANSITIONS[from] || []).includes(to);
}

// Answers and submissions are accepted only while the attempt is IN_PROGRESS (and the section is IN_PROGRESS, and the deadline has not passed: see isWriteAllowed).
function attemptAcceptsAnswers(status) { return status === ATTEMPT.IN_PROGRESS; }
function isTerminal(status) { return [ATTEMPT.COMPLETED, ATTEMPT.ABANDONED, ATTEMPT.INVALIDATED].includes(status); }

const orderOf = (key) => SECTION_KEYS.indexOf(key);
function sorted(sections) { return [...sections].sort((a, b) => orderOf(a.key) - orderOf(b.key)); }

// `sections`: [{ key, status }] for the attempt, all four. Returns whether `key` may be opened now.
function canOpenSection(sections, key) {
  const list = sorted(sections || []);
  const target = list.find((s) => s.key === key);
  if (!target) return { ok: false, code: "UNKNOWN_SECTION", message: "That section is not part of this examination." };
  if (target.status === SECTION.COMPLETED) return { ok: false, code: "ALREADY_COMPLETED", message: "This section is already submitted and cannot be reopened." };
  if (target.status === SECTION.IN_PROGRESS) return { ok: false, code: "ALREADY_OPEN", message: "This section is already open." };
  const open = list.find((s) => s.status === SECTION.IN_PROGRESS);
  if (open) return { ok: false, code: "ANOTHER_SECTION_OPEN", message: `Finish ${open.key} first.` };
  const earlierIncomplete = list.find((s) => orderOf(s.key) < orderOf(key) && s.status !== SECTION.COMPLETED);
  if (earlierIncomplete) return { ok: false, code: "SECTION_ORDER", message: `Complete ${earlierIncomplete.key} before opening ${key}.` };
  return { ok: true };
}

function nextSectionKey(sections) {
  const next = sorted(sections || []).find((s) => s.status === SECTION.LOCKED);
  return next ? next.key : null;
}

// A section is marked COMPLETED only when everything it needs is on the server: no answer still waiting to be confirmed, and (if the section requires it) every question
// answered. `state`: { pendingWrites, answeredCount, questionCount, requireAllAnswered, pendingEvaluations? } where pendingWrites counts answers the server has NOT acknowledged.
function canCompleteSection(sections, key, state) {
  const target = (sections || []).find((s) => s.key === key);
  if (!target) return { ok: false, code: "UNKNOWN_SECTION", message: "That section is not part of this examination." };
  if (target.status === SECTION.COMPLETED) return { ok: false, code: "ALREADY_COMPLETED", message: "This section is already submitted." };
  if (target.status !== SECTION.IN_PROGRESS) return { ok: false, code: "NOT_OPEN", message: "This section is not open." };
  const s = state || {};
  if (!Number.isInteger(s.pendingWrites) || s.pendingWrites < 0) return { ok: false, code: "STATE_UNKNOWN", message: "The save status of this section is unknown." };
  if (s.pendingWrites > 0) return { ok: false, code: "UNSAVED_ANSWERS", message: `${s.pendingWrites} answer(s) have not been confirmed as saved yet.` };
  if (s.requireAllAnswered && s.answeredCount < s.questionCount) return { ok: false, code: "UNANSWERED", message: `${s.questionCount - s.answeredCount} question(s) are still unanswered.` };
  return { ok: true };
}

// The single label the UI and reports show for an attempt: SECTION_A_IN_PROGRESS, SECTION_B_COMPLETED, ... or the attempt status itself.
function combinedLabel(attemptStatus, sections) {
  if (attemptStatus !== ATTEMPT.IN_PROGRESS) return attemptStatus;
  const letter = (k) => "ABCD"[orderOf(k)];
  const list = sorted(sections || []);
  const open = list.find((s) => s.status === SECTION.IN_PROGRESS);
  if (open) return `SECTION_${letter(open.key)}_IN_PROGRESS`;
  const done = list.filter((s) => s.status === SECTION.COMPLETED);
  if (done.length) return `SECTION_${letter(done[done.length - 1].key)}_COMPLETED`;
  return ATTEMPT.IN_PROGRESS;
}

// ---- deadlines (server time only) ---------------------------------------------------------------------------------------------------------------------------------
// One overall deadline always applies. With timingPolicy OVERALL_AND_SECTION the open section's own limit applies as well; the earlier of the two wins. The browser's
// clock and timer are display only. `graceSec` lets a request that was already in flight at the deadline still be accepted; it never extends the deadline itself.
function deadlines({ attemptStartedAtMs, durationMin, timingPolicy, section = null }) {
  const overall = attemptStartedAtMs + durationMin * 60000;
  let sectionDeadline = null;
  if (timingPolicy === "OVERALL_AND_SECTION" && section && Number.isFinite(section.startedAtMs) && Number.isFinite(section.durationMin)) {
    sectionDeadline = section.startedAtMs + section.durationMin * 60000;
  }
  const effective = sectionDeadline === null ? overall : Math.min(overall, sectionDeadline);
  return { overallDeadlineMs: overall, sectionDeadlineMs: sectionDeadline, effectiveDeadlineMs: effective };
}

function isWriteAllowed({ nowMs, graceSec = 0, ...rest }) {
  const d = deadlines(rest);
  const grace = Math.max(0, graceSec) * 1000;
  if (nowMs > d.overallDeadlineMs + grace) return { allowed: false, reason: "EXAM_EXPIRED", ...d };
  if (d.sectionDeadlineMs !== null && nowMs > d.sectionDeadlineMs + grace) return { allowed: false, reason: "SECTION_EXPIRED", ...d };
  return { allowed: true, reason: null, ...d };
}

// What the server's expiry sweep (or the next request) should do with an IN_PROGRESS attempt at `nowMs`.
function expiryAction({ nowMs, ...rest }) {
  const d = deadlines(rest);
  // Past the overall deadline the attempt is EXPIRED whatever the auto-submit setting says (answers close at the deadline); what was saved is then scored.
  if (nowMs > d.overallDeadlineMs) return { action: "EXPIRE_ATTEMPT", ...d };
  if (d.sectionDeadlineMs !== null && nowMs > d.sectionDeadlineMs) return { action: "COMPLETE_SECTION_BY_TIMER", ...d };
  return { action: "NONE", ...d };
}

function remainingSeconds({ nowMs, ...rest }) {
  const d = deadlines(rest);
  return { overall: Math.max(0, Math.ceil((d.overallDeadlineMs - nowMs) / 1000)), section: d.sectionDeadlineMs === null ? null : Math.max(0, Math.ceil((d.sectionDeadlineMs - nowMs) / 1000)) };
}

module.exports = {
  ATTEMPT, SECTION, ATTEMPT_TRANSITIONS, SECTION_TRANSITIONS,
  canTransitionAttempt, checkAttemptTransition, canTransitionSection, attemptAcceptsAnswers, isTerminal,
  canOpenSection, nextSectionKey, canCompleteSection, combinedLabel, deadlines, isWriteAllowed, expiryAction, remainingSeconds,
};
