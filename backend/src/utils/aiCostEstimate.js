// Estimated USD cost of Gemini API usage, from AiUsageLog's already-recorded promptTokens/
// completionTokens (utils/aiService.js already logs every call; this just prices what's already
// there, no new tracking mechanism). Pricing confirmed live against Google's own published rate
// card (ai.google.dev/gemini-api/docs/pricing, checked 2026-09-06) for gemini-3.6-flash (the model
// this platform actually calls — see services/ai/geminiProvider.js's DEFAULT_MODEL) on the
// Standard/pay-as-you-go tier: $0.75 / 1M input tokens, $3.75 / 1M output tokens, through
// 2026-12-31 (rising to $1.50 / $7.50 on 2027-01-01 — update PRICE_PER_1M below when that lands).
//
// This is deliberately labeled an ESTIMATE everywhere it's surfaced, not a bill: whether this
// specific GEMINI_API_KEY is actually on that paid tier or on Google AI Studio's free tier (real
// cost: $0, subject to its own separate rate limits) isn't something this codebase can determine
// from an API response — only the person who created the key knows which. Never present this
// number as an authoritative dollar amount without that caveat attached.
const PRICE_PER_1M = { input: 0.75, output: 3.75 };

function estimateAiCostUsd(promptTokens, completionTokens) {
  const inputCost = (promptTokens || 0) / 1_000_000 * PRICE_PER_1M.input;
  const outputCost = (completionTokens || 0) / 1_000_000 * PRICE_PER_1M.output;
  return Math.round((inputCost + outputCost) * 10000) / 10000; // 4dp -- these totals are often small fractions of a cent
}

module.exports = { estimateAiCostUsd, PRICE_PER_1M };
