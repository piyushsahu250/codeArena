import { useEffect, useState } from "react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import ProblemStatementFields from "../components/ProblemStatementFields";
import TestCasesEditor from "../components/TestCasesEditor";
import QuestionPreviewToggle from "../components/QuestionPreviewToggle";
import EvaluationTypeFields, { EMPTY_SIGNATURE } from "../components/EvaluationTypeFields";

const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 6 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginTop: 10, display: "block" };

// Admin/Staff content management for the Learning Module: drill down Course -> Module -> Lesson
// -> Practice Questions, all in one page since each level is a thin CRUD list.
export default function LearningManagement() {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [moduleId, setModuleId] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [codingTestModuleId, setCodingTestModuleId] = useState(null);

  const [courseDetail, setCourseDetail] = useState(null); // { course, modules: [{...lessons}] }

  function loadCourses() {
    api.get("/learning/courses").then((res) => setCourses(res.data));
  }
  useEffect(loadCourses, []);

  function loadCourseDetail(slug) {
    api.get(`/learning/courses/${slug}`).then((res) => setCourseDetail(res.data));
  }
  useEffect(() => {
    if (!courseId) return setCourseDetail(null);
    const c = courses.find((c) => c.id === courseId);
    if (c) loadCourseDetail(c.slug);
  }, [courseId, courses]);

  const selectedCourse = courses.find((c) => c.id === courseId);
  const selectedModule = courseDetail?.modules.find((m) => m.id === moduleId);
  const selectedLesson = selectedModule?.lessons.find((l) => l.id === lessonId);

  function refresh() {
    if (selectedCourse) loadCourseDetail(selectedCourse.slug);
    loadCourses();
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Learning Management</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Manage courses, modules, lessons, and practice questions for the Learning module.
        </p>

        <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 20 }}>
          <span style={{ cursor: "pointer", textDecoration: courseId ? "underline" : "none" }} onClick={() => { setCourseId(null); setModuleId(null); setLessonId(null); setCodingTestModuleId(null); }}>Courses</span>
          {selectedCourse && <> / <span style={{ cursor: "pointer", textDecoration: (moduleId || codingTestModuleId) ? "underline" : "none" }} onClick={() => { setModuleId(null); setLessonId(null); setCodingTestModuleId(null); }}>{selectedCourse.name}</span></>}
          {selectedModule && !codingTestModuleId && <> / <span style={{ cursor: "pointer", textDecoration: lessonId ? "underline" : "none" }} onClick={() => setLessonId(null)}>{selectedModule.title}</span></>}
          {selectedLesson && <> / {selectedLesson.title}</>}
          {codingTestModuleId && <> / {courseDetail?.modules.find((m) => m.id === codingTestModuleId)?.title} / Coding Assessment</>}
        </div>

        {!courseId && <CoursePanel courses={courses} onSelect={setCourseId} onRefresh={loadCourses} />}
        {courseId && !moduleId && !codingTestModuleId && courseDetail && (
          <ModulePanel course={selectedCourse} modules={courseDetail.modules} onSelect={setModuleId} onManageCoding={setCodingTestModuleId} onRefresh={refresh} />
        )}
        {moduleId && !lessonId && selectedModule && (
          <LessonPanel mod={selectedModule} onSelect={setLessonId} onRefresh={refresh} />
        )}
        {lessonId && selectedLesson && (
          <LessonDetailPanel lessonId={lessonId} lessonSummary={selectedLesson} onRefresh={refresh} />
        )}
        {codingTestModuleId && (
          <CodingTestPanel moduleId={codingTestModuleId} />
        )}
      </div>
    </div>
  );
}

function CoursePanel({ courses, onSelect, onRefresh }) {
  const [form, setForm] = useState({ slug: "", name: "", description: "" });
  const [saving, setSaving] = useState(false);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/learning/courses", form);
      setForm({ slug: "", name: "", description: "" });
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create course");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c) {
    await api.patch(`/learning/courses/${c.id}`, { isActive: !c.isActive });
    onRefresh();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 24, marginTop: 20, alignItems: "start" }}>
      <form onSubmit={create} className="card" style={{ padding: 20 }}>
        <h3 style={{ fontSize: 15 }}>Add course</h3>
        <label style={labelStyle}>Slug (URL id, e.g. "python")</label>
        <input style={inputStyle} required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        <label style={labelStyle}>Name</label>
        <input style={inputStyle} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label style={labelStyle}>Description</label>
        <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Creating…" : "Create course"}</button>
      </form>

      <div style={{ display: "grid", gap: 10 }}>
        {courses.map((c) => (
          <div key={c.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ cursor: "pointer" }} onClick={() => onSelect(c.id)}>
              <div style={{ fontWeight: 600 }}>{c.name} <span className="mono" style={{ fontWeight: 400, fontSize: 12, color: "var(--ink-dim)" }}>/{c.slug}</span></div>
              <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{c.description}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="badge" style={{ background: c.isActive ? "#E7F3EB" : "#F0EEE3", color: c.isActive ? "var(--mint)" : "var(--ink-dim)" }}>
                {c.isActive ? "Active" : "Coming soon"}
              </span>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => toggleActive(c)}>
                {c.isActive ? "Deactivate" : "Activate"}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onSelect(c.id)}>Manage →</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModulePanel({ course, modules, onSelect, onManageCoding, onRefresh }) {
  const [form, setForm] = useState({ title: "", description: "", order: modules.length });
  const [saving, setSaving] = useState(false);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/learning/courses/${course.id}/modules`, form);
      setForm({ title: "", description: "", order: modules.length + 1 });
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create module");
    } finally {
      setSaving(false);
    }
  }

  async function remove(m) {
    if (!confirm(`Delete module "${m.title}" and all its lessons?`)) return;
    await api.delete(`/learning/modules/${m.id}`);
    onRefresh();
  }

  async function reorder(m, delta) {
    await api.patch(`/learning/modules/${m.id}`, { order: m.order + delta });
    onRefresh();
  }

  return (
    <div style={{ marginTop: 20 }}>
      <form onSubmit={create} className="card" style={{ padding: 16, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 200px" }}>
          <label style={labelStyle}>New module title</label>
          <input style={inputStyle} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div style={{ flex: "3 1 260px" }}>
          <label style={labelStyle}>Description</label>
          <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <button className="btn btn-primary" disabled={saving}>{saving ? "Adding…" : "Add module"}</button>
      </form>

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {modules.sort((a, b) => a.order - b.order).map((m, i) => (
          <div key={m.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ cursor: "pointer" }} onClick={() => onSelect(m.id)}>
              <div style={{ fontWeight: 600 }}>Module {i + 1}: {m.title}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{m.totalCount} lesson{m.totalCount === 1 ? "" : "s"}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(m, -1)}>↑</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(m, 1)}>↓</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onSelect(m.id)}>Manage →</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onManageCoding(m.id)}>Coding Assessment</button>
              <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={() => remove(m)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LessonPanel({ mod, onSelect, onRefresh }) {
  const [form, setForm] = useState({ title: "", estimatedMinutes: 10, order: mod.lessons.length });
  const [saving, setSaving] = useState(false);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/learning/modules/${mod.id}/lessons`, form);
      setForm({ title: "", estimatedMinutes: 10, order: mod.lessons.length + 1 });
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create lesson");
    } finally {
      setSaving(false);
    }
  }

  async function remove(l) {
    if (!confirm(`Delete lesson "${l.title}"?`)) return;
    await api.delete(`/learning/lessons/${l.id}`);
    onRefresh();
  }

  async function reorder(l, delta) {
    await api.patch(`/learning/lessons/${l.id}`, { order: l.order + delta });
    onRefresh();
  }

  return (
    <div style={{ marginTop: 20 }}>
      <form onSubmit={create} className="card" style={{ padding: 16, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 200px" }}>
          <label style={labelStyle}>New lesson title</label>
          <input style={inputStyle} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div style={{ flex: "1 1 120px" }}>
          <label style={labelStyle}>Est. minutes</label>
          <input style={inputStyle} type="number" min="1" value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} />
        </div>
        <button className="btn btn-primary" disabled={saving}>{saving ? "Adding…" : "Add lesson"}</button>
      </form>

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {mod.lessons.sort((a, b) => a.order - b.order).map((l) => (
          <div key={l.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ cursor: "pointer" }} onClick={() => onSelect(l.id)}>{l.title}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(l, -1)}>↑</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(l, 1)}>↓</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onSelect(l.id)}>Edit →</button>
              <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={() => remove(l)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Fetches its own full lesson detail (content, video/pdf links, un-sanitized practice
// questions) since the course-tree summary the parent holds only has title/order/estimate —
// the CMS needs the real content to edit, which /learning/courses/:slug intentionally omits.
function LessonDetailPanel({ lessonId, lessonSummary, onRefresh }) {
  const [full, setFull] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get(`/learning/lessons/${lessonId}`).then((res) => {
      setFull(res.data);
      const l = res.data.lesson;
      setForm({ title: l.title, content: l.content || "", videoUrl: l.videoUrl || "", pdfUrl: l.pdfUrl || "", estimatedMinutes: l.estimatedMinutes, isModuleTest: l.isModuleTest });
    });
  }
  useEffect(load, [lessonId]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/learning/lessons/${lessonId}`, form);
      load();
      onRefresh();
      alert("Lesson saved.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save lesson");
    } finally {
      setSaving(false);
    }
  }

  if (!full || !form) return <p className="mono" style={{ marginTop: 20 }}>Loading…</p>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, marginTop: 20, alignItems: "start" }}>
      <form onSubmit={save} className="card" style={{ padding: 20 }}>
        <h3 style={{ fontSize: 15 }}>Edit lesson</h3>
        <label style={labelStyle}>Title</label>
        <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <label style={labelStyle}>Content (HTML — headings, &lt;p&gt;, &lt;pre&gt;&lt;code&gt;, &lt;ul&gt;)</label>
        <textarea style={{ ...inputStyle, minHeight: 260, fontFamily: "var(--font-mono)", fontSize: 12 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        <label style={labelStyle}>Video URL (optional)</label>
        <input style={inputStyle} value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} />
        <label style={labelStyle}>PDF URL (optional)</label>
        <input style={inputStyle} value={form.pdfUrl} onChange={(e) => setForm({ ...form, pdfUrl: e.target.value })} />
        <label style={labelStyle}>Estimated minutes</label>
        <input style={inputStyle} type="number" min="1" value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
          <input type="checkbox" checked={!!form.isModuleTest} onChange={(e) => setForm({ ...form, isModuleTest: e.target.checked })} />
          This is the module's gating practice test (batch-submitted, must pass to unlock the next module)
        </label>
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Saving…" : "Save lesson"}</button>
      </form>

      <PracticeQuestionsPanel lesson={{ id: lessonId, questions: full.questions }} onRefresh={load} />
    </div>
  );
}

const EMPTY_Q = {
  type: "MCQ", prompt: "", options: ["", "", "", ""], correctAnswer: 0, explanation: "", starterCode: "",
  testCases: [{ input: "", expected: "", isHidden: false, explanation: "" }], language: "java",
  title: "", tags: "", estimatedTimeMin: null, realWorldScenario: "", constraints: "",
  inputFormat: "", outputFormat: "", notes: "", edgeCases: "", problemExplanation: "", evaluationType: "STDIO",
};

function PracticeQuestionsPanel({ lesson, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_Q);
  const [signature, setSignature] = useState(EMPTY_SIGNATURE);
  const [saving, setSaving] = useState(false);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, order: lesson.questions?.length || 0 };
      payload.tags = form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      if (form.type === "CODING" && form.evaluationType === "FUNCTION") payload.functionSignature = signature;
      if (form.type !== "CODING") {
        payload.starterCode = undefined; payload.testCases = undefined; payload.language = undefined;
        payload.title = undefined; payload.tags = undefined;
        payload.estimatedTimeMin = undefined; payload.realWorldScenario = undefined; payload.constraints = undefined;
        payload.inputFormat = undefined; payload.outputFormat = undefined; payload.notes = undefined;
        payload.edgeCases = undefined; payload.problemExplanation = undefined;
        payload.evaluationType = undefined; payload.functionSignature = undefined;
        payload.hints = undefined; payload.timeComplexity = undefined; payload.spaceComplexity = undefined;
        payload.editorial = undefined; payload.similarQuestions = undefined;
      }
      if (form.type !== "MCQ" && form.type !== "DEBUG" && form.type !== "OUTPUT_PREDICTION") payload.options = undefined;
      if (form.type === "FILL_BLANK") payload.correctAnswer = form.correctAnswer;
      await api.post(`/learning/lessons/${lesson.id}/questions`, payload);
      setForm(EMPTY_Q);
      setSignature(EMPTY_SIGNATURE);
      setAdding(false);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add question");
    } finally {
      setSaving(false);
    }
  }

  async function remove(q) {
    if (!confirm("Delete this practice question?")) return;
    await api.delete(`/learning/practice/${q.id}`);
    onRefresh();
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 15 }}>Practice questions</h3>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ Add"}</button>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {(lesson.questions || []).map((q) => (
          <div key={q.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <div>
              <span className="badge">{q.type}</span>
              {q.title && <span style={{ marginLeft: 8, fontWeight: 600 }}>{q.title}</span>}
              {q.type === "CODING" && Array.isArray(q.testCases) && (
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginLeft: 8 }}>
                  {q.testCases.length} test case(s) — {q.testCases.filter((tc) => tc.isHidden).length} hidden
                </span>
              )}
              <div style={{ marginTop: 4 }}>{q.prompt}</div>
            </div>
            <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => remove(q)}>Delete</button>
          </div>
        ))}
        {(!lesson.questions || lesson.questions.length === 0) && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No practice questions yet.</p>}
      </div>

      {adding && (
        <form onSubmit={create} style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <label style={labelStyle}>Type</label>
          <select style={inputStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="MCQ">Multiple Choice</option>
            <option value="DEBUG">Debugging (multiple choice)</option>
            <option value="OUTPUT_PREDICTION">Output Prediction (multiple choice)</option>
            <option value="FILL_BLANK">Fill in the Blank</option>
            <option value="CODING">Coding</option>
          </select>

          <label style={labelStyle}>Prompt</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} required value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />

          {(form.type === "MCQ" || form.type === "DEBUG" || form.type === "OUTPUT_PREDICTION") && (
            <>
              <label style={labelStyle}>Options (select the correct one)</label>
              {form.options.map((opt, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <input type="radio" checked={form.correctAnswer === i} onChange={() => setForm({ ...form, correctAnswer: i })} />
                  <input
                    style={{ ...inputStyle, marginTop: 0, flex: 1 }}
                    value={opt}
                    onChange={(e) => { const opts = [...form.options]; opts[i] = e.target.value; setForm({ ...form, options: opts }); }}
                  />
                </div>
              ))}
            </>
          )}

          {form.type === "FILL_BLANK" && (
            <>
              <label style={labelStyle}>Correct answer</label>
              <input style={inputStyle} value={form.correctAnswer} onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })} />
            </>
          )}

          {form.type === "CODING" && (
            <>
              <label style={labelStyle}>Title (optional)</label>
              <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <label style={labelStyle}>Tags (comma-separated, optional)</label>
              <input style={inputStyle} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Arrays, Loops" />

              <ProblemStatementFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

              <label style={labelStyle}>Default language</label>
              <select style={inputStyle} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option value="java">Java</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="c">C</option>
                <option value="cpp">C++</option>
              </select>

              <EvaluationTypeFields
                evaluationType={form.evaluationType}
                onEvaluationTypeChange={(v) => setForm({ ...form, evaluationType: v })}
                signature={signature}
                onSignatureChange={setSignature}
                starterCode={form.starterCode}
                onStarterCodeChange={(v) => setForm({ ...form, starterCode: v })}
              />

              <TestCasesEditor testCases={form.testCases} onChange={(tc) => setForm({ ...form, testCases: tc })} minVisible={2} minHidden={10} />

              <div style={{ marginTop: 10 }}>
                <QuestionPreviewToggle
                  question={{
                    ...form,
                    tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
                    functionSignature: form.evaluationType === "FUNCTION" ? signature : null,
                    testCases: form.testCases.filter((tc) => !tc.isHidden),
                  }}
                />
              </div>
            </>
          )}

          <label style={labelStyle}>Explanation (shown after answering)</label>
          <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Adding…" : "Add question"}</button>
        </form>
      )}
    </div>
  );
}

// --- Mandatory Proctored Coding Test admin panel, reached from ModulePanel's "Coding
// Assessment" button. Not configured for most modules (only Module 1 & 2 are seeded) — creating
// one here is what turns on the gate; deleting it turns it back off, ungating the module.
const EMPTY_TEST_FORM = {
  title: "Module Coding Assessment", instructions: "",
  questionCount: 3, randomizeQuestions: true, passingPercent: 70, timeLimitMin: 45,
  maxAttempts: 3, cooldownMinutes: 0, maxViolations: 3,
  requireFullscreen: true, requireWebcam: false, requireMicrophone: false, allowResume: true,
  allowedLanguages: ["java", "python", "javascript", "c", "cpp"],
};

function CodingTestPanel({ moduleId }) {
  const [test, setTest] = useState(undefined); // undefined = loading, null = not configured yet
  const [form, setForm] = useState(EMPTY_TEST_FORM);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("config");

  function load() {
    api.get(`/module-coding/admin/module/${moduleId}`).then((res) => {
      setTest(res.data);
      if (res.data) {
        setForm({
          title: res.data.title, instructions: res.data.instructions || "",
          questionCount: res.data.questionCount, randomizeQuestions: res.data.randomizeQuestions,
          passingPercent: res.data.passingPercent, timeLimitMin: res.data.timeLimitMin,
          maxAttempts: res.data.maxAttempts ?? "", cooldownMinutes: res.data.cooldownMinutes,
          maxViolations: res.data.maxViolations, requireFullscreen: res.data.requireFullscreen,
          requireWebcam: res.data.requireWebcam, requireMicrophone: res.data.requireMicrophone, allowResume: res.data.allowResume,
          allowedLanguages: res.data.allowedLanguages, isActive: res.data.isActive,
        });
      }
    });
  }
  useEffect(load, [moduleId]);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/module-coding/admin/module/${moduleId}`, form);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create coding assessment");
    } finally {
      setSaving(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/module-coding/admin/tests/${test.id}`, form);
      load();
      alert("Saved.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this coding assessment and ALL student attempt history for it? This un-gates the module and cannot be undone.")) return;
    await api.delete(`/module-coding/admin/tests/${test.id}`);
    setTest(null);
  }

  function toggleLanguage(lang) {
    setForm((f) => ({
      ...f,
      allowedLanguages: f.allowedLanguages.includes(lang) ? f.allowedLanguages.filter((l) => l !== lang) : [...f.allowedLanguages, lang],
    }));
  }

  if (test === undefined) return <p className="mono" style={{ marginTop: 20 }}>Loading…</p>;

  if (test === null) {
    return (
      <form onSubmit={create} className="card" style={{ padding: 20, marginTop: 20, maxWidth: 560 }}>
        <h3 style={{ fontSize: 15 }}>Configure a proctored coding assessment</h3>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 6 }}>
          Not configured yet — this module currently unlocks the next one on lesson completion alone. Creating an
          assessment here makes it mandatory: the next module stays locked until a student passes it.
        </p>
        <ConfigFields form={form} setForm={setForm} toggleLanguage={toggleLanguage} />
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Creating…" : "Create coding assessment"}</button>
      </form>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={tab === "config" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("config")}>Settings</button>
        <button className={tab === "questions" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("questions")}>Questions ({test.questions.length})</button>
        <button className={tab === "attempts" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("attempts")}>Student Attempts</button>
      </div>

      {tab === "config" && (
        <form onSubmit={save} className="card" style={{ padding: 20, marginTop: 16, maxWidth: 560 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active (required to unlock the next module)
          </label>
          <ConfigFields form={form} setForm={setForm} toggleLanguage={toggleLanguage} />
          <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
            <button type="button" style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={remove}>Delete assessment</button>
          </div>
        </form>
      )}

      {tab === "questions" && <CodingQuestionsPanel testId={test.id} questions={test.questions} onRefresh={load} />}
      {tab === "attempts" && <CodingAttemptsPanel testId={test.id} />}
    </div>
  );
}

function ConfigFields({ form, setForm, toggleLanguage }) {
  return (
    <>
      <label style={labelStyle}>Title</label>
      <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <label style={labelStyle}>Instructions</label>
      <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
        <div><label style={labelStyle}>Questions per attempt</label><input style={inputStyle} type="number" min="1" value={form.questionCount} onChange={(e) => setForm({ ...form, questionCount: e.target.value })} /></div>
        <div><label style={labelStyle}>Time limit (min)</label><input style={inputStyle} type="number" min="1" value={form.timeLimitMin} onChange={(e) => setForm({ ...form, timeLimitMin: e.target.value })} /></div>
        <div><label style={labelStyle}>Passing %</label><input style={inputStyle} type="number" min="0" max="100" value={form.passingPercent} onChange={(e) => setForm({ ...form, passingPercent: e.target.value })} /></div>
        <div><label style={labelStyle}>Max attempts (blank = unlimited)</label><input style={inputStyle} type="number" min="1" value={form.maxAttempts} onChange={(e) => setForm({ ...form, maxAttempts: e.target.value })} /></div>
        <div><label style={labelStyle}>Cooldown between attempts (min)</label><input style={inputStyle} type="number" min="0" value={form.cooldownMinutes} onChange={(e) => setForm({ ...form, cooldownMinutes: e.target.value })} /></div>
        <div><label style={labelStyle}>Max violations before auto-submit</label><input style={inputStyle} type="number" min="1" value={form.maxViolations} onChange={(e) => setForm({ ...form, maxViolations: e.target.value })} /></div>
      </div>
      <label style={labelStyle}>Allowed languages</label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
        {["java", "python", "javascript", "c", "cpp"].map((lang) => (
          <label key={lang} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={form.allowedLanguages.includes(lang)} onChange={() => toggleLanguage(lang)} />
            {lang}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={!!form.randomizeQuestions} onChange={(e) => setForm({ ...form, randomizeQuestions: e.target.checked })} /> Randomize question selection
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={!!form.requireFullscreen} onChange={(e) => setForm({ ...form, requireFullscreen: e.target.checked })} /> Require fullscreen
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={!!form.requireWebcam} onChange={(e) => setForm({ ...form, requireWebcam: e.target.checked })} /> Require webcam (face detection)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={!!form.requireMicrophone} onChange={(e) => setForm({ ...form, requireMicrophone: e.target.checked })} /> Require microphone
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={!!form.allowResume} onChange={(e) => setForm({ ...form, allowResume: e.target.checked })} /> Allow resume after crash/refresh
        </label>
      </div>
    </>
  );
}

const EMPTY_CODING_Q = {
  title: "", description: "", difficulty: "EASY", starterCodeByLanguage: {}, timeLimitMs: 3000,
  testCases: [{ input: "", expected: "", isHidden: false, explanation: "" }], tags: "",
  estimatedTimeMin: null, realWorldScenario: "", constraints: "", inputFormat: "", outputFormat: "",
  notes: "", edgeCases: "", problemExplanation: "",
};

// Every language a Module Coding Test can allow (Test.allowedLanguages) — shown unconditionally
// here since this panel isn't scoped to one test's specific language selection. Leaving one blank
// isn't an error: the platform falls back to a generic-but-language-correct default template for
// any language with no admin-authored one, so students never see another language's code.
const CODING_LANGS = [
  { id: "java", label: "Java" },
  { id: "python", label: "Python" },
  { id: "cpp", label: "C++" },
  { id: "c", label: "C" },
  { id: "javascript", label: "JavaScript" },
];

function CodingQuestionsPanel({ testId, questions, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_CODING_Q);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  async function bulkImport(e) {
    e.preventDefault();
    if (!bulkFile) return;
    setBulkImporting(true);
    setBulkResult(null);
    try {
      const formData = new FormData();
      formData.append("file", bulkFile);
      const { data } = await api.post(`/module-coding/admin/tests/${testId}/questions/bulk-import`, formData);
      setBulkResult(data);
      setBulkFile(null);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Bulk import failed");
    } finally {
      setBulkImporting(false);
    }
  }

  async function downloadBulkTemplate() {
    const res = await api.get(`/module-coding/admin/tests/${testId}/questions/bulk-template`, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(res.data);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = "module-coding-question-template.xlsx";
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  function downloadBulkErrorReport() {
    const rows = (bulkResult.errors || []).map((e) => ["Failed", e.row, e.reason]);
    const header = ["Status", "Row", "Reason"];
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "module-coding-bulk-import-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const entries = Object.entries(form.starterCodeByLanguage).filter(([, v]) => v && v.trim());
      // The legacy single-language starterCode field is still populated (as whichever language
      // was authored first) purely for backward compatibility with any code path that hasn't
      // been updated to read starterCodeByLanguage yet — it's never the primary source anymore.
      const payload = {
        ...form,
        starterCode: entries[0]?.[1] || "",
        starterCodeByLanguage: entries.length > 0 ? Object.fromEntries(entries) : undefined,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      };
      await api.post(`/module-coding/admin/tests/${testId}/questions`, payload);
      setForm(EMPTY_CODING_Q);
      setAdding(false);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add question");
    } finally {
      setSaving(false);
    }
  }

  async function remove(q) {
    if (!confirm("Delete this question?")) return;
    await api.delete(`/module-coding/admin/questions/${q.id}`);
    onRefresh();
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 15 }}>Question pool</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setBulkOpen((b) => !b)}>{bulkOpen ? "Cancel" : "⬆ Bulk upload"}</button>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ Add question"}</button>
        </div>
      </div>

      {bulkOpen && (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
            Import multiple coding questions at once from an .xlsx/.csv file — each row needs 2 visible sample
            test cases and at least 10 hidden test cases.{" "}
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={downloadBulkTemplate}>
              ⬇ Download template
            </button>
          </p>
          <form onSubmit={bulkImport} style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setBulkFile(e.target.files?.[0] || null)} />
            <button className="btn btn-primary" disabled={!bulkFile || bulkImporting}>{bulkImporting ? "Importing…" : "Import"}</button>
          </form>
          {bulkResult && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13 }}>
                <strong>{bulkResult.createdCount}</strong> question{bulkResult.createdCount === 1 ? "" : "s"} created
                out of {bulkResult.total}.{bulkResult.errorCount > 0 && ` ${bulkResult.errorCount} failed.`}
              </p>
              {bulkResult.errors?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={downloadBulkErrorReport}>
                    ⬇ Download error report
                  </button>
                  <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                    {bulkResult.errors.map((e, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--rust)" }} className="mono">Row {e.row}: {e.reason}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {questions.map((q) => (
          <div key={q.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <div>
              <span className="badge">{q.difficulty}</span>
              <span style={{ marginLeft: 8, fontWeight: 600 }}>{q.title || "(untitled)"}</span>
              <div style={{ marginTop: 4, color: "var(--ink-dim)" }}>{q.description}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                {q.testCases.length} test case(s) — {q.testCases.filter((tc) => tc.isHidden).length} hidden
                {" — templates: "}
                {q.starterCodeByLanguage && Object.keys(q.starterCodeByLanguage).length > 0
                  ? Object.keys(q.starterCodeByLanguage).join(", ")
                  : "none (generic defaults used)"}
              </div>
            </div>
            <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => remove(q)}>Delete</button>
          </div>
        ))}
        {questions.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No questions yet — students can't start this assessment until at least one is added.</p>}
      </div>

      {adding && (
        <form onSubmit={create} style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <label style={labelStyle}>Title</label>
          <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label style={labelStyle}>Description / prompt</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label style={labelStyle}>Difficulty</label>
          <select style={inputStyle} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
            <option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option>
          </select>
          <label style={labelStyle}>Tags (comma-separated, optional)</label>
          <input style={inputStyle} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Arrays, Recursion" />

          <ProblemStatementFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

          <label style={labelStyle}>Starter code per language (optional — languages left blank fall back to a generic default template instead of another language's code)</label>
          {CODING_LANGS.map((l) => (
            <div key={l.id} style={{ marginTop: 6 }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 2 }}>{l.label}</div>
              <textarea
                style={{ ...inputStyle, minHeight: 60, fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 0 }}
                value={form.starterCodeByLanguage[l.id] || ""}
                onChange={(e) => setForm({ ...form, starterCodeByLanguage: { ...form.starterCodeByLanguage, [l.id]: e.target.value } })}
              />
            </div>
          ))}
          <TestCasesEditor testCases={form.testCases} onChange={(tc) => setForm({ ...form, testCases: tc })} minVisible={2} minHidden={10} />
          <div style={{ marginTop: 10 }}>
            <QuestionPreviewToggle
              question={{
                ...form,
                tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
                testCases: form.testCases.filter((tc) => !tc.isHidden),
              }}
            />
          </div>
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Adding…" : "Add question"}</button>
        </form>
      )}
    </div>
  );
}

function CodingAttemptsPanel({ testId }) {
  const [attempts, setAttempts] = useState(null);

  function load() {
    api.get(`/module-coding/admin/tests/${testId}/attempts`).then((res) => setAttempts(res.data));
  }
  useEffect(load, [testId]);

  async function resetAttempts(studentId, name) {
    if (!confirm(`Reset all attempts for ${name}? They'll be able to start fresh — use this to grant an additional attempt beyond the configured limit.`)) return;
    await api.delete(`/module-coding/admin/tests/${testId}/students/${studentId}/attempts`);
    load();
  }

  async function exportCsv() {
    const { data } = await api.get(`/module-coding/admin/tests/${testId}/export`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "coding-assessment-attempts.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 15 }}>Student attempts</h3>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={exportCsv}>⬇ Export CSV</button>
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {(attempts || []).map((a) => (
          <div key={a.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{a.student.name} <span className="mono" style={{ fontWeight: 400, fontSize: 11, color: "var(--ink-dim)" }}>{a.student.rollNumber || a.student.email}</span></div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                Attempt #{a.attemptNumber} — {a.status} — {a.score}%{a.passed ? " (Passed)" : ""} — {a.violationCount} violation(s)
                {a.autoSubmitReason ? ` — auto-submitted: ${a.autoSubmitReason}` : ""}
              </div>
            </div>
            <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => resetAttempts(a.student.id, a.student.name)}>Reset attempts</button>
          </div>
        ))}
        {attempts && attempts.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No attempts yet.</p>}
      </div>
    </div>
  );
}
