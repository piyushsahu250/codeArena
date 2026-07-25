import { useEffect, useState } from "react";
import api from "../api";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontFamily: "var(--font-body)" };

const SIGNATURE_TYPES = ["int", "long", "double", "boolean", "string", "int[]", "long[]", "double[]", "string[]", "boolean[]"];
const PREVIEW_LANGUAGES = [
  { id: "java", label: "Java" }, { id: "python", label: "Python" },
  { id: "cpp", label: "C++" }, { id: "javascript", label: "JavaScript" }, { id: "c", label: "C" },
];

export const EMPTY_SIGNATURE = { methodName: "", returnType: "int", params: [{ name: "", type: "int" }] };

// Shared STDIO/FUNCTION evaluation-type picker + LeetCode-style function-signature builder,
// extracted from CreateQuestion.jsx so InterviewAdmin.jsx and LearningManagement.jsx's
// PracticeQuestionsPanel get the exact same "write a Solution.method(), no Scanner boilerplate"
// authoring experience formal Tests already had — this is what actually fixes questions like
// "Best Time to Buy and Sell Stock" showing a raw Scanner template once an admin switches them
// (or authors new ones) in Function-based mode.
//
// `evaluationType`/`onEvaluationTypeChange`: "STDIO" | "FUNCTION".
// `signature`/`onSignatureChange`: the {methodName, returnType, params} object (only meaningful
// in FUNCTION mode — caller owns this state so it survives evaluationType toggling).
// `starterCode`/`onStarterCodeChange`: the legacy single starter-code textarea, shown in STDIO
// mode only.
export default function EvaluationTypeFields({ evaluationType, onEvaluationTypeChange, signature, onSignatureChange, starterCode, onStarterCodeChange }) {
  const [preview, setPreview] = useState(null);
  const [previewLang, setPreviewLang] = useState("java");
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (evaluationType !== "FUNCTION" || !signature?.methodName) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api.post("/questions/preview-starter-code", { functionSignature: signature })
        .then((res) => { setPreview(res.data); setPreviewError(""); })
        .catch((err) => { setPreview(null); setPreviewError(err.response?.data?.error || "Invalid signature"); });
    }, 400);
    return () => clearTimeout(t);
  }, [evaluationType, signature]);

  function addParam() {
    onSignatureChange({ ...signature, params: [...signature.params, { name: "", type: "int" }] });
  }
  function updateParam(idx, field, value) {
    const params = [...signature.params];
    params[idx] = { ...params[idx], [field]: value };
    onSignatureChange({ ...signature, params });
  }
  function removeParam(idx) {
    onSignatureChange({ ...signature, params: signature.params.filter((_, i) => i !== idx) });
  }

  return (
    <div>
      <div style={{ marginTop: 20, fontWeight: 700, fontSize: 14 }}>Evaluation Type</div>
      <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
        Function-based: the student fills in a method body matching a signature you define here (like
        LeetCode) — the platform generates the starter code and the stdin-parsing/method-invocation driver
        automatically. A student can also submit their own complete program instead (it's graded directly
        against the same test cases, no driver involved) — both shapes of submission are accepted. Full
        Program: the student's submitted code is always the whole program, reading stdin and writing stdout
        themselves.
      </p>
      <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="radio" name="evalType" checked={evaluationType === "STDIO"} onChange={() => onEvaluationTypeChange("STDIO")} /> Full Program
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="radio" name="evalType" checked={evaluationType === "FUNCTION"} onChange={() => onEvaluationTypeChange("FUNCTION")} /> Function-based
        </label>
      </div>

      {evaluationType === "FUNCTION" ? (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Method name</label>
              <input style={inputStyle} value={signature.methodName} onChange={(e) => onSignatureChange({ ...signature, methodName: e.target.value })} placeholder="twoSum" />
            </div>
            <div>
              <label style={labelStyle}>Return type</label>
              <select style={inputStyle} value={signature.returnType} onChange={(e) => onSignatureChange({ ...signature, returnType: e.target.value })}>
                {SIGNATURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Parameters</div>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={addParam}>+ Add parameter</button>
          </div>
          {signature.params.map((p, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
              <input style={{ ...inputStyle, marginTop: 0 }} value={p.name} onChange={(e) => updateParam(idx, "name", e.target.value)} placeholder="nums" />
              <select style={{ ...inputStyle, marginTop: 0 }} value={p.type} onChange={(e) => updateParam(idx, "type", e.target.value)}>
                {SIGNATURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {signature.params.length > 0 && (
                <button type="button" onClick={() => removeParam(idx)} style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }}>Remove</button>
              )}
            </div>
          ))}

          {previewError && <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 10 }}>{previewError}</p>}
          {preview && (
            <>
              <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {preview.supportedLanguages.map((l) => (
                  <button
                    type="button"
                    key={l}
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "3px 8px", fontWeight: previewLang === l ? 700 : 400 }}
                    onClick={() => setPreviewLang(l)}
                  >
                    {PREVIEW_LANGUAGES.find((pl) => pl.id === l)?.label || l}
                  </button>
                ))}
              </div>
              <pre className="mono" style={{ fontSize: 12, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginTop: 8, overflowX: "auto", whiteSpace: "pre-wrap" }}>
                {preview.starterCodeByLanguage[previewLang] || "(not available in this language)"}
              </pre>
              <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 6 }}>
                This is exactly what the student sees as starter code — generated automatically, saved when
                you save this question. C isn't offered for signatures using array types.
              </p>
            </>
          )}

          <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 12 }}>
            Test case format below: one line per parameter in order (arrays as space-separated values on
            their own line), and the expected output on one line the same way. Example for
            twoSum(int[] nums, int target) → 2 sample lines: <span className="mono">"2 7 11 15\n9"</span> with
            expected <span className="mono">"0 1"</span>.
          </p>
        </div>
      ) : (
        <>
          <label style={labelStyle}>Starter code (optional)</label>
          <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: "var(--font-mono)" }} value={starterCode || ""} onChange={(e) => onStarterCodeChange(e.target.value)} />
        </>
      )}
    </div>
  );
}
