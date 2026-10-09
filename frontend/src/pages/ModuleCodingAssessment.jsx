import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import api, { API_BASE_URL } from "../api";
import { useGamification } from "../context/GamificationContext";
import { useProctoring } from "../hooks/useProctoring";
import { useScreenShare } from "../hooks/useScreenShare";
import useIsMobile from "../hooks/useIsMobile";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CodeResultBlock from "../components/CodeResultBlock";
import RunSubmitButtons from "../components/RunSubmitButtons";
import ProblemStatement from "../components/ProblemStatement";
import ReadinessChecklist from "../components/ReadinessChecklist";
import { CODE_LANGUAGES as ALL_LANGUAGES, defaultStarter } from "../utils/codeEditorDefaults";
import { applyPlainTextInputHints, watchForNonAsciiInput } from "../utils/monacoSetup";
import { createEventReporter, watchCodeInsertion } from "../utils/examSecurityClient";

const AUTOSAVE_INTERVAL_MS = 10000; // spec: auto-save every 10 seconds

const VIOLATION_LABEL = {
  TAB_SWITCH: "switching tabs",
  TAB_SWITCH_BRIEF: "the assessment screen losing focus briefly",
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
  const { slug, moduleId, levelId } = useParams();
  // A chapter Level and the legacy module-direct assessment share every route below except this prefix.
  const base = levelId ? `/module-coding/level/${levelId}` : `/module-coding/module/${moduleId}`;
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
  // Distinct from violationWarning above: shown for a SUSPICIOUS-severity event that did NOT get
  // penalized this time (e.g. the 1st or 2nd copy/paste attempt, not yet the 3rd that escalates)
  // -- see backend/src/utils/proctoringSeverity.js. Softer styling, no "X/Y" counter (since it
  // didn't actually count), and a note that repeating it will start counting.
  const [suspiciousNotice, setSuspiciousNotice] = useState(null);
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
  // Height of the results panel under the editor. The editor itself flexes to fill what is left, so the results are
  // always on screen instead of being pushed below the fold by a fixed-height editor.
  const [resultsHeight, setResultsHeight] = useState(() => Number(localStorage.getItem("moduleCodingResultsHeight")) || 260);
  // Personal layout preferences, remembered on this device: panel widths, editor font and theme, collapsed sidebar.
  const readPref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const savePref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
  const [problemWidth, setProblemWidth] = useState(() => readPref("mcProblemWidth", 380));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readPref("mcSidebarCollapsed", false));
  const [editorFont, setEditorFont] = useState(() => readPref("mcEditorFont", 14));
  const [editorTheme, setEditorTheme] = useState(() => readPref("mcEditorTheme", "vs-dark"));
  const runRef = useRef(null);
  const submitRef = useRef(null);
  const resizingRef = useRef(false);

  const monacoEditorRef = useRef(null); // set on mount — lets the mobile Indent/Outdent buttons below drive the editor directly, since a touch keyboard has no physical Tab key at all
  // Whatever compiler language the student is already using on this assessment — set the first
  // time any coding question resolves a language (default or explicit pick) and again on every
  // explicit switch (setLanguage below), then reused as the default for every subsequent
  // not-yet-opened question instead of each one independently resetting to the platform default.
  const preferredLanguageRef = useRef(null);
  // See watchForNonAsciiInput's own comment: no webpage can force off a student's active
  // third-party keyboard/IME app, so applyPlainTextInputHints below is a hint, not a guarantee.
  // This state instead catches the actual observable moment it fails — a composed non-English
  // character landing in the code — and surfaces it immediately.
  const [imeWarning, setImeWarning] = useState(false);

  function handleEditorMount(editor, monaco) {
    monacoEditorRef.current = editor;
    // Ctrl/Cmd+Enter runs the samples, Ctrl/Cmd+Shift+Enter submits. Only these combinations are bound; normal typing is untouched.
    if (monaco) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.());
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => submitRef.current?.());
    }
    applyPlainTextInputHints(editor);
    watchForNonAsciiInput(editor, () => setImeWarning(true));
    // Evidence only: a large insertion that did not come from typing is logged for human review, never punished automatically.
    insertionWatchRef.current?.();
    if (policyRef.current && statusRef.current?.test?.proctoring !== false) {
      insertionWatchRef.current = watchCodeInsertion(editor, {
        charThreshold: policyRef.current.insertionCharThreshold, lineThreshold: policyRef.current.insertionLineThreshold,
        onInsertion: (m) => reporterRef.current?.report("SUSPICIOUS_CODE_INSERTION", m, activeQuestionIdRef.current),
      });
    }
  }

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
    api.get(base)
      .then((res) => { setStatus(res.data); setPhase("preflight"); })
      .catch((err) => setError(err.response?.data?.error || "Failed to load coding assessment"));
  }
  useEffect(() => { load(); }, [moduleId, levelId]);

  // Another tab took over this attempt (policy BLOCK): stop this one cleanly instead of letting it fail silently.
  useEffect(() => {
    const id = api.interceptors.response.use((r) => r, (err) => {
      const code = err.response?.data?.code;
      if (code === "SESSION_REPLACED") setSessionLost(true);
      // Secure-exam environment lost or locked: the attempt, answers and timer are preserved on the server; the exam is paused here.
      if (["SECURE_SESSION_LOST", "SESSION_LOCKED", "SECURE_SESSION_INVALID", "SECURE_SESSION_EXPIRED", "SECURE_CAPABILITY_MISSING", "DEVICE_NOT_ALLOWED", "VERSION_MISMATCH", "SECURE_CLIENT_REQUIRED"].includes(code)) {
        setSecurityHold({ code, message: err.response.data.error });
      }
      return Promise.reject(err);
    });
    return () => api.interceptors.response.eject(id);
  }, []);

  // Connectivity evidence (not a violation): lets a reviewer tell a dropped connection from other activity.
  useEffect(() => {
    const off = () => reporterRef.current?.report("NETWORK_DISCONNECT");
    const on = () => reporterRef.current?.report("NETWORK_RECONNECT");
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
      insertionWatchRef.current?.();
      reporterRef.current?.stop();
      delete api.defaults.headers.common["X-Exam-Session"];
    };
  }, []);

  // Every violation type is reported to the server, which classifies it into one of four
  // severities (see backend/src/utils/proctoringSeverity.js) and decides -- never trusted
  // client-side -- whether THIS occurrence counts toward the maxViolations auto-submit limit:
  //   CONFIRMED_VIOLATION (tab switch, fullscreen exit, camera/mic dropped) -- always counts.
  //   SUSPICIOUS (copy/paste, right-click, devtools attempt, screen overlay, etc.) -- a soft
  //     notice the first couple of times; only escalates into a real strike after repeating.
  //   INTERRUPTION (face missing, etc.) -- never counts, no matter how often.
  // Previously every type here showed the identical "Warning X/Y ... will auto-submit" banner and
  // counted the same on every single occurrence -- exactly the false-violation behavior this and
  // the severity taxonomy were built to stop.
  async function onViolation(type) {
    if (!attemptIdRef.current || finalizedRef.current) return;
    try {
      const { data } = await api.post(`/module-coding/attempts/${attemptIdRef.current}/violation`, { type });
      if (data.penalized) setViolationCount(data.violationCount);
      if (data.autoSubmitted) {
        finalizedRef.current = true;
        setAutoSubmitted(true);
        setAutoSubmitReasonMsg(VIOLATION_LABEL[type] || "a proctoring violation");
        proctor.stopMedia();
        proctor.releaseFullscreen();
      } else if (data.penalized) {
        const msg = `Warning ${data.violationCount}/${data.maxViolations}: ${VIOLATION_LABEL[type] || type}. The assessment will auto-submit if this continues.`;
        setViolationWarning(msg);
        setTimeout(() => setViolationWarning((m) => (m === msg ? null : m)), 6000);
      } else if (data.severity === "SUSPICIOUS") {
        const msg = `Notice: ${VIOLATION_LABEL[type] || type} was detected. This didn't count this time, but repeating it will.`;
        setSuspiciousNotice(msg);
        setTimeout(() => setSuspiciousNotice((m) => (m === msg ? null : m)), 5000);
      }
    } catch {
      // best-effort
    }
  }

  const policy = status?.security || null;
  const policyRef = useRef(null);
  const statusRef = useRef(null);
  policyRef.current = policy;
  statusRef.current = status;
  const sessionIdRef = useRef("");
  const insertionWatchRef = useRef(null);
  const [sessionLost, setSessionLost] = useState(false);
  const [securityHold, setSecurityHold] = useState(null); // { code, message } while the secure environment is lost/locked
  const reporterRef = useRef(null);
  if (!reporterRef.current) reporterRef.current = createEventReporter({ getAttemptId: () => attemptIdRef.current, getSessionId: () => sessionIdRef.current });

  const proctor = useProctoring({
    active: phase === "active" && status?.test?.proctoring !== false,
    requireFullscreen: status?.test?.requireFullscreen !== false,
    requireWebcam: !!status?.test?.requireWebcam,
    requireMicrophone: !!status?.test?.requireMicrophone,
    onViolation,
    blocks: { copy: policy?.blockCopy, paste: policy?.blockPaste, cut: policy?.blockCut, contextMenu: policy?.blockContextMenu, drag: policy?.blockDrag },
  });
  // Optional whole-screen share for PROCTORED exams: evidence + on-screen hold, never a server lock (a page cannot enforce it).
  const screenRequired = !!policy?.requireScreenShare && status?.test?.proctoring !== false;
  const screen = useScreenShare({ required: screenRequired, active: phase === "active", onStopped: () => reporterRef.current?.report("SCREEN_SHARE_STOPPED") });
  const micBlocked = !!status?.test?.requireMicrophone && proctor.micStatus === "UNAVAILABLE";
  // Mirrors micBlocked -- previously had no equivalent at all, so a webcam-required assessment
  // showed no warning and never disabled Run/Submit if the camera disconnected or permission was
  // revoked mid-attempt, silently defeating the proctoring requirement that's the whole reason
  // requireWebcam exists on this test. Confirmed missing 2026-10-01.
  const cameraBlocked = !!status?.test?.requireWebcam && proctor.cameraStatus === "UNAVAILABLE";

  async function beginOrResume() {
    setPhase("starting");
    try {
      if (status?.test?.requireFullscreen !== false) {
        // Routed through proctor.requestFullscreen() (fullscreenCompat.js) instead of a raw
        // document.documentElement.requestFullscreen?.() call -- gets the vendor-prefixed fallback
        // and diagnostic logging for free, and keeps fullscreenOk in sync from the very first
        // entry attempt, not just later re-entries.
        await proctor.requestFullscreen();
      }
      const { data } = await api.post(`${base}/start`);
      setAttemptId(data.attemptId);
      attemptIdRef.current = data.attemptId;
      // This tab now owns the attempt's single active session (the server rejects older tabs when the policy says BLOCK).
      sessionIdRef.current = data.sessionId || "";
      if (data.sessionId) api.defaults.headers.common["X-Exam-Session"] = data.sessionId;
      reporterRef.current.start();
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
      //
      // Deliberately only pre-populates `initialAnswers` for questions with real saved progress —
      // a NOT-yet-saved question is left unset here on purpose (undefined, not defaulted to
      // allowedLanguages[0]) so the lazy per-question-open effect below can resolve it against
      // whatever language the student is already using elsewhere in this attempt, the moment it's
      // actually opened. Populating every question upfront with a fixed default was the actual
      // cause of "picked Python on Q1, Q2 still shows Java" — every question already had its own
      // independent answer entry before the student ever touched anything, so a later language
      // switch on Q1 had nothing left to propagate to.
      const initialAnswers = {};
      const restoredVerdicts = {};
      const restoredVisited = {};
      const initialDrafts = {};
      let lastRestoredCodingLang = null;
      data.questions.forEach((q) => {
        const saved = data.savedAnswers?.[q.id];
        if (!saved) return;
        const lang = saved.language;
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
        const code = saved.code ?? (q.starterCodeByLanguage?.[lang] || defaultStarter(lang));
        initialAnswers[q.id] = { language: lang, code };
        initialDrafts[q.id] = { [lang]: code };
        lastSavedCodeRef.current[q.id] = `${lang}:${code}`;
        restoredVisited[q.id] = true;
        if (saved.verdict) {
          restoredVerdicts[q.id] = { verdict: saved.verdict, passedCases: saved.passedCases, totalCases: saved.totalCases };
        }
        if (lang !== "sql") lastRestoredCodingLang = lang;
      });
      // Resuming after a refresh carries the most recently-autosaved coding language forward as
      // the preference for any question not yet opened this session, same as picking it live would.
      if (lastRestoredCodingLang) preferredLanguageRef.current = lastRestoredCodingLang;
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
    const q = questions[activeIdx];
    const id = q?.id;
    activeQuestionIdRef.current = id ?? null;
    if (!id) return;
    setVisited((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    setRunResult(null);
    setSubmitResultMsg(null);

    // Lazily resolves THIS question's language/code the first time it's actually opened with no
    // saved/previously-set answer — using whatever language the student is already using
    // elsewhere in this attempt (preferredLanguageRef, seeded on resume and updated on every
    // explicit setLanguage() switch) instead of independently resetting to a fixed default. Only
    // ever touches a question with no existing answer at all — an already-answered or
    // already-opened question is never silently changed underneath the student.
    setAnswers((prev) => {
      if (prev[id]) return prev;
      const allowed = Array.isArray(allowedLanguages) && allowedLanguages.length > 0 ? allowedLanguages : ["python"];
      const preferred = preferredLanguageRef.current;
      const lang = (preferred && allowed.includes(preferred)) ? preferred
        : allowed.includes("python") ? "python" // platform-wide default compiler
        : allowed[0];
      preferredLanguageRef.current = lang;
      const code = q.starterCodeByLanguage?.[lang] || defaultStarter(lang);
      setLangDrafts((d) => (d[id]?.[lang] !== undefined ? d : { ...d, [id]: { ...d[id], [lang]: code } }));
      return { ...prev, [id]: { language: lang, code } };
    });
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
      setResultsHeight((h) => Math.min(520, Math.max(140, h - e.movementY)));
    }
    function onUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      setResultsHeight((h) => { localStorage.setItem("moduleCodingResultsHeight", String(h)); return h; });
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

  runRef.current = handleRun;
  submitRef.current = handleSubmitCode;
  const solvedCount = questions.filter((q) => codeVerdicts[q.id]?.verdict === "ACCEPTED").length;
  const timeColor = secondsLeft !== null && secondsLeft < 120 ? "var(--rust)" : secondsLeft !== null && secondsLeft < 600 ? "var(--amber)" : "var(--chalk)";

  function resetToStarter() {
    if (!current) return;
    if (!confirm("Replace your code for this question with the starting template? This cannot be undone.")) return;
    const language = answer?.language || allowedLanguages[0];
    const code = current.starterCodeByLanguage?.[language] || defaultStarter(language);
    setAnswers((prev) => ({ ...prev, [current.id]: { ...prev[current.id], code } }));
    setLangDrafts((prev) => ({ ...prev, [current.id]: { ...prev[current.id], [language]: code } }));
  }

  function setCode(code) {
    if (!current) return;
    const language = answer?.language || preferredLanguageRef.current || allowedLanguages[0];
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
    // An explicit switch becomes the new preference for every not-yet-opened question too — see
    // preferredLanguageRef's own comment.
    preferredLanguageRef.current = language;
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
        const res = await api.post(`/module-coding/attempts/${attemptId}/finalize`, { reason }, { timeout: 180000 });
        data = res.data;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }

    if (!data) {
      finalizingRef.current = false;
      setFinalizing(false);
      proctor.releaseFullscreen();
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
    proctor.releaseFullscreen();
    proctor.stopMedia();
    setResult(data);
    notify(data.gamification);
    finalizingRef.current = false;
    setFinalizing(false);
    setPhase("result");
  }

  // Practice-track levels return to their topic (the next level is offered there); other assessments return to the course.
  const backHref = status?.practice ? `/learning/${slug}/practice/topic/${status.practice.chapterId}?after=${levelId || ""}` : `/learning/${slug}`;

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
            <Link to={backHref} className="btn btn-primary" style={{ marginTop: 20, display: "inline-block" }}>
              {status.practice ? "Continue →" : "← Back to course"}
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
    // Mandatory server-evaluated requirements: Start stays disabled until they pass (the server re-checks on start).
    const sc = status.securityCheck;
    const securityBlocked = (!!sc && !status.activeAttemptId && (sc.mobileBlocked || (sc.secureBrowserRequired && !sc.secureBrowserOk))) || (screenRequired && screen.state !== "sharing");
    return (
      <div>
        <Navbar />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div className="card" style={{ padding: 32, maxWidth: 560, marginTop: 24 }}>
            <span className="badge" style={{ background: "var(--amber)" }}>Official Test — graded{t.maxAttempts != null ? `, ${t.maxAttempts} attempt${t.maxAttempts === 1 ? "" : "s"} allowed` : ""}</span>
            <h2 style={{ marginTop: 10 }}>{t.title}</h2>
            <ChalkUnderline />
            {t.instructions && <p style={{ color: "var(--ink-dim)", marginTop: 10, whiteSpace: "pre-line" }}>{t.instructions}</p>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20, fontSize: 13 }}>
              <InfoRow label="Questions" value={t.questionCount} />
              <InfoRow label="Time limit" value={`${t.timeLimitMin} min`} />
              <InfoRow label="Passing score" value={`${t.passingPercent}%`} />
              {t.proctoring !== false && <InfoRow label="Max violations" value={t.maxViolations} />}
              <InfoRow label="Attempts" value={t.maxAttempts == null ? "Unlimited" : `${status.attemptsUsed}/${t.maxAttempts} used`} />
              {status.bestScore != null && <InfoRow label="Best score across your attempts" value={`${status.bestScore}%`} />}
            </div>

            {t.proctoring === false ? (
              <p style={{ fontSize: 13, marginTop: 16, color: "var(--ink-dim)" }}>Practice level: switching tabs or windows is fine and nothing is monitored. Your code is auto-saved every 10 seconds, and the timer keeps running.</p>
            ) : (
            <p style={{ fontSize: 13, marginTop: 16, color: "var(--ink-dim)" }}>
              This assessment runs in fullscreen. Switching tabs, exiting fullscreen, copy/paste, right-click, and
              devtools shortcuts are blocked or logged{t.requireWebcam ? ", your face must stay visible in the camera" : ""}
              {t.requireMicrophone ? ", and your microphone must stay enabled" : ""}.
              Exceeding {t.maxViolations} violations auto-submits your assessment.
            </p>
            )}

            <SecurityCheck policy={policy} check={status.securityCheck} />
            {screenRequired && (
              <section aria-label="Screen sharing" style={{ marginTop: 12, border: `1px solid ${screen.state === "sharing" ? "var(--mint)" : "var(--amber-dark)"}`, borderRadius: 10, padding: 14 }}>
                <div className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>SCREEN SHARING REQUIRED</div>
                <p style={{ fontSize: 13, margin: "6px 0 10px" }}>
                  {screen.state === "sharing" ? "✓ Your entire screen is being shared. Keep sharing until you submit; stopping the share is recorded and pauses the exam."
                    : screen.state === "wrong-surface" ? "✗ You shared a window or a tab. Choose \"Entire screen\" and try again."
                    : screen.state === "denied" ? "✗ Screen sharing was cancelled or blocked. Allow it in the browser prompt and try again."
                    : screen.state === "unsupported" ? "✗ This browser cannot share the screen. Use a recent Chrome or Edge on a computer."
                    : "This exam requires you to share your entire screen. Nothing is recorded by the page; your invigilator or institution decides whether it is recorded."}
                </p>
                {screen.state !== "sharing" && screen.supported && <button className="btn btn-primary" onClick={screen.request} disabled={screen.state === "requesting"}>{screen.state === "requesting" ? "Waiting for your choice…" : "Share my entire screen"}</button>}
              </section>
            )}

            {!status.lessonsComplete ? (
              <Banner color="var(--amber-dark)">{status.lockReason || "Complete this module's lessons and practice test first."}</Banner>
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
              style={{ marginTop: 20, width: "100%", padding: "12px 24px", opacity: status.canStart && !securityBlocked && (status.activeAttemptId || readinessReady) ? 1 : 0.4 }}
              onClick={beginOrResume}
              disabled={phase === "starting" || !status.canStart || securityBlocked || (!status.activeAttemptId && !readinessReady)}
            >
              {phase === "starting" ? "Starting…" : status.activeAttemptId ? `Resume ${t.requireFullscreen !== false ? "Assessment (Fullscreen)" : "Level"}` : (t.requireFullscreen !== false ? "Begin Assessment (Fullscreen)" : "Start Level")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Required screen share stopped mid-exam: the exam is hidden until it is restored (the stop is already recorded as evidence).
  if (screenRequired && phase === "active" && screen.state !== "sharing") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" role="alert" style={{ padding: 32, maxWidth: 520, textAlign: "center" }}>
          <h2>Screen sharing stopped</h2>
          <p style={{ marginTop: 10, color: "var(--ink-dim)" }}>This exam requires your entire screen to be shared. Share it again to continue. The timer keeps running and your answers are saved.</p>
          {screen.state === "wrong-surface" && <p style={{ marginTop: 8, color: "var(--rust)", fontSize: 13 }}>Choose "Entire screen", not a window or tab.</p>}
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={screen.request} disabled={screen.state === "requesting"}>{screen.state === "requesting" ? "Waiting…" : "Share my entire screen again"}</button>
        </div>
      </div>
    );
  }

  // The secure exam environment is lost or the exam is locked: nothing can be done from this screen except wait or call the invigilator.
  if (securityHold && phase === "active") {
    const locked = securityHold.code === "SESSION_LOCKED";
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" role="alert" style={{ padding: 32, maxWidth: 520, textAlign: "center" }}>
          <h2>{locked ? "Exam locked" : "Secure exam paused"}</h2>
          <p style={{ marginTop: 10, color: "var(--ink-dim)" }}>{securityHold.message}</p>
          <p style={{ marginTop: 10, fontSize: 13 }}>Your answers and the timer are safe on the server. The timer keeps running.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            {!locked && <button className="btn btn-primary" onClick={() => setSecurityHold(null)}>I have reconnected — continue</button>}
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }

  // Another tab owns this attempt now (policy BLOCK).
  if (sessionLost) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" role="alert" style={{ padding: 32, maxWidth: 480, textAlign: "center" }}>
          <h2>Open in another tab</h2>
          <p style={{ marginTop: 10, color: "var(--ink-dim)" }}>This assessment was opened in another tab or window, so this one has been stopped to keep your attempt safe. Your saved code and the timer are unchanged. Close this tab and continue in the other one, or reload this page to take the attempt over here.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>Reload and continue here</button>
        </div>
      </div>
    );
  }

  // phase === "active"
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {policy && policy.level !== "STANDARD" && status.test.proctoring !== false && (
        <div role="note" className="mono" style={{ background: "var(--slate-900)", color: "var(--amber)", padding: "6px 24px", fontSize: 11.5, textAlign: "center" }}>
          {policy.level === "LOCKDOWN" ? "LOCKDOWN EXAM MODE" : "STRICT EXAM MODE"} — unauthorized AI tools, browser extensions, external assistance and copy/paste are not permitted. Security events may be logged and reviewed under your institution's exam policy.
        </div>
      )}
      <div style={{ background: "var(--slate-900)", color: "var(--chalk)", padding: isMobile ? "10px 12px" : "12px 24px", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: isMobile ? "1 1 100%" : "0 1 auto" }}>{status.test.title}</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {status.test.proctoring !== false && (
          <span className="mono" style={{ fontSize: 12, color: violationCount > 0 ? "var(--rust)" : "var(--ink-dim)" }}>
            ⚠ Violations: {violationCount}/{status.test.maxViolations}
          </span>
          )}
          {!isMobile && (
            <span className="mono" style={{ fontSize: 11, opacity: saveFailed ? 1 : 0.7, color: saveFailed ? "var(--rust)" : undefined }}>
              {saveFailed ? "⚠ Not saved — retrying…" : lastSavedAt ? `● Saved ${lastSavedAt.toLocaleTimeString()}` : "● Auto-save every 10s"}
            </span>
          )}
          <span className="mono" style={{ fontSize: 12 }} title="Questions you submitted that were accepted">✓ {solvedCount}/{questions.length} solved</span>
          <div className="mono" role="timer" aria-label="Time left" style={{ fontSize: isMobile ? 16 : 20, color: timeColor, fontWeight: secondsLeft !== null && secondsLeft < 600 ? 700 : 400 }}>{timeLabel}</div>
        </div>
        <button className="btn btn-primary" onClick={() => finalize(null)}>Submit Assessment</button>
      </div>

      {cameraBlocked && (
        <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "12px 24px", fontSize: 13, fontWeight: 700, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
          <span>Camera is unavailable — it may be off, blocked, or permission was revoked.</span>
          <button className="btn btn-ghost" style={{ borderColor: "#fff", color: "#fff" }} onClick={proctor.requestMedia} disabled={proctor.requestingMedia}>
            {proctor.requestingMedia ? "Reconnecting…" : "Reconnect Camera"}
          </button>
        </div>
      )}
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

      {/* Deliberately NOT reported through onViolation/the violation log — moduleCoding.js's
          endpoint currently penalizes every event type it receives (a separate, already-flagged
          issue), so wiring a model-load failure through that path would falsely cost the student
          a strike for a network/CDN problem that isn't their doing. This is a student-facing
          notice only, visible in the console for a developer, until that endpoint is fixed to
          distinguish penalized from logged-only events the way interview.js already does. */}
      {status.test.requireWebcam && proctor.faceModelStatus === "unavailable" && (
        <div className="mono" style={{ background: "var(--amber)", color: "#3a2c00", padding: "10px 24px", fontSize: 12, fontWeight: 700, textAlign: "center" }}>
          ⚠ Face detection could not start (likely a network/firewall issue) — your camera feed is still shown, but presence isn't being automatically checked this session.
        </div>
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
      {suspiciousNotice && (
        <div className="mono" style={{ background: "var(--amber)", color: "#3a2c00", padding: "10px 24px", fontSize: 12, fontWeight: 700, textAlign: "center" }}>
          {suspiciousNotice}
        </div>
      )}
      {/* Informational only, never a warning/violation styling -- a device rotating is normal. */}
      {proctor.orientationNotice && (
        <div className="mono" style={{ background: "var(--card-bg, #F7F7F5)", color: "var(--ink-dim)", padding: "8px 24px", fontSize: 12, textAlign: "center", borderBottom: "1px solid var(--line)" }}>
          Screen orientation changed. Please continue your assessment.
        </div>
      )}

      {/* Persistent (unlike violationWarning above, which auto-dismisses) so a fullscreen
          rejection that never resolves -- a browser only exposing a vendor-prefixed API that
          somehow still failed, or a platform with no Fullscreen API for non-<video> elements at
          all -- stays honestly visible instead of silently proceeding as if it were active. This
          is exactly the "tab-switch-and-return doesn't restore fullscreen" symptom: previously
          every rejection here was a completely silent no-op with no trace and no student-facing
          indication at all. Tab-switch/violation monitoring keeps working regardless either way. */}
      {status?.test?.requireFullscreen !== false && !proctor.fullscreenOk && (
        <div
          className="mono"
          style={{ background: "var(--amber)", color: "#3a2c00", padding: "10px 24px", fontSize: 13, fontWeight: 700, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, flexWrap: "wrap" }}
        >
          <span>⚠ Fullscreen isn't active. Your browser may not support it, or the request was blocked — tab-switch monitoring is still active regardless.</span>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px", background: "#fff", color: "#1C1B18" }} onClick={() => proctor.requestFullscreen()}>
            Enter Fullscreen
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flex: 1, overflow: isMobile ? "auto" : "hidden" }}>
        <div
          style={
            isMobile
              ? { width: "100%", borderBottom: "1px solid var(--line)", padding: "10px 12px", display: "flex", gap: 8, overflowX: "auto", flexShrink: 0 }
              : { width: sidebarCollapsed ? 56 : 200, borderRight: "1px solid var(--line)", padding: sidebarCollapsed ? 8 : 16, overflowY: "auto", flexShrink: 0, transition: "width .15s" }
          }
        >
          {!isMobile && (
            <button type="button" className="btn btn-ghost" aria-label={sidebarCollapsed ? "Expand question list" : "Collapse question list"} title={sidebarCollapsed ? "Expand question list" : "Collapse question list"} style={{ fontSize: 12, padding: "2px 8px", marginBottom: 8 }} onClick={() => setSidebarCollapsed((v) => { savePref("mcSidebarCollapsed", !v); return !v; })}>{sidebarCollapsed ? "»" : "« Hide"}</button>
          )}
          {!isMobile && !sidebarCollapsed && (
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
                title={q.title || "(untitled)"}
                aria-current={idx === activeIdx ? "true" : undefined}
                onClick={() => setActiveIdx(idx)}
                style={{
                  display: isMobile ? "inline-block" : "block",
                  width: isMobile ? "auto" : "100%",
                  minWidth: isMobile ? 150 : undefined,
                  flexShrink: isMobile ? 0 : undefined,
                  textAlign: "left", padding: "10px 12px", marginBottom: isMobile ? 0 : 6, borderRadius: 8,
                  border: idx === activeIdx ? "1px solid var(--amber)" : "1px solid var(--line)",
                  background: idx === activeIdx ? "var(--warning-bg)" : "var(--card-bg)", fontSize: 13,
                  color: idx === activeIdx ? "var(--amber-dark)" : "var(--ink)",
                }}
              >
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: dot.color, marginRight: sidebarCollapsed && !isMobile ? 0 : 6 }} />
                {sidebarCollapsed && !isMobile ? <span className="mono" style={{ marginLeft: 4, fontSize: 11 }}>{idx + 1}</span> : <>Q{idx + 1}. {q.title || "(untitled)"}</>}
                {!(sidebarCollapsed && !isMobile) && (
                  <span style={{ display: "block", fontSize: 11, marginTop: 2, marginLeft: 14, color: dot.color }} className="mono">
                    {dot.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* maxHeight on mobile: without it this panel rendered at its full problem-statement
            content height and pushed the code editor far down the scrolling column — the
            "compiler not fully visible on mobile" report. Capped so it scrolls internally
            instead, leaving the editor on screen. */}
        <div className="exam-protected-content" style={{ width: isMobile ? "100%" : problemWidth, padding: isMobile ? 16 : 24, overflowY: "auto", flexShrink: 0, maxHeight: isMobile ? "32vh" : undefined, borderRight: isMobile ? "none" : "1px solid var(--line)", borderBottom: isMobile ? "1px solid var(--line)" : "none" }}>
          {current && (
            <>
              <ProblemStatement question={current} />
              {(!current.testCases || current.testCases.length === 0) && (
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>All test cases are hidden for this question.</p>
              )}
            </>
          )}
        </div>

        {!isMobile && (
          <div
            role="separator" aria-orientation="vertical" aria-label="Resize the problem panel" tabIndex={0} title="Drag to resize the problem panel (arrow keys also work)"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX, startW = problemWidth;
              const move = (ev) => setProblemWidth(Math.min(760, Math.max(260, startW + ev.clientX - startX)));
              const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); setProblemWidth((w) => { savePref("mcProblemWidth", w); return w; }); };
              window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                setProblemWidth((w) => { const nw = Math.min(760, Math.max(260, w + (e.key === "ArrowRight" ? 24 : -24))); savePref("mcProblemWidth", nw); return nw; });
              }
            }}
            style={{ width: 7, cursor: "col-resize", background: "var(--line)", flexShrink: 0 }}
          />
        )}

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => goToQuestion(-1)} disabled={activeIdx === 0}>
                ◀ Previous
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => goToQuestion(1)} disabled={activeIdx === questions.length - 1}>
                Next ▶
              </button>
              <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }} role="group" aria-label="Editor options">
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} title="Smaller text" aria-label="Decrease editor font size" onClick={() => setEditorFont((f) => { const v = Math.max(11, f - 1); savePref("mcEditorFont", v); return v; })}>A−</button>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} title="Larger text" aria-label="Increase editor font size" onClick={() => setEditorFont((f) => { const v = Math.min(24, f + 1); savePref("mcEditorFont", v); return v; })}>A+</button>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} title="Switch the editor between light and dark" aria-label="Toggle editor theme" onClick={() => setEditorTheme((t) => { const v = t === "vs-dark" ? "light" : "vs-dark"; savePref("mcEditorTheme", v); return v; })}>{editorTheme === "vs-dark" ? "☀ Light" : "☾ Dark"}</button>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} title="Restore the starting template for this question" onClick={resetToStarter}>↺ Reset</button>
              </span>
              <select value={answer?.language || allowedLanguages[0]} onChange={(e) => setLanguage(e.target.value)} className="mono" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--line)" }}>
                {ALL_LANGUAGES.filter((l) => allowedLanguages.includes(l.id)).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <RunSubmitButtons
              onRun={handleRun}
              onSubmit={handleSubmitCode}
              running={running}
              submitting={submittingCode}
              runDisabled={micBlocked || cameraBlocked}
              submitDisabled={micBlocked || cameraBlocked}
            />
          </div>
          <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", padding: "6px 16px 0" }}>
            Your code is auto-saved every 10 seconds. "Run" checks against sample cases only — "Submit" grades this
            question against all test cases, including hidden ones, right away.
          </p>
          {/* A touch keyboard has no physical Tab key at all, and indentation-sensitive languages
              (Python) are unwritable on mobile without one — these trigger Monaco's own built-in
              tab/outdent commands directly. onPointerDown (not onClick) preventDefaults so tapping
              the button never steals focus/selection away from the editor first. */}
          {isMobile && (
            <div style={{ display: "flex", gap: 6, padding: "6px 16px 0" }}>
              <button
                type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => monacoEditorRef.current?.trigger("toolbar", "tab", null)}
              >
                ⇥ Indent
              </button>
              <button
                type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => monacoEditorRef.current?.trigger("toolbar", "outdent", null)}
              >
                ⇤ Outdent
              </button>
            </div>
          )}
          {imeWarning && (
            <div style={{ background: "var(--danger-bg)", color: "var(--rust)", padding: "8px 16px", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span>⚠ Non-English character detected in your code — your keyboard may be set to a regional/transliteration input mode. Switch it to plain English before continuing (on Gboard: long-press the spacebar or tap the globe key).</span>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", flexShrink: 0 }} onClick={() => setImeWarning(false)}>Dismiss</button>
            </div>
          )}
          {/* On mobile the question panel above is capped at 32vh, so the editor gets a generous
              EXPLICIT height on both the wrapper and <Editor> itself — never `height="100%"`
              alone, which collapses to 0 on some mobile browsers when the parent's own height is
              not definite. The outer column scrolls, so a taller editor just means less empty
              space, never a cut-off. */}
          <div style={isMobile ? { height: 420, minHeight: 0, flexShrink: 0 } : { flex: "1 1 0", minHeight: 200 }}>
            <Editor
              height={isMobile ? 420 : "100%"}
              language={ALL_LANGUAGES.find((l) => l.id === answer?.language)?.monaco}
              value={answer?.code || ""}
              onChange={(v) => setCode(v || "")}
              onMount={handleEditorMount}
              theme={editorTheme}
              options={{ fontSize: editorFont, minimap: { enabled: false }, fontFamily: "JetBrains Mono, monospace" }}
            />
          </div>
          <div
            onMouseDown={isMobile ? undefined : startResize}
            title="Drag to resize the results panel"
            style={{ height: 9, cursor: "row-resize", background: "var(--line)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <div style={{ width: 40, height: 3, borderRadius: 2, background: "var(--ink-dim)" }} />
          </div>
          <ResultsPanel height={isMobile ? undefined : resultsHeight} running={running} runResult={runResult} submitResultMsg={submitResultMsg} submitVerdict={codeVerdicts[current?.id]} />
        </div>
      </div>
    </div>
  );
}

// Always-visible test-result dashboard under the editor. Two tabs so the two kinds of result never get mixed up:
//   Sample run      - Run output: every sample case with its input, expected and actual output (hidden cases never appear)
//   Last submission - the graded result for this question: verdict, passed/total (hidden cases show only a count)
// The tab follows what the student just did; the other tab stays one click away. Status colours always come with
// words and symbols (never colour alone).
function ResultsPanel({ height, running, runResult, submitResultMsg, submitVerdict }) {
  const [tab, setTab] = useState("run");
  useEffect(() => { if (runResult) setTab("run"); }, [runResult]);
  useEffect(() => { if (submitResultMsg) setTab("submit"); }, [submitResultMsg]);

  const run = runResult && !runResult.error ? runResult : null;
  const verdictLabel = (v) => VERDICT_LABEL[v] || v;
  const pill = (ok, partial) => ({ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: ok ? "var(--mint)" : partial ? "var(--amber-dark)" : "var(--rust)", border: `1px solid ${ok ? "var(--mint)" : partial ? "var(--amber-dark)" : "var(--rust)"}`, background: ok ? "var(--success-bg)" : partial ? "var(--warning-bg)" : "var(--danger-bg)" });
  const tabBtn = (id, label, count) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="mono"
      style={{ fontSize: 12, fontWeight: tab === id ? 700 : 500, padding: "6px 12px", border: "none", borderBottom: tab === id ? "2px solid var(--amber-dark)" : "2px solid transparent", background: "transparent", color: tab === id ? "var(--ink)" : "var(--ink-dim)", cursor: "pointer" }}>
      {label}{count != null ? ` (${count})` : ""}
    </button>
  );

  return (
    <section aria-label="Test results" aria-live="polite" style={{ height, minHeight: height ? undefined : 240, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--paper)", borderTop: "1px solid var(--line)" }}>
      <div role="tablist" style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 12px", borderBottom: "1px solid var(--line)", flexShrink: 0, flexWrap: "wrap" }}>
        {tabBtn("run", "Sample run", run?.totalCases)}
        {tabBtn("submit", "Last submission")}
        <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-dim)", padding: "6px 0" }}>Ctrl+Enter run · Ctrl+Shift+Enter submit</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
        {running && <p className="mono" style={{ fontSize: 12.5, color: "var(--amber-dark)", fontWeight: 600 }}>⏳ Compiling and running…</p>}

        {!running && tab === "run" && (
          <>
            {!runResult && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Press <strong>Run</strong> to try your code on the sample cases. Nothing is graded by Run.</p>}
            {runResult?.error && <p className="mono" style={{ color: "var(--rust)", fontSize: 13 }}>{runResult.error}</p>}
            {run?.errorSummary && <CodeResultBlock title="Run" result={run} />}
            {run && !run.errorSummary && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={pill(run.verdict === "ACCEPTED", run.verdict === "PARTIAL")}>{run.verdict === "ACCEPTED" ? "✓ All sample cases passed" : `✗ ${verdictLabel(run.verdict)}`}</span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{run.passedCases}/{run.totalCases} sample cases passed</span>
                  {(run.maxTimeMs != null || run.maxMemoryKb != null) && (
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>{run.maxTimeMs != null && `⏱ ${run.maxTimeMs} ms`}{run.maxMemoryKb != null && ` · ${(run.maxMemoryKb / 1024).toFixed(1)} MB`}</span>
                  )}
                </div>
                <div role="progressbar" aria-valuenow={run.passedCases} aria-valuemin={0} aria-valuemax={run.totalCases} style={{ height: 6, borderRadius: 3, background: "var(--line)", overflow: "hidden", marginBottom: 10 }}>
                  <div style={{ width: `${run.totalCases ? (run.passedCases / run.totalCases) * 100 : 0}%`, height: "100%", background: run.passedCases === run.totalCases ? "var(--mint)" : "var(--amber-dark)" }} />
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {(run.details || []).map((d, i) => {
                    const ok = d.verdict === "PASSED";
                    return (
                      <div key={i} style={{ border: `1px solid ${ok ? "var(--mint)" : "var(--rust)"}`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5 }} className="mono">
                        <div style={{ fontWeight: 700, color: ok ? "var(--mint)" : "var(--rust)" }}>{ok ? "✓ Passed" : `✗ ${d.verdict === "WRONG_ANSWER" ? "Wrong answer" : verdictLabel(d.verdict)}`} — sample case {i + 1}</div>
                        <div style={{ marginTop: 4, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 10, rowGap: 2 }}>
                          <span style={{ color: "var(--ink-dim)" }}>Input</span><span style={{ whiteSpace: "pre-wrap" }}>{d.input === "" ? "(none)" : d.input}</span>
                          {!ok && d.verdict === "WRONG_ANSWER" && (<><span style={{ color: "var(--ink-dim)" }}>Expected</span><span style={{ whiteSpace: "pre-wrap" }}>{d.expected}</span></>)}
                          <span style={{ color: "var(--ink-dim)" }}>{ok ? "Output" : "Your output"}</span><span style={{ whiteSpace: "pre-wrap" }}>{d.actual != null && d.actual !== "" ? d.actual : (d.error || "(no output)")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {!running && tab === "submit" && (
          <>
            {!submitResultMsg && !submitVerdict && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Press <strong>Submit</strong> to grade this question against every test case, including hidden ones. Your last result for this question stays here.</p>}
            {(submitVerdict || submitResultMsg) && (
              <>
                {submitResultMsg && (
                  <div className="mono" style={{ padding: "8px 12px", borderRadius: 8, marginBottom: 10, fontSize: 12.5, fontWeight: 600, background: submitResultMsg.ok ? "var(--success-bg)" : "var(--danger-bg)", color: submitResultMsg.ok ? "var(--mint)" : "var(--rust)", border: `1px solid ${submitResultMsg.ok ? "var(--mint)" : "var(--rust)"}` }}>
                    {submitResultMsg.ok ? "✓ " : "✗ "}{submitResultMsg.text}
                  </div>
                )}
                {submitVerdict && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                      <span style={pill(submitVerdict.verdict === "ACCEPTED", submitVerdict.verdict === "PARTIAL")}>{submitVerdict.verdict === "ACCEPTED" ? "✓ " : "✗ "}{verdictLabel(submitVerdict.verdict)}</span>
                      {submitVerdict.totalCases != null && <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{submitVerdict.passedCases}/{submitVerdict.totalCases} test cases passed</span>}
                    </div>
                    {submitVerdict.totalCases != null && (
                      <>
                        <div role="progressbar" aria-valuenow={submitVerdict.passedCases} aria-valuemin={0} aria-valuemax={submitVerdict.totalCases} style={{ height: 6, borderRadius: 3, background: "var(--line)", overflow: "hidden" }}>
                          <div style={{ width: `${submitVerdict.totalCases ? (submitVerdict.passedCases / submitVerdict.totalCases) * 100 : 0}%`, height: "100%", background: submitVerdict.passedCases === submitVerdict.totalCases ? "var(--mint)" : "var(--amber-dark)" }} />
                        </div>
                        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>Hidden test cases show a pass count only. Edit your code and Submit again to improve; your final score is taken when you submit the assessment.</p>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
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
  PARTIAL: "Partially Accepted",
  WRONG_ANSWER: "Wrong Answer",
  COMPILE_ERROR: "Compilation Error",
  RUNTIME_ERROR: "Runtime Error",
  TLE: "Time Limit Exceeded",
  MLE: "Memory Limit Exceeded",
  OLE: "Output Limit Exceeded",
};

function describeVerdict(data) {
  const label = VERDICT_LABEL[data.verdict] || data.verdict || "Submitted";
  if (data.verdict === "ACCEPTED") {
    return `${label} — ${data.passedCases}/${data.totalCases} hidden test cases passed.`;
  }
  if (["COMPILE_ERROR", "RUNTIME_ERROR", "TLE", "MLE", "OLE"].includes(data.verdict) && data.errorSummary?.message) {
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


// Pre-exam device check for STRICT/LOCKDOWN assessments. Every row is evaluated by the SERVER (secure session, attested device
// capabilities) or by simple browser capability probes; the server evaluates it again when the attempt starts, so this screen
// can never be used to bypass a requirement.
function SecurityCheck({ policy, check }) {
  if (!policy || policy.level === "STANDARD") return null;
  const lockdown = policy.level === "LOCKDOWN";
  const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const rows = [];
  if (lockdown) {
    rows.push({ label: "Secure Exam Environment", ok: !!check?.secureBrowserOk, hint: check?.message });
    for (const c of check?.checks || []) if (c.required) rows.push({ label: c.label, ok: c.ok, hint: null });
  } else {
    rows.push({ label: "Browser supported", ok: typeof fetch === "function" && typeof document.hidden !== "undefined" });
    if (policy.requireFullscreen) rows.push({ label: "Fullscreen available", ok: fsOk });
    rows.push({ label: "Clipboard security (copy, paste and cut blocked)", ok: policy.blockCopy || policy.blockPaste || policy.blockCut });
    rows.push({ label: policy.multiSession === "BLOCK" ? "One-tab policy active" : "Multiple-tab monitoring active", ok: true });
  }
  rows.push({ label: "Network available", ok: navigator.onLine !== false });
  if (!policy.mobileAllowed) rows.push({ label: "Computer (phones and tablets are not supported for this exam)", ok: !check?.mobileBlocked });
  const failed = rows.filter((r) => !r.ok);
  const hint = failed.find((r) => r.hint)?.hint;
  return (
    <section aria-label="Security check" style={{ marginTop: 16, border: `1px solid ${failed.length ? "var(--rust)" : "var(--mint)"}`, borderRadius: 10, padding: 14 }}>
      <div className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>CODEARENA SECURE EXAM — SECURITY CHECK</div>
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 4, fontSize: 13.5 }}>
        {rows.map((r) => (
          <li key={r.label} style={{ color: r.ok ? "var(--ink)" : "var(--rust)" }}>{r.ok ? "✓" : "✗"} {r.label}</li>
        ))}
      </ul>
      {failed.length === 0 ? (
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--mint)", fontWeight: 600 }}>All checks passed. You can start the exam.</p>
      ) : (
        <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--rust)" }}>
          {hint || "This computer is not ready for the exam yet."} {lockdown ? "Strict examinations must be taken in the approved secure exam environment on an exam computer. Please ask your invigilator for help." : "Fix the items marked ✗ to continue."}
        </p>
      )}
      {lockdown && <p style={{ marginTop: 8, fontSize: 11.5, color: "var(--ink-dim)" }}>Physical device rules (phones, notes, seating) are set and enforced by your institution.</p>}
    </section>
  );
}
