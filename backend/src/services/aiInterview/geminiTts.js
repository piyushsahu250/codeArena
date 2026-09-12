// Raw-fetch Gemini text-to-speech client — same style/conventions as
// backend/src/services/ai/geminiProvider.js (Node 20 built-in fetch, no SDK), kept as its own file
// rather than folded into geminiProvider.js because this hits a DIFFERENT endpoint shape
// (responseModalities: ["AUDIO"], returns raw PCM instead of text) and is specific to the voice
// interview module, not a general-purpose text-generation primitive every feature shares.
//
// Deliberately NOT routed through aiService.js's callProvider/generateText: those exist to wrap
// TEXT generation (JSON validation, retry-on-malformed-JSON) which doesn't apply to raw audio
// bytes. Quota/usage-logging for TTS calls is handled by the caller (the voice session handler)
// logging its own AiUsageLog row directly, same fields, just a different `feature` value.
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
// A single, fixed, professional-sounding voice — not user-selectable in this phase (spec's
// "AI personality" admin control, §38, is a later enhancement). Google's own naming is
// personality-flavored ("Kore," "Puck," etc.); Kore is documented as a firm/professional tone,
// matching a technical interviewer rather than a casual assistant.
const TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Kore";
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 30000;

function isConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

// Synthesizes `text` verbatim as spoken audio — the whole reason this module exists as a SEPARATE
// call from the Live API's own conversational audio output (see docs/AI_INTERVIEW.md's Phase 2
// architecture note): a live conversational model asked to "say something" tends to paraphrase,
// which is unacceptable for a question whose EXACT wording the adaptive engine already decided on
// and will grade the candidate's response against. A plain TTS call has no such risk — it speaks
// the string it's given, nothing else.
//
// Returns { audioBase64, mimeType, sampleRateHz } — raw PCM16 mono, per Gemini's TTS response
// shape (inlineData.data is base64 PCM, inlineData.mimeType names the exact rate, typically
// "audio/L16;codec=pcm;rate=24000" — parsed out rather than hardcoded in case Google changes it).
async function synthesizeSpeech(text) {
  if (!isConfigured()) {
    const err = new Error("AI features are not configured on this server (GEMINI_API_KEY is not set)");
    err.notConfigured = true;
    throw err;
  }
  if (!text || !text.trim()) throw new Error("synthesizeSpeech: text must be non-empty");

  const url = `${GEMINI_API_BASE}/${TTS_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Gemini TTS request failed (${res.status}): ${body.slice(0, 500)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) {
      const err = new Error("Gemini TTS returned no audio data");
      err.invalidResponse = true;
      throw err;
    }

    const mimeType = part.inlineData.mimeType || "audio/L16;codec=pcm;rate=24000";
    const rateMatch = /rate=(\d+)/.exec(mimeType);
    return {
      audioBase64: part.inlineData.data,
      mimeType,
      sampleRateHz: rateMatch ? Number(rateMatch[1]) : 24000,
      usage: data.usageMetadata
        ? { promptTokens: data.usageMetadata.promptTokenCount ?? null, completionTokens: data.usageMetadata.candidatesTokenCount ?? null }
        : null,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Gemini TTS request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      timeoutErr.timedOut = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { synthesizeSpeech, isConfigured, TTS_MODEL };
