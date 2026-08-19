// Thin wrapper around the Claude Messages API — every AI feature on this platform (question
// generation, coding hints, resume review, interview feedback) wants "one prompt in, one
// response out," so this stays a single-purpose client rather than a general chat/tool-use SDK.
// Uses Node 20's built-in fetch, so no new npm dependency and no Docker rebuild to ship this.
//
// Requires ANTHROPIC_API_KEY set in the environment (Render → this service → Environment). Every
// caller should catch the `notConfigured` error shape and degrade gracefully (e.g. "AI features
// aren't set up yet" in the UI) rather than 500 — this platform ran on 100% rule-based logic
// before this file existed, so AI being unavailable must never break the underlying feature.
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// claude-sonnet-4-5-20250929 (the prior default) is Active but its tentative retirement window
// opens 2026-09-29 (see Anthropic's model-deprecations page) — claude-sonnet-5 is the current,
// actively-supported successor at the same tier. ANTHROPIC_MODEL still overrides either way.
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
// Every AI feature here is a request/response call inside an HTTP request the student/admin is
// actively waiting on (Render's own proxy times out well past this) — bounded so a stalled
// connection to Anthropic fails fast with a clear error instead of hanging the request open
// indefinitely. One retry on transient failures (network error, 429, 5xx) with a short backoff;
// non-retryable failures (4xx other than 429, JSON parse errors) surface immediately.
const REQUEST_TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS) || 30000;
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 800;

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAnthropicOnce({ system, prompt, maxTokens, temperature }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Claude API request failed (${res.status}): ${body.slice(0, 500)}`);
      err.status = res.status;
      // 429 (rate limited) and 5xx (transient server-side) are worth one retry; other 4xx
      // (bad request, auth, etc.) will fail identically on retry, so don't waste the round trip.
      err.retryable = res.status === 429 || res.status >= 500;
      throw err;
    }

    const data = await res.json();
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Claude API request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      timeoutErr.retryable = true;
      throw timeoutErr;
    }
    // Network-level failures (DNS, connection reset) land here with no `.retryable` set yet —
    // treat them the same as a timeout: worth one retry, not a hard failure.
    if (err.retryable === undefined) err.retryable = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function askClaude({ system, prompt, maxTokens = 1024, temperature = 0.7 }) {
  if (!isConfigured()) {
    const err = new Error("AI features are not configured on this server (ANTHROPIC_API_KEY is not set)");
    err.notConfigured = true;
    throw err;
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callAnthropicOnce({ system, prompt, maxTokens, temperature });
    } catch (err) {
      lastErr = err;
      if (!err.retryable || attempt === MAX_RETRIES) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

// Same contract as askClaude, but instructs Claude to answer with a single JSON value and parses
// it — every structured-output caller (question generator, resume review) wants this. Strips a
// markdown code fence if Claude adds one anyway despite the instruction not to.
async function askClaudeJson(args) {
  const text = await askClaude({
    ...args,
    system: `${args.system ? args.system + "\n\n" : ""}Respond with ONLY a single valid JSON value — no markdown code fences, no commentary before or after.`,
  });
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude did not return valid JSON: ${cleaned.slice(0, 300)}`);
  }
}

module.exports = { askClaude, askClaudeJson, isConfigured };
