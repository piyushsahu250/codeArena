// Raw-fetch Gemini REST client — no SDK dependency, same style as the Anthropic client this
// replaces (Node 20 built-in fetch/AbortController, one file, one job). Only this file knows the
// Gemini request/response shape; aiService.js is the only thing allowed to call it, so a future
// second provider (OpenAI/Groq/OpenRouter/etc, see aiService.js's PROVIDER_REGISTRY) never has to
// touch this file or vice versa.
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// gemini-3.6-flash: confirmed live against the platform's actual API key (gemini-2.5-flash 404s
// with "no longer available to new users" — Google's own error response named this as the
// replacement). Google changes free-tier model availability without much notice — if this model
// ever 404s or disappears from the free tier, set GEMINI_MODEL to whatever AI Studio
// (aistudio.google.com) currently lists rather than editing this file.
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 30000;
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES ?? 2);
const RETRY_BASE_DELAY_MS = Number(process.env.GEMINI_RETRY_BASE_DELAY_MS) || 800;
const MAX_RETRY_AFTER_MS = Number(process.env.GEMINI_MAX_RETRY_AFTER_MS) || 12000; // longest we will wait on a provider-requested retry delay
// 3.x-generation Gemini models "think" by default (a hidden reasoning pass that consumes part of
// maxOutputTokens before any visible text) — confirmed empirically against the live API: with no
// thinkingConfig at all, a 20-50 token budget came back completely empty (finishReason MAX_TOKENS
// with zero visible text), because the whole budget was spent on the hidden reasoning trace.
// "minimal" is the lowest level that still returns real output reliably; every feature on this
// platform needs a direct answer, not deep reasoning, and free-tier tokens are exactly what this
// would otherwise waste. Also confirmed empirically: the OLDER thinkingConfig.thinkingBudget field
// (from the 2.5 generation) is REJECTED outright (400 INVALID_ARGUMENT) on this model — the two
// fields are not interchangeable. If GEMINI_MODEL is ever changed to a different model family,
// re-verify this field name/value against that model directly rather than assuming it still
// applies — set GEMINI_THINKING_LEVEL to override, or blank it out in code if the target model
// doesn't support thinkingConfig at all.
const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || "minimal";

// Free-tier request limits are counted PER MODEL, so when the main model's daily allowance is used up the others still have theirs.
// These are tried in order, only after the main model reports a daily quota (or is gone), so normal answers still come from the main model.
// Probed live against this platform's keys on 2026-10-29: each returns 200 with thinkingLevel "minimal". Set GEMINI_FALLBACK_MODELS (comma
// list, or "none") to change them; a model that rejects "minimal" is retried once with "low" (see callGeminiOnce's caller), so listing e.g.
// gemini-3.7-flash is safe. The "gemini-2.5-*" models 404 for this key ("no longer available to new users") and must not be listed.
const FALLBACK_MODELS = (() => {
  const raw = process.env.GEMINI_FALLBACK_MODELS;
  if (raw === undefined) return ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview"];
  return raw.split(",").map((m) => m.trim()).filter((m) => m && m.toLowerCase() !== "none");
})();
const MAX_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// model -> time (ms) before which it is skipped, set when it reports a daily quota or 404s, so a request does not spend a call finding that out again.
const modelCooldownUntil = new Map();
// model -> thinking level that worked after the default was rejected.
const thinkingLevelFor = new Map();

// Optional extra keys (GEMINI_API_KEY_2, GEMINI_API_KEY_3 or a comma list in GEMINI_API_KEYS) turn
// the per-key rate limit into a pool: a 429 on one key makes the retry use the next key right away
// instead of waiting for the first key's quota window to reopen. With only GEMINI_API_KEY set,
// behaviour is exactly as before. Keys come from the environment only and are never logged.
function geminiKeys() {
  const list = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3, ...String(process.env.GEMINI_API_KEYS || "").split(",")]
    .map((k) => (k || "").trim()).filter(Boolean);
  return [...new Set(list)];
}
let keyCursor = 0;
function pickKey(offset = 0) {
  const keys = geminiKeys();
  return keys[(keyCursor + offset) % keys.length];
}

function isConfigured() {
  return geminiKeys().length > 0;
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

async function callGeminiOnce({ model, system, prompt, maxTokens, temperature, jsonMode, keyOffset = 0, thinkingLevel = THINKING_LEVEL }) {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${pickKey(keyOffset)}`;
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
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Gemini API request failed (${res.status}): ${body.slice(0, 500)}`);
      err.status = res.status;
      // 400 "Thinking level MINIMAL is not supported for this model": the caller retries once with a level this model accepts.
      if (res.status === 400 && /thinking level/i.test(body)) err.thinkingLevelRejected = true;
      // 404 "no longer available to new users": this model will never work for this key, so move on to the next model.
      if (res.status === 404) err.modelUnavailable = true;
      err.retryable = res.status === 429 || res.status >= 500;
      // Gemini tells us exactly how long to back off on a 429: a Retry-After header and/or a
      // RetryInfo detail ("retryDelay": "13s") in the body. Waiting 0.8s/1.6s (the generic backoff)
      // can never clear a per-minute quota, so every retry was wasted. Capped so a request still
      // finishes inside the client's own timeout.
      if (res.status === 429) {
        const header = Number(res.headers.get("retry-after"));
        const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
        const seconds = Number.isFinite(header) && header > 0 ? header : m ? Number(m[1]) : null;
        if (seconds) err.retryAfterMs = Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
        // A delay of minutes-to-hours (e.g. 48000s) is the DAILY free-tier request quota, not a
        // per-minute burst limit: no amount of waiting inside this request, or retrying on the same
        // key, can succeed. Flag it so callers fail fast with an honest message instead of burning
        // retries (and more quota) on a request that cannot work.
        if (seconds && seconds > 120) { err.dailyQuota = true; err.resetInSeconds = Math.round(seconds); }
      }
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
// One call to one model, using the thinking level that model accepts: the default first, and if the model rejects it, "low" once (remembered).
async function callModelOnce(args) {
  const level = thinkingLevelFor.get(args.model) || THINKING_LEVEL;
  try {
    return await callGeminiOnce({ ...args, thinkingLevel: level });
  } catch (err) {
    if (err.thinkingLevelRejected && THINKING_LEVEL && level !== "low") {
      thinkingLevelFor.set(args.model, "low");
      return callGeminiOnce({ ...args, thinkingLevel: "low" });
    }
    throw err;
  }
}

// Whether a failure on one model should move on to the next model instead of ending the request: the model's daily allowance is used up,
// it is gone for this key, it rejects every thinking level we send, or it is still rate limited after the retries. A blocked prompt, a
// timeout, an unlabeled network error or a 5xx stays the caller's error, because another model would not change them.
function shouldTryNextModel(err) {
  return !!(err.dailyQuota || err.modelUnavailable || err.thinkingLevelRejected || err.status === 429);
}

async function generateContent({ model = DEFAULT_MODEL, system, prompt, maxTokens = 1024, temperature = 0.7, jsonMode = false, maxRetries = MAX_RETRIES }) {
  if (!isConfigured()) {
    const err = new Error("AI features are not configured on this server (GEMINI_API_KEY is not set)");
    err.notConfigured = true;
    throw err;
  }

  const now = Date.now();
  const candidates = [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
  const available = candidates.filter((m) => !(modelCooldownUntil.get(m) > now));
  if (!available.length) {
    // Every model reported its daily allowance within the last few hours: answer at once with the real time left instead of calling any.
    const soonest = Math.min(...candidates.map((m) => modelCooldownUntil.get(m) || now));
    const err = new Error("Every configured Gemini model has reached its daily limit");
    err.status = 429;
    err.dailyQuota = true;
    err.resetInSeconds = Math.max(60, Math.round((soonest - now) / 1000));
    throw err;
  }

  let lastErr;
  let soonestReset = null;
  for (const m of available) {
    try {
      return await generateWithModel({ model: m, system, prompt, maxTokens, temperature, jsonMode, maxRetries });
    } catch (err) {
      lastErr = err;
      if (!shouldTryNextModel(err)) throw err;
      if (err.dailyQuota) {
        const reset = err.resetInSeconds || 3600;
        modelCooldownUntil.set(m, Date.now() + Math.min(reset * 1000, MAX_COOLDOWN_MS));
        soonestReset = soonestReset === null ? reset : Math.min(soonestReset, reset);
      } else if (err.modelUnavailable) {
        modelCooldownUntil.set(m, Date.now() + MAX_COOLDOWN_MS); // will not come back on its own
      }
    }
  }
  if (lastErr?.dailyQuota && soonestReset !== null) lastErr.resetInSeconds = soonestReset; // the message names when the FIRST model reopens
  throw lastErr;
}

async function generateWithModel({ model, system, prompt, maxTokens, temperature, jsonMode, maxRetries }) {
  keyCursor++; // round-robin the starting key per call so load spreads across a key pool
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callModelOnce({ model, system, prompt, maxTokens, temperature, jsonMode, keyOffset: attempt });
    } catch (err) {
      lastErr = err;
      if (!err.retryable || attempt === maxRetries) throw err;
      // Daily quota on every key we have -> stop now; only worth trying again if another key exists.
      if (err.dailyQuota && attempt + 1 >= geminiKeys().length) throw err;
      // With a key pool the next attempt uses a different key, so a 429 on this one needs no long wait.
      const poolHasAnother = geminiKeys().length > 1;
      await sleep(poolHasAnother ? backoffDelay(attempt) : Math.max(backoffDelay(attempt), err.retryAfterMs || 0));
    }
  }
  throw lastErr;
}

module.exports = { generateContent, isConfigured, DEFAULT_MODEL, geminiKeys, pickKey };
