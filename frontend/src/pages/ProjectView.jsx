import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import api from "../api";
import { useGamification } from "../context/GamificationContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CodeResultBlock from "../components/CodeResultBlock";
import RunSubmitButtons from "../components/RunSubmitButtons";
import ProblemStatement from "../components/ProblemStatement";
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
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  const [activeTaskId, setActiveTaskId] = useState(null);

  function load() {
    api.get(`/learning/projects/${projectId}`)
      .then((res) => {
        setProject(res.data);
        setActiveTaskId((prev) => prev || res.data.tasks.find((t) => t.status !== "COMPLETED")?.id || res.data.tasks[0]?.id);
      })
      .catch((err) => setError(err.response?.data?.error || "Failed to load project"));
  }
  useEffect(() => { setProject(null); setError(""); load(); }, [projectId]);

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

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
          <div className="mono" style={{ fontSize: 13, color: completedCount === project.tasks.length ? "var(--mint)" : "var(--ink-dim)" }}>
            {completedCount === project.tasks.length ? "✓ All tasks complete" : `${completedCount} / ${project.tasks.length} tasks completed`}
          </div>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "var(--line)", marginTop: 8, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${project.tasks.length ? (completedCount / project.tasks.length) * 100 : 0}%`, background: "var(--mint)", transition: "width 0.3s" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, marginTop: 20, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 6 }}>
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

          {activeTask && <ProjectTaskCard key={activeTask.id} task={activeTask} onProgress={(gamification) => { notify(gamification); load(); }} />}
        </div>
      </div>
    </div>
  );
}

function ProjectTaskCard({ task, onProgress }) {
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
    if (task.isManual) return;
    api.post(`/learning/tasks/${task.id}/autosave`, { code: codeRef.current, language: languageRef.current }).catch(() => {});
  }
  useEffect(() => {
    if (!draftLoaded || task.isManual) return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(flushAutosave, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(autosaveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language, draftLoaded]);
  useEffect(() => {
    if (task.isManual) return;
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
          <button className="btn btn-primary" onClick={markComplete} disabled={completing || task.status === "COMPLETED"}>
            {task.status === "COMPLETED" ? "✓ Completed" : completing ? "Saving…" : "Mark Complete"}
          </button>
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
        </>
      )}
    </div>
  );
}
