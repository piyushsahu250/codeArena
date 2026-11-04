import { useEffect, useState } from "react";
import { formatClock } from "../../utils/examClock";
import { doneLine, headline, positionOf, sectionFacts, sectionNotes, sectionProgress, unitWord } from "../../utils/sectionBreak";

// The screen between two sections (and before the first, and after the last): where the student stands in the examination, what the next section is, the rules that apply to it, and
// one clear button. The server decides what may be opened; this page only describes it and calls `onOpen` / `onSubmit`.
export default function ExamSectionBreak({ sections, next, busy, onOpen, onSubmit, overallLeft }) {
  const progress = sectionProgress(sections);
  const hasCompleted = progress.done > 0;
  const allDone = !next && progress.total > 0 && progress.done === progress.total;
  const pos = next ? positionOf(sections, next.key) : null;
  // The bar grows from empty on arrival, so finishing a section is felt, not just read.
  const [fill, setFill] = useState(0);
  // The rules are open on a large screen; on a phone they start folded so the button is on the first screen (one tap opens them).
  const [notesOpen, setNotesOpen] = useState(() => typeof window === "undefined" || !window.matchMedia || window.matchMedia("(min-width: 641px)").matches);
  useEffect(() => { const t = setTimeout(() => setFill(progress.percent), 60); return () => clearTimeout(t); }, [progress.percent]);

  return (
    <div className="ex-break">
      <section className="ex-card ex-hero" aria-labelledby="ex-break-title">
        <p className="ex-eyebrow">{hasCompleted ? `${progress.done} of ${progress.total} sections complete` : pos ? `Section ${pos.n} of ${pos.of}` : "Examination"}</p>
        <h2 id="ex-break-title">{headline(sections, hasCompleted)}</h2>

        {allDone ? (
          <>
            <p className="ex-lead">Every section has been submitted. Review the list on the right, then submit the examination to finish. After this you cannot change anything.</p>
            <div className="ex-cta">
              <button className="btn btn-primary ex-go" disabled={busy} onClick={onSubmit}>Submit examination</button>
            </div>
          </>
        ) : next ? (
          <>
            <p className="ex-lead">{hasCompleted ? "Up next" : "First up"}: <strong>{next.label}</strong></p>
            <dl className="ex-facts">
              {sectionFacts(next).map((f) => (
                <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
              ))}
            </dl>
            {next.instructions && <blockquote className="ex-instr">{next.instructions}</blockquote>}
            <details className="ex-notes" open={notesOpen} onToggle={(e) => setNotesOpen(e.currentTarget.open)}>
              <summary>Before you open it</summary>
              <ul>{sectionNotes(next).map((n) => <li key={n}>{n}</li>)}</ul>
            </details>
            <div className="ex-cta">
              <button className="btn btn-primary ex-go" disabled={busy} onClick={() => onOpen(next.key)} aria-describedby="ex-cta-hint">
                {busy ? "Opening…" : `Open ${next.label}`}<span aria-hidden="true" className="ex-arrow"> →</span>
              </button>
              <span id="ex-cta-hint" className="ex-sub">{next.durationMin ? "The section timer starts when you open it." : "Nothing starts until you press the button."}</span>
            </div>
          </>
        ) : <p className="ex-lead ex-muted">Updating…</p>}
      </section>

      <aside className="ex-card ex-side" aria-label="Your progress">
        <div className="ex-side-head">
          <strong>Your progress</strong>
          <span className="ex-sub">{progress.done} of {progress.total} done</span>
        </div>
        <div className="ex-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label="Sections completed"><div className="ex-meter-fill" style={{ width: `${fill}%` }} /></div>
        <ol className="ex-track">
          {sections.map((s, i) => {
            const state = s.status === "COMPLETED" ? "done" : s.status === "IN_PROGRESS" ? "open" : next && s.key === next.key ? "next" : "later";
            return (
              <li key={s.key} className={`ex-track-item ${state}`} aria-current={state === "next" || state === "open" ? "step" : undefined}>
                <span className="ex-track-dot" aria-hidden="true">{state === "done" ? "✓" : "ABCD"[i]}</span>
                <span className="ex-track-body">
                  <span className="ex-track-name">{s.label}</span>
                  <span className="ex-track-meta">
                    {state === "done" ? doneLine(s) : `${s.questionCount} ${unitWord(s.key, s.questionCount)} · ${s.maxMarks} marks${s.durationMin ? ` · ${s.durationMin} min` : ""}`}
                  </span>
                </span>
                <span className="ex-track-tag">{state === "done" ? "Done" : state === "next" ? "Up next" : state === "open" ? "Open" : "Later"}</span>
              </li>
            );
          })}
        </ol>
        {overallLeft !== null && overallLeft !== undefined && (
          <div className="ex-clock"><span className="ex-sub">Time left in the examination</span><strong>{formatClock(overallLeft)}</strong></div>
        )}
      </aside>
    </div>
  );
}
