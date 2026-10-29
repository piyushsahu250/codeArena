const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/utils/examStateMachine");

const { ATTEMPT, SECTION } = M;
const secs = (a = "LOCKED", b = "LOCKED", c = "LOCKED", d = "LOCKED") => [
  { key: "APTITUDE", status: a }, { key: "TECHNICAL", status: b }, { key: "CODING", status: c }, { key: "AI_INTERVIEW", status: d },
];

// ---- attempt state machine -----------------------------------------------------------------------------------------------------------------------------------------
test("the documented attempt lifecycle is allowed step by step", () => {
  const path = [ATTEMPT.CREATED, ATTEMPT.READINESS_CHECK, ATTEMPT.IN_PROGRESS, ATTEMPT.SUBMITTED, ATTEMPT.EVALUATING, ATTEMPT.COMPLETED];
  for (let i = 0; i < path.length - 1; i++) assert.equal(M.canTransitionAttempt(path[i], path[i + 1]), true, `${path[i]} -> ${path[i + 1]}`);
});

test("an attempt cannot jump ahead, go back or be restarted", () => {
  assert.equal(M.canTransitionAttempt(ATTEMPT.CREATED, ATTEMPT.IN_PROGRESS), false, "readiness check cannot be skipped");
  assert.equal(M.canTransitionAttempt(ATTEMPT.IN_PROGRESS, ATTEMPT.COMPLETED), false, "evaluation cannot be skipped");
  assert.equal(M.canTransitionAttempt(ATTEMPT.IN_PROGRESS, ATTEMPT.READINESS_CHECK), false);
  assert.equal(M.canTransitionAttempt(ATTEMPT.SUBMITTED, ATTEMPT.IN_PROGRESS), false, "a submitted attempt cannot be reopened");
  assert.equal(M.canTransitionAttempt(ATTEMPT.COMPLETED, ATTEMPT.IN_PROGRESS), false, "a completed formal attempt cannot be restarted");
  assert.equal(M.canTransitionAttempt(ATTEMPT.COMPLETED, ATTEMPT.CREATED), false);
  assert.equal(M.canTransitionAttempt(ATTEMPT.SUBMITTED, ATTEMPT.SUBMITTED), false, "submitting twice is not a transition (the caller treats it as already done)");
});

test("an expired attempt is still evaluated, but never reopened", () => {
  assert.equal(M.canTransitionAttempt(ATTEMPT.IN_PROGRESS, ATTEMPT.EXPIRED), true);
  assert.equal(M.canTransitionAttempt(ATTEMPT.EXPIRED, ATTEMPT.EVALUATING), true);
  assert.equal(M.canTransitionAttempt(ATTEMPT.EXPIRED, ATTEMPT.IN_PROGRESS), false);
});

test("only an administrator can invalidate, from any non-final state, and invalidated is terminal", () => {
  for (const from of [ATTEMPT.CREATED, ATTEMPT.IN_PROGRESS, ATTEMPT.SUBMITTED, ATTEMPT.COMPLETED, ATTEMPT.ABANDONED]) {
    assert.equal(M.checkAttemptTransition(from, ATTEMPT.INVALIDATED, { actor: "ADMIN" }).ok, true, from);
    const byStudent = M.checkAttemptTransition(from, ATTEMPT.INVALIDATED, { actor: "STUDENT" });
    assert.equal(byStudent.ok, false);
    assert.equal(byStudent.code, "NOT_AUTHORISED");
    assert.equal(M.checkAttemptTransition(from, ATTEMPT.INVALIDATED).ok, false, "the default actor is not an administrator");
  }
  assert.equal(M.checkAttemptTransition(ATTEMPT.INVALIDATED, ATTEMPT.IN_PROGRESS, { actor: "ADMIN" }).ok, false);
  assert.equal(M.checkAttemptTransition(ATTEMPT.INVALIDATED, ATTEMPT.INVALIDATED, { actor: "ADMIN" }).ok, false);
  assert.equal(M.checkAttemptTransition("NONSENSE", ATTEMPT.IN_PROGRESS).code, "UNKNOWN_STATE");
  assert.equal(M.checkAttemptTransition(ATTEMPT.CREATED, ATTEMPT.COMPLETED).code, "INVALID_TRANSITION");
});

test("answers are accepted only while the attempt is in progress", () => {
  for (const s of Object.values(ATTEMPT)) assert.equal(M.attemptAcceptsAnswers(s), s === ATTEMPT.IN_PROGRESS, s);
  assert.equal(M.isTerminal(ATTEMPT.COMPLETED), true);
  assert.equal(M.isTerminal(ATTEMPT.INVALIDATED), true);
  assert.equal(M.isTerminal(ATTEMPT.IN_PROGRESS), false);
});

// ---- sections ------------------------------------------------------------------------------------------------------------------------------------------------------------------
test("section A opens first; later sections cannot be opened out of order", () => {
  assert.equal(M.canOpenSection(secs(), "APTITUDE").ok, true);
  for (const k of ["TECHNICAL", "CODING", "AI_INTERVIEW"]) {
    const r = M.canOpenSection(secs(), k);
    assert.equal(r.ok, false, k);
    assert.equal(r.code, "SECTION_ORDER");
  }
});

test("skipping from A straight to C or D is refused at every stage", () => {
  assert.equal(M.canOpenSection(secs("COMPLETED"), "CODING").code, "SECTION_ORDER");
  assert.equal(M.canOpenSection(secs("COMPLETED"), "AI_INTERVIEW").code, "SECTION_ORDER");
  assert.equal(M.canOpenSection(secs("COMPLETED", "COMPLETED"), "AI_INTERVIEW").code, "SECTION_ORDER");
  assert.equal(M.canOpenSection(secs("COMPLETED", "COMPLETED", "COMPLETED"), "AI_INTERVIEW").ok, true);
});

test("a completed section cannot be reopened, and only one section is open at a time", () => {
  assert.equal(M.canOpenSection(secs("COMPLETED"), "APTITUDE").code, "ALREADY_COMPLETED");
  assert.equal(M.canOpenSection(secs("IN_PROGRESS"), "APTITUDE").code, "ALREADY_OPEN");
  assert.equal(M.canOpenSection(secs("IN_PROGRESS"), "TECHNICAL").code, "ANOTHER_SECTION_OPEN");
  assert.equal(M.canOpenSection(secs("COMPLETED", "IN_PROGRESS"), "CODING").code, "ANOTHER_SECTION_OPEN");
  assert.equal(M.canOpenSection(secs(), "BONUS").code, "UNKNOWN_SECTION");
  assert.equal(M.canOpenSection(undefined, "APTITUDE").code, "UNKNOWN_SECTION");
});

test("the next section is the first one still locked", () => {
  assert.equal(M.nextSectionKey(secs()), "APTITUDE");
  assert.equal(M.nextSectionKey(secs("COMPLETED", "COMPLETED")), "CODING");
  assert.equal(M.nextSectionKey(secs("COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED")), null);
});

test("a section is completed only when its answers are confirmed saved (and, if required, all answered)", () => {
  const open = secs("IN_PROGRESS");
  const ok = { pendingWrites: 0, answeredCount: 5, questionCount: 10, requireAllAnswered: false };
  assert.equal(M.canCompleteSection(open, "APTITUDE", ok).ok, true);
  assert.equal(M.canCompleteSection(open, "APTITUDE", { ...ok, pendingWrites: 2 }).code, "UNSAVED_ANSWERS");
  assert.equal(M.canCompleteSection(open, "APTITUDE", { ...ok, requireAllAnswered: true }).code, "UNANSWERED");
  assert.equal(M.canCompleteSection(open, "APTITUDE", { ...ok, requireAllAnswered: true, answeredCount: 10 }).ok, true);
  assert.equal(M.canCompleteSection(open, "APTITUDE", { answeredCount: 5, questionCount: 10 }).code, "STATE_UNKNOWN", "an unknown save status is not 'saved'");
  assert.equal(M.canCompleteSection(open, "APTITUDE", { ...ok, pendingWrites: -1 }).code, "STATE_UNKNOWN");
  assert.equal(M.canCompleteSection(open, "APTITUDE", undefined).code, "STATE_UNKNOWN");
});

test("only an open section can be completed, and not twice", () => {
  const ok = { pendingWrites: 0, answeredCount: 1, questionCount: 1 };
  assert.equal(M.canCompleteSection(secs(), "APTITUDE", ok).code, "NOT_OPEN");
  assert.equal(M.canCompleteSection(secs("COMPLETED"), "APTITUDE", ok).code, "ALREADY_COMPLETED");
  assert.equal(M.canCompleteSection(secs("IN_PROGRESS"), "CODING", ok).code, "NOT_OPEN");
  assert.equal(M.canCompleteSection(secs(), "BONUS", ok).code, "UNKNOWN_SECTION");
});

test("section state transitions run LOCKED, IN_PROGRESS, COMPLETED and never backwards", () => {
  assert.equal(M.canTransitionSection(SECTION.LOCKED, SECTION.IN_PROGRESS), true);
  assert.equal(M.canTransitionSection(SECTION.IN_PROGRESS, SECTION.COMPLETED), true);
  assert.equal(M.canTransitionSection(SECTION.LOCKED, SECTION.COMPLETED), false);
  assert.equal(M.canTransitionSection(SECTION.COMPLETED, SECTION.IN_PROGRESS), false);
  assert.equal(M.canTransitionSection(SECTION.IN_PROGRESS, SECTION.LOCKED), false);
});

test("the combined label names the section in progress or the last one completed", () => {
  assert.equal(M.combinedLabel(ATTEMPT.CREATED, secs()), "CREATED");
  assert.equal(M.combinedLabel(ATTEMPT.IN_PROGRESS, secs()), "IN_PROGRESS");
  assert.equal(M.combinedLabel(ATTEMPT.IN_PROGRESS, secs("IN_PROGRESS")), "SECTION_A_IN_PROGRESS");
  assert.equal(M.combinedLabel(ATTEMPT.IN_PROGRESS, secs("COMPLETED")), "SECTION_A_COMPLETED");
  assert.equal(M.combinedLabel(ATTEMPT.IN_PROGRESS, secs("COMPLETED", "COMPLETED", "IN_PROGRESS")), "SECTION_C_IN_PROGRESS");
  assert.equal(M.combinedLabel(ATTEMPT.IN_PROGRESS, secs("COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED")), "SECTION_D_COMPLETED");
  assert.equal(M.combinedLabel(ATTEMPT.SUBMITTED, secs("COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED")), "SUBMITTED");
});

// ---- deadlines (server time) ---------------------------------------------------------------------------------------------------------------------------------------------
const T0 = Date.UTC(2026, 10, 10, 9, 0, 0);
const min = (n) => n * 60000;

test("with an overall timer only, the deadline is start plus the duration", () => {
  const d = M.deadlines({ attemptStartedAtMs: T0, durationMin: 180, timingPolicy: "OVERALL_ONLY" });
  assert.equal(d.overallDeadlineMs, T0 + min(180));
  assert.equal(d.sectionDeadlineMs, null);
  assert.equal(d.effectiveDeadlineMs, T0 + min(180));
});

test("with section timers the earlier of the section and overall deadlines applies", () => {
  const base = { attemptStartedAtMs: T0, durationMin: 180, timingPolicy: "OVERALL_AND_SECTION" };
  assert.equal(M.deadlines({ ...base, section: { startedAtMs: T0 + min(10), durationMin: 40 } }).effectiveDeadlineMs, T0 + min(50));
  assert.equal(M.deadlines({ ...base, section: { startedAtMs: T0 + min(170), durationMin: 40 } }).effectiveDeadlineMs, T0 + min(180), "the overall deadline wins when it is earlier");
  assert.equal(M.deadlines({ attemptStartedAtMs: T0, durationMin: 180, timingPolicy: "OVERALL_ONLY", section: { startedAtMs: T0, durationMin: 5 } }).effectiveDeadlineMs, T0 + min(180), "section timers are ignored under the overall-only policy");
});

test("writes are accepted up to the deadline and refused after it, with the reason", () => {
  const base = { attemptStartedAtMs: T0, durationMin: 60, timingPolicy: "OVERALL_ONLY", graceSec: 0 };
  assert.equal(M.isWriteAllowed({ ...base, nowMs: T0 + min(59) }).allowed, true);
  assert.equal(M.isWriteAllowed({ ...base, nowMs: T0 + min(60) }).allowed, true, "exactly at the deadline");
  const late = M.isWriteAllowed({ ...base, nowMs: T0 + min(60) + 1 });
  assert.equal(late.allowed, false);
  assert.equal(late.reason, "EXAM_EXPIRED");
});

test("a grace period accepts a request that was in flight at the deadline, and no longer", () => {
  const base = { attemptStartedAtMs: T0, durationMin: 60, timingPolicy: "OVERALL_ONLY", graceSec: 30 };
  assert.equal(M.isWriteAllowed({ ...base, nowMs: T0 + min(60) + 29000 }).allowed, true);
  assert.equal(M.isWriteAllowed({ ...base, nowMs: T0 + min(60) + 31000 }).allowed, false);
  assert.equal(M.isWriteAllowed({ ...base, graceSec: -50, nowMs: T0 + min(60) + 1 }).allowed, false, "a negative grace is treated as none");
});

test("a section deadline closes writes to that section before the exam ends", () => {
  const base = { attemptStartedAtMs: T0, durationMin: 180, timingPolicy: "OVERALL_AND_SECTION", graceSec: 0, section: { startedAtMs: T0, durationMin: 40 } };
  assert.equal(M.isWriteAllowed({ ...base, nowMs: T0 + min(39) }).allowed, true);
  const r = M.isWriteAllowed({ ...base, nowMs: T0 + min(41) });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "SECTION_EXPIRED");
});

test("the expiry action: nothing, complete the section by timer, or expire the attempt", () => {
  const base = { attemptStartedAtMs: T0, durationMin: 180, timingPolicy: "OVERALL_AND_SECTION", section: { startedAtMs: T0, durationMin: 40 } };
  assert.equal(M.expiryAction({ ...base, nowMs: T0 + min(10) }).action, "NONE");
  assert.equal(M.expiryAction({ ...base, nowMs: T0 + min(41) }).action, "COMPLETE_SECTION_BY_TIMER");
  assert.equal(M.expiryAction({ ...base, nowMs: T0 + min(181) }).action, "EXPIRE_ATTEMPT");
  assert.equal(M.expiryAction({ ...base, autoSubmitOnExpiry: false, nowMs: T0 + min(181) }).action, "EXPIRE_ATTEMPT", "answers close at the deadline whatever the auto-submit setting");
});

test("remaining time is computed from the server clock and never negative", () => {
  const base = { attemptStartedAtMs: T0, durationMin: 60, timingPolicy: "OVERALL_AND_SECTION", section: { startedAtMs: T0, durationMin: 10 } };
  assert.deepEqual(M.remainingSeconds({ ...base, nowMs: T0 + min(5) }), { overall: 55 * 60, section: 5 * 60 });
  assert.deepEqual(M.remainingSeconds({ ...base, nowMs: T0 + min(90) }), { overall: 0, section: 0 });
  assert.equal(M.remainingSeconds({ attemptStartedAtMs: T0, durationMin: 60, timingPolicy: "OVERALL_ONLY", nowMs: T0 }).section, null);
});

test("a refresh does not move the deadline: it depends only on the stored start time", () => {
  const first = M.deadlines({ attemptStartedAtMs: T0, durationMin: 60, timingPolicy: "OVERALL_ONLY" }).effectiveDeadlineMs;
  for (let i = 0; i < 5; i++) assert.equal(M.deadlines({ attemptStartedAtMs: T0, durationMin: 60, timingPolicy: "OVERALL_ONLY" }).effectiveDeadlineMs, first);
});
