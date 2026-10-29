// Speech-to-text ("Record answer") engine for typed interview answers. Framework-free (everything it touches is injected), so scripts/dictationRegression.mjs
// runs every rule below under plain Node with a fake SpeechRecognition. The React hook (hooks/useAnswerDictation.js) is a thin wrapper around it.
//
// What the old inline implementation got wrong (InterviewSession.jsx toggleRecording, confirmed by reading it):
//  - it appended to `draft.answerText` captured when recording STARTED, so every later phrase replaced the earlier ones and anything typed meanwhile was lost;
//  - the text went to whichever question's updateDraft the closure had captured, and recognition kept running after the student moved to another question;
//  - nothing stopped recognition on unmount or when the session ended;
//  - there was no onerror: a blocked microphone, a lost connection or an unsupported engine looked like "nothing happened" (or an alert());
//  - recognition ended by itself after silence and the button silently went back to "Record";
//  - "Next" could save before the last words arrived, so the evaluated answer lacked them.
//
// Rules implemented here:
//  - ONE recognition session at a time; the lifecycle is a checked state machine (invalid transitions are ignored, never applied);
//  - only FINAL results are committed, each exactly once (by result position inside one recognition instance); interim text is shown, never saved;
//  - a commit is delivered as onCommit(questionId, text) for the question the recording was STARTED on, so a late result can never land in another question;
//  - recognition runs one phrase at a time (continuous = false) and is restarted when it ends by itself, with a guard against a restart loop;
//  - stop() resolves only after the last words have been delivered (or a short grace period), so callers can save the finished text;
//  - every failure ends in a named state with an accurate message, and the committed text is never discarded;
//  - dispose()/cancel() abort the engine and drop every timer.
import { describeRecognitionError, getSpeechRecognitionCtor, SPEECH_LANG } from "./browserSpeech.js";

export const DICT = Object.freeze({
  IDLE: "IDLE",
  REQUESTING_PERMISSION: "REQUESTING_PERMISSION",
  READY: "READY",
  RECORDING: "RECORDING",
  PROCESSING_TRANSCRIPT: "PROCESSING_TRANSCRIPT",
  TRANSCRIPT_READY: "TRANSCRIPT_READY",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNSUPPORTED: "UNSUPPORTED",
  DEVICE_UNAVAILABLE: "DEVICE_UNAVAILABLE",
  RECOGNITION_ERROR: "RECOGNITION_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
});

export const ERROR_STATES = Object.freeze([DICT.PERMISSION_DENIED, DICT.UNSUPPORTED, DICT.DEVICE_UNAVAILABLE, DICT.RECOGNITION_ERROR, DICT.NETWORK_ERROR, DICT.RECOVERY_REQUIRED]);
const FAILURES_FROM_ACTIVE = [DICT.PERMISSION_DENIED, DICT.DEVICE_UNAVAILABLE, DICT.RECOGNITION_ERROR, DICT.NETWORK_ERROR];

export const TRANSITIONS = Object.freeze({
  [DICT.IDLE]: [DICT.REQUESTING_PERMISSION, DICT.UNSUPPORTED],
  [DICT.REQUESTING_PERMISSION]: [DICT.READY, DICT.UNSUPPORTED, DICT.IDLE, ...FAILURES_FROM_ACTIVE],
  [DICT.READY]: [DICT.RECORDING, DICT.IDLE, ...FAILURES_FROM_ACTIVE],
  [DICT.RECORDING]: [DICT.PROCESSING_TRANSCRIPT, DICT.IDLE, DICT.RECOVERY_REQUIRED, ...FAILURES_FROM_ACTIVE],
  [DICT.PROCESSING_TRANSCRIPT]: [DICT.TRANSCRIPT_READY, DICT.IDLE, DICT.RECOGNITION_ERROR, DICT.NETWORK_ERROR],
  [DICT.TRANSCRIPT_READY]: [DICT.IDLE, DICT.REQUESTING_PERMISSION],
  [DICT.PERMISSION_DENIED]: [DICT.REQUESTING_PERMISSION, DICT.IDLE],
  [DICT.UNSUPPORTED]: [DICT.IDLE],
  [DICT.DEVICE_UNAVAILABLE]: [DICT.REQUESTING_PERMISSION, DICT.IDLE],
  [DICT.RECOGNITION_ERROR]: [DICT.REQUESTING_PERMISSION, DICT.IDLE],
  [DICT.NETWORK_ERROR]: [DICT.REQUESTING_PERMISSION, DICT.IDLE],
  [DICT.RECOVERY_REQUIRED]: [DICT.REQUESTING_PERMISSION, DICT.IDLE],
});

export function canTransition(from, to) {
  return from !== to && (TRANSITIONS[from] || []).includes(to);
}

// A state a new recording may start from (not one of the three that mean "a session is running or finishing").
export function canStartFrom(status) {
  return ![DICT.REQUESTING_PERMISSION, DICT.READY, DICT.RECORDING, DICT.PROCESSING_TRANSCRIPT].includes(status);
}

// States in which the page should hold the Previous / Next / Skip controls: the microphone is being acquired or the last words are being collected.
export function isBusy(status) {
  return status === DICT.REQUESTING_PERMISSION || status === DICT.READY || status === DICT.PROCESSING_TRANSCRIPT;
}

export const MESSAGES = Object.freeze({
  PERMISSION_DENIED: "Microphone access is blocked. Allow microphone access in your browser settings and try again.",
  UNSUPPORTED: "Speech recognition is not supported in this browser. Please use a supported browser such as Chrome or Edge, or type your answer instead.",
  UNSUPPORTED_INSECURE: "Speech recognition needs a secure (HTTPS) connection. Please open the interview on its official address, or type your answer instead.",
  DEVICE_UNAVAILABLE: "No working microphone was found, or another application is using it. Check your microphone and try again.",
  RECOGNITION_ERROR: "Speech recognition is temporarily unavailable. Your existing answer has been preserved.",
  NETWORK_ERROR: "Speech recognition lost its internet connection. Your existing answer has been preserved.",
  RECOVERY_REQUIRED: "Voice input keeps stopping on this device. Your answer so far has been preserved. Try again, or type your answer instead.",
  NO_SPEECH: "No speech was recognized. Please check your microphone and try again.",
  READY: "Transcription ready. Please review your answer.",
});

function statusForRecognitionError(code) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed": return DICT.PERMISSION_DENIED;
    case "audio-capture": return DICT.DEVICE_UNAVAILABLE;
    case "network": return DICT.NETWORK_ERROR;
    case "language-not-supported": return DICT.UNSUPPORTED;
    default: return DICT.RECOGNITION_ERROR;
  }
}

async function defaultQueryMicPermission() {
  try {
    const status = await globalThis.navigator?.permissions?.query({ name: "microphone" });
    return status?.state || "unknown"; // granted | denied | prompt (Safari and Firefox do not support this query: "unknown", and the browser itself asks)
  } catch {
    return "unknown";
  }
}

export function createDictationEngine({
  getCtor = () => getSpeechRecognitionCtor(globalThis.window),
  lang = SPEECH_LANG,
  onCommit = () => {},
  onChange = () => {},
  isSecureContext = () => globalThis.window?.isSecureContext !== false,
  queryMicPermission = defaultQueryMicPermission,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  maxRapidRestarts = 5,
  rapidWindowMs = 3000,
  stopGraceMs = 1500,
  duplicateAcrossRestartMs = 1500,
} = {}) {
  let state = { status: DICT.IDLE, interim: "", message: null, notice: null, questionId: null, startedAt: null, commitCount: 0 };
  let rec = null;            // the live recognition instance (only its own handlers may act)
  let want = false;          // keep recognising: restart when an instance ends by itself
  let instanceCommitted = 0; // how many results of the CURRENT instance were already committed
  let restarts = [];
  let stopTimer = null;
  let stopWaiters = [];
  let startToken = 0;        // bumped by every start/cancel so a start that was waiting for the permission query notices it was cancelled
  let lastCommit = { text: "", at: 0, instance: 0 };
  let instanceSeq = 0;
  let disposed = false;

  function emit() { if (!disposed) onChange({ ...state }); }
  function to(status, extra = {}) {
    if (status !== state.status && !canTransition(state.status, status)) return false; // invalid transition: ignored, never applied
    state = { ...state, ...extra, status };
    emit();
    return true;
  }
  function patch(extra) { state = { ...state, ...extra }; emit(); }

  function release(instance) {
    if (!instance) return;
    instance.onstart = instance.onresult = instance.onerror = instance.onend = null;
    try { instance.abort(); } catch { /* already stopped */ }
  }
  function resolveStopWaiters() {
    clearTimer(stopTimer);
    stopTimer = null;
    const waiters = stopWaiters;
    stopWaiters = [];
    for (const w of waiters) w();
  }

  function commit(rawText, instanceId) {
    const text = String(rawText ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;
    // The same phrase re-delivered by the NEXT instance right after a restart (some engines replay the last result) is the same words, not new ones.
    if (instanceId !== lastCommit.instance && text.toLowerCase() === lastCommit.text.toLowerCase() && now() - lastCommit.at < duplicateAcrossRestartMs) return;
    lastCommit = { text, at: now(), instance: instanceId };
    state = { ...state, commitCount: state.commitCount + 1 };
    // The page's callback must never be able to break recognition: an exception there is logged, and the engine carries on with the next phrase.
    try { onCommit(state.questionId, text); } catch (err) { console.error("[dictation] onCommit failed:", err); }
  }

  function fail(status, message) {
    want = false;
    clearTimer(stopTimer);
    release(rec);
    rec = null;
    // A failure can arise in any state, so it is applied even where the normal flow would not allow that step (otherwise a failure while finishing would leave the page "busy" for good).
    if (!to(status, { message, interim: "", notice: null })) { state = { ...state, status, message, interim: "", notice: null }; emit(); }
    resolveStopWaiters();
  }

  function finalize() {
    want = false;
    release(rec);
    rec = null;
    if (state.commitCount > 0) to(DICT.TRANSCRIPT_READY, { notice: MESSAGES.READY, message: null, interim: "" });
    else to(DICT.IDLE, { notice: MESSAGES.NO_SPEECH, message: null, interim: "" });
    resolveStopWaiters();
  }

  function begin() {
    const Ctor = getCtor();
    const instance = new Ctor();
    const id = ++instanceSeq;
    rec = instance;
    instanceCommitted = 0;
    instance.lang = lang;
    instance.continuous = false;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onstart = () => {
      if (rec !== instance) return;
      to(DICT.READY);
      to(DICT.RECORDING, state.startedAt ? {} : { startedAt: now() });
    };
    instance.onresult = (e) => {
      if (rec !== instance) return;
      const results = e.results || [];
      // Positions below instanceCommitted were committed already, so a re-delivered event can never add the same words twice.
      while (instanceCommitted < results.length && results[instanceCommitted].isFinal) {
        commit(results[instanceCommitted][0]?.transcript, id);
        instanceCommitted += 1;
      }
      let interim = "";
      for (let i = instanceCommitted; i < results.length; i++) if (!results[i].isFinal) interim += (interim ? " " : "") + (results[i][0]?.transcript || "").trim();
      if (interim !== state.interim) patch({ interim });
    };
    instance.onerror = (e) => {
      if (rec !== instance) return;
      const code = e?.error;
      if (!describeRecognitionError(code).fatal) return; // no-speech / aborted: a normal pause; onend follows and decides
      const status = statusForRecognitionError(code);
      fail(status, status === DICT.UNSUPPORTED ? MESSAGES.UNSUPPORTED : MESSAGES[status]);
    };
    instance.onend = () => {
      if (rec !== instance) return;
      rec = null;
      if (state.status === DICT.PROCESSING_TRANSCRIPT) { finalize(); return; }
      if (state.status === DICT.RECORDING && want) {
        const t = now();
        restarts = [...restarts.filter((x) => t - x < rapidWindowMs), t];
        if (restarts.length > maxRapidRestarts) { fail(DICT.RECOVERY_REQUIRED, MESSAGES.RECOVERY_REQUIRED); return; }
        try { begin(); } catch { fail(DICT.RECOGNITION_ERROR, MESSAGES.RECOGNITION_ERROR); }
        return;
      }
      if (state.status === DICT.REQUESTING_PERMISSION || state.status === DICT.READY) fail(DICT.RECOGNITION_ERROR, MESSAGES.RECOGNITION_ERROR);
    };
    try { instance.start(); } catch { fail(DICT.RECOGNITION_ERROR, MESSAGES.RECOGNITION_ERROR); }
  }

  const api = {
    getState: () => ({ ...state }),
    isSupported() { return !!getCtor() && isSecureContext(); },

    // Starts a recording for `questionId`. Returns true when a recording was started, false when one is already running or the start failed (the state says why).
    async start(questionId) {
      if (disposed || !canStartFrom(state.status)) return false;
      if (state.status !== DICT.IDLE) to(DICT.IDLE, { message: null, notice: null });
      const token = ++startToken;
      if (!getCtor() || !isSecureContext()) {
        to(DICT.UNSUPPORTED, { message: getCtor() ? MESSAGES.UNSUPPORTED_INSECURE : MESSAGES.UNSUPPORTED });
        return false;
      }
      state = { ...state, questionId, interim: "", commitCount: 0, startedAt: null, message: null, notice: null };
      restarts = [];
      lastCommit = { text: "", at: 0, instance: 0 };
      to(DICT.REQUESTING_PERMISSION);
      const permission = await queryMicPermission();
      if (token !== startToken || disposed) return false; // cancelled while the permission query was pending
      if (permission === "denied") { to(DICT.PERMISSION_DENIED, { message: MESSAGES.PERMISSION_DENIED }); return false; }
      want = true;
      begin();
      return state.status !== DICT.RECOGNITION_ERROR;
    },

    // Ends the recording and resolves once the last words were delivered (the engine's own end, or after a short grace period if it never ends).
    stop() {
      if (state.status === DICT.RECORDING) {
        to(DICT.PROCESSING_TRANSCRIPT);
        want = false;
        try { rec?.stop(); } catch { /* ended already */ }
        stopTimer = setTimer(() => { // the engine did not finish in time: keep what was delivered
          if (state.status === DICT.PROCESSING_TRANSCRIPT) finalize();
        }, stopGraceMs);
        return new Promise((resolve) => stopWaiters.push(resolve));
      }
      if (state.status === DICT.PROCESSING_TRANSCRIPT) return new Promise((resolve) => stopWaiters.push(resolve));
      if (state.status === DICT.REQUESTING_PERMISSION || state.status === DICT.READY) api.cancel();
      return Promise.resolve();
    },

    // Drops the current recording without producing a transcript notice (leaving the question, the session ended, the page unmounted). Text already committed stays committed.
    cancel() {
      startToken += 1;
      want = false;
      clearTimer(stopTimer);
      stopTimer = null;
      release(rec);
      rec = null;
      if (state.status !== DICT.IDLE) {
        if (!to(DICT.IDLE, { interim: "", message: null, notice: null })) state = { ...state, status: DICT.IDLE, interim: "", message: null, notice: null };
        emit();
      }
      resolveStopWaiters();
    },

    dispose() {
      disposed = true; // first, so cancelling below does not notify a component that is already unmounted
      api.cancel();
    },
  };
  return api;
}
