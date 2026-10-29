import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SPEECH_LANG, describeRecognitionError, getSpeechRecognitionCtor, isBrowserVoiceSupported, pickEnglishVoice, splitForSpeech } from "../utils/browserSpeech";

// Browser-only voice for the AI interview: speechSynthesis reads the question, SpeechRecognition turns the answer into text. No API key
// and no server quota. Recognition runs one phrase at a time (continuous = false) and is restarted from onend, which is the form that
// behaves the same on desktop Chrome/Edge and on Android Chrome (continuous mode repeats text there). English only.
const MAX_RAPID_RESTARTS = 5; // onend firing again and again within RAPID_WINDOW_MS means the engine is failing, not that the student is silent
const RAPID_WINDOW_MS = 3000;

export function useBrowserVoice() {
  const supported = useMemo(() => typeof window !== "undefined" && isBrowserVoiceSupported(window), []);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);

  const recRef = useRef(null);
  const wantListenRef = useRef(false);
  const onFinalRef = useRef(null);
  const speakTokenRef = useRef(0);
  const restartTimesRef = useRef([]);

  const cancelSpeech = useCallback(() => {
    speakTokenRef.current++; // makes the callbacks of whatever was being spoken stale
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  // Speaks `text` in chunks and calls onDone() once after the last one (also after an error, so the caller never waits forever).
  const speak = useCallback((text, onDone) => {
    if (!supported) { onDone?.(); return; }
    const chunks = splitForSpeech(text);
    window.speechSynthesis.cancel();
    const token = ++speakTokenRef.current;
    if (!chunks.length) { setSpeaking(false); onDone?.(); return; }
    const voice = pickEnglishVoice(window.speechSynthesis.getVoices());
    setSpeaking(true);
    let finished = false;
    const finish = () => {
      if (finished || token !== speakTokenRef.current) return;
      finished = true;
      setSpeaking(false);
      onDone?.();
    };
    chunks.forEach((chunk, i) => {
      const u = new window.SpeechSynthesisUtterance(chunk);
      u.lang = voice?.lang || SPEECH_LANG;
      if (voice) u.voice = voice;
      u.rate = 0.95;
      if (i === chunks.length - 1) { u.onend = finish; u.onerror = finish; }
      else u.onerror = finish;
      window.speechSynthesis.speak(u);
    });
  }, [supported]);

  const stopListening = useCallback(() => {
    wantListenRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = rec.onerror = rec.onend = null;
      try { rec.abort(); } catch { /* already stopped */ }
    }
    setListening(false);
    setInterim("");
  }, []);

  // onFinal(text) receives each recognised phrase once it is final.
  const startListening = useCallback((onFinal) => {
    const Ctor = supported ? getSpeechRecognitionCtor(window) : null;
    if (!Ctor) return false;
    stopListening();
    wantListenRef.current = true;
    onFinalRef.current = onFinal;
    restartTimesRef.current = [];
    setError(null);

    const begin = () => {
      const rec = new Ctor();
      rec.lang = SPEECH_LANG;
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let partial = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r[0]?.transcript || "";
          if (r.isFinal) { if (t.trim()) onFinalRef.current?.(t.trim()); } else partial += t;
        }
        setInterim(partial);
      };
      rec.onerror = (e) => {
        const info = describeRecognitionError(e.error);
        if (info.fatal) {
          wantListenRef.current = false;
          setError(info.message);
        }
      };
      rec.onend = () => {
        setInterim("");
        if (recRef.current !== rec) return; // replaced or stopped on purpose
        if (!wantListenRef.current) { recRef.current = null; setListening(false); return; }
        const now = Date.now();
        restartTimesRef.current = [...restartTimesRef.current.filter((t) => now - t < RAPID_WINDOW_MS), now];
        if (restartTimesRef.current.length > MAX_RAPID_RESTARTS) {
          wantListenRef.current = false;
          recRef.current = null;
          setListening(false);
          setError("Voice input keeps stopping on this device. Type your answer instead.");
          return;
        }
        try { rec.start(); } catch { recRef.current = null; wantListenRef.current = false; setListening(false); }
      };
      recRef.current = rec;
      rec.start();
    };

    try {
      begin();
      setListening(true);
      return true;
    } catch {
      recRef.current = null;
      wantListenRef.current = false;
      setListening(false);
      setError("Could not start voice input. Type your answer instead.");
      return false;
    }
  }, [supported, stopListening]);

  useEffect(() => () => {
    wantListenRef.current = false;
    speakTokenRef.current++;
    try { recRef.current?.abort(); } catch { /* nothing to stop */ }
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  return { supported, speaking, listening, interim, error, speak, cancelSpeech, startListening, stopListening };
}
