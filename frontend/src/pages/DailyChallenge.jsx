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

// Real submission history — same data GET /challenges/daily/history already returns for the
// calendar strip below, just rendering the `attempt` details it now carries instead of only the
// solved/unsolved boolean. Most recent attempted day first; days never attempted are omitted here
// (they're already visible as unfilled squares in the calendar).
function SubmissionHistory({ history }) {
  const attempted = (history || []).filter((d) => d.attempt).slice().reverse();
  if (attempted.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>No submissions in the last 30 days yet.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
      {attempted.map((d) => (
        <div
          key={d.date}
          className="mono"
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6,
            padding: "8px 10px", borderRadius: 6, fontSize: 12,
            background: d.attempt.verdict === "ACCEPTED" ? "var(--success-bg)" : "var(--danger-bg)",
          }}
        >
          <span>
            {new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {" — "}{d.questionTitle || "Untitled question"}
          </span>
          <span style={{ color: "var(--ink-dim)" }}>
            {d.attempt.verdict} · {d.attempt.passedCases}/{d.attempt.totalCases} · {d.attempt.language}
            {d.attempt.timeMs != null ? ` · ${d.attempt.timeMs}ms` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

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
  const isMobile = useIsMobile();
  const { notify } = useGamification();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(null);
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
  const monacoEditorRef = useRef(null); // lets the mobile Indent/Outdent buttons drive the editor directly, since a touch keyboard has no physical Tab key
  const [imeWarning, setImeWarning] = useState(false); // see watchForNonAsciiInput's own comment — no webpage can force off a student's IME; this catches the moment it actually miscomposed something

  function handleEditorMount(editor) {
    monacoEditorRef.current = editor;
    applyPlainTextInputHints(editor);
    watchForNonAsciiInput(editor, () => setImeWarning(true));
  }
  const languageRef = useRef(language);
  const challengeIdRef = useRef(null);
  codeRef.current = code;
  languageRef.current = language;

  // Bug fixed 2026-09-08: same fix as WeeklyChallenge.jsx's identical twin function -- pulled out
  // of the mount effect so a failed load can be retried without a full page reload, `question` is
  // now optional-chained, and the initial-loading window between mount and this resolving now
  // shows a real "Loading..." message below instead of rendering nothing.
  function loadChallenge() {
    setError("");
    api.get("/challenges/daily/today")
      .then(async (res) => {
        setData(res.data);
        if (res.data.challenge) {
          challengeIdRef.current = res.data.challenge.id;
          const sub = res.data.submission;
          const lang = sub?.language || "python"; // platform-wide default compiler
          setLanguage(lang);
          setCode(sub?.code || res.data.question?.starterCodeByLanguage?.[lang] || defaultStarter(lang));
          // Already solved before this page load (returning visitor) — show the leaderboard right
          // away rather than only after a fresh Submit.
          if (sub?.solvedAt) loadLeaderboard(res.data.challenge.id);
          // A saved draft (from an in-progress edit that never got Submit-ed) reflects more recent
          // work than the last graded submission's snapshot, so it wins when present.
          try {
            const { data: draft } = await api.get(`/challenges/daily/${res.data.challenge.id}/draft`);
            if (draft) { setCode(draft.code); setLanguage(draft.language); }
          } catch { /* no draft yet */ }
        }
      })
      .catch(() => setError("Unable to load the Daily Challenge."))
      .finally(() => setDraftLoaded(true));
  }

  useEffect(() => {
    loadChallenge();
    api.get("/challenges/daily/history").then((res) => setHistory(res.data)).catch(() => {});
    api.get("/challenges/stats").then((res) => setStats(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flushAutosave() {
    if (!challengeIdRef.current) return;
    api.post(`/challenges/daily/${challengeIdRef.current}/autosave`, { code: codeRef.current, language: languageRef.current }).catch(() => {});
  }

  // Periodic debounced autosave while typing.
  useEffect(() => {
    if (!draftLoaded || !challengeIdRef.current) return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(flushAutosave, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(autosaveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language, draftLoaded]);

  // Flush on unmount (navigating away) and on tab close/refresh.
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
      api.get("/challenges/stats").then((r) => setStats(r.data)).catch(() => {});
      if (res.verdict === "ACCEPTED") loadLeaderboard(data.challenge.id);
    } catch (err) {
      setSubmitResult({ error: err.response?.data?.error || "Submission failed" });
    } finally {
      setSubmitting(false);
    }
  }

  function loadLeaderboard(challengeId) {
    api.get(`/challenges/daily/${challengeId}/leaderboard`).then((res) => setLeaderboardData(res.data)).catch(() => {});
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: isMobile ? "24px 14px" : "48px 24px" }}>
        <h1>Daily Challenge</h1>
        <ChalkUnderline />
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
          A new problem every day. Solving it counts toward your streak, same as Practice Coding.
        </p>
        {stats && (
          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 13 }}>Streak: <strong>{stats.currentStreak}</strong> day{stats.currentStreak === 1 ? "" : "s"}</span>
            <span className="mono" style={{ fontSize: 13, opacity: 0.75 }}>Longest: <strong>{stats.longestStreak}</strong></span>
            <span className="mono" style={{ fontSize: 13, opacity: 0.75 }}>Challenge XP: <strong>{stats.challengeXp}</strong></span>
          </div>
        )}
        <CalendarStrip history={history} />

        {history && history.some((d) => d.attempt) && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>
              RECENT SUBMISSIONS
            </summary>
            <SubmissionHistory history={history} />
          </details>
        )}

        {!data && !error && <p style={{ color: "var(--ink-dim)", marginTop: 20 }}>Loading Daily Challenge…</p>}

        {error && (
          <div className="card" style={{ padding: 24, marginTop: 20, textAlign: "center" }}>
            <p style={{ color: "var(--rust)" }}>{error}</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={loadChallenge}>Retry</button>
          </div>
        )}

        {data && !data.challenge && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center" }}>
            <p style={{ color: "var(--ink-dim)" }}>No challenge is scheduled for today yet — check back soon.</p>
          </div>
        )}

        {data?.challenge && (
          <div className="card" style={{ padding: isMobile ? 14 : 20, marginTop: 24 }}>
            <ProblemStatement question={data.question} />

            {data.submission?.solvedAt && (
              <p className="mono" style={{ fontSize: 12, color: "var(--mint)", marginTop: 16 }}>
                ✓ Already solved today — you can keep submitting, your streak credit was already awarded.
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
                  TODAY'S LEADERBOARD — your institute
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
