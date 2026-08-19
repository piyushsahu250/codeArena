import { Copy, ArrowUp, ArrowDown } from "lucide-react";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const iconBtnStyle = { background: "none", border: "none", color: "var(--ink-dim)", cursor: "pointer", display: "flex", alignItems: "center", padding: 4 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontFamily: "var(--font-body)" };

// Shared admin-side test-case editor — same per-row shape (input/expected/isHidden/explanation)
// used by CreateQuestion.jsx, LearningManagement.jsx's two coding panels, and InterviewAdmin.jsx
// (which previously used a raw JSON textarea instead of this). Centralizing this is what makes
// "platform-wide consistency" and the shared minVisible/minHidden validation messaging actually
// hold, rather than four independently-drifting copies of the same per-row markup.
export default function TestCasesEditor({
  testCases,
  onChange,
  inputLabel = "Input (stdin)",
  expectedLabel = "Expected stdout",
  inputPlaceholder,
  expectedPlaceholder,
  minVisible = 2,
  minHidden = 10,
}) {
  function updateCase(idx, field, value) {
    const next = [...testCases];
    next[idx] = { ...next[idx], [field]: value };
    onChange(next);
  }
  function addCase(isHidden) {
    onChange([...testCases, { input: "", expected: "", isHidden, explanation: "" }]);
  }
  function removeCase(idx) {
    onChange(testCases.filter((_, i) => i !== idx));
  }
  function duplicateCase(idx) {
    const next = [...testCases];
    next.splice(idx + 1, 0, { ...testCases[idx] });
    onChange(next);
  }
  function moveCase(idx, direction) {
    const target = idx + direction;
    if (target < 0 || target >= testCases.length) return;
    const next = [...testCases];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  const visibleCount = testCases.filter((tc) => !tc.isHidden).length;
  const hiddenCount = testCases.filter((tc) => tc.isHidden).length;
  const meetsMinimum = visibleCount >= minVisible && hiddenCount >= minHidden;

  return (
    <div>
      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Test cases</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => addCase(false)}>+ Add visible case</button>
          <button type="button" className="btn btn-ghost" onClick={() => addCase(true)}>+ Add hidden case</button>
        </div>
      </div>
      <p className="mono" style={{ fontSize: 12, marginTop: 6, color: meetsMinimum ? "var(--mint)" : "var(--rust)", fontWeight: 600 }}>
        {visibleCount} visible / {hiddenCount} hidden — needs at least {minVisible} visible and {minHidden} hidden to save
      </p>

      {testCases.map((tc, idx) => (
        <div key={idx} className="card" style={{ padding: 16, marginTop: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>{inputLabel}</label>
              <textarea style={{ ...inputStyle, fontFamily: "var(--font-mono)", minHeight: 60 }} value={tc.input} onChange={(e) => updateCase(idx, "input", e.target.value)} placeholder={inputPlaceholder} />
            </div>
            <div>
              <label style={labelStyle}>{expectedLabel}</label>
              <textarea style={{ ...inputStyle, fontFamily: "var(--font-mono)", minHeight: 60 }} value={tc.expected} onChange={(e) => updateCase(idx, "expected", e.target.value)} placeholder={expectedPlaceholder} />
            </div>
          </div>
          {!tc.isHidden && (
            <>
              <label style={{ ...labelStyle, marginTop: 8 }}>Explanation (optional, shown to students alongside this sample)</label>
              <input style={inputStyle} value={tc.explanation || ""} onChange={(e) => updateCase(idx, "explanation", e.target.value)} />
            </>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={tc.isHidden} onChange={(e) => updateCase(idx, "isHidden", e.target.checked)} />
              Hidden (not shown to students as a sample)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button type="button" title="Move up" onClick={() => moveCase(idx, -1)} disabled={idx === 0} style={{ ...iconBtnStyle, opacity: idx === 0 ? 0.35 : 1 }}>
                <ArrowUp size={15} />
              </button>
              <button type="button" title="Move down" onClick={() => moveCase(idx, 1)} disabled={idx === testCases.length - 1} style={{ ...iconBtnStyle, opacity: idx === testCases.length - 1 ? 0.35 : 1 }}>
                <ArrowDown size={15} />
              </button>
              <button type="button" title="Duplicate" onClick={() => duplicateCase(idx)} style={iconBtnStyle}>
                <Copy size={15} />
              </button>
              {testCases.length > 1 && (
                <button type="button" onClick={() => removeCase(idx)} style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13, marginLeft: 6 }}>Remove</button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
