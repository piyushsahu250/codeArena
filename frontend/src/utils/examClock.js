// Display helpers for the examination timers. The server decides every deadline; these only show them. The browser's clock is used for nothing but the difference to the server's
// (offset = serverNow - Date.now() at the moment a response arrived), so changing the computer's clock cannot change what is displayed by more than the network delay.
export function clockOffset(serverNowMs, localNowMs = Date.now()) {
  return Number.isFinite(serverNowMs) ? serverNowMs - localNowMs : 0;
}

export function secondsUntil(deadlineMs, offsetMs = 0, localNowMs = Date.now()) {
  if (!Number.isFinite(deadlineMs)) return null;
  return Math.max(0, Math.ceil((deadlineMs - (localNowMs + offsetMs)) / 1000));
}

export function formatClock(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return "--:--";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// What the timer bar shows: "urgent" in the last 5 minutes or last 10% of the time, so a student is warned before it is too late.
export function timerTone(remainingSeconds, totalSeconds) {
  if (remainingSeconds === null || remainingSeconds === undefined) return "normal";
  if (remainingSeconds <= 300) return "urgent";
  if (totalSeconds && remainingSeconds <= totalSeconds * 0.1) return "urgent";
  return "normal";
}
