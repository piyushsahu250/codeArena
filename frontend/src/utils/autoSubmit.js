// Why was a formal-test attempt auto-submitted? Worked out from what the server stored, never guessed.
//
// A formal-test attempt reaches AUTO_SUBMITTED in only three ways (backend: tests.repository.js logPenalizedViolation, submissions.service.js finalizeAttempt, testAttemptAutoFinalizeScheduler.js):
//   1. the strike limit: the strike that reaches the limit submits the attempt at that moment, so an auto-submitted attempt whose strike count has reached the limit was ended by it;
//   2. the student's own page submitted when the allowed time ran out (the deadline is startedAt + the test's duration);
//   3. the server closed an attempt the student's page never submitted, once the deadline (plus a one-minute margin) had passed.
// So an auto-submitted attempt below the strike limit was ended by the clock. The size of the gap between the deadline and the submit time says which of 2 and 3 it was, and the facts
// are shown so a reviewer can see it for themselves. If the stored times do not show either, the page says the reason cannot be told rather than choosing one.

export const DEFAULT_STRIKE_LIMIT = 3; // mirrors MAX_TAB_VIOLATIONS in backend/src/modules/tests/tests.domain.js
const PREMATURE_GRACE_MS = 15000; // mirrors PREMATURE_FINALIZE_GRACE_MS: the page may submit this much before the deadline
const PAGE_SUBMIT_WINDOW_MS = 90000; // the server only closes abandoned attempts 60 s after the deadline, so a submit within ~90 s was the student's own page

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "";
  const total = Math.round(Math.abs(ms) / 1000);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

const when = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleString() : null);
const plural = (n, one, many) => (n === 1 ? one : many);

// Returns null for an attempt that was not auto-submitted, else { reason, title, summary, facts: [{ label, value }] }.
export function explainAutoSubmit({ status, startedAt, submittedAt, durationMin, strikes, strikeLimit = DEFAULT_STRIKE_LIMIT } = {}) {
  if (String(status || "").toUpperCase() !== "AUTO_SUBMITTED") return null;
  const limit = Number.isInteger(strikeLimit) && strikeLimit > 0 ? strikeLimit : DEFAULT_STRIKE_LIMIT;
  const count = Number.isFinite(Number(strikes)) ? Math.max(0, Math.trunc(Number(strikes))) : 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(submittedAt).getTime();
  const minutes = Number(durationMin);
  const deadline = Number.isFinite(start) && Number.isFinite(minutes) && minutes > 0 ? start + minutes * 60000 : NaN;
  const delay = Number.isFinite(deadline) && Number.isFinite(end) ? end - deadline : NaN;

  const facts = [];
  if (Number.isFinite(start)) facts.push({ label: "Started", value: when(start) });
  if (Number.isFinite(minutes) && minutes > 0) facts.push({ label: "Allowed time", value: `${minutes} ${plural(minutes, "minute", "minutes")}` });
  if (Number.isFinite(deadline)) facts.push({ label: "Deadline", value: when(deadline) });
  if (Number.isFinite(end)) facts.push({ label: "Submitted automatically", value: when(end) });
  if (Number.isFinite(delay) && delay > 0) facts.push({ label: "After the deadline", value: formatDuration(delay) });
  facts.push({ label: "Strikes", value: `${count} of ${limit}` });

  if (count >= limit) {
    return {
      reason: "STRIKE_LIMIT",
      title: "Auto-submitted: strike limit reached",
      summary: `This attempt reached ${count} of ${limit} strikes. The strike that reached the limit submitted the attempt automatically at that moment, and the answers saved up to then were graded. The events that were counted are listed below.`,
      facts,
    };
  }

  if (Number.isFinite(delay) && delay >= -PREMATURE_GRACE_MS) {
    const strikeNote = count === 0
      ? "No strikes were involved."
      : `The attempt had ${count} ${plural(count, "strike", "strikes")}, below the limit of ${limit}, so the strikes did not end it.`;
    const how = delay <= PAGE_SUBMIT_WINDOW_MS
      ? "The allowed time ran out and the test was submitted automatically at the deadline."
      : `The allowed time ran out and the student's page did not submit the test, so the server closed it ${formatDuration(delay)} after the deadline. This happens when the browser was closed, the device went offline or the page stopped.`;
    return { reason: "TIME_EXPIRED", title: "Auto-submitted: time ran out", summary: `${how} ${strikeNote} Answers saved before then were graded.`, facts };
  }

  return {
    reason: "UNKNOWN",
    title: "Auto-submitted: reason cannot be told",
    summary: `This attempt was submitted automatically, but its stored start and submit times do not show that the time ran out, and its ${count} of ${limit} strikes did not reach the limit. The reason was not recorded.`,
    facts,
  };
}
