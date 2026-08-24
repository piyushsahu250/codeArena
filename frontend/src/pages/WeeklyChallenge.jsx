import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import api from "../api";
import { useGamification } from "../context/GamificationContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import ProblemStatement from "../components/ProblemStatement";
import RunSubmitButtons from "../components/RunSubmitButtons";
import CodeResultBlock from "../components/CodeResultBlock";
import { CODE_LANGUAGES as LANGUAGES, defaultStarter } from "../utils/codeEditorDefaults";
import useIsMobile from "../hooks/useIsMobile";

const AUTOSAVE_DEBOUNCE_MS = 2000;

// Weekly Challenge — the same mechanics as DailyChallenge.jsx (see that file for the fuller
// comment) but keyed by ISO week instead of calendar day, higher XP reward, no daily calendar
// strip since there's only ever one "current" week.
export default function WeeklyChallenge() {
  const isMobile = useIsMobile();
  const { notify } = useGamification();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  const [language, setLanguage] = useState("java");
  const [code, setCode] = useState("");
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const langDraftsRef = useRef({});
  const autosaveTimerRef = useRef(null);
  const codeRef = useRef(code);
  const languageRef = useRef(language);
  const challengeIdRef = useRef(null);
  codeRef.current = code;
  languageRef.current = language;

  useEffect(() => {
    api.get("/challenges/weekly/current")
      .then(async (res) => {
        setData(res.data);
        if (res.data.challenge) {
          challengeIdRef.current = res.data.challenge.id;
          const sub = res.data.submission;
          const lang = sub?.language || "java";
          setLanguage(lang);
          setCode(sub?.code || res.data.question.starterCodeByLanguage?.[lang] || defaultStarter(lang));
          try {
            const { data: draft } = await api.get(`/challenges/weekly/${res.data.challenge.id}/draft`);
            if (draft) { setCode(draft.code); setLanguage(draft.language); }
          } catch { /* no draft yet */ }
        }
      })
      .catch(() => setError("Failed to load this week's challenge"))
      .finally(() => setDraftLoaded(true));
    api.get("/challenges/stats").then((res) => setStats(res.data)).catch(() => {});
  }, []);

  function flushAutosave() {
    if (!challengeIdRef.current) return;
    api.post(`/challenges/weekly/${challengeIdRef.current}/autosave`, { code: codeRef.current, language: languageRef.current }).catch(() => {});
  }

  useEffect(() => {
    if (!draftLoaded || !challengeIdRef.current) return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(flushAutosave, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(autosaveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language, draftLoaded]);

  useEffect(() => {
    const handler = () => flushAutosave();
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
      flushAutosave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const { data: res } = await api.post(`/challenges/weekly/${data.challenge.id}/run`, { language, code });
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
      const { data: res } = await api.post(`/challenges/weekly/${data.challenge.id}/submit`, { language, code });
      setSubmitResult(res);
      notify(res.gamification);
      api.get("/challenges/stats").then((r) => setStats(r.data)).catch(() => {});
    } catch (err) {
      setSubmitResult({ error: err.response?.data?.error || "Submission failed" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: isMobile ? "24px 14px" : "48px 24px" }}>
        <h1>Weekly Challenge</h1>
        <ChalkUnderline />
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
          A tougher problem, one per week — worth more XP than the Daily Challenge.
        </p>
        {stats && (
          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 13 }}>Streak: <strong>{stats.currentStreak}</strong> day{stats.currentStreak === 1 ? "" : "s"}</span>
            <span className="mono" style={{ fontSize: 13, opacity: 0.75 }}>Longest: <strong>{stats.longestStreak}</strong></span>
            <span className="mono" style={{ fontSize: 13, opacity: 0.75 }}>Challenge XP: <strong>{stats.challengeXp}</strong></span>
          </div>
        )}

        {error && <p style={{ color: "var(--rust)", marginTop: 20 }}>{error}</p>}

        {data && !data.challenge && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center" }}>
            <p style={{ color: "var(--ink-dim)" }}>No challenge is scheduled for this week yet — check back soon.</p>
          </div>
        )}

        {data?.challenge && (
          <div className="card" style={{ padding: isMobile ? 14 : 20, marginTop: 24 }}>
            <ProblemStatement question={data.question} />

            {data.submission?.solvedAt && (
              <p className="mono" style={{ fontSize: 12, color: "var(--mint)", marginTop: 16 }}>
                ✓ Already solved this week — you can keep submitting, your XP was already awarded.
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, flexWrap: "wrap", gap: 10 }}>
              <select value={language} onChange={(e) => handleLanguageChange(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)" }}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
              <RunSubmitButtons onRun={runCode} onSubmit={submitCode} running={running} submitting={submitting} />
            </div>
            <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
              <Editor
                height={isMobile ? "260px" : "320px"}
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
