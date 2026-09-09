import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import api from "../api";
import { useGamification } from "../context/GamificationContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import ProblemStatement from "../components/ProblemStatement";
import RunSubmitButtons from "../components/RunSubmitButtons";
import CodeResultBlock from "../components/CodeResultBlock";
import ChallengeLeaderboard from "../components/ChallengeLeaderboard";
import { CODE_LANGUAGES as LANGUAGES, defaultStarter } from "../utils/codeEditorDefaults";
import { applyPlainTextInputHints, watchForNonAsciiInput } from "../utils/monacoSetup";
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
  const [language, setLanguage] = useState("python"); // platform-wide default compiler
  const [code, setCode] = useState("");
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const langDraftsRef = useRef({});
  const autosaveTimerRef = useRef(null);
  const codeRef = useRef(code);
  const languageRef = useRef(language);
  const challengeIdRef = useRef(null);
  const monacoEditorRef = useRef(null); // lets the mobile Indent/Outdent buttons drive the editor directly, since a touch keyboard has no physical Tab key
  const [imeWarning, setImeWarning] = useState(false); // see watchForNonAsciiInput's own comment — no webpage can force off a student's IME; this catches the moment it actually miscomposed something

  function handleEditorMount(editor) {
    monacoEditorRef.current = editor;
    applyPlainTextInputHints(editor);
    watchForNonAsciiInput(editor, () => setImeWarning(true));
  }
  codeRef.current = code;
  languageRef.current = language;

  // Bug fixed 2026-09-08: previously inlined directly in the mount effect below with no way to
  // re-invoke it -- an API failure left the student on a dead-end error message with no recourse
  // but a full page reload (section 2's explicit "Retry" requirement). Pulled out so the Retry
  // button below can call it again. Also: `res.data.question.starterCodeByLanguage` used to read
  // `question` with no optional-chaining -- if a challenge row's question reference were ever
  // missing (e.g. a data-integrity issue), this threw inside the async handler, which .catch()
  // below does still catch (so it wasn't the white-screen cause), but it surfaced the same generic
  // "failed to load" message a real network failure would, instead of anything more specific.
  function loadChallenge() {
    setError("");
    api.get("/challenges/weekly/current")
      .then(async (res) => {
        setData(res.data);
        if (res.data.challenge) {
          challengeIdRef.current = res.data.challenge.id;
          const sub = res.data.submission;
          const lang = sub?.language || "python"; // platform-wide default compiler
          setLanguage(lang);
          setCode(sub?.code || res.data.question?.starterCodeByLanguage?.[lang] || defaultStarter(lang));
          if (sub?.solvedAt) loadLeaderboard(res.data.challenge.id);
          try {
            const { data: draft } = await api.get(`/challenges/weekly/${res.data.challenge.id}/draft`);
            if (draft) { setCode(draft.code); setLanguage(draft.language); }
          } catch { /* no draft yet */ }
        }
      })
      .catch(() => setError("Unable to load the Weekly Challenge."))
      .finally(() => setDraftLoaded(true));
  }

  useEffect(() => {
    loadChallenge();
    api.get("/challenges/stats").then((res) => setStats(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const nextCode = draft !== undefined ? draft : (data?.question?.starterCodeByLanguage?.[lang] || defaultStarter(lang));
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
      if (res.verdict === "ACCEPTED") loadLeaderboard(data.challenge.id);
    } catch (err) {
      setSubmitResult({ error: err.response?.data?.error || "Submission failed" });
    } finally {
      setSubmitting(false);
    }
  }

  function loadLeaderboard(challengeId) {
    api.get(`/challenges/weekly/${challengeId}/leaderboard`).then((res) => setLeaderboardData(res.data)).catch(() => {});
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

        {/* Bug fixed 2026-09-08: neither this loading state nor the Retry button below existed --
            between mount and the API response landing, `data` was still null and neither this nor
            the `data?.challenge`/`data && !data.challenge` blocks further down rendered anything,
            so the only visible content on the whole page was the static header above. On a slow
            connection that's a long, genuinely empty-looking stretch -- not the literal crash this
            page's ErrorBoundary guards against, but the same "user sees nothing informative"
            symptom class the reported white-screen bug describes. */}
        {!data && !error && <p style={{ color: "var(--ink-dim)", marginTop: 20 }}>Loading Weekly Challenge…</p>}

        {error && (
          <div className="card" style={{ padding: 24, marginTop: 20, textAlign: "center" }}>
            <p style={{ color: "var(--rust)" }}>{error}</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={loadChallenge}>Retry</button>
          </div>
        )}

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
            {/* A touch keyboard has no physical Tab key — these trigger Monaco's own built-in
                tab/outdent commands directly. onPointerDown preventDefaults so tapping never
                steals focus/selection away from the editor first. */}
            {isMobile && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                  onPointerDown={(e) => e.preventDefault()} onClick={() => monacoEditorRef.current?.trigger("toolbar", "tab", null)}>
                  ⇥ Indent
                </button>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                  onPointerDown={(e) => e.preventDefault()} onClick={() => monacoEditorRef.current?.trigger("toolbar", "outdent", null)}>
                  ⇤ Outdent
                </button>
              </div>
            )}
            {imeWarning && (
              <div style={{ background: "var(--danger-bg)", color: "var(--rust)", padding: "8px 12px", fontSize: 12, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                <span>⚠ Non-English character detected in your code — your keyboard may be set to a regional/transliteration input mode. Switch it to plain English before continuing (on Gboard: long-press the spacebar or tap the globe key).</span>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", flexShrink: 0 }} onClick={() => setImeWarning(false)}>Dismiss</button>
              </div>
            )}
            <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
              <Editor
                height={isMobile ? "260px" : "320px"}
                language={LANGUAGES.find((l) => l.id === language)?.monaco}
                value={code}
                onChange={(v) => setCode(v || "")}
                onMount={handleEditorMount}
                options={{ fontSize: 13, minimap: { enabled: false }, fontFamily: "JetBrains Mono, monospace" }}
              />
            </div>

            {runResult && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: runResult.verdict === "ACCEPTED" ? "var(--success-bg)" : "var(--danger-bg)" }}>
                <CodeResultBlock title="Sample run result" result={runResult} />
              </div>
            )}
            {submitResult && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: submitResult.verdict === "ACCEPTED" ? "var(--success-bg)" : "var(--danger-bg)" }}>
                <CodeResultBlock title="Submission result" result={submitResult} />
              </div>
            )}

            {leaderboardData && (
              <details open style={{ marginTop: 16 }}>
                <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>
                  THIS WEEK'S LEADERBOARD — your institute
                </summary>
                <ChallengeLeaderboard leaderboard={leaderboardData.leaderboard} yourRank={leaderboardData.yourRank} />
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
