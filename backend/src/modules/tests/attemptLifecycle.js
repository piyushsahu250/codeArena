// The ONE place that decides what state a formal-test attempt is in, for every view that shows it (results leaderboard, export, admin live counts).
// Pure: no database, no HTTP. The input is the persisted attempt row plus its test's duration; nothing comes from the browser, a timer or a cache.
//
//   COMPLETED     the attempt was finalized and persisted as SUBMITTED (the student pressed Submit) or AUTO_SUBMITTED (the time ran out or the server closed it).
//   IN_PROGRESS   stored as IN_PROGRESS and the student's own time (startedAt + durationMin) has not run out, so they can still answer.
//   TIME_EXPIRED  stored as IN_PROGRESS but the student's own time HAS run out. The server refuses their writes and will close the attempt itself, but it has
//                 not yet: it is neither a live attempt nor a finished one, so it must not be counted as either.
//   UNKNOWN       a stored status this code does not recognise (legacy or corrupt data). Never labelled Completed or In progress on a guess.
//
// "Pending evaluation" is not a separate state here: coding answers are graded while the attempt is being finalized, so a finalized attempt is already scored.
const { deadlineOf } = require("../submissions/submissions.domain");

const STATE = Object.freeze({ COMPLETED: "COMPLETED", IN_PROGRESS: "IN_PROGRESS", TIME_EXPIRED: "TIME_EXPIRED", UNKNOWN: "UNKNOWN" });
const LABEL = Object.freeze({
  COMPLETED: "Completed",
  IN_PROGRESS: "In progress",
  TIME_EXPIRED: "Time expired, not yet closed",
  UNKNOWN: "Unknown",
});

const normalize = (status) => String(status ?? "").trim().toUpperCase();

// `test` needs durationMin. `now` is a Date (or ms) so a caller evaluating many rows uses one instant.
function lifecycleOf(attempt, test, now = Date.now()) {
  const status = normalize(attempt?.status);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (status === "SUBMITTED" || status === "AUTO_SUBMITTED") {
    return { state: STATE.COMPLETED, label: LABEL.COMPLETED, detail: status === "AUTO_SUBMITTED" ? "Auto-submitted" : "Submitted" };
  }
  if (status === "IN_PROGRESS") {
    const deadline = deadlineOf({ startedAt: attempt.startedAt, test: { durationMin: test?.durationMin } });
    // An attempt whose deadline cannot be computed is treated as still in progress: the stored status is all there is, and guessing "expired" would be worse.
    if (Number.isFinite(deadline) && nowMs > deadline) return { state: STATE.TIME_EXPIRED, label: LABEL.TIME_EXPIRED, detail: "Time expired" };
    return { state: STATE.IN_PROGRESS, label: LABEL.IN_PROGRESS, detail: "In progress" };
  }
  return { state: STATE.UNKNOWN, label: LABEL.UNKNOWN, detail: status || "No status" };
}

// Ranks only COMPLETED attempts, in the order given (the caller passes them score-descending). A running attempt's score is a live partial total, so it does not
// take a place among finished ones. Tie handling is unchanged: position in the given order.
function withRanks(items) {
  let next = 1;
  return items.map((item) => ({ ...item, rank: item.lifecycle.state === STATE.COMPLETED ? next++ : null }));
}

module.exports = { STATE, LABEL, lifecycleOf, withRanks };
