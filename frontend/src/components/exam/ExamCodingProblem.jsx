import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import api from "../../api";
import ProblemStatement from "../ProblemStatement";
import CodeResultBlock from "../CodeResultBlock";
import { CODE_LANGUAGES, defaultStarter, supportedLanguages } from "../../utils/codeEditorDefaults";
import { examErrorMessage } from "../../utils/examProgress";
import { useTheme } from "../../context/ThemeContext";

// One coding problem inside the examination. The code is autosaved through the same versioned saver as every other answer; Run uses the sample cases only and stores nothing;
// Submit is graded by the judge on the hidden cases. A judge that is busy or down leaves the submission PENDING for a retry later: it is never turned into a wrong answer.
export default function ExamCodingProblem({ attemptId, item, number, total, payload, evaluation, allowedLanguages, maxSubmissions, onChange, disabled, flushAnswer }) {
  const { theme } = useTheme?.() || {};
  const languages = useMemo(() => {
    const base = supportedLanguages({ evaluationType: item.evaluationType, starterCodeByLanguage: item.starterCodeByLanguage });
    const allow = (allowedLanguages && allowedLanguages.length ? allowedLanguages : item.languages) || null;
    const list = allow ? base.filter((l) => allow.includes(l.id)) : base;
    return list.length ? list : CODE_LANGUAGES;
  }, [item, allowedLanguages]);
  const language = payload?.language && languages.some((l) => l.id === payload.language) ? payload.language : languages[0].id;
  const starter = item.starterCodeByLanguage?.[language] || (language === languages[0].id ? item.starterCode : null) || defaultStarter(language);
  const code = typeof payload?.code === "string" ? payload.code : starter;
  const [run, setRun] = useState(null);
  const [sub, setSub] = useState(evaluation && evaluation.status ? { status: evaluation.status, verdict: evaluation.verdict, passedCases: evaluation.passedCases, totalCases: evaluation.totalCases, errorSummary: evaluation.errorSummary, submissions: evaluation.submissions, pending: evaluation.pending } : null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const used = sub?.submissions || 0;
  const exhausted = !!maxSubmissions && used >= maxSubmissions;
  const base = `/exams/attempts/${attemptId}/items/${item.id}`;

  async function call(kind) {
    if (busy || disabled) return;
    setBusy(kind); setError(null);
    try {
      await flushAnswer?.(item.id); // the judge works on what the server holds; make sure that is what is on screen
      const { data } = await api.post(`${base}/${kind === "run" ? "run" : "submit-code"}`, { language, code });
      if (kind === "run") { setRun(data.result); } else { setSub(data.submission); }
    } catch (e) { setError(examErrorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <div>
      <div className="ex-row between"><span className="ex-muted mono">Problem {number} of {total}</span>{maxSubmissions ? <span className="ex-chip">{Math.max(0, maxSubmissions - used)} of {maxSubmissions} submissions left</span> : null}</div>
      <div className="ex-split" style={{ marginTop: 10 }}>
        <div className="ex-q" style={{ maxHeight: "70vh", overflow: "auto" }}>
          <ProblemStatement question={{ title: item.title, description: item.text, inputFormat: item.inputFormat, outputFormat: item.outputFormat, constraints: item.constraints, notes: item.notes, functionSignature: item.functionSignature, starterCode: item.starterCode, starterCodeByLanguage: item.starterCodeByLanguage, testCases: item.samples }} />
        </div>
        <div>
          <div className="ex-row between" style={{ marginBottom: 8 }}>
            <select aria-label="Programming language" value={language} disabled={disabled} onChange={(e) => onChange({ code: payload?.code ?? "", language: e.target.value })} style={{ padding: "6px 10px", borderRadius: 8 }}>
              {languages.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <span className="ex-muted" style={{ fontSize: 12 }}>Your code is saved as you type.</span>
          </div>
          <div className="ex-code-wrap">
            <Editor height="46vh" language={languages.find((l) => l.id === language)?.monaco || language} theme={theme === "dark" ? "vs-dark" : "light"} value={code} options={{ minimap: { enabled: false }, fontSize: 14, readOnly: disabled, scrollBeyondLastLine: false, automaticLayout: true, contextmenu: false, quickSuggestions: false }} onChange={(v) => onChange({ code: v ?? "", language })} />
          </div>
          <div className="ex-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-ghost" disabled={!!busy || disabled || !item.samples?.length} onClick={() => call("run")}>{busy === "run" ? "Running…" : "Run on samples"}</button>
            <button type="button" className="btn btn-primary" disabled={!!busy || disabled || exhausted || !code.trim()} onClick={() => call("submit")}>{busy === "submit" ? "Submitting…" : "Submit this solution"}</button>
          </div>
          {error && <div className="ex-notice bad" role="alert">{error}</div>}
          {run && <div className="ex-result"><CodeResultBlock title="Sample run" result={run} /></div>}
          {sub && (
            <div className="ex-result" aria-live="polite">
              {sub.pending || sub.status === "PENDING"
                ? <span>Your solution is saved. The code runner could not finish grading it just now, so it will be graded again when the section is submitted. Nothing is marked wrong.</span>
                : <span>Submitted: <strong>{sub.passedCases}/{sub.totalCases}</strong> tests passed ({sub.verdict}). You may submit again until the limit; the last submission is the one marked.</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
