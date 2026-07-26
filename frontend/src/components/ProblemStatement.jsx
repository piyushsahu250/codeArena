import { useState } from "react";

// Shared student-facing problem-statement renderer — the read-side counterpart to
// ProblemStatementFields.jsx. Used by every coding surface (formal Tests, Module Coding Tests,
// Learning Module practice, Mock Interview coding, and Daily/Weekly Challenges) so a student sees
// the same structure and section order everywhere, per the platform-wide-consistency requirement.
//
// Every field is optional and simply omitted from render when absent — a legacy or
// not-yet-backfilled question with only title/description/testCases still renders correctly, it
// just has fewer sections. `question` accepts the shape any of this platform's sanitizeQuestion()
// functions already return (title, description/prompt, difficulty, tags, estimatedTimeMin,
// realWorldScenario, constraints, inputFormat, outputFormat, notes, edgeCases,
// problemExplanation, hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
// testCases: [{input, expected, explanation}] — visible cases only).
//
// hints/editorial/similarQuestions are omitted entirely (not just empty) by the sanitizers used
// for proctored Formal Tests and Module Coding Assessments — see tests.js's explicit `select` and
// moduleCoding.js's sanitizeQuestion() — so this component needs no awareness of "formal" vs
// "practice" context itself; it only ever renders what the backend actually sent.
export default function ProblemStatement({ question }) {
  const q = question || {};
  const description = q.description ?? q.prompt ?? "";
  const testCases = Array.isArray(q.testCases) ? q.testCases : [];
  const hints = Array.isArray(q.hints) ? q.hints.filter(Boolean) : [];
  const similarQuestions = Array.isArray(q.similarQuestions) ? q.similarQuestions.filter(Boolean) : [];
  const editorial = q.editorial || null;
  const [hintsRevealed, setHintsRevealed] = useState(0);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {q.title && <h2 style={{ fontSize: 20 }}>{q.title}</h2>}
        {q.difficulty && <span className={`badge badge-${String(q.difficulty).toLowerCase()}`}>{q.difficulty}</span>}
        {!q.functionSignature && (
          q.starterCode || q.starterCodeByLanguage ? (
            <span
              className="mono"
              title="Write a complete, runnable program — your own class/main() (or equivalent) that reads input and prints output."
              style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)", color: "var(--ink-dim)", fontWeight: 700 }}
            >
              ▤ Full program — read input, print output yourself
            </span>
          ) : null
        )}
        {q.estimatedTimeMin != null && (
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>⏱ ~{q.estimatedTimeMin} min</span>
        )}
        {q.timeComplexity && <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>Time: {q.timeComplexity}</span>}
        {q.spaceComplexity && <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>Space: {q.spaceComplexity}</span>}
      </div>

      {Array.isArray(q.tags) && q.tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {q.tags.map((t, i) => (
            <span key={i} className="mono" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)", color: "var(--ink-dim)" }}>
              {t}
            </span>
          ))}
        </div>
      )}

      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 14, marginTop: 16 }}>{description}</p>

      {q.realWorldScenario && (
        <div className="card" style={{ padding: 14, marginTop: 16, background: "var(--card-bg, #F7F7F5)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>REAL-WORLD SCENARIO</div>
          <p style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{q.realWorldScenario}</p>
        </div>
      )}

      {q.problemExplanation && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--ink-dim)" }}>📖 Explanation — read this if you're not sure where to start</summary>
          <p style={{ fontSize: 13, marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{q.problemExplanation}</p>
        </details>
      )}

      {(q.inputFormat || q.outputFormat) && (
        <details open style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>INPUT / OUTPUT FORMAT</summary>
          <div style={{ display: "grid", gridTemplateColumns: q.inputFormat && q.outputFormat ? "1fr 1fr" : "1fr", gap: 12, marginTop: 8 }}>
            {q.inputFormat && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-dim)" }}>INPUT</div>
                <p style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{q.inputFormat}</p>
              </div>
            )}
            {q.outputFormat && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-dim)" }}>OUTPUT</div>
                <p style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{q.outputFormat}</p>
              </div>
            )}
          </div>
        </details>
      )}

      {q.constraints && (
        <details open style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>CONSTRAINTS</summary>
          <p className="mono" style={{ fontSize: 12.5, marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{q.constraints}</p>
        </details>
      )}

      {q.edgeCases && (
        <details open style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>EDGE CASES TO CONSIDER</summary>
          <p style={{ fontSize: 13, marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{q.edgeCases}</p>
        </details>
      )}

      {q.notes && (
        <details open style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>NOTES</summary>
          <p style={{ fontSize: 13, marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{q.notes}</p>
        </details>
      )}

      {hints.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>HINTS</div>
          {hints.slice(0, hintsRevealed).map((h, i) => (
            <div key={i} className="card" style={{ padding: 10, marginTop: 8, fontSize: 13 }}>
              <strong>Hint {i + 1}:</strong> <span style={{ whiteSpace: "pre-wrap" }}>{h}</span>
            </div>
          ))}
          {hintsRevealed < hints.length && (
            <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => setHintsRevealed((n) => n + 1)}>
              Show hint {hintsRevealed + 1} of {hints.length}
            </button>
          )}
        </div>
      )}

      {testCases.length > 0 && (
        <details open style={{ marginTop: 24 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>SAMPLE TEST CASES</summary>
          <div style={{ marginTop: 8 }}>
            {testCases.map((tc, i) => (
              <div key={i} className="card" style={{ padding: 12, marginTop: 8, fontSize: 13 }}>
                <div className="mono"><strong>Input:</strong> {tc.input}</div>
                <div className="mono"><strong>Expected:</strong> {tc.expected}</div>
                {tc.explanation && <div style={{ marginTop: 6, color: "var(--ink-dim)" }}>{tc.explanation}</div>}
              </div>
            ))}
          </div>
        </details>
      )}

      {editorial && (editorial.bruteForce?.approach || editorial.betterApproach?.approach || editorial.optimal?.approach) && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--ink-dim)" }}>💡 Editorial (spoilers — reveals the solution approach)</summary>
          <div style={{ marginTop: 10 }}>
            {[
              ["Brute force", editorial.bruteForce],
              ["Better approach", editorial.betterApproach],
              ["Optimal approach", editorial.optimal],
            ].map(([label, approach]) => approach?.approach && (
              <div key={label} style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{label}{approach.complexity ? ` — ${approach.complexity}` : ""}</div>
                <p style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{approach.approach}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      {similarQuestions.length > 0 && (
        <details open style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>SIMILAR QUESTIONS</summary>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {similarQuestions.map((s, i) => (
              <span key={i} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)" }}>{s}</span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
