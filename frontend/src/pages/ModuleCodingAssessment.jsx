import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import api, { API_BASE_URL } from "../api";
import { useGamification } from "../context/GamificationContext";
import { useProctoring } from "../hooks/useProctoring";
import useIsMobile from "../hooks/useIsMobile";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CodeResultBlock from "../components/CodeResultBlock";
import RunSubmitButtons from "../components/RunSubmitButtons";
import ProblemStatement from "../components/ProblemStatement";
import ReadinessChecklist from "../components/ReadinessChecklist";
import { CODE_LANGUAGES as ALL_LANGUAGES, defaultStarter } from "../utils/codeEditorDefaults";

const AUTOSAVE_INTERVAL_MS = 10000; // spec: auto-save every 10 seconds

const VIOLATION_LABEL = {
  TAB_SWITCH: "switching tabs",
  FULLSCREEN_EXIT: "exiting fullscreen",
  COPY: "copying text",
  PASTE: "pasting text",
  CUT: "cutting text",
  RIGHT_CLICK: "right-clicking",
  DEVTOOLS: "opening developer tools",
  PRINT_SCREEN_ATTEMPT: "attempting a screenshot",
  REFRESH_ATTEMPT: "attempting to refresh/leave the page",
  MULTI_MONITOR: "using multiple monitors",
  SCREEN_OVERLAY_DETECTED: "an on-screen search/assistant overlay being detected",
  FACE_MISSING: "no face being detected in the camera frame",
  MULTIPLE_FACES: "multiple faces being detected in the camera frame",
  CAMERA_DROPPED: "your camera being turned off or disconnected",
  MIC_DROPPED: "your microphone being turned off or disconnected",
  BROWSER_SHORTCUT: "using a restricted keyboard shortcut",
};

export default function ModuleCodingAssessment() {
  const { slug, moduleId } = useParams();
  const { notify } = useGamification();
  const isMobile = useIsMobile();

  const [status, setStatus] = useState(null); // GET /module-coding/module/:moduleId response
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("loading"); // loading | preflight | starting | active | result | finalize-failed
  const [readinessReady, setReadinessReady] = useState(false);
  const [result, setResult] = useState(null);

  const [attemptId, setAttemptId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [allowedLanguages, setAllowedLanguages] = useState(["java"]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // { [questionId]: { language, code } }
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [submittingCode, setSubmittingCode] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [autoSubmitReasonMsg, setAutoSubmitReasonMsg] = useState("");
  const [violationWarning, setViolationWarning] = useState(null);
  const [violationCount, setViolationCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [saveFailed, setSaveFailed] = useState(false); // surfaced honestly instead of the indicator silently staying stale on a failed autosave
  // Independent autosaved code per (question, language) — { [questionId]: { [language]: code } }.
  // Without this, switching languages would always reload a starter template and silently
  // discard whatever was already written in the language being switched away from.
  const [langDrafts, setLangDrafts] = useState({});
  // Per-question live verdict (from an actual Submit, never autosave/Run) and "visited" tracking
  // — drives the navigator's green/yellow/red/gray status dot, same scheme as TestTaking.jsx.
  const [codeVerdicts, setCodeVerdicts] = useState({});
  const [visited, setVisited] = useState({});
  const [submitResultMsg, setSubmitResultMsg] = useState(null); // { ok, text } — no alert(), which forces fullscreen exit
  const [editorHeight, setEditorHeight] = useState(() => Number(localStorage.getItem("moduleCodingEditorHeight")) || 420);
  const resizingRef = useRef(false);

  const deadlineRef = useRef(null);
  const clockOffsetRef = useRef(0); // serverTime - Date.now() at start/resume; corrects a skewed device clock
  const finalizingRef = useRef(false); // in-flight guard for the auto-submit tick, distinct from finalizedRef
  const submittingCodeRef = useRef(false); // in-flight guard for handleSubmitCode, immune to disabled-button re-render lag
  const attemptIdRef = useRef(null);
  const finalizedRef = useRef(false);
  const lastFinalizeReasonRef = useRef(null); // so the manual retry (after a failed finalize) resubmits with the same reason
  // Mirrors the active question's id — Run/Submit are async, and a student can switch questions
  // before a slow response comes back. Guards the ephemeral runResult/submitResultMsg setters so
  // a late response never renders under whatever question happens to be active by then.
  const activeQuestionIdRef = useRef(null);
  const lastSavedCodeRef = useRef({});
  const timerRef = useRef(null);
  // Mirrors of state, kept current via effects below — flushAutosave reads through these refs
  // (not the state variables directly) specifically so it never sees stale data no matter when
  // its enclosing closure was created. This is what fixes a real scoring bug: the previous
  // version's autosave only ever flushed the single currently-active question, and its
  // "flush when switching away" effect closed over `answers` from whenever `activeIdx` last
  // changed — not the latest keystrokes — so a question's actual final code could silently never
  // reach the server (or reach it as stale starter code) while another question's did, producing
  // exactly the "solved everything but scored 33%" pattern (100% on the one question that did
  // save, 0% on two that didn't/couldn't).
  const answersRef = useRef({});
  const questionsRef = useRef([]);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

  function load() {
    setPhase("loading");
    api.get(`/module-coding/module/${moduleId}`)
      .then((res) => { setStatus(res.data); setPhase("preflight"); })
      .catch((err) => setError(err.response?.data?.error || "Failed to load coding assessment"));
  }
  useEffect(() => { load(); }, [moduleId]);

  async function onViolation(type) {
    if (!attemptIdRef.current || finalizedRef.current) return;
    try {
      const { data } = await api.post(`/module-coding/attempts/${attemptIdRef.current}/violation`, { type });
      setViolationCount(data.violationCount);
      if (data.autoSubmitted) {
        finalizedRef.current = true;
        setAutoSubmitted(true);
        setAutoSubmitReasonMsg(VIOLATION_LABEL[type] || "a proctoring violation");
        proctor.stopMedia();
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      } else {
        const msg = `Warning ${data.violationCount}/${data.maxViolations}: ${VIOLATION_LABEL[type] || type}. The assessment will auto-submit if this continues.`;
        setViolationWarning(msg);
        setTimeout(() => setViolationWarning((m) => (m === msg ? null : m)), 6000);
      }
    } catch {
      // best-effort
    }
  }

  const proctor = useProctoring({
    active: phase === "active",
    requireFullscreen: status?.test?.requireFullscreen !== false,
    requireWebcam: !!status?.test?.requireWebcam,
    requireMicrophone: !!status?.test?.requireMicrophone,
    onViolation,
  });
  const micBlocked = !!status?.test?.requireMicrophone && proctor.micStatus === "UNAVAILABLE";

  async function beginOrResume() {
    setPhase("starting");
    try {
      if (status?.test?.requireFullscreen !== false) {
        try { await document.documentElement.requestFullscreen?.(); } catch { /* best-effort */ }
      }
      const { data } = await api.post(`/module-coding/module/${moduleId}/start`);
      setAttemptId(data.attemptId);
      attemptIdRef.current = data.attemptId;
      deadlineRef.current = data.deadline;
      // A device clock that's fast/slow relative to the server would otherwise make the countdown
      // hit zero (and auto-submit) too early or too late in real time — every remaining-time
      // computation below uses (Date.now() + clockOffsetRef.current), never raw Date.now().
      if (typeof data.serverTime === "number") clockOffsetRef.current = data.serverTime - Date.now();
      setQuestions(data.questions);
      setAllowedLanguages(Array.isArray(data.allowedLanguages) ? data.allowedLanguages : ["java"]);

      // On resume (page refresh, dropped connection, etc.), the server returns whatever was last
      // autosaved per question — restore that instead of wiping back to starter code, otherwise
      // real, already-saved progress would appear to vanish from the editor.
      const initialAnswers = {};
      const restoredVerdicts = {};
      const restoredVisited = {};
      const initialDrafts = {};
      data.questions.forEach((q) => {
        const saved = data.savedAnswers?.[q.id];
        const lang = saved?.language || (Array.isArray(data.allowedLanguages) && data.allowedLanguages[0]) || "java";
        // Deliberately does NOT fall back to the legacy single-language q.starterCode field (unlike
        // an earlier version of this line) — two independent problems with it: it only ever matches
        // ONE language, so using it regardless of the selected language showed a wrong-language
        // template; and for any question that started life in STDIO mode before being converted to
        // FUNCTION mode, it's a full leftover program ("public class Main" + its own main()), which
        // the FUNCTION-mode driver assembly can't safely combine with — that's exactly the shape
        // wrapFunctionCode()'s own stale-STDIO-code guard exists to reject, so relying on this field
        // as a fallback could hand a student starter code that's guaranteed to fail to compile the
        // moment they submit it, through no fault of their own. setLanguage() below already made
        // this same call for language switches; this is the matching fix for the initial load.
        const code = saved?.code ?? (q.starterCodeByLanguage?.[lang] || defaultStarter(lang));
        initialAnswers[q.id] = { language: lang, code };
        initialDrafts[q.id] = { [lang]: code };
        if (saved) {
          lastSavedCodeRef.current[q.id] = `${lang}:${code}`;
          restoredVisited[q.id] = true;
          if (saved.verdict) {
            restoredVerdicts[q.id] = { verdict: saved.verdict, passedCases: saved.passedCases, totalCases: saved.totalCases };
          }
        }
      });
      setAnswers(initialAnswers);
      setLangDrafts(initialDrafts);
      setCodeVerdicts(restoredVerdicts);
      setVisited(restoredVisited);
      setSecondsLeft(Math.max(0, Math.floor((data.deadline - (Date.now() + clockOffsetRef.current)) / 1000)));
      setPhase("active");
    } catch (err) {
      setError(err.response?.data?.error || "Could not start this assessment");
      setPhase("preflight");
    }
  }

  // Countdown timer, self-correcting against the fixed deadline.
  useEffect(() => {
    if (phase !== "active" || secondsLeft === null) return;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.floor((deadlineRef.current - (Date.now() + clockOffsetRef.current)) / 1000));
      setSecondsLeft(remaining);
      // Deliberately does NOT clearInterval here — if the auto-submit call below comes back
      // "premature" (server disagrees time is actually up), the interval must keep ticking so it
      // can retry once the corrected clock offset shows real time has elapsed. finalizingRef guards
      // against firing a second call while one is still in flight.
      if (remaining <= 0 && !finalizingRef.current) {
        finalize("TIME_EXPIRED");
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, secondsLeft !== null]);

  // Auto-save every 10 seconds (spec-required interval) — flushes EVERY question's latest code,
  // not just the active one, reading through refs so this timer never needs `answers` in its
  // deps (which would otherwise reset the interval on every keystroke and could go long stretches
  // without ever actually firing while a student types continuously).
  useEffect(() => {
    if (phase !== "active") return;
    const interval = setInterval(() => flushAutosave(), AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [phase]);

  // questionId omitted = flush every question currently held in state; specify one to flush just
  // that question (used for the "leaving this question" nicety below). Always reads the latest
  // values via refs, so it's correct regardless of when the calling closure was created.
  async function flushAutosave(questionId) {
    if (!attemptIdRef.current || finalizedRef.current) return;
    const ids = questionId ? [questionId] : questionsRef.current.map((q) => q.id);
    await Promise.all(ids.map(async (qid) => {
      const a = answersRef.current[qid];
      if (!a) return;
      const key = `${a.language}:${a.code}`;
      if (lastSavedCodeRef.current[qid] === key) return;
      try {
        // seq: Date.now() at the moment of this flush -- see Submission.codeSavedSeq's schema
        // comment (moduleCoding.js's autosave route applies the same conditional-write guard).
        await api.post(`/module-coding/attempts/${attemptIdRef.current}/autosave`, { questionId: qid, language: a.language, code: a.code, seq: Date.now() });
        lastSavedCodeRef.current[qid] = key;
        setLastSavedAt(new Date());
        setSaveFailed(false);
      } catch {
        // Retried on the next interval tick, and unconditionally again at finalize() -- but the
        // student should see that a save didn't go through, not a timestamp silently going stale.
        setSaveFailed(true);
      }
    }));
  }

  // Flush the outgoing question's code the moment the candidate navigates away from it — a
  // latency nicety, not the safety net (finalize() below flushes everything unconditionally).
  useEffect(() => {
    const outgoingId = questions[activeIdx]?.id;
    return () => { if (outgoingId) flushAutosave(outgoingId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  // Every question switch gets a fresh console (clears the previous question's Run/Submit
  // output) and marks the newly-opened question "visited" (the gray → yellow transition in the
  // navigator). Verdicts persist across switches on purpose — only the ephemeral Run/Submit
  // banners reset, not the graded status.
  useEffect(() => {
    const id = questions[activeIdx]?.id;
    activeQuestionIdRef.current = id ?? null;
    if (!id) return;
    setVisited((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    setRunResult(null);
    setSubmitResultMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, questions.length]);

  // Best-effort save fired from beforeunload/pagehide — a normal axios POST can be aborted
  // mid-flight when the page is actually torn down, so this uses fetch's `keepalive` flag
  // (unlike navigator.sendBeacon, it still supports the Authorization header this API requires).
  function keepaliveSave(path, body) {
    try {
      const token = localStorage.getItem("token");
      fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // best-effort only
    }
  }

  // Spec: "never lose work" on page refresh/close or a temporary network drop. The 10s interval
  // + question-switch flush above already cover typing/switching questions; these two effects
  // cover closing/refreshing the tab, and retrying a save that failed while offline the moment
  // connectivity returns.
  useEffect(() => {
    function flushOnUnload() {
      if (finalizedRef.current || !attemptIdRef.current) return;
      for (const q of questionsRef.current) {
        const a = answersRef.current[q.id];
        if (!a) continue;
        const key = `${a.language}:${a.code}`;
        if (lastSavedCodeRef.current[q.id] === key) continue;
        keepaliveSave(`/module-coding/attempts/${attemptIdRef.current}/autosave`, { questionId: q.id, language: a.language, code: a.code });
      }
    }
    window.addEventListener("beforeunload", flushOnUnload);
    window.addEventListener("pagehide", flushOnUnload);
    return () => {
      window.removeEventListener("beforeunload", flushOnUnload);
      window.removeEventListener("pagehide", flushOnUnload);
    };
  }, []);

  useEffect(() => {
    function onOnline() {
      if (phase === "active") flushAutosave();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [phase]);

  // Resizable editor — drag the handle between editor and results panel. Height persists across
  // questions (it's a single piece of state, never reset by activeIdx) and across sessions via
  // localStorage. Min/max clamp keeps the editor from being dragged unusably small or off-screen.
  function startResize(e) {
    resizingRef.current = true;
    document.body.style.cursor = "row-resize";
    e.preventDefault();
  }
  useEffect(() => {
    function onMove(e) {
      if (!resizingRef.current) return;
      setEditorHeight((h) => Math.min(800, Math.max(200, h + e.movementY)));
    }
    function onUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      setEditorHeight((h) => { localStorage.setItem("moduleCodingEditorHeight", String(h)); return h; });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const current = questions[activeIdx];
  const answer = current ? answers[current.id] : null;

  const timeLabel = useMemo(() => {
    if (secondsLeft === null) return "--:--";
    const h = Math.floor(secondsLeft / 3600);
    const m = Math.floor((secondsLeft % 3600) / 60);
    const s = secondsLeft % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
  }, [secondsLeft]);

  function setCode(code) {
    if (!current) return;
    const language = answer?.language || allowedLanguages[0];
    setAnswers((prev) => ({ ...prev, [current.id]: { ...prev[current.id], code } }));
    setLangDrafts((prev) => ({ ...prev, [current.id]: { ...prev[current.id], [language]: code } }));
  }

  function setLanguage(language) {
    if (!current) return;
    // Restores whatever was already typed in this language for this question, if anything —
    // switching away and back must never silently discard a student's work. Only the very first
    // time a language is picked for this question does it fall back to a starter template: the
    // question's own per-language template if the admin defined one, otherwise a generic-but-
    // language-correct default. Never another language's code (the legacy single-language
    // starterCode field is deliberately not used here — it only ever matches one language).
    const draft = langDrafts[current.id]?.[language];
    const code = draft !== undefined ? draft : (current.starterCodeByLanguage?.[language] || defaultStarter(language));
    setAnswers((prev) => ({ ...prev, [current.id]: { language, code } }));
    setLangDrafts((prev) => ({ ...prev, [current.id]: { ...prev[current.id], [language]: code } }));
    setRunResult(null);
    setSubmitResultMsg(null);
  }

  async function handleRun() {
    if (!current || !answer) return;
    const questionId = current.id;
    setRunning(true);
    setRunResult(null);
    try {
      const { data } = await api.post(`/module-coding/attempts/${attemptId}/run`, { questionId, language: answer.language, code: answer.code });
      if (activeQuestionIdRef.current === questionId) setRunResult(data);
    } catch (err) {
      if (activeQuestionIdRef.current === questionId) setRunResult({ error: err.response?.data?.error || "Run failed" });
    } finally {
      setRunning(false);
    }
  }

  // Grades this one question against hidden test cases immediately, distinct from Run (samples
  // only, no score). Marks the code as "already saved" in lastSavedCodeRef right after — the
  // periodic 10s autosave interval skips a question whose code hasn't changed since its last
  // save, so without this the very next tick would re-autosave the same code and reset the
  // verdict it just computed back to PENDING.
  //
  // Deliberately never uses alert() here — a native dialog forces the browser to silently exit
  // fullscreen before it can render, which was the actual cause of "fullscreen exits when I
  // click Submit". submitResultMsg (an on-page banner) replaces it and never touches fullscreen.
  async function handleSubmitCode() {
    if (submittingCodeRef.current) return;
    if (!current || !answer || !attemptId) return;
    const questionId = current.id;
    submittingCodeRef.current = true;
    setSubmittingCode(true);
    try {
      const { data } = await api.post(`/module-coding/attempts/${attemptId}/submit-code`, { questionId, language: answer.language, code: answer.code });
      lastSavedCodeRef.current[questionId] = `${answer.language}:${answer.code}`;
      setLastSavedAt(new Date());
      // codeVerdicts (the status dot) is always applied — it's per-question already. Only the
      // ephemeral banner is guarded against rendering under a question navigated away from.
      setCodeVerdicts((prev) => ({ ...prev, [questionId]: { verdict: data.verdict, passedCases: data.passedCases, totalCases: data.totalCases } }));
      if (activeQuestionIdRef.current === questionId) setSubmitResultMsg({ ok: data.verdict === "ACCEPTED", text: describeVerdict(data) });
    } catch (err) {
      if (activeQuestionIdRef.current === questionId) setSubmitResultMsg({ ok: false, text: err.response?.data?.error || "Submission failed" });
    } finally {
      submittingCodeRef.current = false;
      setSubmittingCode(false);
    }
  }

  function goToQuestion(delta) {
    setActiveIdx((idx) => Math.max(0, Math.min(questions.length - 1, idx + delta)));
  }

  async function finalize(reason) {
    if (finalizedRef.current || finalizingRef.current) return;
    if (!reason && !confirm("Submit this assessment? You won't be able to change your answers afterward.")) return;
    lastFinalizeReasonRef.current = reason;
    await flushAutosave();
    finalizingRef.current = true;
    setFinalizing(true);

    // Up to 3 tries with backoff before giving up -- must never report success (a "result" phase
    // with a real score) unless the server actually confirmed it. Previously ANY failure here set
    // finalizedRef + phase "result", which then rendered with `result` still null/undefined --
    // score/passed would read as falsy/0%, a confusing false result rather than an honest failure.
    let data = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3 && !data; attempt++) {
      try {
        const res = await api.post(`/module-coding/attempts/${attemptId}/finalize`, { reason });
        data = res.data;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }

    if (!data) {
      finalizingRef.current = false;
      setFinalizing(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      console.error("[finalize] failed after 3 attempts:", lastErr);
      setPhase("finalize-failed");
      return;
    }

    // The server disagreed that time is actually up (this candidate's device clock ran ahead of
    // the server's) — resync the offset and let the countdown keep running instead of locking the
    // assessment screen; do NOT set finalizedRef, exit fullscreen, or stop media.
    if (data.premature) {
      if (typeof data.serverNow === "number") clockOffsetRef.current = data.serverNow - Date.now();
      finalizingRef.current = false;
      setFinalizing(false);
      return;
    }
    finalizedRef.current = true;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    proctor.stopMedia();
    setResult(data);
    notify(data.gamification);
    finalizingRef.current = false;
    setFinalizing(false);
    setPhase("result");
  }

  if (error && phase !== "active") {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: 48 }}>
          <p style={{ color: "var(--rust)" }}>{error}</p>
          <Link to={`/learning/${slug}`} className="btn btn-ghost" style={{ marginTop: 12, display: "inline-block" }}>← Back to course</Link>
        </div>
      </div>
    );
  }

  if (phase === "loading" || !status) {
    return <div><Navbar /><div style={{ maxWidth: 700, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;
  }

  if (!status.exists) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: 48 }}>
          <p>No coding assessment is configured for this module.</p>
          <Link to={`/learning/${slug}`} className="btn btn-ghost" style={{ marginTop: 12, display: "inline-block" }}>← Back to course</Link>
        </div>
      </div>
    );
  }

  if (phase === "finalize-failed") {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: 48, textAlign: "center" }}>
          <p style={{ fontSize: 16, color: "var(--rust)" }}>
            We couldn't confirm your submission was received — this attempt has <strong>not</strong> been marked as submitted. Please check your internet connection and try again. Do not close this page.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={finalizing} onClick={() => finalize(lastFinalizeReasonRef.current)}>
            {finalizing ? "Retrying…" : "Retry submission"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "result" || autoSubmitted) {
    const passed = autoSubmitted ? false : !!result?.passed;
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 640, margin: "80px auto", padding: 24 }}>
          <div className="card" style={{ padding: 32, textAlign: "center" }}>
            {autoSubmitted ? (
              <>
                <div style={{ fontSize: 32 }}>⚠️</div>
                <h2 style={{ marginTop: 12, color: "var(--rust)" }}>Auto-submitted</h2>
                <p style={{ marginTop: 10, color: "var(--ink-dim)" }}>
                  Your assessment was automatically submitted after repeated proctoring violations, most recently{" "}
                  {autoSubmitReasonMsg}.
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 32 }}>{passed ? "✅" : "❌"}</div>
                <h2 style={{ marginTop: 12, color: passed ? "var(--mint)" : "var(--rust)" }}>
                  {passed ? "Assessment Passed" : "Assessment Failed"}
                </h2>
                <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>Overall Assessment Score</div>
                <div className="mono" style={{ fontSize: 28, fontWeight: 700 }}>{result?.score ?? 0}%</div>
                {/* This is an average across ALL assigned questions, including any never attempted (counted as
                    0% so skipping can't inflate it) — so it can legitimately differ from an individual question's
                    own score shown below. Both numbers are correct; this note is here so they don't read as
                    contradictory. */}
                {Array.isArray(result?.questionBreakdown) && result.questionBreakdown.some((q) => q.totalCases === 0) && (
                  <p style={{ marginTop: 4, fontSize: 12, color: "var(--ink-dim)" }}>
                    {result.questionBreakdown.filter((q) => q.totalCases === 0).length} of {result.questionBreakdown.length} question
                    {result.questionBreakdown.length === 1 ? "" : "s"} not attempted (counted as 0% in the overall score above).
                  </p>
                )}
                <p style={{ marginTop: 10, color: "var(--ink-dim)" }}>
                  {passed
                    ? "The next module is now unlocked."
                    : `You need ${status.test.passingPercent}% to pass. You can retry once your attempts/cooldown allow.`}
                </p>
                {result?.submittedAt && (
                  <p style={{ marginTop: 4, fontSize: 12, color: "var(--ink-dim)" }}>Submitted {new Date(result.submittedAt).toLocaleString()}</p>
                )}
                {Array.isArray(result?.questionBreakdown) && result.questionBreakdown.length > 0 && (
                  <div style={{ marginTop: 24, textAlign: "left" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Per-Question Result</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {result.questionBreakdown.map((q, i) => (
                        <div key={q.questionId} className="card" style={{ padding: 12, fontSize: 13 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                            <span className="mono">{q.title || `Question ${i + 1}`}</span>
                            <span title="This question's own score — may differ from the overall assessment score above.">
                              <span className="mono" style={{ fontWeight: 700 }}>{q.score}%</span>
                              <span style={{ fontSize: 11, color: "var(--ink-dim)", marginLeft: 4 }}>question score</span>
                            </span>
                          </div>
                          <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-dim)" }} className="mono">
                            {q.verdict} — {q.passedCases}/{q.totalCases} hidden test case{q.totalCases === 1 ? "" : "s"} passed
                            {q.timeMs != null && ` · ⏱ ${q.timeMs} ms`}
                            {q.memoryKb != null && ` · ${(q.memoryKb / 1024).toFixed(1)} MB`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            <Link to={`/learning/${slug}`} className="btn btn-primary" style={{ marginTop: 20, display: "inline-block" }}>
              ← Back to course
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (finalizing) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p className="mono">⏳ Grading your assessment — this can take a few seconds. Please don't close this tab.</p>
        </div>
      </div>
    );
  }

  if (phase === "preflight" || phase === "starting") {
    const t = status.test;
    return (
      <div>
        <Navbar />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div className="card" style={{ padding: 32, maxWidth: 560, marginTop: 24 }}>
            <span className="badge" style={{ background: "var(--amber)" }}>Official Test — graded{t.maxAttempts != null ? `, ${t.maxAttempts} attempt${t.maxAttempts === 1 ? "" : "s"} allowed` : ""}</span>
            <h2 style={{ marginTop: 10 }}>{t.title}</h2>
            <ChalkUnderline />
            {t.instructions && <p style={{ color: "var(--ink-dim)", marginTop: 10 }}>{t.instructions}</p>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20, fontSize: 13 }}>
              <InfoRow label="Questions" value={t.questionCount} />
              <InfoRow label="Time limit" value={`${t.timeLimitMin} min`} />
              <InfoRow label="Passing score" value={`${t.passingPercent}%`} />
              <InfoRow label="Max violations" value={t.maxViolations} />
              <InfoRow label="Attempts" value={t.maxAttempts == null ? "Unlimited" : `${status.attemptsUsed}/${t.maxAttempts} used`} />
              {status.bestScore != null && <InfoRow label="Best score across your attempts" value={`${status.bestScore}%`} />}
            </div>

            <p style={{ fontSize: 13, marginTop: 16, color: "var(--ink-dim)" }}>
              This assessment runs in fullscreen. Switching tabs, exiting fullscreen, copy/paste, right-click, and
              devtools shortcuts are blocked or logged{t.requireWebcam ? ", your face must stay visible in the camera" : ""}
              {t.requireMicrophone ? ", and your microphone must stay enabled" : ""}.
              Exceeding {t.maxViolations} violations auto-submits your assessment.
            </p>

            {!status.lessonsComplete ? (
              <Banner color="var(--amber-dark)">Complete this module's lessons and practice test first.</Banner>
            ) : status.alreadyPassed ? (
              <Banner color="var(--mint)">✓ You've already passed this assessment (best score {status.bestScore}%).</Banner>
            ) : !status.activeAttemptId && status.attemptsRemaining === 0 ? (
              <Banner color="var(--rust)">You've used all allowed attempts. Contact your instructor for an additional attempt.</Banner>
            ) : !status.activeAttemptId && status.cooldownRemainingSec > 0 ? (
              <Banner color="var(--amber-dark)">Please wait {Math.ceil(status.cooldownRemainingSec / 60)} more minute(s) before retrying.</Banner>
            ) : !status.activeAttemptId ? (
              <ReadinessChecklist
                proctor={proctor}
                requireWebcam={!!t.requireWebcam}
                requireMicrophone={!!t.requireMicrophone}
                requireFullscreen={t.requireFullscreen !== false}
                onReadyChange={setReadinessReady}
              />
            ) : null}

            <button
              className="btn btn-primary"
              style={{ marginTop: 20, width: "100%", padding: "12px 24px", opacity: status.canStart && (status.activeAttemptId || readinessReady) ? 1 : 0.4 }}
              onClick={beginOrResume}
              disabled={phase === "starting" || !status.canStart || (!status.activeAttemptId && !readinessReady)}
            >
              {phase === "starting" ? "Starting…" : status.activeAttemptId ? "Resume Assessment (Fullscreen)" : "Begin Assessment (Fullscreen)"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // phase === "active"
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "var(--slate-900)", color: "var(--chalk)", padding: isMobile ? "10px 12px" : "12px 24px", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: isMobile ? "1 1 100%" : "0 1 auto" }}>{status.test.title}</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 12, color: violationCount > 0 ? "var(--rust)" : "var(--ink-dim)" }}>
            ⚠ Violations: {violationCount}/{status.test.maxViolations}
          </span>
          {!isMobile && (
            <span className="mono" style={{ fontSize: 11, opacity: saveFailed ? 1 : 0.7, color: saveFailed ? "var(--rust)" : undefined }}>
              {saveFailed ? "⚠ Not saved — retrying…" : lastSavedAt ? `● Saved ${lastSavedAt.toLocaleTimeString()}` : "● Auto-save every 10s"}
            </span>
          )}
          <div className="mono" style={{ fontSize: isMobile ? 16 : 20, color: secondsLeft < 120 ? "var(--rust)" : "var(--amber)" }}>{timeLabel}</div>
        </div>
        <button className="btn btn-primary" onClick={() => finalize(null)}>Submit Assessment</button>
      </div>

      {micBlocked && (
        <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "12px 24px", fontSize: 13, fontWeight: 700, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
          <span>Microphone is disabled. Please enable your microphone to continue.</span>
          <button className="btn btn-ghost" style={{ borderColor: "#fff", color: "#fff" }} onClick={proctor.requestMedia} disabled={proctor.requestingMedia}>
            {proctor.requestingMedia ? "Reconnecting…" : "Re-enable Microphone"}
          </button>
        </div>
      )}

      {status.test.requireWebcam && (
        <video ref={proctor.videoRef} autoPlay muted playsInline style={{
          position: "fixed", bottom: 16, right: 16, width: isMobile ? 84 : 140, height: isMobile ? 63 : 105, borderRadius: 8,
          objectFit: "cover", background: "#000", zIndex: 50,
          border: proctor.faceStatus !== "OK" ? "3px solid var(--rust)" : "2px solid var(--amber)",
        }} />
      )}

      {proctor.faceStatus === "MISSING" && (
        <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "12px 24px", fontSize: 13, fontWeight: 700, textAlign: "center" }}>
          ⚠ No face detected — please stay visible in the camera frame.
        </div>
      )}
      {proctor.faceStatus === "MULTIPLE" && (
        <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "12px 24px", fontSize: 13, fontWeight: 700, textAlign: "center" }}>
          ⚠ Multiple faces detected — only you may be in frame during this assessment.
        </div>
      )}
      {violationWarning && (
        <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "12px 24px", fontSize: 13, fontWeight: 700, textAlign: "center" }}>
          ⚠ {violationWarning}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flex: 1, overflow: isMobile ? "auto" : "hidden" }}>
        <div
          style={
            isMobile
              ? { width: "100%", borderBottom: "1px solid var(--line)", padding: "10px 12px", display: "flex", gap: 8, overflowX: "auto", flexShrink: 0 }
              : { width: 200, borderRight: "1px solid var(--line)", padding: 16, overflowY: "auto" }
          }
        >
          {!isMobile && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>QUESTIONS</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 10 }}>
                Question {activeIdx + 1} of {questions.length}
              </div>
            </>
          )}
          {questions.map((q, idx) => {
            const dot = codingDotStatus(q, codeVerdicts, visited);
            return (
              <button
                key={q.id}
                onClick={() => setActiveIdx(idx)}
                style={{
                  display: isMobile ? "inline-block" : "block",
                  width: isMobile ? "auto" : "100%",
                  minWidth: isMobile ? 150 : undefined,
                  flexShrink: isMobile ? 0 : undefined,
                  textAlign: "left", padding: "10px 12px", marginBottom: isMobile ? 0 : 6, borderRadius: 8,
                  border: idx === activeIdx ? "1px solid var(--amber)" : "1px solid var(--line)",
                  background: idx === activeIdx ? "#FCEFD9" : "var(--card-bg)", fontSize: 13,
                  color: idx === activeIdx ? "var(--amber-dark)" : "var(--ink)",
                }}
              >
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: dot.color, marginRight: 6 }} />
                Q{idx + 1}. {q.title || "(untitled)"}
                <span style={{ display: "block", fontSize: 11, marginTop: 2, marginLeft: 14, color: dot.color }} className="mono">
                  {dot.label}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ width: isMobile ? "100%" : 380, padding: isMobile ? 16 : 24, overflowY: "auto", flexShrink: 0, borderRight: isMobile ? "none" : "1px solid var(--line)", borderBottom: isMobile ? "1px solid var(--line)" : "none" }}>
          {current && (
            <>
              <ProblemStatement question={current} />
              {(!current.testCases || current.testCases.length === 0) && (
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>All test cases are hidden for this question.</p>
              )}
            </>
          )}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => goToQuestion(-1)} disabled={activeIdx === 0}>
                ◀ Previous
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => goToQuestion(1)} disabled={activeIdx === questions.length - 1}>
                Next ▶
              </button>
              <select value={answer?.language || allowedLanguages[0]} onChange={(e) => setLanguage(e.target.value)} className="mono" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--line)" }}>
                {ALL_LANGUAGES.filter((l) => allowedLanguages.includes(l.id)).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <RunSubmitButtons
              onRun={handleRun}
              onSubmit={handleSubmitCode}
              running={running}
              submitting={submittingCode}
              runDisabled={micBlocked}
              submitDisabled={micBlocked}
            />
          </div>
          <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", padding: "6px 16px 0" }}>
            Your code is auto-saved every 10 seconds. "Run" checks against sample cases only — "Submit" grades this
            question against all test cases, including hidden ones, right away.
          </p>
          <div style={{ height: isMobile ? Math.min(editorHeight, 320) : editorHeight, minHeight: 0, flexShrink: 0 }}>
            <Editor
              height="100%"
              language={ALL_LANGUAGES.find((l) => l.id === answer?.language)?.monaco}
              value={answer?.code || ""}
              onChange={(v) => setCode(v || "")}
              theme="vs-dark"
              options={{ fontSize: 14, minimap: { enabled: false }, fontFamily: "JetBrains Mono, monospace" }}
            />
          </div>
          <div
            onMouseDown={isMobile ? undefined : startResize}
            title="Drag to resize editor"
            style={{ height: 9, cursor: "row-resize", background: "var(--line)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <div style={{ width: 40, height: 3, borderRadius: 2, background: "var(--ink-dim)" }} />
          </div>
          <div style={{ flex: 1, minHeight: 80, overflowY: "auto", padding: 16, background: "#FBF9F4" }}>
            {submitResultMsg && !running && (
              <div
                className="mono"
                style={{
                  padding: "10px 12px", borderRadius: 8, marginBottom: runResult ? 12 : 0, fontSize: 12.5, fontWeight: 600,
                  background: submitResultMsg.ok ? "#E7F3EB" : "#F7E4E0",
                  color: submitResultMsg.ok ? "var(--mint)" : "var(--rust)",
                  border: `1px solid ${submitResultMsg.ok ? "var(--mint)" : "var(--rust)"}`,
                }}
              >
                {submitResultMsg.ok ? "✓ " : "✗ "}{submitResultMsg.text}
              </div>
            )}
            {running && <p className="mono" style={{ fontSize: 12, color: "var(--amber-dark)", fontWeight: 600 }}>⏳ Compiling and running…</p>}
            {!running && runResult && <CodeResultBlock title="Sample run result" result={runResult} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>{label}</div>
      <div className="mono" style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Banner({ color, children }) {
  return (
    <div style={{ marginTop: 16, padding: 14, borderRadius: 8, border: `1px solid ${color}`, color, fontSize: 13, fontWeight: 600 }}>
      {children}
    </div>
  );
}


const VERDICT_LABEL = {
  ACCEPTED: "Accepted",
  WRONG_ANSWER: "Wrong Answer",
  COMPILE_ERROR: "Compilation Error",
  RUNTIME_ERROR: "Runtime Error",
  TLE: "Time Limit Exceeded",
  MLE: "Memory Limit Exceeded",
};

function describeVerdict(data) {
  const label = VERDICT_LABEL[data.verdict] || data.verdict || "Submitted";
  if (data.verdict === "ACCEPTED") {
    return `${label} — ${data.passedCases}/${data.totalCases} hidden test cases passed.`;
  }
  if (["COMPILE_ERROR", "RUNTIME_ERROR", "TLE", "MLE"].includes(data.verdict) && data.errorSummary?.message) {
    return `${label}: ${data.errorSummary.message}`;
  }
  return `${label} — ${data.passedCases ?? 0}/${data.totalCases ?? 0} hidden test cases passed.`;
}

// Drives the navigator's colored status dot — Gray (never opened), Yellow (opened but never
// Submitted), Green (Submitted, Accepted), Red (Submitted, any other verdict).
function codingDotStatus(question, verdicts, visitedMap) {
  const v = verdicts[question.id];
  if (v) return v.verdict === "ACCEPTED" ? { color: "var(--mint)", label: "Accepted" } : { color: "var(--rust)", label: VERDICT_LABEL[v.verdict] || "Failed" };
  if (visitedMap[question.id]) return { color: "var(--amber)", label: "In Progress" };
  return { color: "var(--ink-dim)", label: "Not Visited" };
}

