import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import Navbar from "../components/Navbar";
import ProblemStatement from "../components/ProblemStatement";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { CODE_LANGUAGES, defaultStarter } from "../utils/codeEditorDefaults";
import useIsMobile from "../hooks/useIsMobile";
import api from "../api";

const QUIZ_TYPES = ["MCQ", "TRUE_FALSE", "MULTISELECT"];

// Student-facing assessment-taking flow for the Employability & Readiness module. Unlike Formal
// Tests, a Readiness assessment has no proctoring/lockdown config on ReadinessSubject (see RA1
// schema) — it's a self-paced diagnostic, not a locked-down exam — so this page intentionally
// carries no useProctoring wiring. MCQ/TRUE_FALSE/MULTISELECT answers save the instant a student
// picks an option (cheap, no judge run); CODING/SQL answers only grade on an explicit "Save
// Answer" click, since every save triggers a real judge run against hidden cases (same
// hidden-case-grading policy as every other coding surface).
export default function ReadinessAssessment() {
  const { assessmentId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirmDialog = useConfirm();

  const [assessment, setAssessment] = useState(null);
  const [subjectName, setSubjectName] = useState("");
  const [questions, setQuestions] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // questionId -> { selected: [idx], code, language, skipped, score, isCorrect }
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remainingSec, setRemainingSec] = useState(null);
  const [loadError, setLoadError] = useState("");
  const autoFinalizedRef = useRef(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    api.get(`/readiness/assessments/${assessmentId}`).then((res) => {
      const { assessment: a, questions: qs } = res.data;
      if (a.status !== "IN_PROGRESS") {
        navigate(`/readiness/report/${a.id}`, { replace: true });
        return;
      }
      setAssessment(a);
      setSubjectName(a.subject?.name || "");
      setQuestions(qs);
      const initial = {};
      for (const q of qs) {
        const ans = q.answer || {};
        initial[q.id] = {
          selected: Array.isArray(ans.selectedOptions) ? ans.selectedOptions : [],
          code: ans.code ?? (q.questionType === "SQL" ? (q.starterCode || "") : (q.starterCodeByLanguage?.java || q.starterCode || defaultStarter("java"))),
          language: ans.language || "java",
          skipped: ans.skipped !== false,
          score: ans.skipped === false ? ans.score : null,
          isCorrect: ans.isCorrect ?? null,
        };
      }
      setAnswers(initial);
      if (a.durationMin) {
        const elapsedSec = Math.floor((Date.now() - new Date(a.startedAt).getTime()) / 1000);
        setRemainingSec(Math.max(0, a.durationMin * 60 - elapsedSec));
      }
    }).catch((err) => setLoadError(err.response?.data?.error || "Failed to load assessment"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  const current = questions[activeIdx];
  const isQuiz = current && QUIZ_TYPES.includes(current.questionType);
  const isMulti = current?.questionType === "MULTISELECT";

  useEffect(() => {
    if (remainingSec == null) return;
    if (remainingSec <= 0) {
      if (!autoFinalizedRef.current) { autoFinalizedRef.current = true; finalize(true); }
      return;
    }
    const t = setInterval(() => setRemainingSec((s) => (s == null ? s : s - 1)), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec]);

  function fmtTime(sec) {
    if (sec == null) return "";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }

  async function saveQuizAnswer(questionId, selected) {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], selected, skipped: false } }));
    setSaving(true);
    try {
      const res = await api.post(`/readiness/assessments/${assessmentId}/answer`, { questionId, selectedOptions: selected, skipped: false });
      setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], selected, skipped: false, score: res.data.answer.score, isCorrect: res.data.answer.isCorrect } }));
    } catch {
      toast.error("Failed to save your answer — try again.");
    } finally {
      setSaving(false);
    }
  }

  function toggleOption(idx) {
    const cur = answers[current.id]?.selected || [];
    const next = isMulti ? (cur.includes(idx) ? cur.filter((i) => i !== idx) : [...cur, idx]) : [idx];
    saveQuizAnswer(current.id, next);
  }

  async function saveCodeAnswer() {
    const a = answers[current.id];
    setSaving(true);
    try {
      const res = await api.post(`/readiness/assessments/${assessmentId}/answer`, {
        questionId: current.id, code: a.code, language: current.questionType === "SQL" ? "sql" : a.language, skipped: false,
      });
      setAnswers((prev) => ({ ...prev, [current.id]: { ...prev[current.id], skipped: false, score: res.data.answer.score, isCorrect: res.data.answer.isCorrect } }));
      toast.success(`Saved — scored ${res.data.answer.score}%`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save your answer — try again.");
    } finally {
      setSaving(false);
    }
  }

  function setCode(code) {
    setAnswers((prev) => ({ ...prev, [current.id]: { ...prev[current.id], code } }));
  }

  function setLanguage(language) {
    const a = answers[current.id];
    const code = a.code && a.code.trim() && a.code !== defaultStarter(a.language) ? a.code : (current.starterCodeByLanguage?.[language] || defaultStarter(language));
    setAnswers((prev) => ({ ...prev, [current.id]: { ...prev[current.id], language, code } }));
  }

  const answeredCount = useMemo(() => Object.values(answers).filter((a) => !a.skipped).length, [answers]);

  async function finalize(auto = false) {
    if (!auto) {
      const ok = await confirmDialog({
        title: "Submit assessment?",
        message: `You've answered ${answeredCount} of ${questions.length} question(s). Once submitted, you can't change your answers. Continue?`,
        confirmLabel: "Submit",
      });
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      await api.post(`/readiness/assessments/${assessmentId}/finalize`);
      navigate(`/readiness/report/${assessmentId}`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to submit assessment");
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: 48 }}>
          <p style={{ color: "var(--rust)" }}>{loadError}</p>
        </div>
      </div>
    );
  }

  if (!assessment || !current) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: 48, color: "var(--ink-dim)" }}>Loading…</div>
      </div>
    );
  }

  const ans = answers[current.id] || {};

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "12px" : "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: isMobile ? 14 : 16 }}>{subjectName}</div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{assessment.assessmentMode.replace(/_/g, " ")} · Question {activeIdx + 1} of {questions.length}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: isMobile ? "1 1 100%" : "0 1 auto", justifyContent: isMobile ? "space-between" : "flex-start" }}>
            {remainingSec != null && (
              <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: remainingSec < 120 ? "var(--rust)" : "var(--ink)" }}>⏱ {fmtTime(remainingSec)}</span>
            )}
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => finalize(false)}>
              {submitting ? "Submitting…" : "Submit Assessment"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16 }}>
          {questions.map((q, i) => {
            const a = answers[q.id] || {};
            const bg = i === activeIdx ? "var(--mint)" : a.skipped === false ? "#22c55e" : "var(--card-bg, #F7F7F5)";
            const color = i === activeIdx || a.skipped === false ? "#fff" : "var(--ink)";
            const size = isMobile ? 28 : 32;
            return (
              <button
                key={q.id} type="button" onClick={() => setActiveIdx(i)}
                style={{ width: size, height: size, borderRadius: 6, border: "1px solid var(--line)", background: bg, color, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        <div className="card" style={{ marginTop: 16, padding: isMobile ? 14 : 24 }}>
          {isQuiz ? (
            <>
              <ProblemStatement question={{ ...current, testCases: [] }} />
              <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 16 }}>
                {isMulti ? "Select all that apply." : "Select one option."} Your answer saves automatically.
              </p>
              <div style={{ marginTop: 12 }}>
                {(current.options || []).map((opt, idx) => (
                  <label key={idx} className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, marginBottom: 10, cursor: "pointer" }}>
                    <input type={isMulti ? "checkbox" : "radio"} name="readiness-option" checked={(ans.selected || []).includes(idx)} onChange={() => toggleOption(idx)} />
                    <span style={{ fontSize: 14 }}>{opt}</span>
                  </label>
                ))}
              </div>
              {ans.skipped === false && (
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>{saving ? "Saving…" : "✓ Saved"}</p>
              )}
            </>
          ) : (
            <div style={{ display: isMobile ? "flex" : "grid", flexDirection: isMobile ? "column" : undefined, gridTemplateColumns: isMobile ? undefined : "1fr 1fr", gap: 20 }}>
              <div style={{ maxHeight: isMobile ? 260 : 600, overflowY: "auto" }}>
                <ProblemStatement question={current} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  {current.questionType === "SQL" ? (
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>SQL</span>
                  ) : (
                    <select value={ans.language || "java"} onChange={(e) => setLanguage(e.target.value)} className="mono" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--line)" }}>
                      {CODE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  )}
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={saveCodeAnswer} style={{ fontSize: 13, padding: "6px 14px" }}>
                    {saving ? "Saving…" : "Save Answer"}
                  </button>
                </div>
                <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                  <Editor
                    height={isMobile ? "360px" : "520px"}
                    language={current.questionType === "SQL" ? "sql" : (CODE_LANGUAGES.find((l) => l.id === ans.language)?.monaco || "java")}
                    theme="vs-dark"
                    value={ans.code || ""}
                    onChange={(v) => setCode(v ?? "")}
                    options={{ fontSize: 13, minimap: { enabled: false } }}
                  />
                </div>
                <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8 }}>
                  Saving grades your answer immediately against real test cases — you can save again to update your score any time before you submit the whole assessment.
                </p>
                {ans.score != null && ans.skipped === false && (
                  <p style={{ fontSize: 13, marginTop: 8, fontWeight: 700, color: ans.score >= 100 ? "#16a34a" : ans.score > 0 ? "#f59e0b" : "var(--rust)" }}>
                    Current score: {ans.score}%
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" disabled={activeIdx === 0} onClick={() => setActiveIdx((i) => i - 1)}>◀ Previous</button>
          <button type="button" className="btn btn-ghost" disabled={activeIdx === questions.length - 1} onClick={() => setActiveIdx((i) => i + 1)}>Next ▶</button>
        </div>
      </div>
    </div>
  );
}
