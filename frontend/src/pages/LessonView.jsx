import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import Editor from "@monaco-editor/react";
import api from "../api";
import { useGamification } from "../context/GamificationContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CodeResultBlock from "../components/CodeResultBlock";
import RunSubmitButtons from "../components/RunSubmitButtons";
import ProblemStatement from "../components/ProblemStatement";
import useAiStatus from "../hooks/useAiStatus";
import { CODE_LANGUAGES as LANGUAGES, defaultStarter, supportedLanguages } from "../utils/codeEditorDefaults";

const AUTOSAVE_DEBOUNCE_MS = 2000;

const TYPE_LABEL = { MCQ: "Multiple Choice", FILL_BLANK: "Fill in the Blank", CODING: "Coding", DEBUG: "Debugging", OUTPUT_PREDICTION: "Output Prediction" };

export default function LessonView() {
  const aiAvailable = useAiStatus();
  const { slug, lessonId } = useParams();
  const navigate = useNavigate();
  const { notify } = useGamification();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  function load() {
    api.get(`/learning/lessons/${lessonId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load lesson"));
  }

  useEffect(() => { setData(null); setError(""); load(); }, [lessonId]);

  async function toggleComplete() {
    setCompleting(true);
    try {
      const nextStatus = data.progress?.status === "COMPLETED" ? "IN_PROGRESS" : "COMPLETED";
      const { data: progress } = await api.post(`/learning/lessons/${lessonId}/progress`, { status: nextStatus });
      setData((d) => ({ ...d, progress: { status: progress.status, bookmarked: progress.bookmarked } }));
      notify(progress.gamification);
    } catch {
      alert("Failed to update progress");
    } finally {
      setCompleting(false);
    }
  }

  async function toggleBookmark() {
    setBookmarking(true);
    try {
      const { data: progress } = await api.post(`/learning/lessons/${lessonId}/progress`, { bookmarked: !data.progress?.bookmarked });
      setData((d) => ({ ...d, progress: { status: progress.status, bookmarked: progress.bookmarked } }));
    } catch {
      alert("Failed to update bookmark");
    } finally {
      setBookmarking(false);
    }
  }

  // Progress auto-saves as soon as this lesson is viewed (GET /lessons/:id marks it
  // IN_PROGRESS server-side) and again here — clicking Next marks the lesson COMPLETED
  // without the student needing to press a separate "Save"/"Mark complete" button first.
  async function goNext(nextLessonId) {
    setAdvancing(true);
    try {
      if (data.progress?.status !== "COMPLETED") {
        const { data: progress } = await api.post(`/learning/lessons/${lessonId}/progress`, { status: "COMPLETED" });
        notify(progress.gamification);
      }
      navigate(`/learning/${slug}/lesson/${nextLessonId}`);
    } catch {
      alert("Failed to save progress");
    } finally {
      setAdvancing(false);
    }
  }

  function handlePassed() {
    setData((d) => ({ ...d, progress: { ...(d.progress || {}), status: "COMPLETED" } }));
  }

  if (error) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 48 }}>
          <p style={{ color: "var(--rust)" }}>{error}</p>
          <Link to={`/learning/${slug}`} className="btn btn-ghost" style={{ marginTop: 12, display: "inline-block" }}>← Back to course</Link>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div><Navbar /><div style={{ maxWidth: 900, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;
  }

  const { lesson, module, course, prevLessonId, nextLessonId, progress, questions } = data;
  const completed = progress?.status === "COMPLETED";
  const codingQuestions = questions.filter((q) => q.type === "CODING");
  const testQuestions = questions.filter((q) => q.type !== "CODING");

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              <Link to={`/learning/${slug}`} style={{ color: "var(--ink-dim)" }}>{course.name}</Link> · {module.title}
            </div>
            <h1 style={{ marginTop: 6 }}>{lesson.title}</h1>
            <ChalkUnderline />
            <span
              className="badge"
              style={{ marginTop: 8, display: "inline-block", background: lesson.isModuleTest ? "var(--amber)" : "var(--success-bg)" }}
            >
              {lesson.isModuleTest ? "Official Test — one graded attempt" : "Practice Module — unlimited attempts"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link to={`/learning/${slug}`} className="btn btn-ghost">← Course</Link>
            <button className="btn btn-ghost" onClick={toggleBookmark} disabled={bookmarking}>
              {progress?.bookmarked ? "★ Bookmarked" : "☆ Bookmark"}
            </button>
            {!lesson.isModuleTest && (
              <button className={completed ? "btn btn-dark" : "btn btn-primary"} onClick={toggleComplete} disabled={completing}>
                {completed ? "✓ Completed" : "Mark as Complete"}
              </button>
            )}
          </div>
        </div>

        <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 12 }}>~{lesson.estimatedMinutes} min read</p>

        <div
          className="card lesson-content"
          style={{ padding: 24, marginTop: 20 }}
          // Lesson content is admin-authored, but any institute-scoped admin (not just a
          // superadmin) can author it — sanitize before render so a malicious/compromised admin
          // account can't stash stored XSS (e.g. exfiltrating the JWT from localStorage) in a
          // lesson every enrolled student loads.
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(lesson.content || "<p><em>No content yet.</em></p>") }}
        />

        {lesson.videoUrl && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <strong style={{ fontSize: 13 }}>Video: </strong>
            <a href={lesson.videoUrl} target="_blank" rel="noreferrer">{lesson.videoUrl}</a>
          </div>
        )}
        {lesson.pdfUrl && (
          <div className="card" style={{ padding: 16, marginTop: 12 }}>
            <strong style={{ fontSize: 13 }}>Notes (PDF): </strong>
            <a href={lesson.pdfUrl} target="_blank" rel="noreferrer">Download / view</a>
          </div>
        )}
        {Array.isArray(lesson.externalLinks) && lesson.externalLinks.length > 0 && (
          <div className="card" style={{ padding: 16, marginTop: 12 }}>
            <strong style={{ fontSize: 13 }}>External resources</strong>
            <ul style={{ marginTop: 8 }}>
              {lesson.externalLinks.map((l, i) => (
                <li key={i}><a href={l.url} target="_blank" rel="noreferrer">{l.label || l.url}</a></li>
              ))}
            </ul>
          </div>
        )}

        <NotesPanel courseId={course.id} moduleId={module.id} lessonId={lessonId} />

        {lesson.isModuleTest && testQuestions.length > 0 && (
          <>
            <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>
              Practice Test {completed && <span style={{ color: "var(--mint)", fontSize: 13 }}>— ✓ Passed</span>}
            </h3>
            <ModuleTestBlock lessonId={lessonId} questions={testQuestions} alreadyPassed={completed} onPassed={handlePassed} />
          </>
        )}

        {codingQuestions.length > 0 && (
          <>
            <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>
              {lesson.isModuleTest ? "Bonus Coding Practice (optional, not required to pass)" : "Practice"}
            </h3>
            <div style={{ display: "grid", gap: 16 }}>
              {codingQuestions.map((q) => <PracticeQuestionCard key={q.id} question={q} />)}
            </div>
          </>
        )}

        {!lesson.isModuleTest && testQuestions.length > 0 && (
          <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
            {testQuestions.map((q) => <PracticeQuestionCard key={q.id} question={q} />)}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32 }}>
          {prevLessonId ? (
            <button className="btn btn-ghost" onClick={() => navigate(`/learning/${slug}/lesson/${prevLessonId}`)}>← Previous</button>
          ) : <span />}
          {lesson.isModuleTest && !completed ? (
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", alignSelf: "center" }}>Pass the practice test above to continue →</span>
          ) : nextLessonId ? (
            <button className="btn btn-primary" onClick={() => goNext(nextLessonId)} disabled={advancing}>
              {advancing ? "Saving…" : "Next →"}
            </button>
          ) : (
            <Link to={`/learning/${slug}`} className="btn btn-primary">Back to course</Link>
          )}
        </div>
      </div>
    </div>
  );
}

// Private note-taking panel for this lesson. One editable note per lesson (the most recently
// updated one, if a student somehow has more than one from before this UI existed) — kept
// simple, matching the spec's own single-note-per-topic example. Debounced autosave copies the
// existing AUTOSAVE_DEBOUNCE_MS pattern from this file's own Practice-Coding draft autosave, but
// — unlike that fire-and-forget precedent — surfaces Saving/Saved/Unable-to-save states and never
// clears the student's typed text on a failed save; the next debounce tick (or Retry) tries again.
function NotesPanel({ courseId, moduleId, lessonId }) {
  const [noteId, setNoteId] = useState(null);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle, saving, saved, error
  const savedTextRef = useRef("");
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.get("/learning/notes", { params: { lessonId, pageSize: 1 } })
      .then(({ data }) => {
        if (cancelled) return;
        const existing = data.rows[0];
        setNoteId(existing?.id || null);
        setText(existing?.content || "");
        savedTextRef.current = existing?.content || "";
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, [lessonId]);

  async function flush(value) {
    if (value === savedTextRef.current) return;
    if (!value.trim()) return; // never auto-create/save an empty note
    setSaveState("saving");
    try {
      if (noteId) {
        await api.patch(`/learning/notes/${noteId}`, { content: value });
      } else {
        const { data } = await api.post("/learning/notes", { courseId, moduleId, lessonId, content: value });
        setNoteId(data.id);
      }
      savedTextRef.current = value;
      setSaveState("saved");
    } catch {
      setSaveState("error"); // text stays in `text` state either way — nothing typed is lost
    }
  }

  function handleChange(e) {
    const value = e.target.value;
    setText(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(value), AUTOSAVE_DEBOUNCE_MS);
  }

  useEffect(() => () => clearTimeout(timerRef.current), []);

  async function handleDelete() {
    if (!noteId) { setText(""); return; }
    if (!confirm("Delete this note?")) return;
    try {
      await api.delete(`/learning/notes/${noteId}`);
      setNoteId(null);
      setText("");
      savedTextRef.current = "";
      setSaveState("idle");
    } catch {
      alert("Failed to delete note");
    }
  }

  if (!loaded) return null;

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>My Notes</strong>
        <span className="mono" style={{ fontSize: 11, color: saveState === "error" ? "var(--rust)" : "var(--ink-dim)" }}>
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved"}
          {saveState === "error" && (
            <>
              Unable to save —{" "}
              <button type="button" onClick={() => flush(text)} style={{ background: "none", border: "none", color: "var(--rust)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>
                retry
              </button>
            </>
          )}
        </span>
      </div>
      <textarea
        value={text}
        onChange={handleChange}
        placeholder="Write a private note for yourself about this lesson…"
        rows={4}
        style={{ width: "100%", resize: "vertical", padding: 8, fontFamily: "inherit", fontSize: 13, border: "1px solid var(--border, #ddd)", borderRadius: 6 }}
      />
      {(noteId || text) && (
        <button type="button" className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12, padding: "4px 10px" }} onClick={handleDelete}>
          Delete note
        </button>
      )}
    </div>
  );
}

// The gating practice test for a module: every non-coding question is answered together and
// submitted as one batch (not checked one at a time), then reviewed — selected answers
// highlighted correct/incorrect, with the right answer + explanation shown for anything missed.
// Passing unlocks the next module; failing just lets the student retry, no cap or cooldown.
function ModuleTestBlock({ lessonId, questions, alreadyPassed, onPassed }) {
  const { notify } = useGamification();
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [retaking, setRetaking] = useState(false);

  const allAnswered = questions.every((q) => {
    const a = answers[q.id];
    return a !== undefined && a !== null && String(a).trim() !== "";
  });

  async function submit() {
    setSubmitting(true);
    try {
      const { data } = await api.post(`/learning/lessons/${lessonId}/test-submit`, { answers });
      setResult(data);
      if (data.passed) onPassed();
      notify(data.gamification);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to submit test");
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    setResult(null);
    setAnswers({});
    setRetaking(true);
  }

  if (alreadyPassed && !result && !retaking) {
    return (
      <div className="card" style={{ padding: 20, textAlign: "center" }}>
        <div style={{ color: "var(--mint)", fontWeight: 700 }}>✓ You've already passed this practice test.</div>
        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setRetaking(true)}>Retake for practice</button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 32, fontWeight: 700, color: result.passed ? "var(--mint)" : "var(--rust)" }}>{result.score}%</div>
          <div style={{ fontSize: 13, color: "var(--ink-dim)" }}>
            {result.correctCount}/{result.totalCount} correct — {result.passed ? "Passed!" : `Need ${result.passThreshold}% to pass`}
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
          {result.results.map((r, i) => (
            <div key={r.questionId} className="card" style={{ padding: 16, borderLeft: `4px solid ${r.correct ? "var(--mint)" : "var(--rust)"}` }}>
              <div style={{ fontWeight: 600 }}>{i + 1}. {r.prompt}</div>
              {r.options ? (
                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  {r.options.map((opt, idx) => {
                    const isSelected = Number(r.selected) === idx;
                    const isCorrectOpt = Number(r.correctAnswer) === idx;
                    const bg = isCorrectOpt ? "var(--success-bg)" : isSelected && !r.correct ? "var(--danger-bg)" : "transparent";
                    const color = isCorrectOpt ? "var(--mint)" : isSelected && !r.correct ? "var(--rust)" : "var(--ink)";
                    return (
                      <div key={idx} style={{ padding: "8px 12px", borderRadius: 8, background: bg, color, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
                        <span>{opt}</span>
                        {isSelected && <span className="mono" style={{ fontSize: 11 }}>Your answer</span>}
                        {isCorrectOpt && !isSelected && <span className="mono" style={{ fontSize: 11 }}>Correct answer</span>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <div>Your answer: <span className="mono">{r.selected || "(blank)"}</span></div>
                  {!r.correct && <div>Correct answer: <span className="mono" style={{ color: "var(--mint)" }}>{r.correctAnswer}</span></div>}
                </div>
              )}
              {r.explanation && <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>{r.explanation}</p>}
            </div>
          ))}
        </div>

        {!result.passed && <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} onClick={retry}>Retry Test</button>}
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: "grid", gap: 20 }}>
        {questions.map((q, i) => (
          <div key={q.id}>
            <div style={{ fontWeight: 600 }}>{i + 1}. {q.prompt}</div>
            {q.type === "FILL_BLANK" ? (
              <input
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", marginTop: 8 }}
                value={answers[q.id] || ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                placeholder="Type your answer…"
              />
            ) : (
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {(q.options || []).map((opt, idx) => (
                  <label key={idx} className="card" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="radio" name={q.id} checked={answers[q.id] === idx} onChange={() => setAnswers((a) => ({ ...a, [q.id]: idx }))} />
                    {opt}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 20, width: "100%" }} onClick={submit} disabled={!allAnswered || submitting}>
        {submitting ? "Submitting…" : "Submit Test"}
      </button>
    </div>
  );
}

function PracticeQuestionCard({ question }) {
  const { notify } = useGamification();
  const [selected, setSelected] = useState(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const [language, setLanguage] = useState(question.language || "java");
  const [code, setCode] = useState(question.starterCode || "");
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState(null); // { totalAttempts, solved, latestVerdict }
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [hint, setHint] = useState("");
  const [hintError, setHintError] = useState("");
  const [gettingHint, setGettingHint] = useState(false);
  const autosaveTimerRef = useRef(null);
  const codeRef = useRef(code);
  const languageRef = useRef(language);
  codeRef.current = code;
  languageRef.current = language;
  // Independent autosaved code per language for this question — { [language]: code }. Without
  // this, switching languages would silently discard whatever was already written in the
  // language being switched away from. Kept current on every edit via the effect below.
  const langDraftsRef = useRef({});
  useEffect(() => {
    langDraftsRef.current[language] = code;
  }, [code, language]);

  // Switching languages must reload the editor with THAT language's code — restoring a
  // previously-written draft for it if one exists this session, otherwise a starter template.
  // The question's own authored starterCode only ever matches question.language; showing it for
  // every other language was the actual bug (Java template appearing under Python, etc.).
  function handleLanguageChange(lang) {
    if (lang === language) return;
    const draft = langDraftsRef.current[lang];
    const nextCode = draft !== undefined ? draft : (lang === question.language ? (question.starterCode || defaultStarter(lang)) : defaultStarter(lang));
    setLanguage(lang);
    setCode(nextCode);
    setRunResult(null);
    setSubmitResult(null);
  }

  function loadHistory() {
    if (question.type !== "CODING") return;
    api.get(`/learning/practice/${question.id}/history`).then((res) => setHistory(res.data)).catch(() => {});
  }
  useEffect(loadHistory, [question.id]);

  // Restore any in-progress draft (survives refresh/navigation) before falling back to starter code.
  useEffect(() => {
    if (question.type !== "CODING") return;
    api.get(`/learning/practice/${question.id}/draft`)
      .then((res) => {
        if (res.data) { setCode(res.data.code); setLanguage(res.data.language); }
      })
      .catch(() => {})
      .finally(() => setDraftLoaded(true));
  }, [question.id]);

  function flushAutosave() {
    if (question.type !== "CODING") return;
    api.post(`/learning/practice/${question.id}/autosave`, { code: codeRef.current, language: languageRef.current }).catch(() => {});
  }

  // Periodic debounced autosave while typing.
  useEffect(() => {
    if (!draftLoaded || question.type !== "CODING") return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(flushAutosave, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(autosaveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language, draftLoaded]);

  // Flush on unmount (covers navigating to a different lesson/question) and on tab close.
  useEffect(() => {
    if (question.type !== "CODING") return;
    const handler = () => flushAutosave();
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
      flushAutosave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  async function checkAnswer() {
    setChecking(true);
    try {
      const answer = question.type === "FILL_BLANK" ? textAnswer : selected;
      const { data } = await api.post(`/learning/practice/${question.id}/check`, { answer });
      setResult(data);
    } catch {
      alert("Failed to check answer");
    } finally {
      setChecking(false);
    }
  }

  async function runCode() {
    setRunning(true);
    setRunResult(null);
    try {
      const { data } = await api.post(`/learning/practice/${question.id}/run`, { language, code });
      setRunResult(data);
    } catch (err) {
      alert(err.response?.data?.error || "Execution failed");
    } finally {
      setRunning(false);
    }
  }

  async function submitCode() {
    setSubmitting(true);
    setSubmitResult(null);
    setHint("");
    setHintError("");
    try {
      const { data } = await api.post(`/learning/practice/${question.id}/submit`, { language, code });
      setSubmitResult(data);
      notify(data.gamification);
      loadHistory();
    } catch (err) {
      alert(err.response?.data?.error || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function getHint() {
    setGettingHint(true);
    setHintError("");
    try {
      const { data } = await api.post(`/learning/practice/${question.id}/hint`, { language, code });
      setHint(data.hint);
    } catch (err) {
      setHintError(err.response?.data?.error || "Failed to get a hint");
    } finally {
      setGettingHint(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="badge">{TYPE_LABEL[question.type] || question.type}</span>
      </div>
      {question.type !== "CODING" && <p style={{ marginTop: 10, fontWeight: 600 }}>{question.prompt}</p>}

      {question.type === "CODING" ? (
        <>
          <div style={{ marginTop: 10 }}>
            <ProblemStatement question={question} />
          </div>
          {history && history.totalAttempts > 0 && (
            <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8 }}>
              Submissions: {history.totalAttempts} · Best: {history.solved ? "✓ Solved" : "Not solved yet"} · Latest: {history.latestVerdict}
              {" · "}unlimited attempts — practice as many times as you like
            </p>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <select value={language} onChange={(e) => handleLanguageChange(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)" }}>
              {supportedLanguages(question).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <RunSubmitButtons onRun={runCode} onSubmit={submitCode} running={running} submitting={submitting} />
          </div>
          <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <Editor
              height="240px"
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
              {submitResult.verdict !== "ACCEPTED" && aiAvailable !== false && (
                <div style={{ marginTop: 10 }}>
                  {!hint && (
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 10px" }} disabled={gettingHint || aiAvailable !== true} onClick={getHint}>
                      {gettingHint ? "Thinking…" : "Get a Hint"}
                    </button>
                  )}
                  {hint && (
                    <div className="card" style={{ padding: 10, marginTop: 6, fontSize: 13 }}>
                      <strong style={{ fontSize: 11, color: "var(--ink-dim)" }}>HINT</strong>
                      <p style={{ marginTop: 4 }}>{hint}</p>
                    </div>
                  )}
                  {hintError && <p style={{ color: "var(--rust)", fontSize: 12, marginTop: 6 }}>{hintError}</p>}
                </div>
              )}
            </div>
          )}
        </>
      ) : question.type === "FILL_BLANK" ? (
        <>
          <input
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", marginTop: 10 }}
            value={textAnswer}
            onChange={(e) => setTextAnswer(e.target.value)}
            placeholder="Type your answer…"
            disabled={!!result}
          />
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={checkAnswer} disabled={checking || !!result || !textAnswer.trim()}>
            {checking ? "Checking…" : "Check answer"}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {(question.options || []).map((opt, idx) => (
              <label key={idx} className="card" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: result ? "default" : "pointer" }}>
                <input type="radio" name={question.id} checked={selected === idx} onChange={() => setSelected(idx)} disabled={!!result} />
                {opt}
              </label>
            ))}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={checkAnswer} disabled={checking || !!result || selected === null}>
            {checking ? "Checking…" : "Check answer"}
          </button>
        </>
      )}

      {result && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: result.correct ? "var(--success-bg)" : "var(--danger-bg)" }}>
          <div className="mono" style={{ fontWeight: 700, color: result.correct ? "var(--mint)" : "var(--rust)" }}>
            {result.correct ? "✓ Correct" : "✗ Not quite"}
          </div>
          {result.explanation && <p style={{ fontSize: 13, marginTop: 6 }}>{result.explanation}</p>}
        </div>
      )}
    </div>
  );
}
