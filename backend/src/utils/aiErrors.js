// Shared error → HTTP response mapping for every route that calls aiService.js. Centralized so
// every AI-powered route gives the student/admin the same clear, honest message for the same
// underlying failure, instead of six slightly different ad-hoc catch blocks.
function sendAiError(res, err, fallbackMessage = "AI generation failed — please try again.") {
  if (err.notConfigured) {
    return res.status(503).json({ error: "AI features are not configured on this server yet.", code: "AI_NOT_CONFIGURED" });
  }
  if (err.quotaExceeded) {
    return res.status(429).json({ error: err.message, code: "AI_QUOTA_EXCEEDED" });
  }
  if (err.queueBusy) {
    return res.status(503).json({ error: "AI service is temporarily busy. Please retry in a moment.", code: "AI_QUEUE_FULL" });
  }
  if (err.timedOut) {
    return res.status(504).json({ error: "AI service is temporarily unavailable. Please retry.", code: "AI_TIMEOUT" });
  }
  if (err.blocked) {
    return res.status(422).json({ error: "AI service could not process this request. Please rephrase and try again.", code: "AI_BLOCKED" });
  }
  if (err.invalidResponse) {
    return res.status(502).json({ error: "AI service is temporarily unavailable. Please retry.", code: "AI_INVALID_RESPONSE" });
  }
  if (err.status === 429) {
    return res.status(429).json({ error: "AI service is temporarily unavailable. Please retry.", code: "AI_RATE_LIMITED" });
  }
  console.error("[aiService] unhandled error:", err);
  return res.status(502).json({ error: "AI service is temporarily unavailable. Please retry.", code: "AI_PROVIDER_ERROR" });
}

module.exports = { sendAiError };
