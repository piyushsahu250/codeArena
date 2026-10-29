import { useCallback, useEffect, useRef, useState } from "react";
import { createDictationEngine, DICT, canStartFrom, isBusy } from "../utils/dictationEngine";
import { SPEECH_LANG, getSpeechRecognitionCtor } from "../utils/browserSpeech";

// React wrapper around utils/dictationEngine.js. The engine is created once per mounted page (not on every render) and its callbacks read the latest props through
// refs, so a re-render never recreates recognition or its listeners. Unmounting aborts any running recognition.
//   onCommit(questionId, text): a FINAL phrase for the question the recording was started on. Apply it with a functional state update on that question's draft.
export function useAnswerDictation({ lang = SPEECH_LANG, onCommit }) {
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const engineRef = useRef(null);
  const [snapshot, setSnapshot] = useState({ status: DICT.IDLE, interim: "", message: null, notice: null, questionId: null, startedAt: null, commitCount: 0 });
  const [elapsedSec, setElapsedSec] = useState(0);
  const [supported, setSupported] = useState(() => typeof window !== "undefined" && !!getSpeechRecognitionCtor(window) && window.isSecureContext !== false);

  useEffect(() => {
    const engine = createDictationEngine({ lang, onCommit: (qid, text) => onCommitRef.current?.(qid, text), onChange: setSnapshot });
    engineRef.current = engine;
    setSupported(engine.isSupported());
    return () => { engine.dispose(); engineRef.current = null; };
  }, [lang]);

  // Recording duration, ticking only while recording.
  useEffect(() => {
    if (snapshot.status !== DICT.RECORDING || !snapshot.startedAt) { setElapsedSec(0); return undefined; }
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [snapshot.status, snapshot.startedAt]);

  const start = useCallback((questionId) => engineRef.current?.start(questionId) ?? Promise.resolve(false), []);
  const stop = useCallback(() => engineRef.current?.stop() ?? Promise.resolve(), []);
  const cancel = useCallback(() => engineRef.current?.cancel(), []);

  return {
    ...snapshot,
    supported,
    elapsedSec,
    recording: snapshot.status === DICT.RECORDING,
    busy: isBusy(snapshot.status),
    canStart: canStartFrom(snapshot.status),
    start, stop, cancel,
  };
}
