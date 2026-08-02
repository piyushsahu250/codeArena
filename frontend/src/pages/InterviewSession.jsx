import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import Editor from "@monaco-editor/react";
import api from "../api";
import { Mic, Square } from "lucide-react";
import { useProctoring } from "../hooks/useProctoring";
import { useTheme } from "../context/ThemeContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CodeResultBlock from "../components/CodeResultBlock";
import RunSubmitButtons from "../components/RunSubmitButtons";
import ProblemStatement from "../components/ProblemStatement";
import ReadinessChecklist from "../components/ReadinessChecklist";
import "./interviewPrep.css";
import { CODE_LANGUAGES as LANGUAGES, defaultStarter } from "../utils/codeEditorDefaults";

const AUTOSAVE_DEBOUNCE_MS = 2000;

const CATEGORY_LABEL = { HR: "HR", TECHNICAL: "Technical", CODING: "Coding", APTITUDE: "Aptitude", SYSTEM_DESIGN: "System Design", BEHAVIORAL: "Behavioral", MANAGERIAL: "Managerial" };
const FREE_TEXT_CATEGORIES = ["HR", "TECHNICAL", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL"];
const VIOLATION_LABEL = {
  TAB_SWITCH: "switching tabs",
  FULLSCREEN_EXIT: "exiting fullscreen",
  CAMERA_DROPPED: "your camera being turned off or disconnected",
  MIC_DROPPED: "your microphone being turned off or disconnected",
  BROWSER_SHORTCUT: "using a restricted keyboard shortcut",
};

export default function InterviewSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("preflight"); // preflight | active | terminated
  const [readinessReady, setReadinessReady] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [drafts, setDrafts] = useState({}); // questionId -> {answerText, code, language, selected}
  // Independent autosaved code per (question, language) — { [questionId]: { [language]: code } }.
  // Without this, switching languages would silently discard whatever was already written in the
  // language being switched away from.
  const [langDrafts, setLangDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [codeSubmittedResult, setCodeSubmittedResult] = useState(false); // true once runResult holds a hidden-case Submit grade, not a sample-only Run
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [recording, setRecording] = useState(false);
  const [violationCount, setViolationCount] = useState(0);
  const [maxViolations, setMaxViolations] = useState(3);
  const [violationWarning, setViolationWarning] = useState(null);
  const recognitionRef = useRef(null);
  const finalizedRef = useRef(false);
  const { theme } = useTheme();
  const dark = theme === "dark";

  useEffect(() => {
    api.get(`/interview/sessions/${id}`).then(async (res) => {
      setData(res.data);
      setViolationCount(res.data.session.violationCount || 0);
      const initial = {};
      for (const q of res.data.questions) {
        initial[q.id] = {
          answerText: q.category !== "APTITUDE" ? (q.answer?.answerText || "") : "",
          code: q.answer?.code || q.starterCode || "",
          language: q.answer?.language || q.language || "java",
          selected: q.category === "APTITUDE" && q.answer?.answerText != null && q.answer.answerText !== "" ? Number(q.answer.answerText) : null,
        };
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
      setDrafts(initial);
      const initialLangDrafts = {};
      for (const q of res.data.questions) {
        if (q.category === "CODING") initialLangDrafts[q.id] = { [initial[q.id].language]: initial[q.id].code };
      }
      setLangDrafts(initialLangDrafts);
      const durationMin = res.data.session.config?.durationMin;
      if (durationMin && res.data.session.status === "IN_PROGRESS") {
        const elapsedSec = Math.floor((Date.now() - new Date(res.data.session.startedAt).getTime()) / 1000);
        setSecondsLeft(Math.max(0, durationMin * 60 - elapsedSec));
      }
    }).catch((err) => setError(err.response?.data?.error || "Failed to load session"));
  }, [id]);

  useEffect(() => {
    if (phase !== "active" || secondsLeft === null) return;
    if (secondsLeft <= 0) { finalize(); return; }
    const t = setInterval(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
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
    if (phase !== "active" || !activeQuestion || activeQuestion.category !== "CODING") return;
    const timer = setTimeout(() => {
      api.post(`/interview/sessions/${id}/questions/${activeQuestion.id}/draft`, { code: activeDraft.code, language: activeDraft.language }).catch(() => {});
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDraft.code, activeDraft.language, activeQuestion?.id, phase]);

  useEffect(() => {
    if (phase !== "active" || !activeQuestion) return;
    const handler = () => {
      if (activeQuestion.category === "CODING") {
        api.post(`/interview/sessions/${id}/questions/${activeQuestion.id}/draft`, { code: activeDraft.code, language: activeDraft.language }).catch(() => {});
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

  // Every violation type is reported to the server, which decides — never trusted client-side —
  // whether it's penalized (tab switch, fullscreen exit, camera/mic dropped: counts toward the
  // 3-strike auto-terminate) or logged only (face missing briefly, multiple faces detected: per
  // spec, "future ready, log don't penalize"). Noise/silent-environment reminders never reach
  // here at all — they're pure client-side UI state from useProctoring's `noiseWarning`.
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
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      } else if (res.penalized) {
        const msg = `Warning ${res.violationCount}/${res.maxViolations}: ${VIOLATION_LABEL[type] || type}. The interview will be terminated if this continues.`;
        setViolationWarning(msg);
        setTimeout(() => setViolationWarning((m) => (m === msg ? null : m)), 6000);
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

  async function begin() {
    try { await document.documentElement.requestFullscreen?.(); } catch { /* best-effort */ }
    setPhase("active");
  }

  if (error) return <div className={`interview-prep ${dark ? "dark" : ""}`}><Navbar /><div style={{ maxWidth: 800, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p><Link to="/interview" className="btn btn-ghost">← AI Mock Interview</Link></div></div>;
  if (!data) return <div className={`interview-prep ${dark ? "dark" : ""}`}><Navbar /><div style={{ maxWidth: 800, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;

  const { session, questions } = data;

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
          <div className="ip-glass" style={{ padding: 32, maxWidth: 560, marginTop: 24 }}>
            <h2>{session.isMock ? "Mock Interview" : session.isCompanyRound ? `${session.config?.company || ""} Company Round` : session.isResumeBased ? "Resume-based Interview" : `${CATEGORY_LABEL[session.category]} Interview`}</h2>
            <ChalkUnderline />
            {session.isCompanyRound && session.config?.generalFallbackCategories?.length > 0 && (
              <p style={{ fontSize: 12, marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(217,119,87,0.12)", color: "var(--rust)" }}>
                We don't have enough {session.config.company}-specific questions in {session.config.generalFallbackCategories.join(", ").toLowerCase()} yet, so this round
                includes general industry-standard questions for {session.config.generalFallbackCategories.length > 1 ? "those sections" : "that section"}.
              </p>
            )}
            <p style={{ fontSize: 13, marginTop: 14, opacity: 0.85 }}>
              This interview is fully proctored and runs in fullscreen with your camera and microphone on for the
              whole duration. Switching tabs, exiting fullscreen, or turning off your camera/microphone is tracked
              and logged; after {maxViolations} such violations the interview is automatically terminated. Your face
              should stay visible in frame — briefly stepping away or multiple people appearing in frame is logged
              for review but won't end your interview. Background noise triggers a friendly reminder only, never a
              violation.
            </p>

            <ReadinessChecklist
              proctor={proctor}
              requireWebcam
              requireMicrophone
              requireFullscreen
              onReadyChange={setReadinessReady}
            />

            <button className="btn btn-primary" style={{ marginTop: 20, width: "100%", padding: "12px 24px", opacity: readinessReady ? 1 : 0.4 }} onClick={begin} disabled={!readinessReady}>
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
    setRunResult(null);
    setCodeSubmittedResult(false);
  }

  async function saveAnswer(skipped = false) {
    setSaving(true);
    try {
      const body = { questionId: q.id, skipped };
      if (q.category === "APTITUDE") body.answerText = draft.selected != null ? String(draft.selected) : null;
      else if (q.category === "CODING") { body.code = draft.code; body.language = draft.language; }
      else body.answerText = draft.answerText;
      const { data: res } = await api.post(`/interview/sessions/${id}/answer`, body);
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
      alert(err.response?.data?.error || "Failed to save answer");
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
    try {
      const { data: res } = await api.post(`/interview/sessions/${id}/run-code`, { questionId: q.id, code: draft.code, language: draft.language });
      setRunResult(res);
    } catch (err) {
      alert(err.response?.data?.error || "Execution failed");
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
    if (finalizedRef.current) return;
    setSaving(true);
    try {
      await saveAnswer(false);
      const { data: res } = await api.post(`/interview/sessions/${id}/rounds/advance`);
      if (res.completed) {
        finalizedRef.current = true;
        proctor.stopMedia();
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
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
      alert(err.response?.data?.error || "Failed to advance to the next round");
    } finally {
      setSaving(false);
    }
  }

  async function finalize() {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    setSaving(true);
    try {
      await saveAnswer(false);
      const { data: res } = await api.post(`/interview/sessions/${id}/finalize`);
      proctor.stopMedia();
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      navigate(`/interview/report/${id}`, { state: { report: res.report, recommendedLearning: res.recommendedLearning } });
    } catch (err) {
      finalizedRef.current = false;
      alert(err.response?.data?.error || "Failed to submit interview");
    } finally {
      setSaving(false);
    }
  }

  function toggleRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition isn't supported in this browser (try Chrome). You can type your answer instead.");
      return;
    }
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) transcript += e.results[i][0].transcript + " ";
      updateDraft({ answerText: ((draft.answerText || "") + " " + transcript).trim() });
    };
    rec.onend = () => setRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
  }

  const mm = secondsLeft != null ? String(Math.floor(secondsLeft / 60)).padStart(2, "0") : null;
  const ss = secondsLeft != null ? String(secondsLeft % 60).padStart(2, "0") : null;

  return (
    <div className={`interview-prep ${dark ? "dark" : ""}`}>
      <Navbar />
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
            <Link to="/interview" className="btn btn-ghost">Exit</Link>
          </div>
        </div>

        <video ref={proctor.videoRef} autoPlay muted playsInline style={{
          position: "fixed", bottom: 16, right: 16, width: 140, height: 105, borderRadius: 8,
          objectFit: "cover", background: "#000", zIndex: 50,
          border: proctor.faceStatus !== "OK" ? "3px solid var(--rust)" : "2px solid var(--ip-accent)",
        }} />

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
          <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "10px 20px", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8 }}>
            Camera is unavailable — it may be off, blocked, or permission was revoked. Please reconnect it.
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
        {violationWarning && (
          <div className="mono" style={{ background: "var(--rust)", color: "#fff", padding: "10px 20px", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 12, borderRadius: 8 }}>
            ⚠ {violationWarning}
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
            <button key={qq.id} onClick={() => setActiveIdx(i)} className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px", opacity: i === activeIdx ? 1 : 0.5, fontWeight: i === activeIdx ? 700 : 400 }}>
              {i + 1}
            </button>
          ))}
        </div>

        <div className="ip-glass" style={{ padding: 24, marginTop: 16 }}>
          <span className="badge">{CATEGORY_LABEL[q.category]}{q.subject ? ` · ${q.subject}` : ""}{q.aptitudeCategory ? ` · ${q.aptitudeCategory}` : ""}</span>
          {q.category === "CODING" ? (
            <div style={{ marginTop: 12 }}>
              <ProblemStatement question={q} />
            </div>
          ) : (
            <p style={{ marginTop: 12, fontWeight: 600, fontSize: 16 }}>{q.prompt}</p>
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
              <button className="btn btn-ghost" style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={toggleRecording}>
                {recording ? <><Square size={14} /> Stop recording</> : <><Mic size={14} /> Record answer (speech-to-text)</>}
              </button>
              {recording && <span className="mono" style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>Listening… click Stop, then edit the transcript before moving on if needed.</span>}
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                <select className="ip-select" value={draft.language} onChange={(e) => handleLanguageChange(e.target.value)}>
                  {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
                <RunSubmitButtons onRun={runCode} onSubmit={submitCode} running={running} submitting={saving} runDisabled={micBlocked} submitDisabled={micBlocked} />
              </div>
              <div style={{ marginTop: 10, border: "1px solid var(--ip-glass-border)", borderRadius: 8, overflow: "hidden" }}>
                <Editor
                  height="260px"
                  language={LANGUAGES.find((l) => l.id === draft.language)?.monaco}
                  value={draft.code}
                  onChange={(v) => updateDraft({ code: v || "" })}
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
              <button className="btn btn-ghost" disabled={activeIdx === 0 || micBlocked} onClick={() => go(-1)}>← Previous</button>
              <button className="btn btn-ghost" onClick={skip} disabled={micBlocked}>Skip</button>
            </div>
            {activeIdx < questions.length - 1 ? (
              <button className="btn btn-primary" onClick={() => go(1)} disabled={saving || micBlocked}>{saving ? "Saving…" : "Next →"}</button>
            ) : isRoundElimination ? (
              <button className="btn btn-primary" onClick={advanceRound} disabled={saving}>
                {saving ? "Scoring round…" : session.currentRoundNumber < roundPlan.length ? "Submit Round →" : "Submit Interview"}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={finalize} disabled={saving}>{saving ? "Submitting…" : "Submit Interview"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
