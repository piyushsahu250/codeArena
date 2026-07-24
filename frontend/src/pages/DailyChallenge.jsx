import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import api from "../api";
import { useGamification } from "../context/GamificationContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import ProblemStatement from "../components/ProblemStatement";
import RunSubmitButtons from "../components/RunSubmitButtons";
import CodeModeWarning from "../components/CodeModeWarning";
import CodeResultBlock from "../components/CodeResultBlock";
import { CODE_LANGUAGES as LANGUAGES, defaultStarter } from "../utils/codeEditorDefaults";

function CalendarStrip({ history }) {
  if (!history) return null;
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 12, flexWrap: "wrap" }}>
      {history.map((d, i) => (
        <div
          key={i}
          title={`${new Date(d.date).toDateString()} — ${d.solved ? "Solved" : "Not solved"}`}
          style={{
            width: 14, height: 14, borderRadius: 3,
            background: d.solved ? "var(--mint)" : "var(--card-bg, #F7F7F5)",
            border: "1px solid var(--line)",
          }}
        />
      ))}
    </div>
  );
}

// Daily Challenge — a single scheduled Question (LeetCode-daily-style), reusing the exact same
// Question model / hidden test cases / judge as every other coding surface, via
// backend/src/routes/challenges.js. See WeeklyChallenge.jsx for the near-identical weekly variant.
export default function DailyChallenge() {
  const { notify } = useGamification();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(null);
  const [language, setLanguage] = useState("java");
  const [code, setCode] = useState("");
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const langDraftsRef = useRef({});

  useEffect(() => {
    api.get("/challenges/daily/today")
      .then((res) => {
        setData(res.data);
        if (res.data.challenge) {
          const sub = res.data.submission;
          const lang = sub?.language || "java";
          setLanguage(lang);
          setCode(sub?.code || res.data.question.starterCodeByLanguage?.[lang] || defaultStarter(lang));
        }
      })
      .catch(() => setError("Failed to load today's challenge"));
    api.get("/challenges/daily/history").then((res) => setHistory(res.data)).catch(() => {});
  }, []);

  function handleLanguageChange(lang) {
    if (lang === language) return;
    langDraftsRef.current[language] = code;
    const draft = langDraftsRef.current[lang];
    const nextCode = draft !== undefined ? draft : (data.question.starterCodeByLanguage?.[lang] || defaultStarter(lang));
    setLanguage(lang);
    setCode(nextCode);
    setRunResult(null);
  }

  async function runCode() {
    setRunning(true);
    setRunResult(null);
    try {
      const { data: res } = await api.post(`/challenges/daily/${data.challenge.id}/run`, { language, code });
      setRunResult(res);
    } catch (err) {
      setRunResult({ error: err.response?.data?.error || "Execution failed" });
    } finally {
      setRunning(false);
    }
  }

  async function submitCode() {
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const { data: res } = await api.post(`/challenges/daily/${data.challenge.id}/submit`, { language, code });
      setSubmitResult(res);
      notify(res.gamification);
      api.get("/challenges/daily/history").then((r) => setHistory(r.data)).catch(() => {});
    } catch (err) {
      setSubmitResult({ error: err.response?.data?.error || "Submission failed" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Daily Challenge</h1>
        <ChalkUnderline />
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
          A new problem every day. Solving it counts toward your streak, same as Practice Coding.
        </p>
        <CalendarStrip history={history} />

        {error && <p style={{ color: "var(--rust)", marginTop: 20 }}>{error}</p>}

        {data && !data.challenge && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center" }}>
            <p style={{ color: "var(--ink-dim)" }}>No challenge is scheduled for today yet — check back soon.</p>
          </div>
        )}

        {data?.challenge && (
          <div className="card" style={{ padding: 20, marginTop: 24 }}>
            <ProblemStatement question={data.question} />

            {data.submission?.solvedAt && (
              <p className="mono" style={{ fontSize: 12, color: "var(--mint)", marginTop: 16 }}>
                ✓ Already solved today — you can keep submitting, your streak credit was already awarded.
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <select value={language} onChange={(e) => handleLanguageChange(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)" }}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
              <RunSubmitButtons onRun={runCode} onSubmit={submitCode} running={running} submitting={submitting} />
            </div>
            <CodeModeWarning evaluationType={data.question.evaluationType} language={language} code={code} />

            <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
              <Editor
                height="320px"
                language={LANGUAGES.find((l) => l.id === language)?.monaco}
                value={code}
                onChange={(v) => setCode(v || "")}
                options={{ fontSize: 13, minimap: { enabled: false }, fontFamily: "JetBrains Mono, monospace" }}
              />
            </div>

            {runResult && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: runResult.verdict === "ACCEPTED" ? "#E7F3EB" : "#F7E4E0" }}>
                <CodeResultBlock title="Sample run result" result={runResult} />
              </div>
            )}
            {submitResult && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: submitResult.verdict === "ACCEPTED" ? "#E7F3EB" : "#F7E4E0" }}>
                <CodeResultBlock title="Submission result" result={submitResult} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
