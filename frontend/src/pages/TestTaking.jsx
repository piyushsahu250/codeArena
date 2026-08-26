import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Editor from "@monaco-editor/react";
import * as tf from "@tensorflow/tfjs";
import * as blazeface from "@tensorflow-models/blazeface";
import api, { API_BASE_URL } from "../api";
import { useGamification } from "../context/GamificationContext";
import useIsMobile from "../hooks/useIsMobile";
import CodeResultBlock from "../components/CodeResultBlock";
import RunSubmitButtons from "../components/RunSubmitButtons";
import ProblemStatement from "../components/ProblemStatement";
import MathText from "../components/MathText";
import { CODE_LANGUAGES as LANGUAGES, defaultStarter, supportedLanguages } from "../utils/codeEditorDefaults";

const FACE_CHECK_INTERVAL_MS = 2000;
const FACE_CONFIDENCE_THRESHOLD = 0.7;

const MAX_TAB_VIOLATIONS = 3;

// Persists the split-screen panel sizes across reloads/navigations — a student who drags the
// layout to their liking during one question shouldn't have it snap back to defaults on the
// next. Shared across every test attempt (one layout preference per student, not per test).
const LAYOUT_KEY = "codearena-test-layout";
const DEFAULT_LAYOUT = { questionPanelWidth: 420, resultsPanelHeight: 220 };
function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    return {
      questionPanelWidth: Number(parsed.questionPanelWidth) || DEFAULT_LAYOUT.questionPanelWidth,
      resultsPanelHeight: Number(parsed.resultsPanelHeight) || DEFAULT_LAYOUT.resultsPanelHeight,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export default function TestTaking() {
  const { id: testId } = useParams();
  const navigate = useNavigate();
  const { notify } = useGamification();
  const isMobile = useIsMobile();

  const [testMeta, setTestMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);

  const [test, setTest] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Editor-specific preferences (independent of the site-wide light/dark theme — code editors
  // conventionally keep their own theme choice, same as VSCode/GitHub/LeetCode). Persisted to
  // localStorage so a refresh mid-test doesn't reset them back to defaults.
  const [editorTheme, setEditorTheme] = useState(() => localStorage.getItem("ca-editor-theme") || "vs-dark");
  const [editorFontSize, setEditorFontSize] = useState(() => Number(localStorage.getItem("ca-editor-fontsize")) || 14);
  const [editorWordWrap, setEditorWordWrap] = useState(() => localStorage.getItem("ca-editor-wordwrap") === "on");
  useEffect(() => { localStorage.setItem("ca-editor-theme", editorTheme); }, [editorTheme]);
  useEffect(() => { localStorage.setItem("ca-editor-fontsize", String(editorFontSize)); }, [editorFontSize]);
  useEffect(() => { localStorage.setItem("ca-editor-wordwrap", editorWordWrap ? "on" : "off"); }, [editorWordWrap]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // { [questionId]: { language, code } | { selected: number[] } }
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [submittingCode, setSubmittingCode] = useState(false);
  const [queueStatus, setQueueStatus] = useState(null);
  // Independent autosaved code per (question, language) — { [questionId]: { [language]: code } }.
  // Without this, switching languages would always reload the starter template and silently
  // discard whatever was already written in the language being switched away from.
  const [langDrafts, setLangDrafts] = useState({});
  // Per-question live verdict for CODING/SQL questions only — drives the green/red status dot
  // in the navigator. Set from an actual Submit response (never from autosave/Run), and restored
  // from the attempt's saved submissions on resume so a refresh doesn't lose earlier results.
  const [codeVerdicts, setCodeVerdicts] = useState({});
  // "Visited" (opened at least once) vs "Not visited" — the gray/yellow distinction in the
  // navigator. A question with no verdict yet is yellow once visited, gray until then.
  const [visited, setVisited] = useState({});
  const [submitResultMsg, setSubmitResultMsg] = useState(null); // { ok, text } — replaces alert(), which forces fullscreen exit
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [tabWarning, setTabWarning] = useState(null);
  const [showQuestionPanel, setShowQuestionPanel] = useState(true);
  const [showResultsPanel, setShowResultsPanel] = useState(true);
  const initialLayout = useState(loadLayout)[0];
  const [questionPanelWidth, setQuestionPanelWidth] = useState(initialLayout.questionPanelWidth);
  const [resultsPanelHeight, setResultsPanelHeight] = useState(initialLayout.resultsPanelHeight);
  const resizingRef = useRef(null); // "question" | "results" | null
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  // Set only when finalize has been retried and still failed -- surfaces an honest "couldn't
  // confirm" state with a manual retry, instead of silently treating a network failure as a
  // successful submission (see finalizeAndExit's retry loop).
  const [finalizeFailed, setFinalizeFailed] = useState(false);
  const timerRef = useRef(null);
  const deadlineRef = useRef(null); // absolute ms timestamp this candidate's answers lock at
  const clockOffsetRef = useRef(0); // serverTime - Date.now() at test start; corrects a skewed device clock
  const finalizingRef = useRef(false); // in-flight guard for the auto-submit tick, distinct from finalizedRef
  const submittingCodeRef = useRef(false); // in-flight guard for handleSubmitCode, immune to disabled-button re-render lag
  const attemptIdRef = useRef(null);
  const finalizedRef = useRef(false);
  const lastFinalizeReasonRef = useRef(null); // so the manual "Retry submission" button (after a failed finalize) resubmits with the same reason/auto-ness as the attempt that failed
  // Mirrors `current?.id`, kept live via an effect below — Run/Submit are async, and a student
  // can switch questions before a slow response (e.g. under judge queue load) comes back. Without
  // this guard the late response would render its result under whatever question is active by
  // then, which is exactly the kind of thing that looks like a bug in a proctored exam.
  const activeQuestionIdRef = useRef(null);

  const [mediaGranted, setMediaGranted] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [requestingMedia, setRequestingMedia] = useState(false);
  const mediaStreamRef = useRef(null);
  const preflightVideoRef = useRef(null);
  const liveVideoRef = useRef(null);

  const [faceMissing, setFaceMissing] = useState(false);
  const faceModelRef = useRef(null);
  const faceMissingRef = useRef(false); // mirrors faceMissing for use inside the polling interval closure

  const [noiseWarning, setNoiseWarning] = useState(false);
  const noiseWarningTimeoutRef = useRef(null);
  const lastNoiseWarningAtRef = useRef(0);

  // MCQ/TRUE_FALSE/MULTISELECT and CODING answers both auto-save in the background — no
  // per-question Submit, no lock. Coding just saves the draft (no judging); MCQ grades
  // instantly since exact-match grading is free. Both share the same debounce/indicator
  // machinery below, keyed by which pending-save ref is populated.
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Autosave previously failed completely silently (indicator just went blank) -- this surfaces
  // it honestly instead. Cleared the moment any autosave (MCQ or code) next succeeds.
  const [saveFailed, setSaveFailed] = useState(false);
  const autoSaveTimeoutRef = useRef(null);
  const pendingAutoSaveRef = useRef(null); // MCQ: { questionId, selected }
  const codeAutoSaveTimeoutRef = useRef(null);
  const pendingCodeAutoSaveRef = useRef(null); // Coding: { questionId, language, code }
  const justSavedTimeoutRef = useRef(null);

  const [markedForReview, setMarkedForReview] = useState({});

  // Load basic test info up front so we can show a "Begin Test" screen
  // (fullscreen must be requested from a direct click, not on page load).
  useEffect(() => {
    api
      .get(`/tests/${testId}`)
      .then((res) => setTestMeta(res.data))
      .catch((err) => setMetaError(err.response?.data?.error || "Could not load this test"));
  }, [testId]);

  async function requestMedia() {
    setRequestingMedia(true);
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: !!testMeta?.requireWebcam,
        audio: !!testMeta?.requireMicrophone,
      });
      mediaStreamRef.current = stream;
      setMediaGranted(true);
    } catch (err) {
      const reason =
        err.name === "NotAllowedError"
          ? "Camera and microphone access was denied. Please allow both to begin this test."
          : err.name === "NotFoundError"
          ? "No camera or microphone was found on this device. Both are required to begin this test."
          : "Could not access your camera/microphone. Please check your device and browser permissions.";
      setMediaError(reason);
      setMediaGranted(false);
    } finally {
      setRequestingMedia(false);
    }
  }

  // Attach the granted stream to the preflight preview. This must be an effect (not done
  // inline in requestMedia) because the <video> element only mounts once mediaGranted flips
  // true — assigning srcObject synchronously inside requestMedia hits a ref that's still null.
  useEffect(() => {
    if (mediaGranted && preflightVideoRef.current && mediaStreamRef.current) {
      preflightVideoRef.current.srcObject = mediaStreamRef.current;
    }
  }, [mediaGranted]);

  // Keep the live self-view (shown during the test) in sync with the granted stream
  useEffect(() => {
    if (started && liveVideoRef.current && mediaStreamRef.current) {
      liveVideoRef.current.srcObject = mediaStreamRef.current;
    }
  }, [started]);

  // Continuously monitor that the webcam/mic stay live — a device going 'ended' (unplugged,
  // permission revoked mid-session, etc.) or dropping out of the "live" state counts as a violation.
  useEffect(() => {
    if (!started) return;
    const stream = mediaStreamRef.current;
    if (!stream) return;

    const tracks = stream.getTracks();
    function handleEnded() {
      reportViolation("your camera or microphone was turned off or disconnected");
    }
    tracks.forEach((t) => t.addEventListener("ended", handleEnded));

    const pollInterval = setInterval(() => {
      const stillLive = stream.getTracks().every((t) => t.readyState === "live");
      if (!stillLive) reportViolation("your camera or microphone was turned off or disconnected");
    }, 5000);

    return () => {
      tracks.forEach((t) => t.removeEventListener("ended", handleEnded));
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Load the face-detection model as soon as the page opens (independent of camera permission,
  // since it's just a network fetch) so it's ready by the time the candidate actually begins.
  // Face detection is best-effort: if the model fails to load (e.g. blocked network), it simply
  // never runs rather than blocking the candidate from taking the test at all.
  useEffect(() => {
    let cancelled = false;
    tf.ready()
      .then(() => blazeface.load())
      .then((model) => {
        if (!cancelled) faceModelRef.current = model;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Continuously check that a face is present in frame. Unlike other violations, "no face"
  // is a *state*, not a one-off event: the warning must stay up the whole time no face is
  // detected, and it should count as a single warning per disappearance — not once per poll.
  useEffect(() => {
    if (!started || !testMeta?.requireWebcam) return;
    const video = liveVideoRef.current;
    if (!video) return;

    const interval = setInterval(async () => {
      const model = faceModelRef.current;
      if (!model || document.hidden || video.readyState < 2 || finalizedRef.current) return;
      let predictions;
      try {
        predictions = await model.estimateFaces(video, false);
      } catch {
        return;
      }
      const faceFound = predictions.some((p) => (p.probability?.[0] ?? 1) >= FACE_CONFIDENCE_THRESHOLD);

      if (!faceFound && !faceMissingRef.current) {
        faceMissingRef.current = true;
        setFaceMissing(true);
        reportViolation("no face was detected in the camera frame — stay visible for the whole test");
      } else if (faceFound && faceMissingRef.current) {
        faceMissingRef.current = false;
        setFaceMissing(false);
      }
    }, FACE_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Background-noise monitoring — purely informational, per spec: it never reports a
  // violation, never touches the 3-strike counter, and never blocks the candidate. Just a
  // courtesy nudge if the mic picks up sustained loud audio (conversation, TV, etc.).
  useEffect(() => {
    if (!started || !testMeta?.requireMicrophone) return;
    const stream = mediaStreamRef.current;
    if (!stream || stream.getAudioTracks().length === 0) return;

    let audioContext;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const NOISE_RMS_THRESHOLD = 0.35; // conservative, tuned to avoid flagging normal typing/breathing
    const NOISE_WARNING_COOLDOWN_MS = 20000; // don't re-nag more than once per ~20s

    const interval = setInterval(() => {
      if (document.hidden || finalizedRef.current) return;
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      if (rms > NOISE_RMS_THRESHOLD) {
        const now = Date.now();
        if (now - lastNoiseWarningAtRef.current > NOISE_WARNING_COOLDOWN_MS) {
          lastNoiseWarningAtRef.current = now;
          setNoiseWarning(true);
          clearTimeout(noiseWarningTimeoutRef.current);
          noiseWarningTimeoutRef.current = setTimeout(() => setNoiseWarning(false), 5000);
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(noiseWarningTimeoutRef.current);
      source.disconnect();
      audioContext.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Release camera/mic when the test ends or the component unmounts
  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      clearTimeout(tabWarningTimeoutRef.current);
      clearTimeout(autoSaveTimeoutRef.current);
      clearTimeout(codeAutoSaveTimeoutRef.current);
      clearTimeout(justSavedTimeoutRef.current);
    };
  }, []);

  // Drag-to-resize for the question-description panel (width) and the results panel
  // (height). A single window-level listener pair handles both, gated by resizingRef so it's
  // a no-op the rest of the time.
  const layoutRef = useRef({ questionPanelWidth: initialLayout.questionPanelWidth, resultsPanelHeight: initialLayout.resultsPanelHeight });
  useEffect(() => {
    function onMove(e) {
      if (resizingRef.current === "question") {
        const w = Math.max(260, Math.min(760, e.clientX - 220));
        layoutRef.current.questionPanelWidth = w;
        setQuestionPanelWidth(w);
      } else if (resizingRef.current === "results") {
        const h = Math.max(100, Math.min(560, window.innerHeight - e.clientY));
        layoutRef.current.resultsPanelHeight = h;
        setResultsPanelHeight(h);
      }
    }
    function onUp() {
      if (resizingRef.current) {
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutRef.current)); } catch { /* private-browsing storage denial, non-fatal */ }
      }
      resizingRef.current = null;
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function resetLayout() {
    setQuestionPanelWidth(DEFAULT_LAYOUT.questionPanelWidth);
    setResultsPanelHeight(DEFAULT_LAYOUT.resultsPanelHeight);
    layoutRef.current = { ...DEFAULT_LAYOUT };
    try { localStorage.removeItem(LAYOUT_KEY); } catch { /* non-fatal */ }
  }

  function startResize(kind) {
    return (e) => {
      e.preventDefault();
      resizingRef.current = kind;
      document.body.style.cursor = kind === "question" ? "col-resize" : "row-resize";
    };
  }

  function toggleMaximizeEditor() {
    const maximized = !showQuestionPanel && !showResultsPanel;
    setShowQuestionPanel(maximized);
    setShowResultsPanel(maximized);
  }

  async function beginTest() {
    setStarting(true);
    // Request fullscreen synchronously in response to the click, before any awaits.
    if (testMeta?.requireFullscreen !== false) {
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        // Fullscreen can be denied/unsupported — proceed with the test regardless.
      }
    }
    try {
      const startRes = await api.post(`/tests/${testId}/start`);
      setAttemptId(startRes.data.id);
      attemptIdRef.current = startRes.data.id;
      const testRes = await api.get(`/tests/${testId}`);
      setTest(testRes.data);

      // The candidate's deadline is their own start time + the configured duration — every
      // student gets the FULL duration from the moment they click Start, regardless of how late
      // in the test's availability window (Test.startTime/endTime) they started. The window only
      // gates *when a new attempt can begin* (enforced server-side in tests.js's POST /:id/start);
      // it is not a shared end-of-test clock. Capping the deadline to the window's close (the
      // previous behavior) meant a student starting 10 minutes into a 60-minute window got only
      // 50 minutes while an on-time student got the full 60 — an unfair, inconsistent-per-student
      // timer that looked like a bug because it was one. Anchored to the server-recorded
      // startedAt (fixed at first start, never changes on refresh) so a reload can't reset or
      // extend the clock; the server independently enforces this same deadline on every write
      // (see submissions.js's deadlineOf()), so a client that never fires this timer can't be used
      // to keep submitting past time.
      const startedAtMs = new Date(startRes.data.startedAt).getTime();
      const deadline = startedAtMs + testRes.data.durationMin * 60 * 1000;
      deadlineRef.current = deadline;
      // A device clock that's fast/slow relative to the server would otherwise make the countdown
      // hit zero (and auto-submit) too early or too late in real time — every remaining-time
      // computation below uses (Date.now() + clockOffsetRef.current), never raw Date.now(), so the
      // timer tracks the server's clock regardless of the student's own clock setting.
      if (typeof startRes.data.serverTime === "number") clockOffsetRef.current = startRes.data.serverTime - Date.now();

      // Restore previously auto-saved answers — a page refresh mid-test shouldn't lose
      // anything already persisted server-side.
      const existingSubs = startRes.data.submissions || [];
      if (existingSubs.length > 0) {
        const restoredAnswers = {};
        const restoredVerdicts = {};
        const restoredVisited = {};
        const restoredDrafts = {};
        existingSubs.forEach((s) => {
          restoredVisited[s.questionId] = true;
          if (["MCQ", "TRUE_FALSE", "MULTISELECT"].includes(s.language)) {
            try {
              restoredAnswers[s.questionId] = { selected: JSON.parse(s.code) };
            } catch {
              restoredAnswers[s.questionId] = { selected: [] };
            }
          } else {
            restoredAnswers[s.questionId] = { language: s.language, code: s.code };
            // Only one language's code is ever persisted server-side per question (the most
            // recently active one) — a refresh restores that language's draft; drafts typed in
            // other languages during the same browser session but never autosaved after a
            // switch-away are, unavoidably, not recoverable across a refresh.
            restoredDrafts[s.questionId] = { [s.language]: s.code };
            // A PENDING verdict means autosaved-but-never-submitted — that's the "yellow" case,
            // not a graded result, so it's deliberately left out of restoredVerdicts.
            if (s.verdict && s.verdict !== "PENDING") {
              restoredVerdicts[s.questionId] = { verdict: s.verdict, passedCases: s.passedCases, totalCases: s.totalCases };
            }
          }
        });
        setAnswers((prev) => ({ ...restoredAnswers, ...prev }));
        setCodeVerdicts((prev) => ({ ...restoredVerdicts, ...prev }));
        setVisited((prev) => ({ ...restoredVisited, ...prev }));
        setLangDrafts((prev) => {
          const merged = { ...prev };
          for (const [qid, langs] of Object.entries(restoredDrafts)) merged[qid] = { ...langs, ...merged[qid] };
          return merged;
        });
      }
      try {
        setMarkedForReview(JSON.parse(localStorage.getItem(`markedForReview:${startRes.data.id}`) || "{}"));
      } catch {
        // ignore
      }

      setSecondsLeft(Math.max(0, Math.floor((deadline - (Date.now() + clockOffsetRef.current)) / 1000)));
      setStarted(true);
    } catch (err) {
      setLoadError(err.response?.data?.error || "Could not start this test");
    } finally {
      setStarting(false);
    }
  }

  const questions = test?.questions || [];
  const current = questions[activeIdx]?.question;
  const isSql = current?.questionType === "SQL";
  const isQuiz = current && current.questionType !== "CODING" && !isSql;
  const isMulti = current?.questionType === "MULTISELECT";
  useEffect(() => { activeQuestionIdRef.current = current?.id ?? null; }, [current]);

  // Overall test timer — recomputes remaining time from the fixed deadline every tick rather
  // than decrementing a counter, so it self-corrects instead of drifting if the tab was
  // throttled/backgrounded, and stays accurate across a page refresh.
  useEffect(() => {
    if (secondsLeft === null) return;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.floor((deadlineRef.current - (Date.now() + clockOffsetRef.current)) / 1000));
      setSecondsLeft(remaining);
      // Deliberately does NOT clearInterval here — if the auto-submit call below comes back
      // "premature" (server disagrees time is actually up), the interval must keep ticking so it
      // can retry once the corrected clock offset shows real time has elapsed. finalizingRef guards
      // against firing a second call while one is still in flight.
      if (remaining <= 0 && !finalizingRef.current) {
        finalizeAndExit(true, "time");
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft !== null]);

  // Initialize/restore the answer for the active question, and reset the run result panel —
  // every question switch gets a fresh console (item 4) and its own independent starter code the
  // first time it's opened (item 3), never code carried over from another question. Also marks
  // the question "visited" (item 1's gray → yellow transition) the moment it's opened.
  useEffect(() => {
    if (!current) return;
    setAnswers((prev) => {
      if (prev[current.id]) return prev;
      if (current.questionType === "SQL") {
        return { ...prev, [current.id]: { language: "sql", code: "" } };
      }
      if (current.questionType === "CODING") {
        // Question.starterCode (the legacy single-language field) has no associated language on
        // this model — unlike PracticeQuestion/InterviewQuestion, there's no way to know what
        // language it was authored in, so it must never be used as a per-language fallback here.
        // Using it for "javascript" specifically was the actual cause of Java/other-language code
        // appearing mislabeled as JavaScript the first time a legacy question was opened.
        const code = current.starterCodeByLanguage?.javascript || defaultStarter("javascript");
        return { ...prev, [current.id]: { language: "javascript", code } };
      }
      return { ...prev, [current.id]: { selected: [] } };
    });
    if (current.questionType === "SQL" || current.questionType === "CODING") {
      const lang = current.questionType === "SQL" ? "sql" : "javascript";
      setLangDrafts((prev) => {
        if (prev[current.id]?.[lang] !== undefined) return prev; // already seeded — first-open only
        const code = current.questionType === "SQL" ? "" : (current.starterCodeByLanguage?.javascript || defaultStarter("javascript"));
        return { ...prev, [current.id]: { ...prev[current.id], [lang]: code } };
      });
    }
    setVisited((prev) => (prev[current.id] ? prev : { ...prev, [current.id]: true }));
    setRunResult(null);
    setSubmitResultMsg(null);
  }, [current]);

  // Flush any pending debounced save the moment the candidate navigates away from a question —
  // "auto-save on navigation" per spec, and avoids losing the last few keystrokes/clicks to an
  // in-flight debounce if they jump away right after editing.
  useEffect(() => {
    return () => {
      if (pendingAutoSaveRef.current) flushAutoSave();
      if (pendingCodeAutoSaveRef.current) flushCodeAutoSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  const lastViolationAtRef = useRef(0);
  const tabWarningTimeoutRef = useRef(null);
  function reportViolation(reason) {
    if (!attemptIdRef.current || finalizedRef.current) return;
    // Exiting fullscreen via Escape/Alt-Tab fires both `fullscreenchange` and `visibilitychange`
    // within the same instant — without this guard a single action was double-counted as 2
    // violations, which made the 3-strike limit feel broken/erratic.
    const now = Date.now();
    if (now - lastViolationAtRef.current < 1500) return;
    lastViolationAtRef.current = now;
    api
      .post(`/tests/attempts/${attemptIdRef.current}/violation`)
      .then(({ data }) => {
        if (data.autoSubmitted) {
          finalizedRef.current = true;
          setAutoSubmitted(true);
          if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
          mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
          // No alert() here — a dedicated full-screen message is shown once `autoSubmitted`
          // is true, and native alert()/confirm() dialogs force the browser to exit
          // fullscreen before they can render, which would fight the auto-submit cleanup.
        } else {
          // No alert() here either: showing a native dialog while in fullscreen forces the
          // browser to silently exit fullscreen first, which was actively working against
          // the "immediately return to fullscreen" requirement. An on-page banner instead.
          const message = `Warning ${data.tabSwitchCount}/${MAX_TAB_VIOLATIONS}: ${reason}. The test will auto-submit if this happens ${MAX_TAB_VIOLATIONS} times.`;
          setTabWarning(message);
          clearTimeout(tabWarningTimeoutRef.current);
          tabWarningTimeoutRef.current = setTimeout(() => setTabWarning(null), 6000);
        }
      })
      .catch(() => {});
  }

  // Tab-switch / focus-loss detection. Reporting is unconditional regardless of this test's
  // proctoring configuration — switching tabs always counts as a violation. Only the "snap back
  // into fullscreen on refocus" behavior is gated, since a test with requireFullscreen=false
  // never entered fullscreen at all.
  useEffect(() => {
    if (!started) return;
    function handleVisibilityChange() {
      if (document.hidden) {
        reportViolation("switching tabs during a test is not allowed");
      } else if (testMeta?.requireFullscreen !== false && !finalizedRef.current && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [started]);

  // Fullscreen-exit detection — immediately attempts to force back into fullscreen. Browsers
  // that block programmatic re-entry without a fresh user gesture will silently no-op the
  // request; the warning banner's "Resume fullscreen" button is the fallback for that case.
  // Skipped entirely when this test doesn't require fullscreen.
  useEffect(() => {
    if (!started || testMeta?.requireFullscreen === false) return;
    function handleFullscreenChange() {
      if (!document.fullscreenElement && !finalizedRef.current) {
        reportViolation("exiting fullscreen during a test is not allowed");
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        clearTimeout(tabWarningTimeoutRef.current);
        setTabWarning(null);
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [started]);

  // Android system-level assistant overlays (e.g. "Circle to Search", triggered by a long-press
  // on the home button/gesture pill) draw their result sheet as an OS-level layer ON TOP of the
  // current app rather than switching away from it — the tab is never actually hidden or
  // backgrounded, so neither visibilitychange nor fullscreenchange above fires, which is exactly
  // what lets a student search a visible on-screen question without tripping tab-switch
  // detection. The one side effect it can't avoid: the result sheet still has to occupy real
  // screen space, so the visible viewport shrinks noticeably while it's open — the same signal a
  // docked on-screen keyboard produces, which is why this is gated to touch devices and excludes
  // any moment a text input/editor genuinely has focus. Not a perfect defense (nothing
  // client-side can be, against an OS-level overlay) but it catches the actual, unavoidable
  // footprint this class of overlay leaves on the page.
  useEffect(() => {
    if (!started) return;
    const isTouchDevice = navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches;
    if (!isTouchDevice) return;
    const viewport = window.visualViewport;
    const SHRINK_RATIO_THRESHOLD = 0.22;
    let baseline = viewport ? viewport.height : window.innerHeight;
    let flagged = false;

    function isEditableFocused() {
      const el = document.activeElement;
      if (!el) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    }

    function handleResize() {
      const height = viewport ? viewport.height : window.innerHeight;
      if (isEditableFocused()) {
        baseline = Math.max(baseline, height);
        flagged = false;
        return;
      }
      if (height >= baseline) {
        baseline = height;
        flagged = false;
        return;
      }
      const shrinkRatio = (baseline - height) / baseline;
      if (shrinkRatio > SHRINK_RATIO_THRESHOLD) {
        if (!flagged) {
          flagged = true;
          reportViolation("an on-screen search/assistant overlay was detected");
        }
      } else {
        flagged = false;
      }
    }

    const target = viewport || window;
    target.addEventListener("resize", handleResize);
    return () => target.removeEventListener("resize", handleResize);
  }, [started]);

  // Block clipboard/context-menu/browser-chrome shortcuts for the duration of the test. This is
  // always on, independent of the webcam/mic/fullscreen proctoring flags — same treatment as
  // tab-switch detection above. Browsers reserve some of these (Ctrl+T/N/W/Tab, Print Screen) and
  // won't let a page preventDefault() them; those are blocked where the browser allows it and
  // otherwise just can't be intercepted from JS at all.
  useEffect(() => {
    if (!started) return;
    function blockContextMenu(e) {
      e.preventDefault();
    }
    function blockClipboard(e) {
      e.preventDefault();
    }
    function blockKeys(e) {
      const k = e.key?.toLowerCase();
      const blockedWithCtrl = ["s", "p", "u", "w", "n", "t", "r", "tab"];
      if ((e.ctrlKey || e.metaKey) && blockedWithCtrl.includes(k)) {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["t", "i", "j", "c"].includes(k)) {
        e.preventDefault();
        return;
      }
      if (k === "f5" || k === "f11" || k === "f12") {
        e.preventDefault();
      }
    }
    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("copy", blockClipboard);
    document.addEventListener("paste", blockClipboard);
    document.addEventListener("cut", blockClipboard);
    document.addEventListener("dragstart", blockClipboard);
    document.addEventListener("drop", blockClipboard);
    document.addEventListener("dragover", blockClipboard);
    document.addEventListener("keydown", blockKeys);
    return () => {
      document.removeEventListener("contextmenu", blockContextMenu);
      document.removeEventListener("copy", blockClipboard);
      document.removeEventListener("paste", blockClipboard);
      document.removeEventListener("cut", blockClipboard);
      document.removeEventListener("dragstart", blockClipboard);
      document.removeEventListener("drop", blockClipboard);
      document.removeEventListener("dragover", blockClipboard);
      document.removeEventListener("keydown", blockKeys);
    };
  }, [started]);

  const answer = current ? answers[current.id] : null;

  // MM:SS for tests under an hour, HH:MM:SS once an hour or more is left.
  const timeLabel = useMemo(() => {
    if (secondsLeft === null) return "--:--";
    const h = Math.floor(secondsLeft / 3600);
    const m = Math.floor((secondsLeft % 3600) / 60);
    const s = secondsLeft % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
  }, [secondsLeft]);

  function setLanguage(language) {
    if (!current) return;
    // Restores whatever was already typed in this language for this question, if anything —
    // switching away and back must never silently discard a student's work. Only the very first
    // time a language is picked for this question does it fall back to a starter template:
    // the question's own per-language template (bulk-uploaded or authored that way) if present,
    // otherwise a generic-but-language-correct default. Never another language's code.
    const draft = langDrafts[current.id]?.[language];
    const code = draft !== undefined ? draft : (current.starterCodeByLanguage?.[language] || defaultStarter(language));
    setAnswers((prev) => ({ ...prev, [current.id]: { language, code } }));
    setLangDrafts((prev) => ({ ...prev, [current.id]: { ...prev[current.id], [language]: code } }));
    setRunResult(null);
    setSubmitResultMsg(null);
    scheduleCodeAutoSave(current.id, language, code);
  }

  function setCode(code) {
    if (!current) return;
    const language = answer?.language || "javascript";
    setAnswers((prev) => ({ ...prev, [current.id]: { ...prev[current.id], code } }));
    setLangDrafts((prev) => ({ ...prev, [current.id]: { ...prev[current.id], [language]: code } }));
    scheduleCodeAutoSave(current.id, language, code);
  }

  function goToQuestion(delta) {
    setActiveIdx((idx) => Math.max(0, Math.min(questions.length - 1, idx + delta)));
  }

  function toggleOption(idx) {
    if (!current) return;
    const prevSelected = answer?.selected || [];
    const nextSelected = isMulti
      ? (prevSelected.includes(idx) ? prevSelected.filter((i) => i !== idx) : [...prevSelected, idx])
      : [idx];
    setAnswers((prev) => ({ ...prev, [current.id]: { ...prev[current.id], selected: nextSelected } }));
    scheduleAutoSave(current.id, nextSelected);
  }

  // Debounced background save for MCQ/TRUE_FALSE/MULTISELECT — coalesces rapid successive
  // clicks (e.g. ticking several MULTISELECT checkboxes) into one request instead of firing
  // on every click, while still feeling instantaneous to the candidate.
  function scheduleAutoSave(questionId, selected) {
    pendingAutoSaveRef.current = { questionId, selected };
    clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(flushAutoSave, 600);
  }

  async function flushAutoSave() {
    clearTimeout(autoSaveTimeoutRef.current);
    const pending = pendingAutoSaveRef.current;
    if (!pending || !attemptId) return;
    pendingAutoSaveRef.current = null;
    setSavingAnswer(true);
    try {
      await api.post("/submissions/submit", { attemptId, questionId: pending.questionId, selectedOptions: pending.selected });
      flashSaved();
    } catch {
      // The selection stays in local state and gets retried on the next change, or flushed again
      // right before the final Submit Test -- but the student should know a save didn't go
      // through in the meantime, not see a blank indicator that looks identical to "nothing to save".
      setSaveFailed(true);
    } finally {
      setSavingAnswer(false);
    }
  }

  // Debounced background save for coding drafts — longer debounce than MCQ since typing is
  // far more frequent than clicking an option; no judge invocation here, just a DB write.
  function scheduleCodeAutoSave(questionId, language, code) {
    // seq captured NOW (when the student actually typed this), not when the debounced flush
    // eventually fires or when the HTTP request happens to complete -- see Submission.codeSavedSeq's
    // schema comment for why arrival order alone isn't a safe proxy for edit order.
    pendingCodeAutoSaveRef.current = { questionId, language, code, seq: Date.now() };
    clearTimeout(codeAutoSaveTimeoutRef.current);
    codeAutoSaveTimeoutRef.current = setTimeout(flushCodeAutoSave, 1000);
  }

  async function flushCodeAutoSave() {
    clearTimeout(codeAutoSaveTimeoutRef.current);
    const pending = pendingCodeAutoSaveRef.current;
    if (!pending || !attemptId) return;
    pendingCodeAutoSaveRef.current = null;
    setSavingAnswer(true);
    try {
      await api.post("/submissions/autosave", { attemptId, questionId: pending.questionId, language: pending.language, code: pending.code, seq: pending.seq });
      flashSaved();
    } catch {
      // Same "tell the student, don't just go silent" reasoning as MCQ auto-save above. Code
      // stays in local state either way and the next debounce tick (or beforeunload) retries it.
      setSaveFailed(true);
    } finally {
      setSavingAnswer(false);
    }
  }

  function flashSaved() {
    setJustSaved(true);
    setSaveFailed(false);
    clearTimeout(justSavedTimeoutRef.current);
    justSavedTimeoutRef.current = setTimeout(() => setJustSaved(false), 1500);
  }

  // Best-effort save fired from beforeunload/pagehide — a normal axios POST can be aborted
  // mid-flight when the page is actually torn down, so this uses fetch's `keepalive` flag
  // (designed exactly for "send this request even though the page is unloading"; unlike
  // navigator.sendBeacon, it still supports the Authorization header this API requires).
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
      // best-effort only — nothing to recover here, the 1s/600ms debounce already minimizes
      // how much could possibly be unsaved at the moment of unload
    }
  }

  // Spec: "never lose work" on page refresh/close or a temporary network drop. The 600ms/1000ms
  // debounced autosaves above already cover typing/switching questions; these two effects cover
  // the two gaps that were previously unhandled — closing/refreshing the tab, and a save that
  // failed while offline getting retried the moment connectivity returns.
  useEffect(() => {
    function flushOnUnload() {
      if (finalizedRef.current || !attemptId) return;
      if (pendingAutoSaveRef.current) {
        keepaliveSave("/submissions/submit", { attemptId, questionId: pendingAutoSaveRef.current.questionId, selectedOptions: pendingAutoSaveRef.current.selected });
      }
      if (pendingCodeAutoSaveRef.current) {
        keepaliveSave("/submissions/autosave", { attemptId, questionId: pendingCodeAutoSaveRef.current.questionId, language: pendingCodeAutoSaveRef.current.language, code: pendingCodeAutoSaveRef.current.code, seq: pendingCodeAutoSaveRef.current.seq });
      }
    }
    window.addEventListener("beforeunload", flushOnUnload);
    window.addEventListener("pagehide", flushOnUnload);
    return () => {
      window.removeEventListener("beforeunload", flushOnUnload);
      window.removeEventListener("pagehide", flushOnUnload);
    };
  }, [attemptId]);

  useEffect(() => {
    function onOnline() {
      if (finalizedRef.current) return;
      if (pendingAutoSaveRef.current) flushAutoSave();
      if (pendingCodeAutoSaveRef.current) flushCodeAutoSave();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  function toggleMarkForReview() {
    if (!current || !attemptId) return;
    setMarkedForReview((prev) => {
      const next = { ...prev, [current.id]: !prev[current.id] };
      try {
        localStorage.setItem(`markedForReview:${attemptId}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  // While Run is pending, poll how busy the judge is so a slow response under heavy
  // concurrent load (many students coding at once) reads as "N ahead of you" rather than a
  // spinner that looks frozen. Purely informational — has no effect on execution itself.
  useEffect(() => {
    if (!running) {
      setQueueStatus(null);
      return;
    }
    const poll = () => api.get("/submissions/queue-status").then(({ data }) => setQueueStatus(data)).catch(() => {});
    poll();
    const interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, [running]);

  async function handleRun() {
    if (!answer || isQuiz) return;
    const questionId = current.id;
    setRunning(true);
    setRunResult(null);
    try {
      const { data } = await api.post("/submissions/run", { questionId, language: answer.language, code: answer.code });
      if (activeQuestionIdRef.current === questionId) setRunResult(data);
    } catch (err) {
      if (activeQuestionIdRef.current === questionId) setRunResult({ error: err.response?.data?.error || "Run failed" });
    } finally {
      setRunning(false);
    }
  }

  // Grades this one question against hidden test cases immediately, distinct from the whole-test
  // Submit Test button — the score is fully computed and stored right away, same as clicking Run,
  // just scored against hidden cases instead of samples. Cancels any pending debounced autosave
  // first: that autosave always resets the row back to PENDING on write, which would silently
  // undo this grading if it fired right after with the same (already-submitted) code.
  //
  // Deliberately never uses alert()/confirm() here — a native dialog forces the browser to
  // silently exit fullscreen before it can render (same reasoning as reportViolation above),
  // which was the actual cause of "fullscreen exits when I click Submit". An on-page banner
  // (submitResultMsg) replaces it and never touches fullscreen.
  async function handleSubmitCode() {
    // Explicit in-flight guard, not just the disabled-button attribute -- the button's `disabled`
    // only takes effect after a re-render, so two clicks landing within the same event-loop tick
    // (or two independent callers, e.g. a keyboard-shortcut path added later) weren't actually
    // prevented from both firing, only incidentally slowed by React's own render timing.
    if (submittingCodeRef.current) return;
    if (!answer || isQuiz || !attemptId) return;
    const questionId = current.id;
    clearTimeout(codeAutoSaveTimeoutRef.current);
    pendingCodeAutoSaveRef.current = null;
    submittingCodeRef.current = true;
    setSubmittingCode(true);
    try {
      const { data } = await api.post("/submissions/submit-code", { attemptId, questionId, language: answer.language, code: answer.code });
      // codeVerdicts (the status dot) is always applied — it's per-question already, and a
      // late-arriving grade is exactly as real as an immediate one. Only the ephemeral banner is
      // guarded: it must never render under a question the student has since navigated away from.
      setCodeVerdicts((prev) => ({ ...prev, [questionId]: { verdict: data.verdict, passedCases: data.passedCases, totalCases: data.totalCases } }));
      if (activeQuestionIdRef.current === questionId) setSubmitResultMsg({ ok: data.verdict === "ACCEPTED", text: describeVerdict(data) });
    } catch (err) {
      if (activeQuestionIdRef.current === questionId) setSubmitResultMsg({ ok: false, text: err.response?.data?.error || "Submission failed" });
    } finally {
      submittingCodeRef.current = false;
      setSubmittingCode(false);
    }
  }

  async function finalizeAndExit(auto = false, reason = null) {
    if (!attemptId || finalizedRef.current || finalizingRef.current) return;
    if (!auto && !confirm("Are you sure you want to submit your test? After submission, you will not be able to modify your answers.")) return;
    lastFinalizeReasonRef.current = reason;
    // Flush any answer still waiting on an auto-save debounce so the very last change isn't
    // lost to a race between submitting and the pending save timer.
    if (pendingAutoSaveRef.current) await flushAutoSave();
    if (pendingCodeAutoSaveRef.current) await flushCodeAutoSave();
    finalizingRef.current = true;
    setFinalizing(true);
    setFinalizeFailed(false);

    // Up to 3 tries with a short backoff before giving up -- most "the finalize call failed"
    // cases in practice are a transient blip, not a genuinely dead connection, and a real success
    // must never be reported unless the server actually confirmed it (previously this function
    // set finalizedRef + navigated away on ANY failure, which silently told the student "your
    // test has been submitted" even when the server never received it at all).
    let data = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3 && !data; attempt++) {
      try {
        const res = await api.post(`/submissions/finalize/${attemptId}`, { reason });
        data = res.data;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }

    if (!data) {
      // Genuinely could not confirm the server received this -- say so plainly instead of
      // pretending it worked. finalizedRef stays false so the student (or the next auto-submit
      // tick, for the time-up case) can retry; fullscreen/camera are released regardless since
      // the exam UI is now showing an error, not the live exam.
      finalizingRef.current = false;
      setFinalizing(false);
      setFinalizeFailed(true);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      console.error("[finalize] failed after 3 attempts:", lastErr);
      return;
    }

    // The server disagreed that time is actually up (this candidate's device clock ran ahead of
    // the server's) — resync the offset and let the countdown keep running instead of locking the
    // exam screen; do NOT set finalizedRef, exit fullscreen, or stop the media stream, since the
    // test genuinely isn't over yet.
    if (data.premature) {
      if (typeof data.serverNow === "number") clockOffsetRef.current = data.serverNow - Date.now();
      finalizingRef.current = false;
      setFinalizing(false);
      return;
    }
    finalizedRef.current = true;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    notify(data.gamification);
    finalizingRef.current = false;
    setFinalizing(false);
    if (reason === "time") {
      setTimeExpired(true);
      return;
    }
    navigate("/dashboard");
  }

  async function resumeFullscreen() {
    try {
      await document.documentElement.requestFullscreen?.();
      setTabWarning(null);
    } catch {
      // ignore
    }
  }

  if (metaError) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p style={{ fontSize: 16 }}>{metaError}</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p style={{ fontSize: 16 }}>{loadError}</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (finalizeFailed) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p style={{ fontSize: 16, color: "var(--rust)" }}>
            We couldn't confirm your submission was received — your test has <strong>not</strong> been marked as submitted. Please check your internet connection and try again. Do not close this page.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={finalizing} onClick={() => finalizeAndExit(true, lastFinalizeReasonRef.current)}>
            {finalizing ? "Retrying…" : "Retry submission"}
          </button>
        </div>
      </div>
    );
  }

  if (timeExpired) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p style={{ fontSize: 16, color: "var(--rust)" }}>Time is up. Your test has been submitted automatically.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (autoSubmitted) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p style={{ fontSize: 16, color: "var(--rust)" }}>
            Your test was automatically submitted after repeated integrity violations (leaving the test window,
            exiting fullscreen, your camera/microphone being turned off, or no face being detected in frame).
          </p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (finalizing) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p className="mono" style={{ fontSize: 15 }}>⏳ Grading your test — this can take a few seconds for coding questions. Please don't close this tab.</p>
        </div>
      </div>
    );
  }

  if (!started) {
    if (!testMeta) return <div style={{ padding: 48 }} className="mono">Loading test…</div>;
    const needsWebcam = !!testMeta.requireWebcam;
    const needsMic = !!testMeta.requireMicrophone;
    const needsMedia = needsWebcam || needsMic;
    const needsFullscreen = testMeta.requireFullscreen !== false;
    const mediaLabel = needsWebcam && needsMic ? "camera and microphone" : needsWebcam ? "camera" : "microphone";
    const attendanceBlocked = !!testMeta.attendanceMandatory && testMeta.attendanceStatus !== "PRESENT";
    const attendanceMessage = testMeta.attendanceStatus === "ABSENT"
      ? "You have been marked absent for this test and cannot start it."
      : "Attendance has not yet been marked for this test. Please contact your faculty.";
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 480, textAlign: "center" }}>
          <span className="badge" style={{ background: "var(--amber)" }}>Official Test — graded, one attempt unless permitted by admin/staff</span>
          <h2 style={{ marginTop: 10 }}>{testMeta.title}</h2>
          {testMeta.description && <p style={{ color: "var(--ink-dim)", marginTop: 8 }}>{testMeta.description}</p>}
          <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 16 }}>
            {testMeta.questions?.length || 0} questions · {testMeta.durationMin} minutes
          </p>
          <p style={{ fontSize: 13, marginTop: 20 }}>
            {needsFullscreen && `This test runs in fullscreen${needsMedia ? ` with your ${mediaLabel} on for the full duration` : ""}. `}
            {needsWebcam && "Your face must stay visible in frame. "}
            Switching tabs{needsFullscreen ? ", exiting fullscreen," : ""}
            {needsMedia ? ` disabling your ${mediaLabel},` : ""}
            {needsWebcam ? " or moving out of camera view" : ""} is tracked and will auto-submit your test after {MAX_TAB_VIOLATIONS} violations. You get
            one continuous {testMeta.durationMin}-minute timer for the whole test — answer any question in any
            order, and change your answers freely until you submit or time runs out.
          </p>

          {attendanceBlocked && (
            <div style={{ marginTop: 20, padding: 16, border: "1px solid var(--rust)", borderRadius: 10, background: "rgba(220,38,38,0.08)" }}>
              <p style={{ fontSize: 13, color: "var(--rust)", fontWeight: 600 }}>{attendanceMessage}</p>
            </div>
          )}

          {needsMedia && (
            <div style={{ marginTop: 20, padding: 16, border: "1px solid var(--line)", borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{needsWebcam && needsMic ? "Camera & microphone check" : needsWebcam ? "Camera check" : "Microphone check"}</div>
              {mediaGranted ? (
                <>
                  {needsWebcam && (
                    <video
                      ref={preflightVideoRef}
                      autoPlay
                      muted
                      playsInline
                      style={{ width: 160, height: 120, borderRadius: 8, marginTop: 10, background: "#000", objectFit: "cover" }}
                    />
                  )}
                  <p style={{ fontSize: 12, color: "var(--mint)", marginTop: 8, fontWeight: 600 }}>✓ {needsWebcam && needsMic ? "Camera and microphone are" : "Ready"} ready</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>
                    Required before you can begin — it stays on for the whole test.
                  </p>
                  <button className="btn btn-dark" style={{ marginTop: 10 }} onClick={requestMedia} disabled={requestingMedia}>
                    {requestingMedia ? "Requesting access…" : `Grant ${mediaLabel} access`}
                  </button>
                  {mediaError && <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 8 }}>{mediaError}</p>}
                </>
              )}
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{ marginTop: 20, padding: "12px 24px", opacity: (!needsMedia || mediaGranted) && !attendanceBlocked ? 1 : 0.4 }}
            onClick={beginTest}
            disabled={starting || attendanceBlocked || (needsMedia && !mediaGranted)}
          >
            {starting ? "Starting…" : needsFullscreen ? "Begin Test (Fullscreen)" : "Begin Test"}
          </button>
        </div>
      </div>
    );
  }

  if (!test) return <div style={{ padding: 48 }} className="mono">Loading test…</div>;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{ background: "var(--slate-900)", color: "var(--chalk)", padding: isMobile ? "10px 12px" : "12px 24px", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: isMobile ? "1 1 100%" : "0 1 auto" }}>
          <strong>{test.title}</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {!isMobile && (
            <>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => setShowQuestionPanel((v) => !v)}>
                {showQuestionPanel ? "Hide questions" : "Show questions"}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => setShowResultsPanel((v) => !v)}>
                {showResultsPanel ? "Hide results" : "Show results"}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={toggleMaximizeEditor}>
                {!showQuestionPanel && !showResultsPanel ? "⛶ Restore layout" : "⛶ Maximize editor"}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={resetLayout} title="Reset panel sizes to default">
                ↺ Reset layout
              </button>
            </>
          )}
          <div className="mono" style={{ fontSize: isMobile ? 16 : 20, color: secondsLeft < 300 ? "var(--rust)" : "var(--amber)" }}>
            {timeLabel} <span style={{ opacity: 0.6 }}>▊</span>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => finalizeAndExit(false)}>Submit Test</button>
      </div>

      {test.requireWebcam && (
        <video
          ref={liveVideoRef}
          autoPlay
          muted
          playsInline
          style={{
            position: "fixed", bottom: 16, right: 16, width: isMobile ? 84 : 140, height: isMobile ? 63 : 105, borderRadius: 8,
            objectFit: "cover", background: "#000", zIndex: 50,
            border: faceMissing ? "3px solid var(--rust)" : "2px solid var(--amber)",
          }}
        />
      )}

      {noiseWarning && (
        <div
          style={{
            background: "var(--amber)", color: "#3a2c00", padding: "10px 24px", fontSize: 13, fontWeight: 600,
            textAlign: "center",
          }}
          className="mono"
        >
          Please maintain a quiet environment during the examination.
        </div>
      )}

      {faceMissing && (
        <div
          style={{
            background: "var(--rust)", color: "#fff", padding: "14px 24px", fontSize: 14, fontWeight: 700,
            textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
          }}
          className="mono"
        >
          ⚠ No face detected — please stay visible in the camera frame. This warning stays up until your face is
          detected again.
        </div>
      )}

      {tabWarning && (
        <div
          style={{
            background: "var(--rust)", color: "#fff", padding: "14px 24px", fontSize: 14, fontWeight: 700,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
          }}
          className="mono"
        >
          <span>⚠ {tabWarning}</span>
          {test.requireFullscreen && !document.fullscreenElement && (
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px", background: "#fff", color: "#1C1B18" }} onClick={resumeFullscreen}>
              Resume fullscreen
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flex: 1, overflow: isMobile ? "auto" : "hidden" }}>
        {/* Question navigator */}
        <div
          style={
            isMobile
              ? { width: "100%", borderBottom: "1px solid var(--line)", padding: "10px 12px", display: "flex", gap: 8, overflowX: "auto", flexShrink: 0 }
              : { width: 220, borderRight: "1px solid var(--line)", padding: 16, overflowY: "auto" }
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
          {questions.map((tq, idx) => {
            const q = tq.question;
            const a = answers[q.id];
            const isCoding = q.questionType === "CODING" || q.questionType === "SQL";
            const marked = !!markedForReview[q.id];
            let dotColor;
            let statusLabel;
            if (isCoding) {
              const dot = codingDotStatus(q, codeVerdicts, visited);
              dotColor = dot.color;
              statusLabel = dot.label;
            } else {
              const answered = (a?.selected || []).length > 0;
              dotColor = answered ? "var(--mint)" : "var(--ink-dim)";
              statusLabel = answered ? "Answered" : "Unanswered";
            }
            if (marked) {
              dotColor = "#8b5cf6";
              statusLabel = `⚑ ${statusLabel}`;
            }
            return (
              <button
                key={tq.id}
                onClick={() => setActiveIdx(idx)}
                style={{
                  display: isMobile ? "inline-block" : "block",
                  width: isMobile ? "auto" : "100%",
                  minWidth: isMobile ? 150 : undefined,
                  flexShrink: isMobile ? 0 : undefined,
                  textAlign: "left",
                  padding: "10px 12px",
                  marginBottom: isMobile ? 0 : 6,
                  borderRadius: 8,
                  border: idx === activeIdx ? "1px solid var(--amber)" : "1px solid var(--line)",
                  background: idx === activeIdx ? "var(--warning-bg)" : "var(--card-bg)",
                  color: idx === activeIdx ? "var(--amber-dark)" : "var(--ink)",
                  fontSize: 13,
                }}
              >
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: dotColor, marginRight: 6 }} />
                Q{idx + 1}. {tq.question.title || "(untitled)"}
                <span style={{ display: "block", fontSize: 11, marginTop: 2, marginLeft: 14, color: dotColor }} className="mono">
                  {statusLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Question description */}
        {showQuestionPanel && (
        <>
        <div style={{ width: isMobile ? "100%" : questionPanelWidth, padding: isMobile ? 16 : 24, overflowY: "auto", flexShrink: 0 }}>
          {current && (
            <>
              <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{current.points} points</p>
              <ProblemStatement question={isQuiz ? { ...current, testCases: [] } : current} />
            </>
          )}
        </div>
        {!isMobile && (
          <div
            onMouseDown={startResize("question")}
            className="ca-resize-handle"
            style={{ width: 6, cursor: "col-resize", background: "var(--line)", flexShrink: 0 }}
            title="Drag to resize"
          />
        )}
        </>
        )}

        {/* Answer panel: code editor for Coding, options for quiz types */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {isQuiz ? (
            <>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => goToQuestion(-1)} disabled={activeIdx === 0}>
                    ◀ Previous
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => goToQuestion(1)} disabled={activeIdx === questions.length - 1}>
                    Next ▶
                  </button>
                  {!isMobile && (
                    <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                      {isMulti ? "Select all that apply" : "Select one answer"}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 12, color: savingAnswer ? "var(--amber-dark)" : saveFailed ? "var(--rust)" : "var(--mint)", minWidth: 90, textAlign: "right" }}>
                    {savingAnswer ? "Saving…" : saveFailed ? "⚠ Not saved" : justSaved ? "✓ Saved" : ""}
                  </span>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "5px 10px", color: markedForReview[current.id] ? "#8b5cf6" : undefined }}
                    onClick={toggleMarkForReview}
                  >
                    {markedForReview[current.id] ? "⚑ Marked" : "⚑ Mark for review"}
                  </button>
                </div>
              </div>
              <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", padding: "6px 16px 0" }}>
                Your selection is saved automatically — change it any time before you submit the whole test.
              </p>
              <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
                {(current.options || []).map((opt, idx) => (
                  <label
                    key={idx}
                    className="card"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, marginBottom: 10, cursor: "pointer" }}
                  >
                    <input
                      type={isMulti ? "checkbox" : "radio"}
                      name="quiz-option"
                      checked={(answer?.selected || []).includes(idx)}
                      onChange={() => toggleOption(idx)}
                    />
                    <span style={{ fontSize: 14 }}><MathText text={opt} /></span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => goToQuestion(-1)} disabled={activeIdx === 0}>
                    ◀ Previous
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => goToQuestion(1)} disabled={activeIdx === questions.length - 1}>
                    Next ▶
                  </button>
                  {isSql ? (
                    <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", padding: "6px 10px" }}>SQL</span>
                  ) : (
                    <select value={answer?.language || "javascript"} onChange={(e) => setLanguage(e.target.value)} className="mono" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--line)" }}>
                      {supportedLanguages(current).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 12, color: savingAnswer ? "var(--amber-dark)" : saveFailed ? "var(--rust)" : "var(--mint)", minWidth: 90, textAlign: "right" }}>
                    {savingAnswer ? "Saving…" : saveFailed ? "⚠ Not saved" : justSaved ? "✓ Saved" : ""}
                  </span>
                  <button
                    className="btn btn-ghost"
                    style={{ color: markedForReview[current.id] ? "#8b5cf6" : undefined }}
                    onClick={toggleMarkForReview}
                  >
                    {markedForReview[current.id] ? "⚑ Marked" : "⚑ Mark for review"}
                  </button>
                  <RunSubmitButtons onRun={handleRun} onSubmit={handleSubmitCode} running={running} submitting={submittingCode} />
                </div>
              </div>
              <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setEditorTheme((t) => (t === "vs-dark" ? "light" : "vs-dark"))}>
                  {editorTheme === "vs-dark" ? "☾ Dark" : "☀ Light"}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>Font</span>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setEditorFontSize((s) => Math.max(10, s - 1))}>A-</button>
                  <span className="mono" style={{ fontSize: 11, minWidth: 18, textAlign: "center" }}>{editorFontSize}</span>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setEditorFontSize((s) => Math.min(28, s + 1))}>A+</button>
                </div>
                <label className="mono" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, color: "var(--ink-dim)" }}>
                  <input type="checkbox" checked={editorWordWrap} onChange={(e) => setEditorWordWrap(e.target.checked)} /> Wrap lines
                </label>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <Editor
                  height="100%"
                  language={isSql ? "sql" : LANGUAGES.find((l) => l.id === answer?.language)?.monaco}
                  value={answer?.code || ""}
                  onChange={(v) => setCode(v || "")}
                  theme={editorTheme}
                  options={{
                    fontSize: editorFontSize,
                    wordWrap: editorWordWrap ? "on" : "off",
                    minimap: { enabled: false },
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                />
              </div>
            </>
          )}

          {showResultsPanel && (
          <>
          {!isMobile && (
            <div onMouseDown={startResize("results")} className="ca-resize-handle" style={{ height: 6, cursor: "row-resize", background: "var(--line)", flexShrink: 0 }} title="Drag to resize" />
          )}
          <div style={{ height: isMobile ? Math.min(resultsPanelHeight, 220) : resultsPanelHeight, overflowY: "auto", padding: 16, background: "var(--paper)", flexShrink: 0 }}>
            {submitResultMsg && !running && (
              <div
                className="mono"
                style={{
                  padding: "10px 12px", borderRadius: 8, marginBottom: runResult ? 12 : 0, fontSize: 12.5, fontWeight: 600,
                  background: submitResultMsg.ok ? "var(--success-bg)" : "var(--danger-bg)",
                  color: submitResultMsg.ok ? "var(--mint)" : "var(--rust)",
                  border: `1px solid ${submitResultMsg.ok ? "var(--mint)" : "var(--rust)"}`,
                }}
              >
                {submitResultMsg.ok ? "✓ " : "✗ "}{submitResultMsg.text}
              </div>
            )}
            {running && (
              <p className="mono" style={{ fontSize: 12, color: "var(--amber-dark)", fontWeight: 600 }}>
                ⏳ Compiling and running your {answer?.language || ""} code
                {["c", "cpp", "java"].includes(answer?.language) ? " — compiled languages take a bit longer" : ""}…
                {queueStatus?.waiting > 0 && ` (${queueStatus.waiting} student${queueStatus.waiting > 1 ? "s" : ""} ahead of you)`}
              </p>
            )}
            {!running && runResult && (
              <CodeResultBlock title="Sample run result" result={runResult} />
            )}
            {!isQuiz && !running && !runResult && !submitResultMsg && (
              <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                Run against sample cases any time. Submit grades this question against the hidden test cases and
                shows the result immediately.
              </p>
            )}
          </div>
          </>
          )}
        </div>
      </div>
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

// Drives the navigator's colored status dot for a CODING/SQL question — Gray (never opened),
// Yellow (opened but never Submitted, or code written/Run only), Green (Submitted, Accepted),
// Red (Submitted, any other verdict: wrong answer, compile/runtime error, TLE, MLE).
function codingDotStatus(question, verdicts, visitedMap) {
  const v = verdicts[question.id];
  if (v) return v.verdict === "ACCEPTED" ? { color: "var(--mint)", label: "Accepted" } : { color: "var(--rust)", label: VERDICT_LABEL[v.verdict] || "Failed" };
  if (visitedMap[question.id]) return { color: "var(--amber)", label: "In Progress" };
  return { color: "var(--ink-dim)", label: "Not Visited" };
}

