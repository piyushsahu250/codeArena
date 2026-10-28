// Changing the duration of a formal test while students are taking it. See tests.duration.domain.js for the timing model: deadlines are derived (attempt start + duration), so one guarded
// write to the test moves every running attempt's deadline, each from its own start. This file adds the parts around that write: who may do it, the preview, the confirmations a reduction needs,
// the concurrency and repeat protection, the audit record, and the clock the student pages sync to.
// No req/res: the controller passes an `actor` { user, requesterInstituteId, req }.
const { ServiceError } = require("../../utils/serviceError");
const { canStaffAccessTest } = require("../../utils/testOwnership");
const { AUDIT_ACTIONS } = require("../../utils/auditLog");
const { deadlineOf } = require("../submissions/submissions.domain");
const d = require("./tests.domain");
const dur = require("./tests.duration.domain");
const repo = require("./tests.duration.repository");

// The same people who may edit the test (its creator and anyone it is shared with, its institute's admins, the platform admin), inside their own institute.
async function loadManageable(actor, id) {
  const test = await repo.findTest(id);
  if (!test) throw new ServiceError(404, "Test not found");
  if (d.outsideInstitute(actor, test, true)) throw new ServiceError(403, "You can only manage tests under your own institute");
  if (!canStaffAccessTest(actor, test)) throw new ServiceError(403, "You can only change the duration of tests you created or that were shared with you");
  return test;
}

const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
const planOut = (p) => ({ ...p, earliestNewDeadline: iso(p.earliestNewDeadline), latestNewDeadline: iso(p.latestNewDeadline) });

function originalDurationOf(test, history) {
  const first = history[0] && history[0].details && history[0].details.previousDurationMin;
  return Number.isInteger(first) ? first : test.durationMin;
}

// Everything the administrator sees before confirming. With `durationMin` it also says what that change would do; without it, only the current state.
async function durationImpact(actor, id, query = {}) {
  const test = await loadManageable(actor, id);
  const [counts, starts, history] = await Promise.all([repo.attemptCounts(test.id), repo.activeStarts(test.id), repo.changeHistory(test.id)]);
  const out = {
    test: { id: test.id, title: test.title, isPublished: test.isPublished, startTime: test.startTime, endTime: test.endTime, window: dur.windowState(test), version: test.version },
    originalDurationMin: originalDurationOf(test, history),
    currentDurationMin: test.durationMin,
    attempts: { started: counts.started, active: counts.active, completed: counts.completed },
    // The scheduled window only decides who may START; it is not changed here and does not limit anyone's own time (existing rule, kept).
    closingTime: { endTime: test.endTime, changedByThisAction: false, note: "The scheduled closing time is not changed. It only decides whether a new attempt can start; a running attempt keeps its own deadline (its start plus the duration)." },
    changes: history.slice(-5).map((h) => ({ at: h.createdAt, by: h.adminName, from: h.details.previousDurationMin, to: h.details.newDurationMin, reason: h.details.reason || null })),
  };
  if (query.durationMin !== undefined && query.durationMin !== "") {
    const parsed = dur.parseDuration(query.durationMin);
    if (parsed.error) throw new ServiceError(400, parsed.error);
    const plan = dur.planDurationChange({ startedAts: starts, oldMin: test.durationMin, newMin: parsed.value, endTime: test.endTime });
    out.requestedDurationMin = parsed.value;
    out.plan = planOut(plan);
    out.confirmationsNeeded = dur.confirmationsNeeded({ oldMin: test.durationMin, newMin: parsed.value, plan });
    out.sameAsCurrent = parsed.value === test.durationMin;
  }
  return out;
}

// What the repeat of an already-applied request returns: the recorded outcome, never a second change.
const summaryOf = (details, extra = {}) => ({
  ok: true,
  testId: details.testId, title: details.title,
  previousDurationMin: details.previousDurationMin, newDurationMin: details.newDurationMin, version: details.version, effectiveAt: details.effectiveAt, reason: details.reason || null,
  eligibleAttempts: details.eligibleAttempts, updatedAttempts: details.eligibleAttempts, failedAttempts: 0,
  movedLater: details.movedLater, movedEarlier: details.movedEarlier, closingNow: details.wouldExpireNow, closingWithinFiveMinutes: details.wouldExpireSoon,
  howApplied: "Deadlines are calculated from each attempt's own start and the test's duration, so every running attempt has the new deadline at once. Open student pages pick it up on their next sync (about every 20 seconds); a student who is offline gets it when they reconnect. Nothing is restarted and no answer is touched.",
  ...extra,
});

async function changeDuration(actor, id, body = {}) {
  const parsed = dur.parseDuration(body.durationMin);
  if (parsed.error) throw new ServiceError(400, parsed.error);
  const newMin = parsed.value;
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion)) throw new ServiceError(400, "expectedVersion is required: send the version you were shown");
  const requestId = body.requestId === undefined || body.requestId === null || body.requestId === "" ? null : String(body.requestId);
  if (requestId !== null && !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new ServiceError(400, "requestId must be 8 to 64 letters, digits, - or _");
  const reason = body.reason === undefined || body.reason === null ? null : String(body.reason).trim().slice(0, 300) || null;

  const test = await loadManageable(actor, id);

  // A repeat of a request that was already applied (a retry after a timeout) returns what happened the first time.
  if (requestId) {
    const earlier = await repo.findByRequest(test.id, requestId);
    if (earlier) return summaryOf(earlier.details, { repeated: true });
  }
  if (newMin === test.durationMin) throw new ServiceError(400, `The duration is already ${newMin} minutes`);

  const starts = await repo.activeStarts(test.id);
  const plan = dur.planDurationChange({ startedAts: starts, oldMin: test.durationMin, newMin, endTime: test.endTime });
  const needs = dur.confirmationsNeeded({ oldMin: test.durationMin, newMin, plan });
  if (needs.reduction && body.confirmReduction !== true) {
    throw new ServiceError(409, `This shortens the time of ${plan.movedEarlier} running attempt(s). Confirm the reduction to continue.`, { needsConfirmation: "REDUCTION", plan: planOut(plan) });
  }
  if (needs.expiry && body.confirmExpiry !== true) {
    throw new ServiceError(409, `${plan.wouldExpireSoon} running attempt(s) would be at or past their new deadline or within five minutes of it (${plan.wouldExpireNow} already past it). The server closes an attempt past its deadline on its next sweep, keeping and grading what was saved. Confirm to continue.`, { needsConfirmation: "EXPIRY", plan: planOut(plan) });
  }

  const history = await repo.changeHistory(test.id);
  const original = originalDurationOf(test, history);
  const effectiveAt = new Date().toISOString();
  let result;
  try {
    result = await repo.applyChange({
      testId: test.id, expectedVersion, newMin,
      entry: { req: actor.req, action: AUDIT_ACTIONS.TEST_DURATION_CHANGED, actorId: actor.user.id, actorName: actor.user.name, actorRole: actor.user.role, instituteId: test.instituteId },
      // The counts recorded are those of the running attempts at the moment of the write, inside the transaction.
      makeDetails: (startsAtCommit, version) => {
        const p = dur.planDurationChange({ startedAts: startsAtCommit, oldMin: test.durationMin, newMin, endTime: test.endTime });
        return {
          testId: test.id, title: test.title, previousDurationMin: test.durationMin, newDurationMin: newMin, originalDurationMin: original, version, requestId, reason, effectiveAt,
          eligibleAttempts: p.eligible, movedLater: p.movedLater, movedEarlier: p.movedEarlier, pastOldDeadline: p.pastOldDeadline, wouldExpireNow: p.wouldExpireNow, wouldExpireSoon: p.wouldExpireSoon,
          afterWindowClose: p.afterWindowClose, endTime: test.endTime, confirmedReduction: body.confirmReduction === true, confirmedExpiry: body.confirmExpiry === true,
        };
      },
    });
  } catch (err) {
    if (err instanceof repo.VersionConflict) {
      // Either someone else changed the test, or this very request already won a moment ago (a double click, a retry racing itself).
      if (requestId) {
        const earlier = await repo.findByRequest(test.id, requestId);
        if (earlier) return summaryOf(earlier.details, { repeated: true });
      }
      throw new ServiceError(409, "This test was changed by someone else while you were editing. Reload to see its current duration and try again.", { conflict: true });
    }
    throw err;
  }
  return summaryOf(result.details);
}

// The student's own clock: the authoritative deadline of THEIR attempt as the server computes it right now, and the server's time (so a skewed device clock cannot move the deadline).
// Only the owner of the attempt gets an answer, and the answer holds nothing about any other attempt.
async function attemptClock(actor, attemptId) {
  const a = await repo.attemptClock(attemptId);
  if (!a || a.studentId !== actor.user.id) throw new ServiceError(403, "Invalid attempt");
  return {
    status: a.status,
    deadlineAt: deadlineOf({ startedAt: a.startedAt, test: { durationMin: a.test.durationMin } }),
    serverNow: Date.now(),
    durationMin: a.test.durationMin,
    configVersion: a.test.version,
  };
}

// Used by the generic test edit: a duration change must not slip through it while attempts are running.
async function assertNoLiveDurationChange(existing, body) {
  if (body.durationMin === undefined || Number(body.durationMin) === existing.durationMin) return;
  const { active } = await repo.attemptCounts(existing.id);
  if (active > 0) {
    throw new ServiceError(409, `${active} attempt(s) are in progress, so the duration cannot be changed from this form. Use "Edit live duration" on the test: it shows what changes for each running attempt, asks for confirmation and keeps a record.`, { liveDurationRequired: true, activeAttempts: active });
  }
}

module.exports = { durationImpact, changeDuration, attemptClock, assertNoLiveDurationChange };
