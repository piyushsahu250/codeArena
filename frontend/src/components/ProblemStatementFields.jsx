const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontFamily: "var(--font-body)" };
const hintStyle = { fontSize: 11, color: "var(--ink-dim)", marginTop: 2 };
const smallBtnStyle = { padding: "6px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 12, cursor: "pointer" };
const removeBtnStyle = { ...smallBtnStyle, color: "var(--danger, #c0392b)" };

const EMPTY_APPROACH = { approach: "", complexity: "" };

function ApproachFields({ label, value, onChange }) {
  const v = value || EMPTY_APPROACH;
  const approachId = `approach-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div style={{ marginTop: 10 }}>
      <label style={{ ...labelStyle, marginTop: 0 }} htmlFor={approachId}>{label}</label>
      <textarea id={approachId} style={{ ...inputStyle, minHeight: 60 }} value={v.approach || ""} onChange={(e) => onChange({ ...v, approach: e.target.value })} placeholder="Describe the approach..." />
      <input style={{ ...inputStyle, maxWidth: 220, marginTop: 6 }} value={v.complexity || ""} onChange={(e) => onChange({ ...v, complexity: e.target.value })} placeholder="Complexity, e.g. O(n^2)" />
    </div>
  );
}

// Shared "professional problem statement" admin fields — the write-side counterpart to
// ProblemStatement.jsx's read-side rendering. Embedded identically in every coding-question
// admin form (CreateQuestion.jsx, LearningManagement.jsx's two panels, InterviewAdmin.jsx, and
// the Daily/Weekly Challenge scheduling panels) so admins get the same authoring experience
// everywhere, and so no surface silently lacks a field another one has.
//
// `value` is the subset of the question object holding these fields; `onChange(patch)` merges a
// partial update the same way each embedding form's own field setters already work.
export default function ProblemStatementFields({ value, onChange }) {
  const v = value || {};
  function set(field) {
    return (e) => onChange({ [field]: e.target.value });
  }
  const hints = Array.isArray(v.hints) ? v.hints : [];
  function setHint(i, text) {
    const next = [...hints];
    next[i] = text;
    onChange({ hints: next });
  }
  function addHint() {
    onChange({ hints: [...hints, ""] });
  }
  function removeHint(i) {
    onChange({ hints: hints.filter((_, idx) => idx !== i) });
  }
  const similarQuestions = Array.isArray(v.similarQuestions) ? v.similarQuestions : [];
  function setSimilar(i, text) {
    const next = [...similarQuestions];
    next[i] = text;
    onChange({ similarQuestions: next });
  }
  function addSimilar() {
    onChange({ similarQuestions: [...similarQuestions, ""] });
  }
  function removeSimilar(i) {
    onChange({ similarQuestions: similarQuestions.filter((_, idx) => idx !== i) });
  }
  const editorial = v.editorial || {};
  function setApproach(key) {
    return (approachValue) => onChange({ editorial: { ...editorial, [key]: approachValue } });
  }
  return (
    <div>
      <label style={labelStyle} htmlFor="psf-estimated-time-min">Estimated time (minutes, optional)</label>
      <input id="psf-estimated-time-min" type="number" min="1" style={{ ...inputStyle, maxWidth: 160 }} value={v.estimatedTimeMin ?? ""} onChange={(e) => onChange({ estimatedTimeMin: e.target.value ? Number(e.target.value) : null })} />

      <label style={labelStyle} htmlFor="psf-real-world-scenario">Real-world scenario (optional)</label>
      <p style={hintStyle}>A short framing of where this problem shows up in practice — helps students see why it matters before diving in.</p>
      <textarea id="psf-real-world-scenario" style={{ ...inputStyle, minHeight: 60 }} value={v.realWorldScenario || ""} onChange={set("realWorldScenario")} />

      <label style={labelStyle} htmlFor="psf-problem-explanation">Beginner-friendly explanation (optional)</label>
      <p style={hintStyle}>What the problem is really asking, step by step — shown to students before they attempt it, separate from the problem statement itself.</p>
      <textarea id="psf-problem-explanation" style={{ ...inputStyle, minHeight: 90 }} value={v.problemExplanation || ""} onChange={set("problemExplanation")} />

      <label style={labelStyle} htmlFor="psf-constraints">Constraints (optional)</label>
      <textarea id="psf-constraints" style={{ ...inputStyle, minHeight: 60, fontFamily: "var(--font-mono)", fontSize: 13 }} value={v.constraints || ""} onChange={set("constraints")} placeholder={"1 <= n <= 10^5\n-10^9 <= nums[i] <= 10^9"} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle} htmlFor="psf-input-format">Input format (optional)</label>
          <textarea id="psf-input-format" style={{ ...inputStyle, minHeight: 60 }} value={v.inputFormat || ""} onChange={set("inputFormat")} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="psf-output-format">Output format (optional)</label>
          <textarea id="psf-output-format" style={{ ...inputStyle, minHeight: 60 }} value={v.outputFormat || ""} onChange={set("outputFormat")} />
        </div>
      </div>

      <label style={labelStyle} htmlFor="psf-notes">Notes (optional)</label>
      <textarea id="psf-notes" style={{ ...inputStyle, minHeight: 50 }} value={v.notes || ""} onChange={set("notes")} />

      <label style={labelStyle} htmlFor="psf-edge-cases">Edge cases to consider (optional)</label>
      <p style={hintStyle}>Called out for students, not test-case data — e.g. "empty input", "all duplicate values", "n = 1".</p>
      <textarea id="psf-edge-cases" style={{ ...inputStyle, minHeight: 60 }} value={v.edgeCases || ""} onChange={set("edgeCases")} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle} htmlFor="psf-time-complexity">Time complexity (optional)</label>
          <input id="psf-time-complexity" style={inputStyle} value={v.timeComplexity || ""} onChange={set("timeComplexity")} placeholder="O(n)" />
        </div>
        <div>
          <label style={labelStyle} htmlFor="psf-space-complexity">Space complexity (optional)</label>
          <input id="psf-space-complexity" style={inputStyle} value={v.spaceComplexity || ""} onChange={set("spaceComplexity")} placeholder="O(1)" />
        </div>
      </div>

      <label style={labelStyle}>Hints (optional)</label>
      <p style={hintStyle}>Shown to students one at a time, on request — never in a proctored Formal Test or Module Coding Assessment. Order from vaguest to most specific.</p>
      {hints.map((h, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input style={inputStyle} value={h} onChange={(e) => setHint(i, e.target.value)} placeholder={`Hint ${i + 1}`} />
          <button type="button" style={removeBtnStyle} onClick={() => removeHint(i)}>Remove</button>
        </div>
      ))}
      <button type="button" style={smallBtnStyle} onClick={addHint}>+ Add hint</button>

      <label style={labelStyle}>Editorial (optional)</label>
      <p style={hintStyle}>Shown to students after they choose to view it — never in a proctored Formal Test or Module Coding Assessment.</p>
      <ApproachFields label="Brute force" value={editorial.bruteForce} onChange={setApproach("bruteForce")} />
      <ApproachFields label="Better approach" value={editorial.betterApproach} onChange={setApproach("betterApproach")} />
      <ApproachFields label="Optimal approach" value={editorial.optimal} onChange={setApproach("optimal")} />

      <label style={labelStyle}>Similar questions (optional)</label>
      <p style={hintStyle}>Plain titles of related practice problems — not linked automatically, just shown as text for students to look up.</p>
      {similarQuestions.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input style={inputStyle} value={s} onChange={(e) => setSimilar(i, e.target.value)} placeholder="e.g. Two Sum" />
          <button type="button" style={removeBtnStyle} onClick={() => removeSimilar(i)}>Remove</button>
        </div>
      ))}
      <button type="button" style={smallBtnStyle} onClick={addSimilar}>+ Add similar question</button>
    </div>
  );
}
