// When the test timer reaches zero the page submits the attempt by itself. If that call fails (a slow server, a dropped connection) or the server says time is not up yet, the timer's
// one-second tick used to start another attempt at once, every second: each attempt swapped the "Submission not confirmed" card for the "Grading your assessment" card and back, so the
// screen blinked for as long as the problem lasted. These rules space the automatic attempts out; the student's Retry button is never throttled.
export const AUTO_RETRY_AFTER_FAILURE_MS = 15000; // after a failed submit, wait this long before trying again by itself
export const AUTO_RETRY_AFTER_PREMATURE_MS = 5000; // after "time is not up yet", let the corrected clock decide

// May the timer tick start an automatic submit now?
export function shouldAutoFinalize({ remainingSec, inFlight, finalized, lastFailureAt = 0, lastPrematureAt = 0, now = Date.now() }) {
  if (finalized || inFlight) return false;
  if (!(remainingSec <= 0)) return false;
  if (lastFailureAt && now - lastFailureAt < AUTO_RETRY_AFTER_FAILURE_MS) return false;
  if (lastPrematureAt && now - lastPrematureAt < AUTO_RETRY_AFTER_PREMATURE_MS) return false;
  return true;
}
