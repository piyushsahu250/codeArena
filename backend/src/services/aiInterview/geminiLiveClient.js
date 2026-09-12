// Thin wrapper around Gemini's Live API (BidiGenerateContent WebSocket) — used ONLY as a real-time
// speech-to-text + turn-detection layer, never to let Gemini generate the interview's own
// conversational content. See docs/AI_INTERVIEW.md's Phase 2 architecture note for why: a
// full speech-to-speech conversational model asked to "conduct the interview" would bypass every
// piece of Phase 1 (the adaptive engine's structured evaluation, deterministic scoring, duplicate-
// question prevention, competency planning) — this connection exists purely so the candidate's
// spoken answer becomes text, with Gemini's own automatic Voice Activity Detection telling us the
// moment they've finished speaking (spec §3's "AI should detect when the candidate has finished
// speaking"), and nothing more. `responseModalities: ["TEXT"]` means Gemini's own generated reply
// (which we never asked for and always discard) comes back as text, not audio — no wasted TTS
// cost on a reply nobody hears.
//
// This client is only ever used SERVER-SIDE (from the WS voice-session handler) — the browser
// never holds a Gemini API key or connects to Google directly at all; every credential this needs
// stays in this process's own env, exactly like every other AI call on this platform.
const WebSocket = require("ws");
const { EventEmitter } = require("events");

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-native-audio-preview-09-2025";
const LIVE_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

function isConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

// Emits: "ready" (setup ack received, safe to start streaming audio), "partialTranscript" (text,
// so-far transcript of the candidate's CURRENT utterance, for optional live-caption display —
// spec §19's "candidate should see live transcription optionally"), "turnComplete" (finalText —
// Gemini's VAD detected the candidate stopped speaking; finalText is what gets graded), "error",
// "close".
class GeminiLiveSttSession extends EventEmitter {
  constructor() {
    super();
    if (!isConfigured()) {
      const err = new Error("AI features are not configured on this server (GEMINI_API_KEY is not set)");
      err.notConfigured = true;
      throw err;
    }
    this._transcriptBuffer = "";
    this._closed = false;
    this._ws = new WebSocket(`${LIVE_WS_URL}?key=${process.env.GEMINI_API_KEY}`);

    this._ws.on("open", () => {
      // Setup message — must be the first client message on a fresh connection. Automatic
      // activity detection is left ENABLED (the default) deliberately: Gemini's own server-side
      // VAD is exactly the "detect when the candidate has finished speaking" behavior spec §3
      // asks for, and reimplementing that client-side (spec's alternative "manual" mode) would be
      // strictly worse for a first real implementation with no clear benefit here.
      this._ws.send(JSON.stringify({
        setup: {
          model: `models/${LIVE_MODEL}`,
          generationConfig: { responseModalities: ["TEXT"] },
          inputAudioTranscription: {},
        },
      }));
    });

    this._ws.on("message", (raw) => this._handleMessage(raw));
    this._ws.on("error", (err) => this.emit("error", err));
    this._ws.on("close", (code, reason) => { this._closed = true; this.emit("close", code, reason?.toString()); });
  }

  _handleMessage(raw) {
    let msg;
    try {
      // Gemini's WS frames are JSON text in every observed case, but the `ws` library still hands
      // Buffers for text frames on some Node/ws version combinations — normalize defensively
      // rather than assume.
      msg = JSON.parse(raw.toString());
    } catch (err) {
      this.emit("error", new Error(`Received non-JSON frame from Gemini Live: ${err.message}`));
      return;
    }

    if (msg.setupComplete) {
      this.emit("ready");
      return;
    }

    const serverContent = msg.serverContent;
    if (!serverContent) return;

    if (serverContent.inputTranscription?.text) {
      this._transcriptBuffer += serverContent.inputTranscription.text;
      this.emit("partialTranscript", this._transcriptBuffer);
    }

    if (serverContent.turnComplete) {
      const finalText = this._transcriptBuffer.trim();
      this._transcriptBuffer = "";
      this.emit("turnComplete", finalText);
    }

    // serverContent.interrupted: true fires when the candidate starts speaking again while
    // Gemini still thinks a previous turn is open (e.g. a very late VAD signal) — surfaced so the
    // voice-session handler can treat it the same as an explicit client-side barge-in signal
    // (spec §14), stopping any in-flight TTS playback immediately.
    if (serverContent.interrupted) this.emit("interrupted");
  }

  // `pcmBase64` — base64-encoded 16-bit PCM mono audio, 16kHz, matching Gemini's documented
  // realtimeInput format exactly (no resampling/transcoding happens on this side — the browser is
  // responsible for capturing/encoding at this exact rate, see the frontend audio-capture code).
  sendAudioChunk(pcmBase64) {
    if (this._closed) return;
    this._ws.send(JSON.stringify({
      realtimeInput: { audio: { data: pcmBase64, mimeType: "audio/pcm;rate=16000" } },
    }));
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try { this._ws.close(); } catch { /* already closing/closed */ }
  }
}

module.exports = { GeminiLiveSttSession, isConfigured, LIVE_MODEL };
