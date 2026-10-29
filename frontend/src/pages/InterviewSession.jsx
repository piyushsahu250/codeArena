import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import Editor from "@monaco-editor/react";
import api, { API_BASE_URL, performExpiredRedirect } from "../api";
import { Mic, Square, Move, Camera, Clock, ListChecks, Maximize, AlertTriangle, ShieldCheck } from "lucide-react";
import { useProctoring } from "../hooks/useProctoring";
import { createSaveQueue } from "../utils/saveQueue";
import { useAnswerDictation } from "../hooks/useAnswerDictation";
import { useExamNavigationGuard } from "../hooks/useExamNavigationGuard";
import { DICT } from "../utils/dictationEngine";
import { mergeTranscript, SPEECH_LANG } from "../utils/browserSpeech";
import { useExamSession, recallExamSession } from "../hooks/useExamSession";
import { runSecurityCheck } from "../utils/secureAssessment";
import useIsMobile from "../hooks/useIsMobile";
import { useTheme } from "../context/ThemeContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CodeResultBlock from "../components/CodeResultBlock";
import RunSubmitButtons from "../components/RunSubmitButtons";
import ProblemStatement from "../components/ProblemStatement";
import MathText from "../components/MathText";
import ReadinessChecklist from "../components/ReadinessChecklist";
import "./interviewPrep.css";
import { CODE_LANGUAGES as LANGUAGES, defaultStarter, supportedLanguages } from "../utils/codeEditorDefaults";
import { applyPlainTextInputHints, watchForNonAsciiInput } from "../utils/monacoSetup";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const TEXT_AUTOSAVE_DEBOUNCE_MS = 800; // a typed/dictated answer is saved this long after the last change (see utils/saveQueue.js for the ordering and retry rules)

// What the line under the answer box says. "Saved" is shown only when the server confirmed the text that is in the box right now.
function textSaveLabel(status, unsynced) {
  if (unsynced) return "Unsaved changes…";
  if (status === "saving") return "Saving…";
  if (status === "saved") return "Saved";
  if (status === "retrying") return "Reconnecting… your answer is kept here and will be saved as soon as the connection is back.";
  if (status === "failed") return "Could not save automatically. Your answer is still here and is saved when you press Next.";
  return "";
}
const JUDGE_TIMEOUT_MS = 20000;

// Judge/queue-contention errors get the specific, reassuring copy the platform wants for this
// scenario (distinct from a generic "Execution failed") — queue-full (backend-flagged via
// queueBusy) and a client-side timeout (queue/judge taking longer than JUDGE_TIMEOUT_MS) both
// read as "temporarily busy, try again," not as a broken interview.
function judgeErrorMessage(err, fallback) {
  if (err.response?.data?.queueBusy) return err.response.data.error;
  if (err.code === "ECONNABORTED") return "Evaluation temporarily unavailable. Your code has been saved. Please try again shortly.";
  return err.response?.data?.error || fallback;
}

const CATEGORY_LABEL = { HR: "HR", TECHNICAL: "Technical", CODING: "Coding", APTITUDE: "Aptitude", SYSTEM_DESIGN: "System Design", BEHAVIORAL: "Behavioral", MANAGERIAL: "Managerial" };
const FREE_TEXT_CATEGORIES = ["HR", "TECHNICAL", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL"];
const VIOLATION_LABEL = {
  TAB_SWITCH: "switching tabs",
  TAB_SWITCH_BRIEF: "the interview screen losing focus briefly",
  FULLSCREEN_EXIT: "exiting fullscreen",
  CAMERA_DROPPED: "your camera being turned off or disconnected",
  MIC_DROPPED: "your microphone being turned off or disconnected",
  BROWSER_SHORTCUT: "using a restricted keyboard shortcut",
  SCREEN_OVERLAY_DETECTED: "an on-screen search/assistant overlay being detected",
  NAVIGATION_ATTEMPT: "trying to leave the interview",
};

export default function InterviewSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const monacoEditorRef = useRef(null); // lets the mobile Indent/Outdent buttons drive the editor directly, since a touch keyboard has no physical Tab key
  // Whatever compiler language the student is already using on this session — set the first time
  // any coding question resolves a language (default or explicit pick) and again on every
  // explicit switch (handleLanguageChange below), then reused as the default for every subsequent
  // not-yet-opened coding question instead of each one independently resetting to the default.
  const preferredLanguageRef = useRef(null);
  const [imeWarning, setImeWarning] = useState(false); // see watchForNonAsciiInput's own comment — no webpage can force off a student's IME; this catches the moment it actually miscomposed something

  function handleEditorMount(editor) {
    monacoEditorRef.current = editor;
    applyPlainTextInputHints(editor);
    watchForNonAsciiInput(editor, () => setImeWarning(true));
  }
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("preflight"); // preflight | active | terminated
  const { replaced: sessionReplaced, setSession: setExamSession } = useExamSession();
  const [secCheck, setSecCheck] = useState(null);
  const [readinessReady, setReadinessReady] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [drafts, setDrafts] = useState({}); // questionId -> {answerText, code, language, selected}
  // Independent autosaved code per (question, language) — { [questionId]: { [language]: code } }.
  // Without this, switching languages would silently discard whatever was already written in the
  // language being switched away from.
  const [langDrafts, setLangDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  // Autosave of typed answers: questionId -> idle | saving | saved | retrying | failed, driven by the queue's confirmations only.
  const [textSaveStatus, setTextSaveStatus] = useState({});
  // ---- speech-to-text for typed answers (the rules and the lifecycle live in utils/dictationEngine.js) ----
  // A recognised FINAL phrase is added to the end of the answer of the question the recording was started on, through a functional update on the CURRENT text: whatever the student
  // typed meanwhile stays, earlier phrases stay, and nothing is ever overwritten. The Phase 1 autosave then saves it like any other change to the box.
  const draftsRef = useRef({});
  draftsRef.current = drafts;
  const dictation = useAnswerDictation({
    lang: data?.session?.config?.speechLang || SPEECH_LANG,
    onCommit: (questionId, text) => {
      if (!questionId || !text) return;
      // The ref is updated at once as well, so a save that runs straight after the recording ends already sees this phrase (state alone is rendered a moment later).
      const prev = draftsRef.current[questionId] || {};
      draftsRef.current = { ...draftsRef.current, [questionId]: { ...prev, answerText: mergeTranscript(prev.answerText || "", text) } };
      setDrafts((d) => ({ ...d, [questionId]: { ...d[questionId], answerText: mergeTranscript(d[questionId]?.answerText || "", text) } }));
    },
  });
  const dictatedQuestionId = dictation.questionId;
  const activeQuestionIdForDictation = data?.questions?.[activeIdx]?.id;
  // Whatever path moves the page to another question, a recording started on the old one is finished first (its last words still go to the old question).
  useEffect(() => {
    if (dictatedQuestionId && dictation.recording && dictatedQuestionId !== activeQuestionIdForDictation) dictation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuestionIdForDictation]);
  // The interview ended (submitted, terminated, round changed to a closed state): nothing may keep listening.
  useEffect(() => { if (phase !== "active") dictation.cancel(); }, [phase, dictation.cancel]);

  // Formal proctored interview in progress: the browser's Back button is absorbed (see hooks/useExamNavigationGuard.js) and the attempt is recorded for review, never counted.
  const proctoredActive = data?.security?.level === "PROCTORED" && phase === "active";
  useExamNavigationGuard({
    enabled: proctoredActive,
    onAttempt: () => {
      onViolation("NAVIGATION_ATTEMPT");
      const msg = "The interview is still in progress. Use Submit when you have finished; your answers and the timer are saved on the server.";
      setSuspiciousNotice(msg);
      setTimeout(() => setSuspiciousNotice((m) => (m === msg ? null : m)), 6000);
    },
  });

  const textQueueRef = useRef(null);
  const lastQueuedTextRef = useRef({}); // questionId -> the text last handed to the queue, or loaded from the server: unchanged text is never sent again
  const latestAnswerTextRef = useRef({ id: null, text: "" }); // read by the page-hide handler, which must send the text as it is NOW, not as it was when the handler was registered
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [codeSubmittedResult, setCodeSubmittedResult] = useState(false); // true once runResult holds a hidden-case Submit grade, not a sample-only Run
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [violationCount, setViolationCount] = useState(0);
  const [maxViolations, setMaxViolations] = useState(3);
  const [violationWarning, setViolationWarning] = useState(null);
  // Distinct from violationWarning above: shown for a SUSPICIOUS-severity event that did NOT get
  // penalized this time -- see backend/src/utils/proctoringSeverity.js. Softer styling, no "X/Y"
  // counter (since it didn't actually count), and a note that repeating it will start counting.
  const [suspiciousNotice, setSuspiciousNotice] = useState(null);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);
  // Self-view proctoring video position, draggable — was a hardcoded position:fixed bottom-right
  // corner with no way to move it, which on mobile sits directly on top of the "Next"/"Submit
  // Interview" button below (that button is also bottom-right-anchored — see the flex row near
  // the end of this component), making it untappable. null = use the CSS default (bottom-right);
  // once dragged, an explicit {top,left} pixel position overrides it. Pointer Events (not separate
  // mouse/touch handlers) so the same code drags correctly with a mouse OR a finger.
  const [videoPos, setVideoPos] = useState(null);
  const draggingVideoRef = useRef(false);
  const videoDragOffsetRef = useRef({ x: 0, y: 0 });
  const finalizedRef = useRef(false);
  // Set synchronously as the FIRST statement of advanceRound() (before any await, including the
  // one inside saveAnswer()) — a double-click guard distinct from `saving`, since saveAnswer()'s
  // own finally resets `saving` to false as soon as the answer-save leg resolves, well before
  // advanceRound()'s own /rounds/advance request finishes, which previously left a real window
  // where the "Submit Round" button looked enabled again while a request was still in flight.
  const advancingRef = useRef(false);
  const deadlineRef = useRef(null); // absolute ms timestamp this interview auto-submits at
  const clockOffsetRef = useRef(0); // serverTime - Date.now() at load; corrects a skewed device clock
  // Guards against a slow/duplicate Run response landing after the student has already switched
  // questions — mirrors TestTaking.jsx's activeQuestionIdRef pattern.
  const activeQuestionIdRef = useRef(null);
  const { theme } = useTheme();
  const dark = theme === "dark";

  // A concurrent login elsewhere (or any other authExpired 401) mid-interview dispatches this
  // instead of api.js's usual instant window.location.href redirect — see api.js for why. Shows
  // an in-page explanation so the student isn't silently yanked to /login with no idea why.
  useEffect(() => {
    function handleExpired() { setSessionExpiredNotice(true); }
    window.addEventListener("app:session-expired", handleExpired);
    return () => window.removeEventListener("app:session-expired", handleExpired);
  }, []);

  useEffect(() => {
    api.get(`/interview/sessions/${id}`).then(async (res) => {
      setData(res.data);
      setExamSession(recallExamSession(id));
      setViolationCount(res.data.session.violationCount || 0);
      if (typeof res.data.serverTime === "number") clockOffsetRef.current = res.data.serverTime - Date.now();
      // Deliberately does NOT assign every CODING question a language/code upfront — only ones
      // with a real saved answer (below) or a restored draft (further below) get one here. A
      // not-yet-answered question is left without a language at all so the lazy per-question-open
      // effect (see activeQuestion's own effect) can resolve it against whatever language the
      // student is already using elsewhere in this session, instead of every question
      // independently defaulting and a later language switch having nothing left to propagate to.
      const initial = {};
      for (const q of res.data.questions) {
        initial[q.id] = {
          answerText: q.category !== "APTITUDE" ? (q.answer?.answerText || "") : "",
          code: q.answer?.code || q.starterCode || "",
          selected: q.category === "APTITUDE" && q.answer?.answerText != null && q.answer.answerText !== "" ? Number(q.answer.answerText) : null,
        };
        if (q.category === "CODING" && q.answer?.language) initial[q.id].language = q.answer.language;
      }
      // A leftover autosaved draft (unsaved code from before a refresh/crash) takes precedence
      // over the last officially-saved answer, since it's more recent in-progress work.
      const codingQuestions = res.data.questions.filter((q) => q.category === "CODING");
      if (res.data.session.status === "IN_PROGRESS" && codingQuestions.length > 0) {
        const drafts_ = await Promise.all(
          codingQuestions.map((q) => api.get(`/interview/sessions/${id}/questions/${q.id}/draft`).then((r) => r.data).catch(() => null))
        );
        codingQuestions.forEach((q, i) => {
          if (drafts_[i]) initial[q.id] = { ...initial[q.id], code: drafts_[i].code, language: drafts_[i].language };
        });
      }
      // Typed answers autosaved before a refresh or crash (only those newer than the answer saved with Next come back from the server).
      if (res.data.session.status === "IN_PROGRESS") {
        const textDrafts = await api.get(`/interview/sessions/${id}/text-drafts`).then((r) => r.data?.drafts || {}).catch(() => ({}));
        for (const [qid, text] of Object.entries(textDrafts)) {
          if (initial[qid] && typeof text === "string") initial[qid] = { ...initial[qid], answerText: text };
        }
      }
      // Whatever is in a box at load time is already on the server (saved answer or restored draft), so it is not sent again.
      for (const q of res.data.questions) lastQueuedTextRef.current[q.id] = initial[q.id]?.answerText || "";
      setDrafts(initial);
      const initialLangDrafts = {};
      for (const q of res.data.questions) {
        if (q.category === "CODING" && initial[q.id].language) initialLangDrafts[q.id] = { [initial[q.id].language]: initial[q.id].code };
      }
      // Resuming after a refresh carries the most recently-known coding language forward as the
      // preference for any question not yet opened this session, same as picking it live would.
      const lastKnownLang = codingQuestions.map((q) => initial[q.id]?.language).filter(Boolean).pop();
      if (lastKnownLang) preferredLanguageRef.current = lastKnownLang;
      setLangDrafts(initialLangDrafts);
      const durationMin = res.data.session.config?.durationMin;
      if (durationMin && res.data.session.status === "IN_PROGRESS") {
        const deadline = new Date(res.data.session.startedAt).getTime() + durationMin * 60 * 1000;
        deadlineRef.current = deadline;
        setSecondsLeft(Math.max(0, Math.floor((deadline - (Date.now() + clockOffsetRef.current)) / 1000)));
      }

      // Resume mid-interview after a refresh: if this session already has at least one real
      // (non-skipped) answer, the student already cleared the readiness/fullscreen gate once this
      // session — skip the full checklist and drop them back in at the first still-unanswered
      // question instead of silently restarting them at question 1 and re-running preflight.
      const hasProgress = res.data.questions.some((q) => q.answer && q.answer.skipped === false);
      if (res.data.session.status === "IN_PROGRESS" && hasProgress) {
        setActiveIdx(Math.min(res.data.resumeIndex ?? 0, res.data.questions.length - 1));
        setPhase("resume");
      }
    }).catch((err) => setError(err.response?.data?.error || "Failed to load session"));
  }, [id]);

  useEffect(() => {
    if (phase !== "active" || secondsLeft === null) return;
    if (secondsLeft <= 0) { finalize("TIME_EXPIRED"); return; }
    const t = setInterval(() => {
      if (deadlineRef.current == null) { setSecondsLeft((s) => (s === null ? null : s - 1)); return; }
      setSecondsLeft(Math.max(0, Math.floor((deadlineRef.current - (Date.now() + clockOffsetRef.current)) / 1000)));
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, secondsLeft === 0]);

  // Debounced draft autosave for the active coding question — protects in-progress code against
  // a refresh or crash before the candidate clicks Next (which is when the real answer saves).
  // Hooks must run unconditionally, so the active question/draft are re-derived defensively here
  // (data may not have loaded yet, or the active question may not be CODING) rather than reusing
  // the `q`/`draft` consts declared further down, which only exist after the loading-state guards.
  const activeQuestion = data?.questions?.[activeIdx];
  const activeDraft = activeQuestion ? drafts[activeQuestion.id] || {} : {};
  useEffect(() => {
    activeQuestionIdRef.current = activeQuestion?.id ?? null;
    // Lazily resolves THIS question's language/code the first time it's actually opened with no
    // language set yet (no saved answer, no restored draft) — using whatever language the
    // student is already using elsewhere in this session (preferredLanguageRef, seeded on resume
    // and updated on every explicit handleLanguageChange switch below) instead of independently
    // falling back to a fixed default. Only ever touches a question with no language at all — an
    // already-answered or already-opened question is never silently changed underneath the student.
    if (activeQuestion?.category === "CODING") {
      setDrafts((prev) => {
        const d = prev[activeQuestion.id];
        if (d?.language) return prev;
        // A rare FUNCTION-mode question can restrict which languages it even offers (see
        // supportedLanguages) — if the carried-forward preference isn't one of them, this ONE
        // question falls back to whatever it does support, without corrupting the preference
        // itself for later questions.
        const supported = supportedLanguages(activeQuestion).map((l) => l.id);
        const preferred = preferredLanguageRef.current;
        const lang = preferred && supported.includes(preferred) ? preferred
          : supported.includes(activeQuestion.language) ? activeQuestion.language
          : supported.includes("python") ? "python" // platform-wide default compiler
          : supported[0];
        if (!preferred || supported.includes(preferred)) preferredLanguageRef.current = lang;
        const code = d?.code || activeQuestion.starterCode || defaultStarter(lang);
        setLangDrafts((ld) => (ld[activeQuestion.id]?.[lang] !== undefined ? ld : { ...ld, [activeQuestion.id]: { ...ld[activeQuestion.id], [lang]: code } }));
        return { ...prev, [activeQuestion.id]: { ...d, language: lang, code } };
      });
    }
  }, [activeQuestion]);
  useEffect(() => {
    if (phase !== "active" || !activeQuestion || activeQuestion.category !== "CODING") return;
    const timer = setTimeout(() => {
      api.post(`/interview/sessions/${id}/questions/${activeQuestion.id}/draft`, { code: activeDraft.code, language: activeDraft.language }).catch(() => {});
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDraft.code, activeDraft.language, activeQuestion?.id, phase]);

  // Autosave of typed/dictated answers for free-text questions. The queue (utils/saveQueue.js) keeps one request in flight per question, always sends the newest text last,
  // retries network failures, and reports "saved" only after the server confirmed. It is retried at once when the browser comes back online.
  useEffect(() => {
    const queue = createSaveQueue({
      send: (qid, text) => api.post(`/interview/sessions/${id}/questions/${qid}/text-draft`, { answerText: text }),
      onStatus: (qid, status) => setTextSaveStatus((prev) => ({ ...prev, [qid]: status })),
    });
    textQueueRef.current = queue;
    const retry = () => queue.retryNow();
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("online", retry);
      queue.dispose();
      textQueueRef.current = null;
    };
  }, [id]);

  const activeIsFreeText = !!activeQuestion && FREE_TEXT_CATEGORIES.includes(activeQuestion.category);
  const activeAnswerText = activeDraft.answerText || "";
  latestAnswerTextRef.current = { id: activeIsFreeText ? activeQuestion.id : null, text: activeAnswerText };
  useEffect(() => {
    if (phase !== "active" || !activeIsFreeText) return;
    const qid = activeQuestion.id;
    if ((lastQueuedTextRef.current[qid] ?? "") === activeAnswerText) return;
    const timer = setTimeout(() => {
      lastQueuedTextRef.current[qid] = activeAnswerText;
      textQueueRef.current?.push(qid, activeAnswerText);
    }, TEXT_AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnswerText, activeQuestion?.id, activeIsFreeText, phase]);

  // A normal axios POST can be aborted mid-flight when the page is actually torn down, so this
  // uses fetch's `keepalive` flag (designed exactly for "send this request even though the page is
  // unloading"; unlike navigator.sendBeacon, it still supports the Authorization header this API
  // requires) — mirrors TestTaking.jsx's identical helper.
  function keepaliveSave(path, body) {
    try {
      const token = localStorage.getItem("token");
      fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    } catch { /* best-effort only */ }
  }

  useEffect(() => {
    if (phase !== "active" || !activeQuestion) return;
    const handler = () => {
      if (activeQuestion.category === "CODING") {
        keepaliveSave(`/interview/sessions/${id}/questions/${activeQuestion.id}/draft`, { code: activeDraft.code, language: activeDraft.language });
      } else {
        // The text as it is at the moment the page is hidden or closed (a ref, since this handler is registered once per question).
        const { id: qid, text } = latestAnswerTextRef.current;
        if (qid && text) keepaliveSave(`/interview/sessions/${id}/questions/${qid}/text-draft`, { answerText: text });
      }
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuestion?.id, phase]);

  // Mirrors the active question's current code into langDrafts under its current language, so
  // switching languages and switching back later restores it instead of reloading a template.
  useEffect(() => {
    if (!activeQuestion || activeQuestion.category !== "CODING" || !activeDraft.language) return;
    setLangDrafts((prev) => {
      const qDrafts = prev[activeQuestion.id] || {};
      if (qDrafts[activeDraft.language] === activeDraft.code) return prev;
      return { ...prev, [activeQuestion.id]: { ...qDrafts, [activeDraft.language]: activeDraft.code } };
    });
  }, [activeDraft.code, activeDraft.language, activeQuestion?.id]);

  // Every violation type is reported to the server, which classifies it into one of four
  // severities (see backend/src/utils/proctoringSeverity.js) and decides — never trusted
  // client-side — whether THIS occurrence counts toward the 3-strike auto-terminate:
  //   CONFIRMED_VIOLATION (tab switch, fullscreen exit, camera/mic dropped) -- always counts.
  //   SUSPICIOUS (copy/paste, right-click, devtools attempt, screen overlay, etc.) -- a soft
  //     notice the first couple of times; only escalates into a real strike after repeating.
  //   INTERRUPTION (face missing briefly, multiple faces detected) -- never counts, per the
  //     original "future ready, log don't penalize" policy for face signals, now generalized.
  // Noise/silent-environment reminders never reach here at all — they're pure client-side UI
  // state from useProctoring's `noiseWarning`.
  async function onViolation(type) {
    if (finalizedRef.current) return;
    try {
      const { data: res } = await api.post(`/interview/sessions/${id}/violation`, { type });
      if (res.penalized) setViolationCount(res.violationCount);
      setMaxViolations(res.maxViolations);
      if (res.terminated) {
        finalizedRef.current = true;
        setPhase("terminated");
        proctor.stopMedia();
        proctor.releaseFullscreen();
      } else if (res.penalized) {
        const msg = `Warning ${res.violationCount}/${res.maxViolations}: ${VIOLATION_LABEL[type] || type}. The interview will be terminated if this continues.`;
        setViolationWarning(msg);
        setTimeout(() => setViolationWarning((m) => (m === msg ? null : m)), 6000);
      } else if (res.severity === "SUSPICIOUS") {
        const msg = `Notice: ${VIOLATION_LABEL[type] || type} was detected. This didn't count this time, but repeating it will.`;
        setSuspiciousNotice(msg);
        setTimeout(() => setSuspiciousNotice((m) => (m === msg ? null : m)), 5000);
      } else if (type === "SCREEN_OVERLAY_DETECTED") {
        // INTERRUPTION on the server (never counted), but the candidate must still be told it was recorded.
        const msg = "Notice: part of the interview screen was covered by another layer (for example a search or assistant overlay). This is recorded for review and did not count as a strike. Close it and continue.";
        setSuspiciousNotice(msg);
        setTimeout(() => setSuspiciousNotice((m) => (m === msg ? null : m)), 7000);
      }
    } catch {
      // best-effort
    }
  }

  const proctor = useProctoring({
    active: phase === "active",
    requireFullscreen: true,
    requireWebcam: true,
    requireMicrophone: true,
    onViolation,
  });

  // Leaving mid-interview (the session stays resumable): fullscreen is released first, and the camera/microphone stop with the page. If the browser refuses
  // to leave fullscreen, FullscreenExitNotice (mounted in App) tells the student and offers Retry; navigation is never blocked on it.
  async function exitInterview() {
    await proctor.releaseFullscreen();
    navigate("/interview");
  }

  async function begin() {
    // Routed through proctor.requestFullscreen() (fullscreenCompat.js) -- vendor-prefixed
    // fallback + diagnostic logging for free, and keeps proctor.fullscreenOk in sync from the
    // very first entry attempt.
    await proctor.requestFullscreen();
    setPhase("active");
  }

  // Same as begin(), but also re-requests the camera/mic stream first — the lightweight "resume"
  // screen skips the full ReadinessChecklist (which is where that would normally happen), so this
  // single click has to cover both the media re-grant and the fullscreen user-gesture requirement.
  async function resumeSession() {
    try { await proctor.requestMedia(); } catch { /* best-effort — the in-session status banners already surface a failure */ }
    await begin();
  }

  if (sessionExpiredNotice) {
    return (
      <div className={`interview-prep ${dark ? "dark" : ""}`}>
        <Navbar />
        <div style={{ maxWidth: 560, margin: "80px auto", padding: 24 }}>
          <div className="ip-glass" style={{ padding: 32, textAlign: "center" }}>
            <h2 style={{ color: "var(--rust)" }}>Your session ended</h2>
            <p style={{ marginTop: 10, opacity: 0.8 }}>
              You were signed out — most likely because this account was logged into elsewhere. Your progress up to
              your last saved answer has been preserved; log back in to resume this interview.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={performExpiredRedirect}>Continue to Login</button>
          </div>
        </div>
      </div>
    );
  }

  if (sessionReplaced) return <div className={`interview-prep ${dark ? "dark" : ""}`}><Navbar /><div style={{ maxWidth: 560, margin: "48px auto", padding: 24, textAlign: "center" }}><h2>Interview open elsewhere</h2><p style={{ marginTop: 10, opacity: 0.8 }}>This interview was opened in another tab, window or device, which now holds your session. Close this one and continue there. Your saved answers are safe.</p></div></div>;
  if (error) return <div className={`interview-prep ${dark ? "dark" : ""}`}><Navbar /><div style={{ maxWidth: 800, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p><Link to="/interview" className="btn btn-ghost">← AI Mock Interview</Link></div></div>;
  if (!data) return <div className={`interview-prep ${dark ? "dark" : ""}`}><Navbar /><div style={{ maxWidth: 800, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;

  const { session, questions } = data;

  if (phase === "resume") {
    return (
      <div className={`interview-prep ${dark ? "dark" : ""}`}>
        <Navbar />
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <div className="ip-glass" style={{ padding: 32, maxWidth: 560, marginTop: 24, textAlign: "center" }}>
            <h2>Resume Interview</h2>
            <ChalkUnderline />
            <p style={{ fontSize: 13, marginTop: 14, opacity: 0.85 }}>
              Your progress has been saved — you're picking up at question {activeIdx + 1} of {questions.length}.
              Continuing will turn your camera/microphone back on and re-enter fullscreen for the rest of the
              interview.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 20, width: "100%", padding: "12px 24px" }} onClick={resumeSession}>
              Resume Interview (Fullscreen)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "terminated") {
    return (
      <div className={`interview-prep ${dark ? "dark" : ""}`}>
        <Navbar />
        <div style={{ maxWidth: 560, margin: "80px auto", padding: 24 }}>
          <div className="ip-glass" style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 32 }}>⚠️</div>
            <h2 style={{ marginTop: 12, color: "var(--rust)" }}>Proctoring Rules Violated</h2>
            <p style={{ marginTop: 10, opacity: 0.8 }}>
              This interview was automatically terminated after {maxViolations} proctoring violations. A report
              was generated from whatever was answered before termination.
            </p>
            <Link to={`/interview/report/${id}`} className="btn btn-primary" style={{ marginTop: 20, display: "inline-block" }}>View Report</Link>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "preflight") {
    return (
      <div className={`interview-prep ${dark ? "dark" : ""}`}>
        <Navbar />
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <div className="ip-glass ip-pre-card">
            <div className="ip-pre-eyebrow"><ShieldCheck size={14} aria-hidden="true" /> Proctored interview</div>
            <h2 className="ip-pre-title">{session.isMock ? "Mock Interview" : session.isCompanyRound ? `${session.config?.company || ""} Company Round` : session.isResumeBased ? "Resume-based Interview" : `${CATEGORY_LABEL[session.category]} Interview`}</h2>
            <ChalkUnderline />

            <ul className="ip-pre-chips" aria-label="Interview details">
              {session.config?.durationMin ? <li><Clock size={14} aria-hidden="true" /> {session.config.durationMin} minutes</li> : null}
              {data.questions?.length ? <li><ListChecks size={14} aria-hidden="true" /> {data.questions.length} questions</li> : null}
              <li><Maximize size={14} aria-hidden="true" /> Fullscreen</li>
              <li><Camera size={14} aria-hidden="true" /> Camera and microphone on</li>
            </ul>

            <h3 className="ip-pre-heading">Before you begin</h3>
            <div className="ip-pre-rules">
              <div className="ip-pre-rule">
                <span className="ip-pre-rule-icon" aria-hidden="true"><Maximize size={18} /></span>
                <div>
                  <strong>Stay in fullscreen</strong>
                  <p>The interview runs full screen from start to finish. Leaving fullscreen is recorded.</p>
                </div>
              </div>
              <div className="ip-pre-rule">
                <span className="ip-pre-rule-icon" aria-hidden="true"><Camera size={18} /></span>
                <div>
                  <strong>Camera and microphone on</strong>
                  <p>Keep both on for the whole interview and keep your face in frame.</p>
                </div>
              </div>
              <div className="ip-pre-rule ip-pre-rule-warn">
                <span className="ip-pre-rule-icon" aria-hidden="true"><AlertTriangle size={18} /></span>
                <div>
                  <strong>{maxViolations} violations end the interview</strong>
                  <p>Switching tabs, exiting fullscreen, or turning off your camera or microphone counts as a violation. After {maxViolations}, the interview ends automatically and your answers so far are kept.</p>
                </div>
              </div>
              <div className="ip-pre-rule">
                <span className="ip-pre-rule-icon" aria-hidden="true"><ShieldCheck size={18} /></span>
                <div>
                  <strong>Recorded for review, not counted</strong>
                  <p>Stepping away briefly or more than one face in frame is logged for review and does not end your interview. Background noise only shows a reminder.</p>
                </div>
              </div>
            </div>

            <ReadinessChecklist
              proctor={proctor}
              requireWebcam
              requireMicrophone
              requireFullscreen
              onReadyChange={setReadinessReady}
            />

            {data.security?.level === "PROCTORED" && (
              <div style={{ marginTop: 16, padding: 12, border: "1px solid var(--line)", borderRadius: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7, marginBottom: 6 }}>SECURE ASSESSMENT</div>
                <p style={{ fontSize: 13, margin: "0 0 6px" }}>Stay on this page, keep the window full-size, and do not use other applications, copy/paste, screen sharing or outside assistance. Security events are recorded and reviewed.</p>
                {secCheck && (
                  <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, fontSize: 13, lineHeight: 1.8 }}>
                    {secCheck.items.map((i) => <li key={i.key} style={{ color: i.ok ? "var(--success-text)" : (i.required ? "var(--danger-text)" : "var(--warning-text)") }}>{i.ok ? "✓" : i.required ? "✕" : "!"} {i.label}</li>)}
                  </ul>
                )}
                {secCheck && !secCheck.ready && <p style={{ fontSize: 13, color: "var(--danger-text)", fontWeight: 600, margin: "6px 0 0" }}>This device or window cannot provide the required security controls. Use a laptop or desktop computer with a full-size window, then run the check again.</p>}
                <button type="button" className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12, padding: "5px 10px" }} onClick={() => setSecCheck(runSecurityCheck(data.security))}>{secCheck ? "Run security check again" : "Run security check"}</button>
              </div>
            )}

            <button className="btn btn-primary" style={{ marginTop: 20, width: "100%", padding: "12px 24px", opacity: readinessReady && !(data.security?.level === "PROCTORED" && !secCheck?.ready) ? 1 : 0.4 }} onClick={begin} disabled={!readinessReady || (data.security?.level === "PROCTORED" && !secCheck?.ready)}>
              Begin Interview (Fullscreen)
            </button>
          </div>
        </div>
      </div>
    );
  }

  const q = questions[activeIdx];
  const draft = drafts[q.id] || {};
  const micBlocked = proctor.micStatus === "UNAVAILABLE";
  const roundPlan = Array.isArray(session.roundPlanSnapshot) ? session.roundPlanSnapshot : null;
  const isRoundElimination = !!roundPlan;
  const currentRoundInfo = isRoundElimination ? roundPlan[session.currentRoundNumber - 1] : null;

  function updateDraft(patch) {
    setDrafts((d) => ({ ...d, [q.id]: { ...d[q.id], ...patch } }));
  }

  // Switching languages must reload the editor with THAT language's code — restoring a
  // previously-written draft for it if one exists this session, otherwise a starter template.
  // The question's own authored starterCode only ever matches q.language; showing it for every
  // other language was the actual bug (Java template appearing under Python, etc.).
  function handleLanguageChange(lang) {
    if (lang === draft.language) return;
    const saved = langDrafts[q.id]?.[lang];
    const code = saved !== undefined ? saved : (lang === q.language ? (q.starterCode || defaultStarter(lang)) : defaultStarter(lang));
    updateDraft({ language: lang, code });
    // An explicit switch becomes the new preference for every not-yet-opened question too — see
    // preferredLanguageRef's own comment.
    preferredLanguageRef.current = lang;
    setRunResult(null);
    setCodeSubmittedResult(false);
  }

  async function saveAnswer(skipped = false) {
    setSaving(true);
    try {
      // A recording still running (or finishing) is ended FIRST and its last words are waited for, so the answer that is saved and evaluated contains everything the student said.
      await finishDictation();
      // `draft` above is the copy captured when the button was clicked; after a recording it is stale, so the latest text is read from the ref.
      const live = draftsRef.current[q.id] || draft;
      // Let a draft request that is still in flight finish first (at most 3 s), so it cannot land after the real answer and look newer than it on a later reload.
      if (FREE_TEXT_CATEGORIES.includes(q.category) && textQueueRef.current) {
        await Promise.race([textQueueRef.current.flush(q.id), new Promise((resolve) => setTimeout(resolve, 3000))]);
      }
      const body = { questionId: q.id, skipped };
      if (q.category === "APTITUDE") body.answerText = live.selected != null ? String(live.selected) : null;
      else if (q.category === "CODING") { body.code = live.code; body.language = live.language; }
      else body.answerText = live.answerText;
      const { data: res } = await api.post(`/interview/sessions/${id}/answer`, body, { timeout: JUDGE_TIMEOUT_MS });
      if (FREE_TEXT_CATEGORIES.includes(q.category) && !skipped) {
        // The answer itself is now saved by the server, so the autosave has nothing left to send for this text.
        lastQueuedTextRef.current[q.id] = live.answerText || "";
        setTextSaveStatus((prev) => ({ ...prev, [q.id]: "saved" }));
      }
      if (res.immediateResult) setRunResult(res.immediateResult);
      if (res.followUpQuestion) {
        setData((d) => (d.questions.some((qq) => qq.id === res.followUpQuestion.id) ? d : { ...d, questions: [...d.questions, res.followUpQuestion] }));
        setDrafts((dr) => ({
          ...dr,
          [res.followUpQuestion.id]: { answerText: "", code: res.followUpQuestion.starterCode || "", language: res.followUpQuestion.language || "java", selected: null },
        }));
      }
      return res;
    } catch (err) {
      alert(judgeErrorMessage(err, "Failed to save answer"));
      return null;
    } finally {
      setSaving(false);
    }
  }

  // Sample-case-only self-check — does not save the answer or affect the score. Matches the
  // Run/Submit split used everywhere else: the real (hidden-graded) evaluation happens silently
  // when the candidate moves on via saveAnswer() (Next/Skip/Submit Interview).
  async function runCode() {
    setRunning(true);
    setRunResult(null);
    setCodeSubmittedResult(false);
    const questionIdAtRequest = q.id;
    try {
      const { data: res } = await api.post(`/interview/sessions/${id}/run-code`, { questionId: q.id, code: draft.code, language: draft.language }, { timeout: JUDGE_TIMEOUT_MS });
      // A slow/duplicate response landing after the student already switched questions must not
      // overwrite that other question's displayed result.
      if (activeQuestionIdRef.current === questionIdAtRequest) setRunResult(res);
    } catch (err) {
      if (activeQuestionIdRef.current === questionIdAtRequest) alert(judgeErrorMessage(err, "Execution failed"));
    } finally {
      setRunning(false);
    }
  }

  // Grades the current answer against hidden test cases right away via the same saveAnswer()
  // path Next/Skip/Submit Interview already use (idempotent upsert — calling it again on Next
  // just re-saves the same code and re-grades it, no double-counting).
  async function submitCode() {
    const res = await saveAnswer(false);
    if (res?.immediateResult) setCodeSubmittedResult(true);
  }

  // Ends a running recording and resolves once its last words are part of the answer (one extra tick so the commit has been rendered into draftsRef).
  async function finishDictation() {
    const wasDictating = dictation.status === DICT.RECORDING || dictation.status === DICT.PROCESSING_TRANSCRIPT;
    await dictation.stop();
    if (wasDictating) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // The numbered buttons: the question being left is saved first when it has an answer in it (a question that was only opened is not marked answered), and a recording on it is
  // finished first, so its words stay with it.
  async function jumpTo(i) {
    if (i === activeIdx || saving || dictation.status === DICT.PROCESSING_TRANSCRIPT) return;
    await finishDictation();
    const live = draftsRef.current[q.id] || draft;
    const hasAnswer = q.category === "APTITUDE" ? live.selected != null : FREE_TEXT_CATEGORIES.includes(q.category) && !!(live.answerText || "").trim();
    if (hasAnswer) await saveAnswer(false); // coding drafts are autosaved on their own; Next / Submit grades them
    setRunResult(null);
    setActiveIdx(i);
  }

  async function go(delta) {
    await saveAnswer(false);
    setRunResult(null);
    setActiveIdx((i) => Math.max(0, Math.min(questions.length - 1, i + delta)));
  }

  async function skip() {
    await saveAnswer(true);
    setRunResult(null);
    if (activeIdx < questions.length - 1) setActiveIdx((i) => i + 1);
  }

  // Company Round sessions with a real round-elimination profile: this replaces the plain
  // finalize() as the "last question" action. The server is the sole authority on whether the
  // round was passed — this just saves the last answer, asks the server to score the round, and
  // either appends the next round's questions (continuing the session) or navigates to the report
  // (round-elimination or the whole interview completed).
  async function advanceRound() {
    if (finalizedRef.current || advancingRef.current) return;
    advancingRef.current = true;
    setSaving(true);
    try {
      await saveAnswer(false);
      const { data: res } = await api.post(`/interview/sessions/${id}/rounds/advance`, {}, { timeout: JUDGE_TIMEOUT_MS });
      if (res.completed) {
        finalizedRef.current = true;
        proctor.stopMedia();
        proctor.releaseFullscreen();
        navigate(`/interview/report/${id}`, { state: { report: res.report } });
        return;
      }
      const nextQs = res.nextRoundQuestions || [];
      setData((d) => ({ ...d, session: res.session, questions: [...d.questions, ...nextQs] }));
      setDrafts((dr) => {
        const merged = { ...dr };
        for (const nq of nextQs) merged[nq.id] = { answerText: "", code: nq.starterCode || "", language: nq.language || "java", selected: null };
        return merged;
      });
      setRunResult(null);
      setCodeSubmittedResult(false);
      setActiveIdx((i) => i + 1);
    } catch (err) {
      alert(judgeErrorMessage(err, "Failed to advance to the next round"));
    } finally {
      setSaving(false);
      advancingRef.current = false;
    }
  }

  async function finalize(reason) {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    setSaving(true);
    try {
      await saveAnswer(false);
      const { data: res } = await api.post(`/interview/sessions/${id}/finalize`, reason ? { reason } : {});
      if (res.premature) {
        // Server disagrees time is actually up (client clock was fast) — resync the offset and
        // keep the interview running instead of ending it early.
        if (typeof res.serverNow === "number") clockOffsetRef.current = res.serverNow - Date.now();
        finalizedRef.current = false;
        return;
      }
      proctor.stopMedia();
      proctor.releaseFullscreen();
      navigate(`/interview/report/${id}`, { state: { report: res.report, recommendedLearning: res.recommendedLearning } });
    } catch (err) {
      finalizedRef.current = false;
      alert(err.response?.data?.error || "Failed to submit interview");
    } finally {
      setSaving(false);
    }
  }

  // Drag the self-view proctoring video anywhere on screen — see videoPos's declaration comment
  // for why this exists (fixed bottom-right previously blocked the Submit/Next button on mobile,
  // with no way to move it out of the way). All three handlers are wired directly onto the video
  // element (not a separate ref/window listener) — setPointerCapture on pointerdown means the
  // SAME element keeps receiving pointermove/pointerup for the rest of this gesture even once the
  // finger/cursor moves outside its small 140x105 bounds, so e.currentTarget is reliably the video
  // element throughout, whether the input is a mouse or a touch.
  function startVideoDrag(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    videoDragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    draggingVideoRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onVideoDragMove(e) {
    if (!draggingVideoRef.current) return;
    const w = e.currentTarget.offsetWidth || 140;
    const h = e.currentTarget.offsetHeight || 105;
    // Clamped to the viewport so a fast drag can never leave the video partially or fully
    // off-screen (and therefore un-draggable again without a page refresh).
    const left = Math.min(Math.max(0, e.clientX - videoDragOffsetRef.current.x), window.innerWidth - w);
    const top = Math.min(Math.max(0, e.clientY - videoDragOffsetRef.current.y), window.innerHeight - h);
    setVideoPos({ left, top });
  }
  function endVideoDrag(e) {
    if (!draggingVideoRef.current) return;
    draggingVideoRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // Starts a recording on THIS question. Text already in the box is kept: each recognised phrase is added after it (see the onCommit above). One recording at a time.
  function startDictation() {
    dictation.start(q.id);
  }
  // After a failure the same button says "Try again".
  const dictHere = !dictation.questionId || dictation.questionId === q.id; // status lines belong to the question the recording was started on
  const dictationRetryable = dictHere && [DICT.PERMISSION_DENIED, DICT.DEVICE_UNAVAILABLE, DICT.RECOGNITION_ERROR, DICT.NETWORK_ERROR, DICT.RECOVERY_REQUIRED].includes(dictation.status);

  const mm = secondsLeft != null ? String(Math.floor(secondsLeft / 60)).padStart(2, "0") : null;
  const ss = secondsLeft != null ? String(secondsLeft % 60).padStart(2, "0") : null;

  return (
    <div className={`interview-prep ${dark ? "dark" : ""}`}>
      <Navbar locked={proctoredActive} />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1>{session.isMock ? "Mock Interview" : session.isCompanyRound ? `${session.config?.company || ""} Company Round` : session.isResumeBased ? "Resume-based Interview" : `${CATEGORY_LABEL[session.category]} Interview`}</h1>
            {session.config?.company && !session.isCompanyRound && <span className="badge" style={{ marginRight: 8 }}>{session.config.company}</span>}
            <ChalkUnderline />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="mono" style={{ fontSize: 12, color: violationCount > 0 ? "var(--rust)" : "inherit", opacity: violationCount > 0 ? 1 : 0.6 }}>
              ⚠ {violationCount}/{maxViolations}
            </span>
            {secondsLeft != null && <span className="mono ip-glass" style={{ padding: "6px 12px", fontWeight: 700 }}>⏱ {mm}:{ss}</span>}
            {/* No Exit while a formal proctored interview is in progress: the component is not rendered at all (not hidden with CSS). The student leaves by submitting, when the
                time ends, or by closing the tab, after which the same session resumes. Practice interviews (not PROCTORED) keep it. */}
            {!proctoredActive && <button type="button" className="btn btn-ghost" onClick={exitInterview}>Exit</button>}
          </div>
        </div>

        <div
          style={{
            position: "fixed",
            ...(videoPos ? { top: videoPos.top, left: videoPos.left } : { bottom: 16, right: 16 }),
            width: 140, height: 105, zIndex: 50,
          }}
        >
          <video
            ref={proctor.videoRef} autoPlay muted playsInline
            onPointerDown={startVideoDrag} onPointerMove={onVideoDragMove} onPointerUp={endVideoDrag} onPointerCancel={endVideoDrag}
            title="Drag to move"
            style={{
              width: "100%", height: "100%", borderRadius: 8,
              objectFit: "cover", background: "#000",
              border: proctor.faceStatus !== "OK" ? "3px solid var(--rust)" : "2px solid var(--ip-accent)",
              cursor: "move", touchAction: "none",
            }}
          />
          {/* Visual drag affordance -- a hover-only cursor: move (above) tells desktop users this
              moves, but touch users get no hover state at all, so without a visible icon a mobile
              user has no way to discover the video can be dragged out of the way of the Next/Submit
              button (the user's exact bug report: "cannot move video"). pointerEvents: none so this
              overlay never steals the drag gesture from the video element underneath it. */}
          <div
            style={{
              position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.55)",
              borderRadius: 6, padding: 3, display: "flex", pointerEvents: "none",
            }}
          >
            <Move size={13} color="#fff" />
          </div>
        </div>

        {proctor.faceModelStatus === "unavailable" && (
          <div className="mono" style={{ background: "var(--amber)", color: "#3a2c00", padding: "10px 20px", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8 }}>
            Face detection could not start (likely a network/firewall issue) — your camera feed is still shown, but presence isn't being automatically checked this session.
          </div>
        )}
        {proctor.faceStatus === "MISSING" && (
          <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "10px 20px", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8 }}>
            Face not detected. Please position yourself in front of the camera.
          </div>
        )}
        {proctor.faceStatus === "MULTIPLE" && (
          <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "10px 20px", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8 }}>
            Multiple faces detected — only you should be visible during this interview.
          </div>
        )}
        {proctor.cameraStatus === "UNAVAILABLE" && (
          <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "14px 20px", fontSize: 13, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Camera size={14} /> Camera is unavailable — it may be off, blocked, or permission was revoked.</span>
            <button className="btn btn-ghost" style={{ borderColor: "#fff", color: "#fff" }} onClick={proctor.requestMedia} disabled={proctor.requestingMedia}>
              {proctor.requestingMedia ? "Reconnecting…" : "Reconnect Camera"}
            </button>
          </div>
        )}
        {proctor.micStatus === "UNAVAILABLE" && (
          <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "14px 20px", fontSize: 13, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Mic size={14} /> Microphone is disabled. Please enable your microphone to continue the interview.</span>
            <button className="btn btn-ghost" style={{ borderColor: "#fff", color: "#fff" }} onClick={proctor.requestMedia} disabled={proctor.requestingMedia}>
              {proctor.requestingMedia ? "Reconnecting…" : "Re-enable Microphone"}
            </button>
          </div>
        )}
        {proctor.noiseWarning && (
          <div className="mono" style={{ background: "var(--amber)", color: "#3a2c00", padding: "10px 20px", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8 }}>
            Please maintain a quiet interview environment.
          </div>
        )}
        {/* Informational only, never a warning/violation styling -- a device rotating is normal. */}
        {proctor.orientationNotice && (
          <div className="mono" style={{ background: "var(--card-bg, #F7F7F5)", color: "var(--ink-dim)", padding: "8px 20px", fontSize: 11.5, textAlign: "center", marginTop: 12, borderRadius: 8, border: "1px solid var(--line)" }}>
            Screen orientation changed. Please continue your interview.
          </div>
        )}
        {violationWarning && (
          <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "10px 20px", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8 }}>
            ⚠ {violationWarning}
          </div>
        )}
        {suspiciousNotice && (
          <div className="mono" style={{ background: "var(--amber)", color: "#3a2c00", padding: "10px 20px", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8 }}>
            {suspiciousNotice}
          </div>
        )}
        {/* Persistent (unlike violationWarning above) -- see ModuleCodingAssessment.jsx's
            identical banner for the full reasoning: a fullscreen rejection here was previously a
            completely silent no-op, which is exactly what "tab-switch-and-return doesn't restore
            fullscreen" looks like from the outside. */}
        {!proctor.fullscreenOk && (
          <div className="mono" style={{ background: "var(--amber)", color: "#3a2c00", padding: "10px 20px", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8, display: "flex", justifyContent: "center", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>⚠ Fullscreen isn't active. Your browser may not support it, or the request was blocked.</span>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px", background: "#fff", color: "#1C1B18" }} onClick={() => proctor.requestFullscreen()}>
              Enter Fullscreen
            </button>
          </div>
        )}

        {isRoundElimination && currentRoundInfo && (
          <div className="ip-glass" style={{ padding: "10px 16px", marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <span className="badge" style={{ background: "var(--ip-accent)" }}>Round {session.currentRoundNumber} of {roundPlan.length}</span>
            <strong>{currentRoundInfo.label || CATEGORY_LABEL[currentRoundInfo.category] || currentRoundInfo.category}</strong>
            {currentRoundInfo.eliminationThreshold != null && (
              <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>— need {currentRoundInfo.eliminationThreshold}%+ to advance</span>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16 }}>
          {questions.map((qq, i) => (
            <button key={qq.id} onClick={() => jumpTo(i)} disabled={dictation.busy} className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px", opacity: i === activeIdx ? 1 : 0.5, fontWeight: i === activeIdx ? 700 : 400 }}>
              {i + 1}
            </button>
          ))}
        </div>

        <div className="ip-glass exam-protected-content" style={{ padding: 24, marginTop: 16 }}>
          <span className="badge">{CATEGORY_LABEL[q.category]}{q.subject ? ` · ${q.subject}` : ""}{q.aptitudeCategory ? ` · ${q.aptitudeCategory}` : ""}</span>
          {q.category === "CODING" ? (
            <div style={{ marginTop: 12 }}>
              <ProblemStatement question={q} />
            </div>
          ) : (
            <p style={{ marginTop: 12, fontWeight: 600, fontSize: 16 }}><MathText text={q.prompt} /></p>
          )}

          {FREE_TEXT_CATEGORIES.includes(q.category) && (
            <>
              <textarea
                className="ip-select"
                style={{ width: "100%", minHeight: 140, marginTop: 14, fontFamily: "var(--font-body)", fontSize: 14 }}
                value={draft.answerText || ""}
                onChange={(e) => updateDraft({ answerText: e.target.value })}
                placeholder="Type your answer, or use the mic below to speak it…"
              />
              <div role="status" aria-live="polite" className="mono" style={{ fontSize: 11, marginTop: 6, minHeight: 16, opacity: 0.75, color: textSaveStatus[q.id] === "failed" ? "var(--danger-text)" : undefined }}>
                {textSaveLabel(textSaveStatus[q.id], (lastQueuedTextRef.current[q.id] ?? "") !== (draft.answerText || ""))}
              </div>
              <div className="ip-dict">
                <div className="ip-dict-row">
                  {dictation.recording ? (
                    <button type="button" className="btn btn-ghost ip-dict-btn ip-dict-btn-live" onClick={finishDictation} aria-pressed="true"><Square size={14} aria-hidden="true" /> Stop recording</button>
                  ) : (
                    <button type="button" className="btn btn-ghost ip-dict-btn" onClick={startDictation} disabled={!dictation.supported || dictation.busy || !dictation.canStart} aria-pressed="false">
                      <Mic size={14} aria-hidden="true" /> {dictation.busy ? (dictation.status === DICT.PROCESSING_TRANSCRIPT ? "Finishing…" : "Starting…") : dictationRetryable ? "Try again" : "Start recording"}
                    </button>
                  )}
                  {dictation.recording && <span className="ip-dict-timer mono" aria-label="Recording time">● {String(Math.floor(dictation.elapsedSec / 60)).padStart(2, "0")}:{String(dictation.elapsedSec % 60).padStart(2, "0")}</span>}
                  <span className="mono ip-dict-mic">Microphone: {dictation.recording ? "on" : micBlocked ? "unavailable" : "off"}</span>
                </div>
                <div role="status" aria-live="polite" className="ip-dict-status">
                  {dictation.recording && <span>Listening… Speak clearly.</span>}
                  {dictHere && dictation.status === DICT.REQUESTING_PERMISSION && <span>Waiting for your microphone…</span>}
                  {dictHere && dictation.status === DICT.PROCESSING_TRANSCRIPT && <span>Finishing the transcription…</span>}
                  {dictHere && dictation.status === DICT.TRANSCRIPT_READY && <span className="ip-dict-ok">{dictation.notice}</span>}
                  {dictHere && dictation.status === DICT.IDLE && dictation.notice && <span className="ip-dict-warn">{dictation.notice}</span>}
                  {dictHere && dictation.message && <span className="ip-dict-err">{dictation.message}</span>}
                  {!dictation.supported && dictation.status === DICT.IDLE && <span className="ip-dict-warn">Speech recognition is not available in this browser. Please type your answer.</span>}
                </div>
                {dictHere && dictation.recording && dictation.interim && <div className="ip-dict-preview" aria-live="off"><span className="mono">Hearing:</span> {dictation.interim}</div>}
              </div>
            </>
          )}

          {q.category === "APTITUDE" && (
            <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
              {(q.options || []).map((opt, idx) => (
                <label key={idx} className="ip-glass" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="radio" name={q.id} checked={draft.selected === idx} onChange={() => updateDraft({ selected: idx })} />
                  {opt}
                </label>
              ))}
            </div>
          )}

          {q.category === "CODING" && (
            <>
              {/* flexWrap+gap matches DailyChallenge.jsx/WeeklyChallenge.jsx's identical row --
                  without it, the language picker and Run/Submit buttons sit on one unwrapped line
                  and get squeezed/cut off on a narrow mobile screen (this page was missing it). */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, flexWrap: "wrap", gap: 10 }}>
                <select className="ip-select" value={draft.language || "python"} onChange={(e) => handleLanguageChange(e.target.value)}>
                  {supportedLanguages(q).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
                <RunSubmitButtons onRun={runCode} onSubmit={submitCode} running={running} submitting={saving} runDisabled={micBlocked} submitDisabled={micBlocked} />
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
                  <span>⚠ Non-English character detected in your answer — your keyboard may be set to a regional/transliteration input mode. Switch it to plain English before continuing (on Gboard: long-press the spacebar or tap the globe key).</span>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", flexShrink: 0 }} onClick={() => setImeWarning(false)}>Dismiss</button>
                </div>
              )}
              <div style={{ marginTop: 10, border: "1px solid var(--ip-glass-border)", borderRadius: 8, overflow: "hidden" }}>
                <Editor
                  height="260px"
                  language={LANGUAGES.find((l) => l.id === draft.language)?.monaco}
                  value={draft.code}
                  onChange={(v) => updateDraft({ code: v || "" })}
                  onMount={handleEditorMount}
                  theme={dark ? "vs-dark" : "light"}
                  options={{ fontSize: 13, minimap: { enabled: false }, fontFamily: "JetBrains Mono, monospace" }}
                />
              </div>
              {runResult ? (
                <div className="ip-glass" style={{ marginTop: 12, padding: 12 }}>
                  <CodeResultBlock title={codeSubmittedResult ? "Submitted — graded against hidden test cases" : "Sample run result"} result={runResult} />
                </div>
              ) : (
                <p className="mono" style={{ fontSize: 11, marginTop: 8, opacity: 0.7 }}>
                  "Run" checks against sample cases only. "Submit" grades this answer against hidden test cases right
                  away — it also happens automatically when you move to the next question or submit the interview.
                </p>
              )}
            </>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" disabled={activeIdx === 0 || micBlocked || dictation.busy} onClick={() => go(-1)}>← Previous</button>
              <button className="btn btn-ghost" onClick={skip} disabled={micBlocked || dictation.busy}>Skip</button>
            </div>
            {activeIdx < questions.length - 1 ? (
              <button className="btn btn-primary" onClick={() => go(1)} disabled={saving || micBlocked || dictation.busy}>{saving ? "Saving…" : "Next →"}</button>
            ) : isRoundElimination ? (
              <button className="btn btn-primary" onClick={advanceRound} disabled={saving}>
                {saving ? "Scoring round…" : session.currentRoundNumber < roundPlan.length ? "Submit Round →" : "Submit Interview"}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => finalize()} disabled={saving}>{saving ? "Submitting…" : "Submit Interview"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
