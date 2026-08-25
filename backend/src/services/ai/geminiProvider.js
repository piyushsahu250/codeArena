// Raw-fetch Gemini REST client — no SDK dependency, same style as the Anthropic client this
// replaces (Node 20 built-in fetch/AbortController, one file, one job). Only this file knows the
// Gemini request/response shape; aiService.js is the only thing allowed to call it, so a future
// second provider (OpenAI/Groq/OpenRouter/etc, see aiService.js's PROVIDER_REGISTRY) never has to
// touch this file or vice versa.
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// gemini-2.5-flash: confirmed free-tier-eligible and not scheduled to sunset until well past this
// deploy (2026-10-16, per Google's own model-deprecations info as of when this was written).
// Google changes free-tier model availability without much notice — if this model ever 404s or
// disappears from the free tier, set GEMINI_MODEL to whatever AI Studio (aistudio.google.com)
// currently lists rather than editing this file.
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 30000;
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES ?? 2);
const RETRY_BASE_DELAY_MS = Number(process.env.GEMINI_RETRY_BASE_DELAY_MS) || 800;

function isConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff with jitter — spreads out a burst of simultaneously-retrying requests
// instead of all of them re-hitting Gemini at the exact same moment (which would just reproduce
// the 429 that triggered the retry in the first place).
function backoffDelay(attempt) {
  const base = RETRY_BASE_DELAY_MS * 2 ** attempt;
  return base + Math.random() * base * 0.25;
}

async function callGeminiOnce({ model, system, prompt, maxTokens, temperature, jsonMode }) {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
          ...(jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Gemini API request failed (${res.status}): ${body.slice(0, 500)}`);
      err.status = res.status;
      err.retryable = res.status === 429 || res.status >= 500;
      throw err;
    }

    const data = await res.json();

    // A prompt blocked by Gemini's own safety filters returns 200 with no candidates at all —
    // this is a real, distinct failure mode (not a network/server issue), so it must not be
    // silently treated as "empty success." Not retryable — retrying the identical prompt gets
    // the identical block.
    if (!data.candidates || data.candidates.length === 0) {
      const reason = data.promptFeedback?.blockReason || "unknown";
      const err = new Error(`Gemini declined to generate a response (reason: ${reason})`);
      err.retryable = false;
      err.blocked = true;
      throw err;
    }

    const candidate = data.candidates[0];
    const text = (candidate.content?.parts || []).map((p) => p.text || "").join("");
    return {
      text,
      finishReason: candidate.finishReason || null,
      truncated: candidate.finishReason === "MAX_TOKENS",
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount ?? null,
            completionTokens: data.usageMetadata.candidatesTokenCount ?? null,
            totalTokens: data.usageMetadata.totalTokenCount ?? null,
          }
        : null,
      model: data.modelVersion || model,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Gemini API request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      timeoutErr.retryable = true;
      timeoutErr.timedOut = true;
      throw timeoutErr;
    }
    if (err.retryable === undefined) err.retryable = true; // unlabeled = network-level, worth retrying
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Calls Gemini with retry/backoff on retryable failures (429, 5xx, timeout, network). `maxRetries`
// lets a caller opt out (0) for cases where a fast failure matters more than resilience — none do
// today, but the knob exists per the "maximum retry attempts should be configurable" requirement.
async function generateContent({ model = DEFAULT_MODEL, system, prompt, maxTokens = 1024, temperature = 0.7, jsonMode = false, maxRetries = MAX_RETRIES }) {
  if (!isConfigured()) {
    const err = new Error("AI features are not configured on this server (GEMINI_API_KEY is not set)");
    err.notConfigured = true;
    throw err;
  }

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callGeminiOnce({ model, system, prompt, maxTokens, temperature, jsonMode });
    } catch (err) {
      lastErr = err;
      if (!err.retryable || attempt === maxRetries) throw err;
      await sleep(backoffDelay(attempt));
    }
  }
  throw lastErr;
}

module.exports = { generateContent, isConfigured, DEFAULT_MODEL };
