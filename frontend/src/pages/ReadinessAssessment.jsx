import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import Navbar from "../components/Navbar";
import ProblemStatement from "../components/ProblemStatement";
import MathText from "../components/MathText";
import ReadinessChecklist from "../components/ReadinessChecklist";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { useProctoring } from "../hooks/useProctoring";
import { useExamSession, recallExamSession } from "../hooks/useExamSession";
import { runSecurityCheck } from "../utils/secureAssessment";
import { CODE_LANGUAGES, defaultStarter } from "../utils/codeEditorDefaults";
import { applyPlainTextInputHints, watchForNonAsciiInput } from "../utils/monacoSetup";
import { getFullscreenElement, exitFullscreenCompat } from "../utils/fullscreenCompat";
import useIsMobile from "../hooks/useIsMobile";
import api, { API_BASE_URL } from "../api";

const QUIZ_TYPES = ["MCQ", "TRUE_FALSE", "MULTISELECT"];

// Starter for a coding question in a given language: the question's own per-language template, else
// the generic one. Deliberately never the legacy single-language q.starterCode (it only matches one
// language and showed up under the wrong selector).
function starterFor(q, lang) {
  return q.starterCodeByLanguage?.[lang] || defaultStarter(lang);
}
const AUTOSAVE_INTERVAL_MS = 10000;

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

// Student-facing assessment-taking flow for the Employability & Readiness module.
//
// Strictness model (all enforced server-side, this page only reflects it):
//  - No feedback while in progress: the server never returns correctness or score for an answer
//    until the attempt is submitted, so nothing here can be used as an answer oracle. Every pick /
//    code draft is just stored; grading happens once at submit.
//  - The countdown is derived from the server's clock (serverTime offset) and the attempt's
//    startedAt + duration, so changing the device clock gains nothing, and the server independently
//    rejects saves after the deadline and sweeps abandoned attempts.
//  - If the subject has proctoring on (snapshotted onto assessment.config.proctoring at start), the
//    attempt runs fullscreen with optional camera/mic, every violation is reported to the server,
//    which counts it and terminates the attempt at the configured limit.
export default function ReadinessAssessment() {
  const { assessmentId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const isMobile = useIsMobile();

  const [assessment, setAssessment] = useState(null);
  const [subjectName, setSubjectName] = useState("");
  const [questions, setQuestions] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // questionId -> { selected: [idx], code, language, skipped }
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [remainingSec, setRemainingSec] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [phase, setPhase] = useState("loading"); // loading | preflight | starting | active | finalize-failed | terminated
  const { replaced: sessionReplaced, setSession: setExamSession } = useExamSession();
  const [security, setSecurity] = useState(null);
  const [secCheck, setSecCheck] = useState(null);
  const [readinessReady, setReadinessReady] = useState(false);
  const [violationCount, setViolationCount] = useState(0);
  const [violationWarning, setViolationWarning] = useState(null);
  const [suspiciousNotice, setSuspiciousNotice] = useState(null);
  const [terminatedReason, setTerminatedReason] = useState("");
  const [imeWarning, setImeWarning] = useState(false); // see watchForNonAsciiInput's own comment

  const monacoEditorRef = useRef(null);
  const preferredLanguageRef = useRef(null);
  const deadlineRef = useRef(null);
  const clockOffsetRef = useRef(0); // serverTime - Date.now(): a skewed device clock can't shorten/lengthen the test
  const finalizingRef = useRef(false);
  const finalizedRef = useRef(false);
  const answersRef = useRef({});
  const dirtyRef = useRef(new Set()); // questionIds with changes not yet confirmed saved
  const draftsRef = useRef({}); // { [questionId]: { [language]: code } } -- switching language never discards or cross-contaminates code
  const inFlightRef = useRef(new Set());
  const againRef = useRef(new Set()); // changed again while a save was in flight
  const questionsRef = useRef([]);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

  const proctoringCfg = assessment?.config?.proctoring || { enabled: false };
  const proctored = !!proctoringCfg.enabled;
  const maxViolations = proctoringCfg.maxViolations || 3;

  function handleEditorMount(editor) {
    monacoEditorRef.current = editor;
    applyPlainTextInputHints(editor);
    watchForNonAsciiInput(editor, () => setImeWarning(true));
  }

  // Server-classified violations (see backend utils/proctoringSeverity.js): CONFIRMED always counts,
  // SUSPICIOUS only after repeating, INTERRUPTION never. The server decides; we only display.
  async function onViolation(type) {
    if (finalizedRef.current || !proctored) return;
    try {
      const { data } = await api.post(`/readiness/assessments/${assessmentId}/violation`, { type });
      if (data.penalized) setViolationCount(data.violationCount);
      if (data.autoSubmitted) {
        finalizedRef.current = true;
        setTerminatedReason(VIOLATION_LABEL[type] || "a proctoring violation");
        proctor.stopMedia();
        if (getFullscreenElement()) exitFullscreenCompat().catch(() => {});
        setPhase("terminated");
      } else if (data.penalized) {
        const msg = `Warning ${data.violationCount}/${data.maxViolations}: ${VIOLATION_LABEL[type] || type}. The assessment will be terminated if this continues.`;
        setViolationWarning(msg);
        setTimeout(() => setViolationWarning((m) => (m === msg ? null : m)), 6000);
      } else if (data.severity === "SUSPICIOUS") {
        const msg = `Notice: ${VIOLATION_LABEL[type] || type} was detected. This didn't count this time, but repeating it will.`;
        setSuspiciousNotice(msg);
        setTimeout(() => setSuspiciousNotice((m) => (m === msg ? null : m)), 5000);
      }
    } catch {
      // best-effort; the server keeps its own log
    }
  }

  const proctor = useProctoring({
    active: phase === "active" && proctored,
    requireFullscreen: proctored,
    requireWebcam: !!proctoringCfg.requireWebcam,
    requireMicrophone: !!proctoringCfg.requireMicrophone,
    onViolation,
  });
  const cameraBlocked = !!proctoringCfg.requireWebcam && proctor.cameraStatus === "UNAVAILABLE";
  const micBlocked = !!proctoringCfg.requireMicrophone && proctor.micStatus === "UNAVAILABLE";

  useEffect(() => {
    api.get(`/readiness/assessments/${assessmentId}`).then((res) => {
      const { assessment: a, questions: qs, serverTime } = res.data;
      if (a.status !== "IN_PROGRESS") {
        navigate(`/readiness/report/${a.id}`, { replace: true });
        return;
      }
      if (serverTime) clockOffsetRef.current = new Date(serverTime).getTime() - Date.now();
      deadlineRef.current = new Date(a.startedAt).getTime() + a.durationMin * 60 * 1000;
      setAssessment(a);
      setSecurity(res.data.security || null);
      setExamSession(recallExamSession(a.id));
      setSubjectName(a.subject?.name || "");
      setQuestions(qs);
      setViolationCount(a.violationCount || 0);
      const initial = {};
      let lastKnownLang = null;
      for (const q of qs) {
        const ans = q.answer || {};
        const answered = ans.skipped === false;
        if (q.questionType === "SQL") {
          initial[q.id] = { selected: [], code: ans.code ?? (q.starterCode || ""), language: "sql", skipped: !answered };
        } else if (q.questionType === "CODING" && !ans.language) {
          // Resolved lazily the first time it's opened (see the activeIdx effect below), against the
          // language the student is already using elsewhere in this attempt.
          initial[q.id] = { selected: [], code: undefined, language: undefined, skipped: !answered };
        } else {
          const code = q.questionType === "CODING" && ans.language ? (ans.code ?? starterFor(q, ans.language)) : ans.code;
          initial[q.id] = {
            selected: Array.isArray(ans.selectedOptions) ? ans.selectedOptions : [],
            code, language: ans.language, skipped: !answered,
          };
          if (q.questionType === "CODING" && ans.language) draftsRef.current[q.id] = { [ans.language]: code };
          if (q.questionType === "CODING" && ans.language) lastKnownLang = ans.language;
        }
      }
      setAnswers(initial);
      answersRef.current = initial;
      if (lastKnownLang) preferredLanguageRef.current = lastKnownLang;
      setRemainingSec(Math.max(0, Math.floor((deadlineRef.current - (Date.now() + clockOffsetRef.current)) / 1000)));
      setPhase(a.config?.proctoring?.enabled ? "preflight" : "active");
    }).catch((err) => {
      if (err.response?.data?.finalized) { navigate(`/readiness/report/${assessmentId}`, { replace: true }); return; }
      setLoadError(err.response?.data?.error || "Failed to load assessment");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  const current = questions[activeIdx];
  const isQuiz = current && QUIZ_TYPES.includes(current.questionType);
  const isMulti = current?.questionType === "MULTISELECT";

  // Lazily resolves a coding question's language/code the first time it's opened with none set.
  useEffect(() => {
    if (!current || current.questionType !== "CODING") return;
    setAnswers((prev) => {
      const a = prev[current.id];
      if (a?.language) return prev;
      const lang = preferredLanguageRef.current || "python";
      preferredLanguageRef.current = lang;
      const code = starterFor(current, lang);
      draftsRef.current[current.id] = { ...draftsRef.current[current.id], [lang]: code };
      return { ...prev, [current.id]: { ...a, language: lang, code } };
    });
  }, [current]);

  // Countdown: always recomputed from the fixed deadline + server clock offset, never decremented.
  useEffect(() => {
    if (remainingSec == null || phase === "loading" || phase === "terminated") return;
    const t = setInterval(() => {
      const remaining = Math.max(0, Math.floor((deadlineRef.current - (Date.now() + clockOffsetRef.current)) / 1000));
      setRemainingSec(remaining);
      if (remaining <= 0 && !finalizingRef.current && !finalizedRef.current) finalize(true);
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec == null, phase]);

  function fmtTime(sec) {
    if (sec == null) return "";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }

  function payloadFor(q, a) {
    return QUIZ_TYPES.includes(q.questionType)
      ? { questionId: q.id, selectedOptions: a.selected || [], skipped: false }
      : { questionId: q.id, code: a.code ?? "", language: q.questionType === "SQL" ? "sql" : a.language, skipped: false };
  }

  // Saves one question's latest state. Serialized per question so two overlapping saves can never
  // land out of order and let an older draft overwrite a newer one; a change that arrives while a
  // save is in flight triggers one more save of the then-latest state right after.
  async function saveQuestion(qid) {
    if (finalizedRef.current) return;
    if (inFlightRef.current.has(qid)) { againRef.current.add(qid); return; }
    const q = questionsRef.current.find((x) => x.id === qid);
    const a = answersRef.current[qid];
    if (!q || !a || a.skipped !== false) { dirtyRef.current.delete(qid); return; }
    inFlightRef.current.add(qid);
    dirtyRef.current.delete(qid);
    setSaving(true);
    try {
      await api.post(`/readiness/assessments/${assessmentId}/answer`, payloadFor(q, a));
      setLastSavedAt(new Date());
      setSaveFailed(false);
    } catch (err) {
      dirtyRef.current.add(qid); // retried on the next tick and again at submit
      setSaveFailed(true);
      if (err.response?.status === 403 && /time is up/i.test(err.response?.data?.error || "") && !finalizingRef.current) finalize(true);
    } finally {
      inFlightRef.current.delete(qid);
      setSaving(inFlightRef.current.size > 0);
      if (againRef.current.delete(qid)) saveQuestion(qid);
    }
  }

  async function flushAutosave() {
    await Promise.all([...dirtyRef.current].map((qid) => saveQuestion(qid)));
  }

  useEffect(() => {
    if (phase !== "active") return;
    const i = setInterval(() => flushAutosave(), AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Never lose work on tab close / refresh / reconnect: keepalive fetch survives page teardown
  // (unlike axios) and keeps the Authorization header (unlike sendBeacon).
  useEffect(() => {
    function flushOnUnload() {
      if (finalizedRef.current) return;
      const token = localStorage.getItem("token");
      for (const qid of dirtyRef.current) {
        const q = questionsRef.current.find((x) => x.id === qid);
        const a = answersRef.current[qid];
        if (!q || !a || a.skipped !== false) continue;
        try {
          fetch(`${API_BASE_URL}/readiness/assessments/${assessmentId}/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(payloadFor(q, a)), keepalive: true,
          }).catch(() => {});
        } catch { /* best-effort */ }
      }
    }
    const onOnline = () => flushAutosave();
    window.addEventListener("beforeunload", flushOnUnload);
    window.addEventListener("pagehide", flushOnUnload);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("beforeunload", flushOnUnload);
      window.removeEventListener("pagehide", flushOnUnload);
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  // Flush the outgoing question the moment the student navigates away from it.
  useEffect(() => {
    const outgoingId = questions[activeIdx]?.id;
    return () => { if (outgoingId && dirtyRef.current.has(outgoingId)) saveQuestion(outgoingId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  function markChanged(qid, patch) {
    const next = { ...answersRef.current[qid], ...patch, skipped: false };
    answersRef.current = { ...answersRef.current, [qid]: next }; // visible to saveQuestion before React re-renders
    setAnswers(answersRef.current);
    dirtyRef.current.add(qid);
  }

  function toggleOption(idx) {
    const cur = answers[current.id]?.selected || [];
    const next = isMulti ? (cur.includes(idx) ? cur.filter((i) => i !== idx) : [...cur, idx]) : [idx];
    markChanged(current.id, { selected: next });
    saveQuestion(current.id); // picks save immediately; code saves on the 10s tick / navigation / Save Draft
  }

  function setCode(code) {
    if (!current) return;
    // The untouched starter template isn't an answer -- only a real edit marks the question answered.
    const lang = answers[current.id]?.language;
    if (lang) draftsRef.current[current.id] = { ...draftsRef.current[current.id], [lang]: code };
    markChanged(current.id, { code });
  }

  function setLanguage(language) {
    const a = answers[current.id];
    // Restore whatever was already written in the target language; otherwise that language's own
    // starter -- never the previous language's code (that left Python under a "Java" selector).
    if (a.language) draftsRef.current[current.id] = { ...draftsRef.current[current.id], [a.language]: a.code };
    const code = draftsRef.current[current.id]?.[language] ?? starterFor(current, language);
    draftsRef.current[current.id] = { ...draftsRef.current[current.id], [language]: code };
    if (a.skipped === false) markChanged(current.id, { language, code });
    else setAnswers((prev) => ({ ...prev, [current.id]: { ...prev[current.id], language, code } }));
    preferredLanguageRef.current = language;
  }

  const answeredCount = useMemo(() => Object.values(answers).filter((a) => a.skipped === false).length, [answers]);

  async function beginAssessment() {
    setPhase("starting");
    try {
      if (proctored) await proctor.requestFullscreen();
    } catch { /* surfaced by the fullscreen banner below */ }
    setPhase("active");
  }

  async function finalize(auto = false) {
    if (finalizedRef.current || finalizingRef.current) return;
    if (!auto) {
      const ok = await confirmDialog({
        title: "Submit assessment?",
        message: `You've answered ${answeredCount} of ${questions.length} question(s). Once submitted, you can't change your answers. Continue?`,
        confirmLabel: "Submit",
      });
      if (!ok) return;
    }
    finalizingRef.current = true;
    setSubmitting(true);
    // Last-chance flush so the final keystrokes are on the server before grading. A failed flush
    // (time already up / offline) never blocks submitting what the server already holds.
    await flushAutosave().catch(() => {});

    // Up to 3 tries with backoff -- never navigate to a "result" unless the server confirmed it.
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        // Grading runs every coding answer through the judge, which takes longer when a whole class
        // submits together -- the 45s global axios default would time out and retry mid-grading.
        await api.post(`/readiness/assessments/${assessmentId}/finalize`, null, { timeout: 180000 });
        ok = true;
      } catch {
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    finalizingRef.current = false;
    if (!ok) {
      setSubmitting(false);
      if (getFullscreenElement()) exitFullscreenCompat().catch(() => {});
      setPhase("finalize-failed");
      return;
    }
    finalizedRef.current = true;
    proctor.stopMedia();
    if (getFullscreenElement()) exitFullscreenCompat().catch(() => {});
    navigate(`/readiness/report/${assessmentId}`, { replace: true });
  }

  if (loadError) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: 48 }}>
          <p style={{ color: "var(--rust)" }}>{loadError}</p>
          <Link to="/readiness" className="btn btn-ghost" style={{ marginTop: 12, display: "inline-block" }}>← Back to Readiness</Link>
        </div>
      </div>
    );
  }

  if (sessionReplaced) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 480, textAlign: "center" }}>
          <h2>Assessment open elsewhere</h2>
          <p style={{ marginTop: 10, color: "var(--ink-dim)" }}>This assessment was opened in another tab, window or device, which now holds your session. Close this one and continue there. Your saved answers are safe.</p>
        </div>
      </div>
    );
  }

  if (!assessment || !current || phase === "loading") {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: 48, color: "var(--ink-dim)" }}>Loading…</div>
      </div>
    );
  }

  if (phase === "terminated") {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 640, margin: "80px auto", padding: 24 }}>
          <div className="card" style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 32 }}>⚠️</div>
            <h2 style={{ marginTop: 12, color: "var(--rust)" }}>Assessment terminated</h2>
            <p style={{ marginTop: 10, color: "var(--ink-dim)" }}>
              Your assessment was ended after repeated proctoring violations, most recently {terminatedReason}. Answers saved before termination were graded and recorded, and this counts as one of your attempts.
            </p>
            <Link to={`/readiness/report/${assessmentId}`} className="btn btn-primary" style={{ marginTop: 20, display: "inline-block" }}>View report</Link>
          </div>
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
            We couldn't confirm your submission was received — this attempt has <strong>not</strong> been marked as submitted. Check your internet connection and try again. Do not close this page.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={submitting} onClick={() => finalize(true)}>
            {submitting ? "Retrying…" : "Retry submission"}
          </button>
        </div>
      </div>
    );
  }

  if (submitting) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p className="mono">⏳ Grading your assessment — this can take a few seconds. Please don't close this tab.</p>
        </div>
      </div>
    );
  }

  if (phase === "preflight" || phase === "starting") {
    return (
      <div>
        <Navbar />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div className="card" style={{ padding: 32, maxWidth: 560, marginTop: 24 }}>
            <span className="badge" style={{ background: "var(--amber)" }}>Proctored assessment</span>
            <h2 style={{ marginTop: 10 }}>{subjectName}</h2>
            <p style={{ fontSize: 13, marginTop: 12, color: "var(--ink-dim)" }}>
              This assessment runs in fullscreen. Switching tabs, exiting fullscreen, copy/paste, right-click, and devtools shortcuts are blocked or logged
              {proctoringCfg.requireWebcam ? ", your face must stay visible in the camera" : ""}
              {proctoringCfg.requireMicrophone ? ", and your microphone must stay enabled" : ""}.
              Reaching {maxViolations} violations terminates the assessment.
            </p>
            <p className="mono" style={{ fontSize: 13, marginTop: 12, fontWeight: 700 }}>
              ⏱ The timer is already running: {fmtTime(remainingSec)} left.
            </p>
            <ReadinessChecklist
              proctor={proctor}
              requireWebcam={!!proctoringCfg.requireWebcam}
              requireMicrophone={!!proctoringCfg.requireMicrophone}
              requireFullscreen
              onReadyChange={setReadinessReady}
            />
            {security?.level === "PROCTORED" && (
              <div style={{ marginTop: 16, padding: 12, border: "1px solid var(--line)", borderRadius: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-dim)", marginBottom: 6 }}>SECURE ASSESSMENT</div>
                <p style={{ fontSize: 13, margin: "0 0 6px" }}>Stay on this page, keep the window full-size, and do not use other applications, copy/paste, screen sharing or outside assistance. Security events are recorded and reviewed.</p>
                {secCheck && (
                  <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, fontSize: 13, lineHeight: 1.8 }}>
                    {secCheck.items.map((i) => <li key={i.key} style={{ color: i.ok ? "var(--success-text)" : (i.required ? "var(--danger-text)" : "var(--warning-text)") }}>{i.ok ? "✓" : i.required ? "✕" : "!"} {i.label}</li>)}
                  </ul>
                )}
                {secCheck && !secCheck.ready && <p style={{ fontSize: 13, color: "var(--danger-text)", fontWeight: 600, margin: "6px 0 0" }}>This device or window cannot provide the required security controls. Use a laptop or desktop computer with a full-size window, then run the check again.</p>}
                <button type="button" className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12, padding: "5px 10px" }} onClick={() => setSecCheck(runSecurityCheck(security))}>{secCheck ? "Run security check again" : "Run security check"}</button>
              </div>
            )}
            <button
              className="btn btn-primary"
              style={{ marginTop: 20, width: "100%", padding: "12px 24px", opacity: readinessReady && !(security?.level === "PROCTORED" && !secCheck?.ready) ? 1 : 0.4 }}
              onClick={beginAssessment}
              disabled={phase === "starting" || !readinessReady || (security?.level === "PROCTORED" && !secCheck?.ready)}
            >
              {phase === "starting" ? "Starting…" : "Begin Assessment (Fullscreen)"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const ans = answers[current.id] || {};
  const banner = (bg, fg, children, extra) => (
    <div className="mono" style={{ background: bg, color: fg, padding: "10px 24px", fontSize: 13, fontWeight: 700, textAlign: "center", ...extra }}>{children}</div>
  );

  return (
    <div>
      {!proctored && <Navbar />}

      {proctored && cameraBlocked && banner("var(--rust)", "#fff", (
        <span>Camera is unavailable — it may be off, blocked, or permission was revoked.{" "}
          <button className="btn btn-ghost" style={{ borderColor: "#fff", color: "#fff", marginLeft: 10 }} onClick={proctor.requestMedia} disabled={proctor.requestingMedia}>
            {proctor.requestingMedia ? "Reconnecting…" : "Reconnect Camera"}
          </button>
        </span>
      ))}
      {proctored && micBlocked && banner("var(--rust)", "#fff", (
        <span>Microphone is disabled. Please enable your microphone to continue.{" "}
          <button className="btn btn-ghost" style={{ borderColor: "#fff", color: "#fff", marginLeft: 10 }} onClick={proctor.requestMedia} disabled={proctor.requestingMedia}>
            {proctor.requestingMedia ? "Reconnecting…" : "Re-enable Microphone"}
          </button>
        </span>
      ))}
      {proctored && proctoringCfg.requireWebcam && (
        <video ref={proctor.videoRef} autoPlay muted playsInline style={{
          position: "fixed", bottom: 16, right: 16, width: isMobile ? 84 : 140, height: isMobile ? 63 : 105, borderRadius: 8,
          objectFit: "cover", background: "#000", zIndex: 50,
          border: proctor.faceStatus !== "OK" ? "3px solid var(--rust)" : "2px solid var(--amber)",
        }} />
      )}
      {proctored && proctoringCfg.requireWebcam && proctor.faceModelStatus === "unavailable" && banner("var(--amber)", "#3a2c00",
        "⚠ Face detection could not start (likely a network/firewall issue) — your camera feed is still shown, but presence isn't being automatically checked this session.")}
      {proctored && proctor.faceStatus === "MISSING" && banner("var(--rust)", "#fff", "⚠ No face detected — please stay visible in the camera frame.")}
      {proctored && proctor.faceStatus === "MULTIPLE" && banner("var(--rust)", "#fff", "⚠ Multiple faces detected — only you may be in frame during this assessment.")}
      {violationWarning && banner("var(--rust)", "#fff", `⚠ ${violationWarning}`)}
      {suspiciousNotice && banner("var(--amber)", "#3a2c00", suspiciousNotice, { fontSize: 12 })}
      {proctored && proctor.orientationNotice && (
        <div className="mono" style={{ color: "var(--ink-dim)", padding: "8px 24px", fontSize: 12, textAlign: "center", borderBottom: "1px solid var(--line)" }}>
          Screen orientation changed. Please continue your assessment.
        </div>
      )}
      {proctored && !proctor.fullscreenOk && banner("var(--amber)", "#3a2c00", (
        <span>⚠ Fullscreen isn't active — leaving fullscreen counts as a violation.{" "}
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px", background: "#fff", color: "#1C1B18", marginLeft: 8 }} onClick={() => proctor.requestFullscreen()}>
            Enter Fullscreen
          </button>
        </span>
      ))}

      <div className={proctored ? "exam-protected-content" : undefined} style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "12px" : "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: isMobile ? 14 : 16 }}>{subjectName}</div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{assessment.assessmentMode.replace(/_/g, " ")} · Question {activeIdx + 1} of {questions.length}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flex: isMobile ? "1 1 100%" : "0 1 auto", justifyContent: isMobile ? "space-between" : "flex-start" }}>
            {proctored && (
              <span className="mono" style={{ fontSize: 12, color: violationCount > 0 ? "var(--rust)" : "var(--ink-dim)" }}>⚠ Violations: {violationCount}/{maxViolations}</span>
            )}
            <span className="mono" style={{ fontSize: 11, color: saveFailed ? "var(--rust)" : "var(--ink-dim)" }}>
              {saveFailed ? "⚠ Not saved — retrying…" : saving ? "Saving…" : lastSavedAt ? `● Saved ${lastSavedAt.toLocaleTimeString()}` : "● Auto-save on"}
            </span>
            {remainingSec != null && (
              <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: remainingSec < 120 ? "var(--rust)" : "var(--ink)" }}>⏱ {fmtTime(remainingSec)}</span>
            )}
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => finalize(false)}>Submit Assessment</button>
          </div>
        </div>

        {assessment.config?.shortfallLevels?.length > 0 && (
          <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "var(--amber-10, #FFF7E6)", border: "1px solid var(--amber-dark, #B8860B)", fontSize: 12.5, color: "var(--amber-dark, #8a6400)" }}>
            ⚠ The question bank didn't have enough verified questions at {assessment.config.shortfallLevels.map((l) => `BTL ${l}`).join(", ")} to fully match this assessment's intended difficulty mix — your report will reflect exactly what was actually asked, not the full intended blueprint.
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16 }}>
          {questions.map((q, i) => {
            const a = answers[q.id] || {};
            const bg = i === activeIdx ? "var(--mint)" : a.skipped === false ? "#22c55e" : "var(--card-bg, #F7F7F5)";
            const color = i === activeIdx || a.skipped === false ? "#fff" : "var(--ink)";
            const size = isMobile ? 28 : 32;
            return (
              <button key={q.id} type="button" onClick={() => setActiveIdx(i)}
                style={{ width: size, height: size, borderRadius: 6, border: "1px solid var(--line)", background: bg, color, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
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
                    <span style={{ fontSize: 14 }}><MathText text={opt} /></span>
                  </label>
                ))}
              </div>
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
                    <select value={ans.language || "python"} onChange={(e) => setLanguage(e.target.value)} className="mono" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--line)" }}>
                      {CODE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  )}
                  <button type="button" className="btn btn-ghost" disabled={saving || ans.skipped !== false} onClick={() => saveQuestion(current.id)} style={{ fontSize: 13, padding: "6px 14px" }}>
                    {saving ? "Saving…" : "Save draft now"}
                  </button>
                </div>
                {isMobile && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                      onPointerDown={(e) => e.preventDefault()} onClick={() => monacoEditorRef.current?.trigger("toolbar", "tab", null)}>⇥ Indent</button>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                      onPointerDown={(e) => e.preventDefault()} onClick={() => monacoEditorRef.current?.trigger("toolbar", "outdent", null)}>⇤ Outdent</button>
                  </div>
                )}
                {imeWarning && (
                  <div style={{ background: "var(--danger-bg)", color: "var(--rust)", padding: "8px 12px", fontSize: 12, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <span>⚠ Non-English character detected in your code — your keyboard may be set to a regional/transliteration input mode. Switch it to plain English before continuing (on Gboard: long-press the spacebar or tap the globe key).</span>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", flexShrink: 0 }} onClick={() => setImeWarning(false)}>Dismiss</button>
                  </div>
                )}
                <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                  <Editor
                    height={isMobile ? "360px" : "520px"}
                    language={current.questionType === "SQL" ? "sql" : (CODE_LANGUAGES.find((l) => l.id === ans.language)?.monaco || "python")}
                    theme="vs-dark"
                    value={ans.code || ""}
                    onChange={(v) => { if ((v ?? "") !== (ans.code ?? "")) setCode(v ?? ""); }}
                    onMount={handleEditorMount}
                    options={{ fontSize: 13, minimap: { enabled: false } }}
                  />
                </div>
                <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8 }}>
                  Your code is auto-saved every 10 seconds and graded against the real test cases once, when you submit. No results are shown during the assessment.
                </p>
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
