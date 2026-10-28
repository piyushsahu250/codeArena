// The exam page's deadline comes from the server and can change while the student is taking the test (an administrator extends or shortens the duration). The page asks the server for its own
// attempt's clock (GET /tests/attempts/:id/clock) every SYNC_INTERVAL_MS, when the tab becomes visible again, and when the connection returns. This is the pure half: given the answer, what is the
// deadline, the device-clock correction, did it change, and what may the student be told. The page never works out a new deadline itself and never shows one the server did not confirm.
export const SYNC_INTERVAL_MS = 20000;
const CHANGE_THRESHOLD_MS = 1000; // smaller differences are rounding, not a change

// answer: { status, deadlineAt (ms), serverNow (ms), configVersion }. Returns null for an answer that cannot be trusted (missing or not numbers): the page keeps its current deadline.
//   { ended: true }                     the server says the attempt is no longer in progress (closed by the student or the server)
//   { deadline, clockOffset, changed, direction, deltaMs, configVersion }
export function applyClockAnswer({ currentDeadline, answer, deviceNow = Date.now() }) {
  if (!answer || !Number.isFinite(answer.deadlineAt) || !Number.isFinite(answer.serverNow)) return null;
  if (answer.status && String(answer.status).toUpperCase() !== "IN_PROGRESS") return { ended: true };
  const deltaMs = Number.isFinite(currentDeadline) ? answer.deadlineAt - currentDeadline : 0;
  const changed = Number.isFinite(currentDeadline) && Math.abs(deltaMs) >= CHANGE_THRESHOLD_MS;
  return { deadline: answer.deadlineAt, clockOffset: answer.serverNow - deviceNow, changed, direction: !changed ? null : deltaMs > 0 ? "later" : "earlier", deltaMs, configVersion: answer.configVersion ?? null };
}

export function secondsLeftAt(deadline, clockOffset, deviceNow = Date.now()) {
  return Math.max(0, Math.floor((deadline - (deviceNow + clockOffset)) / 1000));
}

// The neutral notice. It carries the actual deadline of THIS attempt, nothing about who changed it or why.
export function deadlineNotice(deadlineMs, locale) {
  const time = new Date(deadlineMs).toLocaleTimeString(locale || [], { hour: "2-digit", minute: "2-digit" });
  return `Your exam duration has been updated by the administrator. Your revised deadline is ${time}.`;
}
