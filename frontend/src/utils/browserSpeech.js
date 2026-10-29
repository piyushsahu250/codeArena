// Pure helpers for the browser-voice AI interview (no DOM access except through the `win` argument, so they run under plain Node in
// scripts/browserSpeechRegression.mjs). The interview reads each question aloud with the browser's speechSynthesis and turns the
// student's speech into text with the browser's SpeechRecognition: no API key, no server call and no provider quota. English only.

export const SPEECH_LANG = "en-IN";

export function getSpeechRecognitionCtor(win) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

export function isBrowserVoiceSupported(win) {
  return !!(getSpeechRecognitionCtor(win) && win?.speechSynthesis && typeof win?.SpeechSynthesisUtterance === "function");
}

// Prefers Indian English, then British, then US, then any other English voice. Returns null when the device has no English voice
// (the caller then lets the browser pick its default, or skips speaking and shows the text).
export function pickEnglishVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];
  const order = ["en-in", "en-gb", "en-us"];
  const lang = (v) => String(v?.lang || "").toLowerCase().replace("_", "-");
  for (const wanted of order) {
    const hit = list.find((v) => lang(v) === wanted);
    if (hit) return hit;
  }
  return list.find((v) => lang(v).startsWith("en")) || null;
}

// Strips what sounds wrong when read aloud (markdown markers, code fences, URLs) and collapses whitespace.
export function cleanForSpeech(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " code omitted. ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[*_#>~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Chrome stops a single long utterance after roughly 15 seconds, so a long question is spoken as several sentence-sized chunks.
export function splitForSpeech(text, maxLen = 180) {
  const clean = cleanForSpeech(text);
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
  const chunks = [];
  let current = "";
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length > maxLen) {
      if (current) { chunks.push(current); current = ""; }
      const words = s.split(" ");
      let part = "";
      for (const w of words) {
        if (part && (part + " " + w).length > maxLen) { chunks.push(part); part = w; } else part = part ? part + " " + w : w;
      }
      if (part) chunks.push(part);
    } else if (current && (current + " " + s).length > maxLen) {
      chunks.push(current);
      current = s;
    } else {
      current = current ? current + " " + s : s;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Appends recognised speech to what is already in the answer box with exactly one space between them.
export function mergeTranscript(base, addition) {
  const a = String(base ?? "").replace(/\s+$/, "");
  const b = String(addition ?? "").trim();
  if (!b) return a;
  return a ? `${a} ${b}` : b;
}

// Maps a SpeechRecognition error code to { fatal, message }. no-speech and aborted are normal pauses; everything else stops the
// microphone and tells the student to type instead.
export function describeRecognitionError(code) {
  switch (code) {
    case "no-speech":
    case "aborted":
      return { fatal: false, message: null };
    case "not-allowed":
    case "service-not-allowed":
      return { fatal: true, message: "Microphone access is blocked for this page. Allow the microphone in your browser settings, or type your answer instead." };
    case "audio-capture":
      return { fatal: true, message: "No microphone was found. Connect one, or type your answer instead." };
    case "network":
      return { fatal: true, message: "Speech recognition needs an internet connection (your browser's speech service does the listening). Type your answer instead, or reconnect." };
    case "language-not-supported":
      return { fatal: true, message: "This browser cannot recognise English speech. Type your answer instead." };
    default:
      return { fatal: true, message: "Voice input stopped working. Type your answer instead." };
  }
}
