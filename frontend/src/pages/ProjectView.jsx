import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { CheckCircle2, PlusCircle } from "lucide-react";
import api from "../api";
import { useGamification } from "../context/GamificationContext";
import { useFeatures } from "../context/FeatureContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CodeResultBlock from "../components/CodeResultBlock";
import RunSubmitButtons from "../components/RunSubmitButtons";
import ProblemStatement from "../components/ProblemStatement";
import ImStuckMenu from "../components/ImStuckMenu";
import useAiStatus from "../hooks/useAiStatus";
import { CODE_LANGUAGES as LANGUAGES, defaultStarter, supportedLanguages } from "../utils/codeEditorDefaults";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const STATUS_ICON = { COMPLETED: "✓", IN_PROGRESS: "◐", NOT_STARTED: "○" };
const STATUS_COLOR = { COMPLETED: "var(--mint)", IN_PROGRESS: "var(--amber-dark)", NOT_STARTED: "var(--ink-dim)" };

// Student-facing Project-Based Learning surface (spec sections 14-17): a module-scoped, multi-
// task capstone. Reuses the exact Run/Submit/autosave/draft pattern already proven by
// PracticeQuestionCard in LessonView.jsx, and ProblemStatement's own built-in progressive-hint
// reveal — no new judge, no new hint UI, per the standing "reuse, don't duplicate" rule.
export default function ProjectView() {
  const { slug, moduleId, projectId } = useParams();
  const { notify } = useGamification();
  const { isFeatureEnabled } = useFeatures();
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [resumeStatus, setResumeStatus] = useState(null); // null (unknown) | { addedToResume } | "adding"

  async function checkResumeStatus(title) {
    if (!isFeatureEnabled("resume_builder")) return;
    try {
      const { data } = await api.get("/resume/me/portfolio");
      const entry = data.projects.find((p) => p.title === title);
      setResumeStatus(entry ? { addedToResume: entry.addedToResume } : null);
    } catch { setResumeStatus(null); }
  }

  async function addToResume(title) {
    setResumeStatus("adding");
    try {
      await api.post("/resume/me/portfolio/add", { projectTitle: title });
      setResumeStatus({ addedToResume: true });
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add to resume");
      setResumeStatus(null);
    }
  }

  function load() {
    api.get(`/learning/projects/${projectId}`)
      .then((res) => {
        setProject(res.data);
        setActiveTaskId((prev) => prev || res.data.tasks.find((t) => t.status !== "COMPLETED")?.id || res.data.tasks[0]?.id);
        if (res.data.tasks.length > 0 && res.data.tasks.every((t) => t.status === "COMPLETED")) checkResumeStatus(res.data.title);
      })
      .catch((err) => setError(err.response?.data?.error || "Failed to load project"));
  }
  useEffect(() => { setProject(null); setError(""); setResumeStatus(null); load(); }, [projectId]);

  if (error) return <div><Navbar /><div style={{ maxWidth: 900, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p></div></div>;
  if (!project) return <div><Navbar /><div style={{ maxWidth: 900, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;

  const completedCount = project.tasks.filter((t) => t.status === "COMPLETED").length;
  const activeTask = project.tasks.find((t) => t.id === activeTaskId);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <Link to={`/learning/${slug}`} className="btn btn-ghost" style={{ fontSize: 12 }}>← Back to course</Link>
        <div style={{ marginTop: 8 }}>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {project.title}
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 10px" }}>
              {project.level.replace(/_/g, " ")}
            </span>
          </h1>
          <ChalkUnderline />
        </div>

        {(project.objective || project.realWorldScenario || (project.requirements || []).length > 0 || (project.skillsRequired || []).length > 0) && (
          <div className="card" style={{ padding: 20, marginTop: 16 }}>
            {project.objective && <p style={{ fontSize: 14 }}><strong>Objective:</strong> {project.objective}</p>}
            {project.realWorldScenario && <p style={{ fontSize: 13, marginTop: 8, color: "var(--ink-dim)", whiteSpace: "pre-wrap" }}>{project.realWorldScenario}</p>}
            {Array.isArray(project.requirements) && project.requirements.length > 0 && (
              <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 13 }}>
                {project.requirements.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            {Array.isArray(project.skillsRequired) && project.skillsRequired.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {project.skillsRequired.map((s, i) => (
                  <span key={i} className="mono" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)" }}>{s}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {Array.isArray(project.possibleImprovements) && project.possibleImprovements.length > 0 && (
          <div className="card" style={{ padding: 20, marginTop: 16 }}>
            <p style={{ fontSize: 14, fontWeight: 600 }}>Possible improvements</p>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>Once your tasks pass, try extending the project with one of these — good for a portfolio writeup.</p>
            <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 13 }}>
              {project.possibleImprovements.map((imp, i) => <li key={i}>{imp}</li>)}
            </ul>
          </div>
        )}

        {Array.isArray(project.interviewQuestions) && project.interviewQuestions.length > 0 && (
          <div className="card" style={{ padding: 20, marginTop: 16 }}>
            <p style={{ fontSize: 14, fontWeight: 600 }}>Interview questions based on this project</p>
            <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 13 }}>
              {project.interviewQuestions.map((q, i) => <li key={i} style={{ marginTop: i > 0 ? 6 : 0 }}>{q}</li>)}
            </ul>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
          <div className="mono" style={{ fontSize: 13, color: completedCount === project.tasks.length ? "var(--mint)" : "var(--ink-dim)" }}>
            {completedCount === project.tasks.length ? "✓ All tasks complete" : `${completedCount} / ${project.tasks.length} tasks completed`}
          </div>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "var(--line)", marginTop: 8, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${project.tasks.length ? (completedCount / project.tasks.length) * 100 : 0}%`, background: "var(--mint)", transition: "width 0.3s" }} />
        </div>

        {project.tasks.length > 0 && completedCount === project.tasks.length && isFeatureEnabled("resume_builder") && resumeStatus && (
          <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--mint)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 13 }}>🎉 Project complete — showcase it on your resume?</span>
            {resumeStatus === "adding" ? (
              <span className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}>Adding…</span>
            ) : resumeStatus.addedToResume ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mint)" }}><CheckCircle2 size={14} /> Added to Resume</span>
            ) : (
              <button className="btn btn-primary" style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => addToResume(project.title)}>
                <PlusCircle size={13} /> Add to Resume
              </button>
            )}
          </div>
        )}

        {/* flexWrap, not a fixed grid column — a 220px sidebar plus content in a rigid grid
            leaves an unusably narrow ~135px for the code editor on a 375px phone. flex-basis lets
            the task list keep its natural width on desktop while wrapping to full-width, stacked
            above the content, the moment the viewport is too narrow to fit both. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 20, alignItems: "flex-start" }}>
          <div style={{ display: "grid", gap: 6, flex: "1 1 220px", minWidth: 0 }}>
            {project.tasks.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setActiveTaskId(t.id)}
                className="card"
                style={{
                  textAlign: "left", padding: "10px 12px", fontSize: 13, cursor: "pointer",
                  border: t.id === activeTaskId ? "1px solid var(--mint)" : "1px solid var(--line)",
                  background: "none",
                }}
              >
                <span className="mono" style={{ color: STATUS_COLOR[t.status], marginRight: 8 }}>{STATUS_ICON[t.status]}</span>
                Task {i + 1}: {t.title}
              </button>
            ))}
          </div>

          {project.tasks.length === 0 && (
            <div className="card" style={{ padding: 24, flex: "3 1 320px", textAlign: "center", color: "var(--ink-dim)" }}>
              This project doesn't have any tasks yet — check back soon.
            </div>
          )}

          {activeTask && (
            <div style={{ flex: "3 1 320px", minWidth: 0 }}>
              <ProjectTaskCard key={activeTask.id} task={activeTask} onProgress={(gamification) => { notify(gamification); load(); }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectTaskCard({ task, onProgress }) {
  const aiAvailable = useAiStatus();
  const [language, setLanguage] = useState(task.language || "java");
  const [code, setCode] = useState(task.starterCode || defaultStarter(task.language || "java"));
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const autosaveTimerRef = useRef(null);
  const codeRef = useRef(code);
  const languageRef = useRef(language);
  codeRef.current = code;
  languageRef.current = language;

  useEffect(() => {
    setRunResult(null); setSubmitResult(null); setDraftLoaded(false);
    api.get(`/learning/tasks/${task.id}/draft`)
      .then((res) => {
        if (res.data) { setCode(res.data.code); setLanguage(res.data.language); }
        else { setCode(task.starterCode || defaultStarter(task.language || "java")); setLanguage(task.language || "java"); }
      })
      .catch(() => {})
      .finally(() => setDraftLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  function flushAutosave() {
    api.post(`/learning/tasks/${task.id}/autosave`, { code: codeRef.current, language: languageRef.current }).catch(() => {});
  }
  useEffect(() => {
    // Autosaves for a MANUAL task too (not just auto-graded ones) — the backend now requires a
    // real, saved draft here before /tasks/:id/complete will accept the transition to COMPLETED,
    // so a MANUAL task's editor needs the same autosave wiring graded tasks already had.
    if (!draftLoaded) return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(flushAutosave, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(autosaveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language, draftLoaded]);
  useEffect(() => {
    const handler = () => flushAutosave();
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => { window.removeEventListener("beforeunload", handler); window.removeEventListener("pagehide", handler); flushAutosave(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function runCode() {
    setRunning(true); setRunResult(null);
    try {
      const { data } = await api.post(`/learning/tasks/${task.id}/run`, { language, code });
      setRunResult(data);
    } catch (err) {
      alert(err.response?.data?.error || "Execution failed");
    } finally { setRunning(false); }
  }

  async function submitCode() {
    setSubmitting(true); setSubmitResult(null);
    try {
      const { data } = await api.post(`/learning/tasks/${task.id}/submit`, { language, code });
      setSubmitResult(data);
      if (data.verdict === "ACCEPTED") onProgress(data.gamification);
    } catch (err) {
      alert(err.response?.data?.error || "Submission failed");
    } finally { setSubmitting(false); }
  }

  async function markComplete() {
    setCompleting(true);
    try {
      const { data } = await api.post(`/learning/tasks/${task.id}/complete`);
      onProgress(data.gamification);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to mark complete");
    } finally { setCompleting(false); }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <ProblemStatement question={{ title: task.title, description: task.instructions, hints: task.hints, testCases: task.testCases, starterCode: task.starterCode, functionSignature: task.functionSignature }} />

      {task.isManual ? (
        <div style={{ marginTop: 20 }}>
          {/* This task has no auto-gradable test cases, so the server can't verify a correct
              answer the way it does for graded tasks — self-marking is the only completion
              signal that can exist for it. To stop Mark Complete being clickable with nothing
              written at all, the editor below autosaves a real draft (same CodeDraft/autosave
              path graded tasks use) and the backend now requires it to hold real, non-starter
              content before it accepts the transition to COMPLETED. */}
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)" }}>
            {supportedLanguages(task).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <Editor
              height="220px"
              language={LANGUAGES.find((l) => l.id === language)?.monaco}
              value={code}
              onChange={(v) => setCode(v || "")}
              options={{ fontSize: 13, minimap: { enabled: false }, fontFamily: "JetBrains Mono, monospace" }}
            />
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={markComplete} disabled={completing || task.status === "COMPLETED"}>
            {task.status === "COMPLETED" ? "✓ Completed" : completing ? "Saving…" : "Mark Complete"}
          </button>
          {task.status !== "COMPLETED" && (
            <ImStuckMenu endpoint={`/learning/tasks/${task.id}/assist`} code={code} language={language} aiAvailable={aiAvailable} />
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)" }}>
              {supportedLanguages(task).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <RunSubmitButtons onRun={runCode} onSubmit={submitCode} running={running} submitting={submitting} />
          </div>
          <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <Editor
              height="280px"
              language={LANGUAGES.find((l) => l.id === language)?.monaco}
              value={code}
              onChange={(v) => setCode(v || "")}
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
          {task.status !== "COMPLETED" && (
            <ImStuckMenu endpoint={`/learning/tasks/${task.id}/assist`} code={code} language={language} aiAvailable={aiAvailable} />
          )}
        </>
      )}
    </div>
  );
}
