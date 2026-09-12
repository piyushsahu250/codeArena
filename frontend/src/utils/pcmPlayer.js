// Plays the raw PCM16 audio the backend sends over the voice WebSocket (question_audio messages
// — see backend/src/services/aiInterview/geminiTts.js: base64 mono PCM16 little-endian at
// sampleRateHz, NOT a container format like WAV/MP3, so it can't just be handed to an <audio>
// element or decodeAudioData — that expects a self-describing file with its own header). One
// shared AudioContext for the whole page (creating a fresh one per clip is unnecessary and some
// browsers cap how many can exist at once), and only ever one clip playing at a time — a new
// question_audio should replace whatever was still playing, and a barge-in (stop_playback from
// the server, or the candidate's own "Interrupt" button) must be able to cut it off instantly.
let sharedCtx = null;
function getCtx() {
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (sharedCtx.state === "suspended") sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

let currentSource = null;

export function stopPlayback() {
  if (currentSource) {
    try {
      currentSource.onended = null;
      currentSource.stop();
    } catch {
      // already stopped/ended — nothing to do
    }
    currentSource = null;
  }
}

// base64Pcm: base64-encoded little-endian Int16 PCM, mono. sampleRateHz: from the message itself
// (backend already parsed this out of Gemini's mimeType — see geminiTts.js — never hardcoded here).
// onEnded fires once playback completes naturally (not on an interrupt-triggered stop).
export function playPcm16(base64Pcm, sampleRateHz, onEnded) {
  stopPlayback();
  const ctx = getCtx();

  const binary = atob(base64Pcm);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);

  const buffer = ctx.createBuffer(1, int16.length, sampleRateHz);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onended = () => {
    if (currentSource === source) currentSource = null;
    onEnded?.();
  };
  currentSource = source;
  source.start();
}

export function closePcmPlayer() {
  stopPlayback();
  if (sharedCtx && sharedCtx.state !== "closed") sharedCtx.close().catch(() => {});
  sharedCtx = null;
}
