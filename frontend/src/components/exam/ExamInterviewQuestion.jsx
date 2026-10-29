import { Mic, Square } from "lucide-react";
import { DICT } from "../../utils/dictationEngine";

// One AI Mock Interview question inside the examination: typed answer, optionally dictated with the browser's free speech-to-text. The words are transcribed into the same box and
// stay editable; what is saved and evaluated is the text. Dictation is an input method, it never replaces the text and nothing is uploaded.
export default function ExamInterviewQuestion({ item, number, total, payload, onChange, disabled, speechAllowed, dictation }) {
  const text = payload?.text || "";
  const here = dictation && dictation.questionId === item.id;
  const retryable = here && [DICT.PERMISSION_DENIED, DICT.DEVICE_UNAVAILABLE, DICT.RECOGNITION_ERROR, DICT.NETWORK_ERROR, DICT.RECOVERY_REQUIRED].includes(dictation.status);
  return (
    <div className="ex-q">
      <div className="ex-row between"><span className="ex-muted mono">Question {number} of {total}</span>{item.category && <span className="ex-chip">{item.category}</span>}</div>
      <div className="ex-q-text">{item.text}</div>
      <textarea
        className="ex-textarea" aria-label={`Your answer to question ${number}`} value={text} disabled={disabled} maxLength={8000} placeholder="Type your answer here…"
        onChange={(e) => onChange({ text: e.target.value, input: payload?.input === "SPEECH" ? "SPEECH" : "TYPED" })}
        onPaste={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}
      />
      <div className="ex-row between" style={{ marginTop: 8 }}>
        <span className="ex-muted" style={{ fontSize: 12 }}>{text.trim() ? `${text.trim().split(/\s+/).length} words` : "Not answered yet"}</span>
        {speechAllowed && dictation && (
          <div className="ex-row">
            {here && dictation.recording
              ? <button type="button" className="btn btn-ghost" onClick={() => dictation.stop()}><Square size={14} aria-hidden="true" /> Stop recording</button>
              : <button type="button" className="btn btn-ghost" disabled={disabled || !dictation.supported || dictation.busy || !dictation.canStart} onClick={() => dictation.start(item.id)}><Mic size={14} aria-hidden="true" /> {retryable ? "Try again" : "Speak your answer"}</button>}
            {here && dictation.recording && <span className="mono" aria-live="polite">● Listening… {String(Math.floor(dictation.elapsedSec / 60)).padStart(2, "0")}:{String(dictation.elapsedSec % 60).padStart(2, "0")}</span>}
          </div>
        )}
      </div>
      {speechAllowed && dictation && !dictation.supported && <p className="ex-sub">Speech-to-text is not available in this browser. Please type your answer.</p>}
      {here && dictation.message && <p className="ex-notice warn" role="status">{dictation.message}</p>}
      {here && dictation.interim && <p className="ex-sub" aria-live="polite">{dictation.interim}</p>}
    </div>
  );
}
