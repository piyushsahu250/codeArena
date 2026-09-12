import { useCallback, useRef, useState } from "react";

// Captures the candidate's microphone as mono PCM16 @ 16kHz base64 chunks — the exact shape the
// voice WebSocket's audio_chunk messages need (see backend/src/services/aiInterview/
// geminiLiveClient.js: Gemini Live's realtimeInput expects "audio/pcm;rate=16000"). Nothing in
// this codebase captures raw PCM today (useProctoring.js's mic usage is limited to a local
// AudioContext/AnalyserNode noise heuristic — it never reads samples out for transmission), so
// this is a new, narrowly-scoped hook rather than an extension of that one.
//
// Uses a ScriptProcessorNode rather than an AudioWorklet: it's deprecated but still universally
// supported, and — unlike a worklet — needs no separate module file or addModule() step, which
// keeps a first-of-its-kind feature this small self-contained. Revisit if Chrome ever actually
// removes it (no removal date has been set as of this writing).
const BUFFER_SIZE = 4096;
const TARGET_SAMPLE_RATE = 16000;

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

function int16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Only needed when the browser ignores the requested AudioContext sampleRate (some Safari
// versions clamp it to the hardware rate) — linear interpolation, same approach already proven
// live against Gemini Live during Phase 2 backend testing (test scripts resampled TTS output the
// other direction, 24kHz->16kHz, with an exact-match transcript confirming the technique is sound).
function resampleTo16k(float32, fromRate) {
  if (fromRate === TARGET_SAMPLE_RATE) return float32;
  const ratio = TARGET_SAMPLE_RATE / fromRate;
  const outLength = Math.floor(float32.length * ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(idx0 + 1, float32.length - 1);
    const frac = srcPos - idx0;
    out[i] = float32[idx0] + (float32[idx1] - float32[idx0]) * frac;
  }
  return out;
}

export function useMicCapture() {
  const [permission, setPermission] = useState("idle"); // idle | requesting | granted | denied | unavailable
  const [error, setError] = useState(null);
  const [level, setLevel] = useState(0); // 0..1 RMS, for a simple "you're speaking" meter

  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const onChunkRef = useRef(null);

  const requestPermission = useCallback(async () => {
    setPermission("requesting");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;
      setPermission("granted");
      return true;
    } catch (err) {
      setPermission(err.name === "NotAllowedError" ? "denied" : "unavailable");
      setError(
        err.name === "NotAllowedError"
          ? "Microphone access was denied. Please allow it to begin the interview."
          : err.name === "NotFoundError"
          ? "No microphone was found on this device."
          : "Could not access your microphone. Please check your device and browser permissions."
      );
      return false;
    }
  }, []);

  // Starts streaming PCM16 chunks to onChunk(base64) until stop() is called. Safe to call only
  // after permission === "granted".
  const start = useCallback((onChunk) => {
    if (!streamRef.current) return;
    onChunkRef.current = onChunk;

    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    ctxRef.current = ctx;

    const source = ctx.createMediaStreamSource(streamRef.current);
    sourceRef.current = source;
    const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);

      let sumSquares = 0;
      for (let i = 0; i < input.length; i++) sumSquares += input[i] * input[i];
      setLevel(Math.min(1, Math.sqrt(sumSquares / input.length) * 4));

      const resampled = resampleTo16k(input, ctx.sampleRate);
      const pcm16 = floatTo16BitPCM(resampled);
      onChunkRef.current?.(int16ToBase64(pcm16));
    };

    source.connect(processor);
    // A ScriptProcessorNode only fires while connected into the graph all the way to a
    // destination (a Web Audio spec quirk, not a bug here) — connecting to a silent gain-less
    // destination would work too, but connecting straight to ctx.destination is simpler and the
    // mic input is never itself routed to speakers (no feedback loop) since nothing here plays it.
    processor.connect(ctx.destination);
  }, []);

  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== "closed") ctxRef.current.close().catch(() => {});
    ctxRef.current = null;
    setLevel(0);
  }, []);

  const release = useCallback(() => {
    stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setPermission("idle");
  }, [stop]);

  return { permission, error, level, requestPermission, start, stop, release };
}
