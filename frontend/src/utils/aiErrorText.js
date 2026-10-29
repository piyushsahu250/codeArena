// Student-facing wording for a failed AI call. The server's own message for a daily provider limit says "ask your administrator to enable
// paid AI usage", which is no use to a student in the middle of an interview, and it says nothing about whether their interview was lost.
// Pure, so scripts/aiErrorTextRegression.mjs can run it under plain Node.
export function friendlyAiError(err, fallback) {
  const data = err?.response?.data;
  const code = data?.code;
  if (code === "AI_DAILY_QUOTA") {
    const seconds = Number(data?.resetInSeconds);
    let when = "later today";
    if (Number.isFinite(seconds) && seconds > 0) {
      if (seconds < 3600) when = "in under an hour";
      else { const h = Math.ceil(seconds / 3600); when = `in about ${h} hour${h === 1 ? "" : "s"}`; }
    }
    return `AI interviews are paused for a while because today's free AI limit has been used up. Nothing is lost: your interview is saved and your answers so far are kept. Please try again ${when}.`;
  }
  return data?.error || fallback;
}

// Whether a failed AI call is one the student can simply retry later (shows a "Try again" button).
export function isRetryableAiError(err) {
  const status = err?.response?.status;
  return status === 429 || status === 502 || status === 503 || status === 504;
}
