import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import FolderPicker from "../components/FolderPicker";
import ProblemStatementFields from "../components/ProblemStatementFields";
import TestCasesEditor from "../components/TestCasesEditor";
import QuestionPreviewToggle from "../components/QuestionPreviewToggle";
import EvaluationTypeFields, { EMPTY_SIGNATURE } from "../components/EvaluationTypeFields";
import { useConfirm } from "../context/ConfirmContext";

const QUESTION_TYPES = [
  { value: "CODING", label: "Coding" },
  { value: "MCQ", label: "Multiple Choice" },
  { value: "TRUE_FALSE", label: "True/False" },
  { value: "MULTISELECT", label: "Multiple Select" },
  { value: "SQL", label: "SQL Query" },
];

const emptyForm = {
  title: "", subject: "", topic: "", description: "", questionType: "CODING",
  difficulty: "EASY", points: 10, explanation: "",
  timeLimitMs: 2000, memoryLimitKb: "", starterCode: "", tags: "",
  evaluationType: "STDIO", sqlSchema: "",
  estimatedTimeMin: null, realWorldScenario: "", constraints: "", inputFormat: "",
  outputFormat: "", notes: "", edgeCases: "", problemExplanation: "",
  // Employability & Subject Readiness module — all optional; leaving btlLevel unset just means
  // this question is never picked for a Readiness assessment, everything else about it is
  // unaffected. questionStatus defaults PUBLISHED, matching the backend default.
  subtopic: "", btlLevel: "", skillTested: "", questionStatus: "PUBLISHED",
};

// Bloom's Taxonomy levels — the description is the actual cognitive task a question at that level
// must require (per the platform's "classify by cognitive task, not wording difficulty" rule),
// not a difficulty label. Deliberately shown inline so whoever is tagging a question sees the
// distinction every time, not just once in a help doc nobody reads.
const BTL_LEVELS = [
  { value: 1, label: "BTL 1 — Remember", hint: "Recall a fact or definition" },
  { value: 2, label: "BTL 2 — Understand", hint: "Explain or summarize a concept" },
  { value: 3, label: "BTL 3 — Apply", hint: "Use a concept to solve a given problem" },
  { value: 4, label: "BTL 4 — Analyze", hint: "Break down / identify issues in a scenario" },
  { value: 5, label: "BTL 5 — Evaluate", hint: "Judge or justify between options" },
  { value: 6, label: "BTL 6 — Create", hint: "Design or construct a new solution" },
];
const QUESTION_STATUSES = ["DRAFT", "UNDER_REVIEW", "VERIFIED", "PUBLISHED", "ARCHIVED"];

export default function CreateQuestion() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const confirmDialog = useConfirm();

  const [form, setForm] = useState(emptyForm);
  const [testCases, setTestCases] = useState([{ input: "", expected: "", isHidden: false, explanation: "" }]);
  const [options, setOptions] = useState(["", ""]);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [folderId, setFolderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [signature, setSignature] = useState(EMPTY_SIGNATURE);

  const [aiConfigured, setAiConfigured] = useState(true); // optimistic until checked, avoids a flash of "unavailable"
  const [aiSubject, setAiSubject] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    api.get("/ai/questions/status").then((res) => setAiConfigured(res.data.configured)).catch(() => {});
  }, []);

  // Drafts a question via Claude into the form for review — never saves directly. The admin/staff
  // member is expected to read, edit, and only then click the existing Save button, same as if
  // they'd typed it themselves. SQL / fill-in-the-blank / subjective aren't offered here since
  // this platform has no execution or grading path for them (see backend/src/routes/aiQuestions.js).
  async function generateWithAI() {
    const subject = (aiSubject || form.subject).trim();
    if (!subject) return setAiError("Enter a subject to generate from");
    setGenerating(true);
    setAiError("");
    try {
      const { data } = await api.post("/ai/questions/generate-question", {
        questionType: form.questionType,
        subject,
        topic: (aiTopic || form.topic).trim(),
        difficulty: form.difficulty,
      });
      setForm((f) => ({
        ...f,
        title: data.title || f.title,
        description: data.description || f.description,
        explanation: data.explanation || f.explanation,
        subject: f.subject || subject,
        topic: f.topic || (aiTopic || "").trim(),
      }));
      if (form.questionType === "CODING") {
        if (Array.isArray(data.testCases) && data.testCases.length > 0) {
          setTestCases(data.testCases.map((tc) => ({ input: tc.input ?? "", expected: tc.expected ?? "", isHidden: !!tc.isHidden, explanation: "" })));
        }
      } else {
        if (Array.isArray(data.options) && data.options.length > 0) setOptions(data.options);
        if (Array.isArray(data.correctAnswer)) setCorrectIndices(data.correctAnswer);
      }
    } catch (err) {
      setAiError(err.response?.data?.error || "AI generation failed");
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/questions/${id}`).then((res) => {
      const q = res.data;
      setForm({
        title: q.title || "", subject: q.subject || "", topic: q.topic || "",
        description: q.description || "", questionType: q.questionType,
        difficulty: q.difficulty, points: q.points, explanation: q.explanation || "",
        timeLimitMs: q.timeLimitMs ?? 2000, memoryLimitKb: q.memoryLimitKb ? Math.round(q.memoryLimitKb / 1024) : "",
        starterCode: q.starterCode || "", tags: Array.isArray(q.tags) ? q.tags.join(", ") : "",
        evaluationType: q.evaluationType || "STDIO", sqlSchema: q.sqlSchema || "",
        estimatedTimeMin: q.estimatedTimeMin ?? null,
        realWorldScenario: q.realWorldScenario || "", constraints: q.constraints || "",
        inputFormat: q.inputFormat || "", outputFormat: q.outputFormat || "",
        notes: q.notes || "", edgeCases: q.edgeCases || "", problemExplanation: q.problemExplanation || "",
        subtopic: q.subtopic || "", btlLevel: q.btlLevel ?? "", skillTested: q.skillTested || "",
        questionStatus: q.questionStatus || "PUBLISHED",
      });
      if (q.functionSignature) setSignature(q.functionSignature);
      if (q.questionType === "CODING" || q.questionType === "SQL") {
        setTestCases(q.testCases?.length ? q.testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden, explanation: tc.explanation || "" })) : [{ input: "", expected: "", isHidden: false, explanation: "" }]);
      } else {
        setOptions(q.options?.length ? q.options : ["", ""]);
        setCorrectIndices(q.correctAnswer || []);
      }
      setFolderId(q.folderId || "");
      setLoading(false);
    });
  }, [id, isEdit]);

  function updateField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  function updateOption(idx, value) {
    const next = [...options];
    next[idx] = value;
    setOptions(next);
  }

  function addOption() {
    setOptions([...options, ""]);
  }

  function removeOption(idx) {
    setOptions(options.filter((_, i) => i !== idx));
    setCorrectIndices(correctIndices.filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i)));
  }

  function toggleCorrect(idx) {
    const isMulti = form.questionType === "MULTISELECT";
    if (isMulti) {
      setCorrectIndices((prev) => (prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]));
    } else {
      setCorrectIndices([idx]);
    }
  }

  function changeType(newType) {
    setForm({ ...form, questionType: newType });
    setCorrectIndices([]);
    if (newType === "TRUE_FALSE") setOptions(["True", "False"]);
    else if (options.length < 2 || (form.questionType === "TRUE_FALSE" && newType !== "TRUE_FALSE")) setOptions(["", ""]);
  }

  async function handleSubmit(e, allowDuplicate = false) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        points: Number(form.points),
        timeLimitMs: Number(form.timeLimitMs),
        memoryLimitKb: form.memoryLimitKb ? Math.round(Number(form.memoryLimitKb) * 1024) : null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        folderId: folderId || null,
        allowDuplicate: allowDuplicate || undefined,
      };
      if (form.questionType === "CODING") {
        payload.testCases = testCases;
        if (form.evaluationType === "FUNCTION") payload.functionSignature = signature;
      } else if (form.questionType === "SQL") {
        payload.testCases = testCases;
        payload.sqlSchema = form.sqlSchema;
      } else {
        payload.options = options.map((o) => o.trim()).filter(Boolean);
        payload.correctAnswer = correctIndices;
      }

      if (isEdit) {
        await api.patch(`/questions/${id}`, payload);
      } else {
        await api.post("/questions", payload);
      }
      navigate("/staff/questions");
    } catch (err) {
      if (!isEdit && err.response?.status === 409 && err.response?.data?.duplicate) {
        const existing = err.response.data.existing;
        const ok = await confirmDialog({
          title: "Duplicate Question Detected",
          message: `A question with this text already exists in this question bank${existing.title ? ` ("${existing.title}")` : ""}: "${existing.description}". Do you want to add this one anyway?`,
          confirmLabel: "Add Anyway",
        });
        if (ok) return await handleSubmit(e, true);
        setSaving(false);
        return;
      }
      alert(err.response?.data?.error || "Failed to save question");
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  if (loading) return <div style={{ padding: 48 }} className="mono">Loading…</div>;

  const isSql = form.questionType === "SQL";
  const isCoding = form.questionType === "CODING";
  const previewQuestion = {
    title: form.title,
    description: form.description,
    difficulty: form.difficulty,
    tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    estimatedTimeMin: form.estimatedTimeMin,
    realWorldScenario: form.realWorldScenario,
    constraints: form.constraints,
    inputFormat: form.inputFormat,
    outputFormat: form.outputFormat,
    notes: form.notes,
    edgeCases: form.edgeCases,
    problemExplanation: form.problemExplanation,
    functionSignature: form.evaluationType === "FUNCTION" ? signature : null,
    testCases: testCases.filter((tc) => !tc.isHidden).map((tc) => ({ input: tc.input, expected: tc.expected, explanation: tc.explanation })),
  };
  const isQuiz = form.questionType !== "CODING" && !isSql;
  const isMulti = form.questionType === "MULTISELECT";
  const isTrueFalse = form.questionType === "TRUE_FALSE";

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <h1>{isEdit ? "Edit question" : "New question"}</h1>
          {isCoding && <QuestionPreviewToggle question={previewQuestion} />}
        </div>
        <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
          <label style={labelStyle}>Question Type</label>
          <select style={inputStyle} value={form.questionType} onChange={(e) => changeType(e.target.value)}>
            {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <div className="card" style={{ padding: 14, marginTop: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Generate with AI</div>
            {isSql ? (
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                AI generation isn't available for SQL questions yet — write the schema, query, and expected results directly below.
              </p>
            ) : !aiConfigured ? (
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                AI generation isn't configured on this server yet.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                  Drafts a {QUESTION_TYPES.find((t) => t.value === form.questionType)?.label.toLowerCase()} question below for you to review and edit — nothing is saved until you click Save.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <input style={{ ...inputStyle, marginTop: 0, flex: "1 1 160px" }} placeholder="Subject (e.g. Java, DBMS)" value={aiSubject} onChange={(e) => setAiSubject(e.target.value)} />
                  <input style={{ ...inputStyle, marginTop: 0, flex: "1 1 160px" }} placeholder="Topic (optional)" value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} />
                  <button type="button" className="btn btn-primary" disabled={generating} onClick={generateWithAI}>
                    {generating ? "Generating…" : "Generate"}
                  </button>
                </div>
                {aiError && <p style={{ color: "var(--rust)", fontSize: 12, marginTop: 6 }}>{aiError}</p>}
              </>
            )}
          </div>

          <label style={labelStyle}>Question Name (optional)</label>
          <input style={inputStyle} value={form.title} onChange={updateField("title")} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Subject</label>
              <input style={inputStyle} value={form.subject} onChange={updateField("subject")} />
            </div>
            <div>
              <label style={labelStyle}>Topic</label>
              <input style={inputStyle} value={form.topic} onChange={updateField("topic")} />
            </div>
          </div>

          {/* Employability & Subject Readiness module — all optional. A question with no BTL
              level set is simply never picked for a Readiness assessment; everything else about
              it (Formal Tests, Practice, bulk import, etc.) is completely unaffected. */}
          <div className="card" style={{ padding: 14, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Employability Readiness tagging (optional)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Subtopic</label>
                <input style={inputStyle} value={form.subtopic} onChange={updateField("subtopic")} placeholder="Finer than Topic, e.g. &quot;Normalization&quot;" />
              </div>
              <div>
                <label style={labelStyle}>Skill Tested</label>
                <input style={inputStyle} value={form.skillTested} onChange={updateField("skillTested")} placeholder="e.g. Recursion, SQL Joins" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div>
                <label style={labelStyle}>Bloom's Taxonomy (BTL) Level</label>
                <select style={inputStyle} value={form.btlLevel} onChange={updateField("btlLevel")}>
                  <option value="">Not classified</option>
                  {BTL_LEVELS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
                {form.btlLevel && (
                  <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                    Classify by what this question actually requires the student to do — {BTL_LEVELS.find((b) => b.value === Number(form.btlLevel))?.hint.toLowerCase()} — not by how hard the wording sounds.
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Review Status</label>
                <select style={inputStyle} value={form.questionStatus} onChange={updateField("questionStatus")}>
                  {QUESTION_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
                <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                  Only VERIFIED/PUBLISHED questions are eligible for a Readiness assessment blueprint.
                </p>
              </div>
            </div>
          </div>

          <label style={labelStyle}>Question Text</label>
          <textarea style={{ ...inputStyle, minHeight: 140 }} required value={form.description} onChange={updateField("description")} placeholder="Problem statement / question text…" />

          {!isQuiz && (
            <ProblemStatementFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
          )}

          <div style={{ display: "grid", gridTemplateColumns: isQuiz ? "1fr 1fr" : "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Difficulty Level</label>
              <select style={inputStyle} value={form.difficulty} onChange={updateField("difficulty")}>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Marks</label>
              <input style={inputStyle} type="number" value={form.points} onChange={updateField("points")} />
            </div>
            {!isQuiz && (
              <div>
                <label style={labelStyle}>Time limit (ms)</label>
                <input style={inputStyle} type="number" value={form.timeLimitMs} onChange={updateField("timeLimitMs")} />
              </div>
            )}
          </div>

          {form.questionType === "CODING" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Memory limit (MB, optional)</label>
                  <input style={inputStyle} type="number" value={form.memoryLimitKb} onChange={updateField("memoryLimitKb")} placeholder="Platform default" />
                </div>
                <div>
                  <label style={labelStyle}>Tags (comma-separated, optional)</label>
                  <input style={inputStyle} value={form.tags} onChange={updateField("tags")} placeholder="Arrays, Dynamic Programming" />
                </div>
              </div>

              <EvaluationTypeFields
                evaluationType={form.evaluationType}
                onEvaluationTypeChange={(v) => setForm({ ...form, evaluationType: v })}
                signature={signature}
                onSignatureChange={setSignature}
                starterCode={form.starterCode}
                onStarterCodeChange={(v) => setForm({ ...form, starterCode: v })}
              />

              <TestCasesEditor
                testCases={testCases}
                onChange={setTestCases}
                inputLabel={form.evaluationType === "FUNCTION" ? "Input (one line per parameter)" : "Input (stdin)"}
                expectedLabel={`Expected ${form.evaluationType === "FUNCTION" ? "return value" : "stdout"}`}
                minVisible={2}
                minHidden={10}
              />
            </>
          )}

          {isSql && (
            <>
              <label style={{ ...labelStyle, marginTop: 20 }}>Setup SQL (schema + seed data)</label>
              <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
                Run once against a fresh database before each test case — e.g. <span className="mono">CREATE TABLE employees (id INTEGER, name TEXT, salary INTEGER); INSERT INTO employees VALUES (1,'Asha',50000), (2,'Ravi',62000);</span> SQLite syntax only.
              </p>
              <textarea style={{ ...inputStyle, minHeight: 100, fontFamily: "var(--font-mono)" }} value={form.sqlSchema} onChange={updateField("sqlSchema")} placeholder="CREATE TABLE ...; INSERT INTO ...;" />

              <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
                Each case grades the same student query against the setup SQL above, plus this case's own optional extra setup SQL — the LeetCode-style pattern of varying the data per case while asking for one query.
              </p>

              <TestCasesEditor
                testCases={testCases}
                onChange={setTestCases}
                inputLabel="Extra setup SQL for this case (optional)"
                inputPlaceholder="INSERT INTO ... (leave blank to just use the setup SQL above)"
                expectedLabel="Expected result (one row per line, tab-separated columns)"
                expectedPlaceholder={"Ravi\t62000"}
                minVisible={1}
                minHidden={5}
              />
            </>
          )}

          {isQuiz && (
            <>
              <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  Options — {isMulti ? "check all correct answers" : "select the correct answer"}
                </div>
                {!isTrueFalse && <button type="button" className="btn btn-ghost" onClick={addOption}>+ Add option</button>}
              </div>

              {options.map((opt, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <input
                    type={isMulti ? "checkbox" : "radio"}
                    name="correctOption"
                    checked={correctIndices.includes(idx)}
                    onChange={() => toggleCorrect(idx)}
                  />
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={opt}
                    disabled={isTrueFalse}
                    onChange={(e) => updateOption(idx, e.target.value)}
                    placeholder={`Option ${idx + 1}`}
                  />
                  {!isTrueFalse && options.length > 2 && (
                    <button type="button" onClick={() => removeOption(idx)} style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }}>Remove</button>
                  )}
                </div>
              ))}

              <label style={labelStyle}>Explanation (optional)</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.explanation} onChange={updateField("explanation")} placeholder="Shown to staff for review; not shown to students during the test." />
            </>
          )}

          <div style={{ marginTop: 24, fontWeight: 700, fontSize: 14 }}>Question Bank</div>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
            File this question into a bank so it's easy to find and reuse later, or leave it uncategorized.
          </p>
          <div style={{ marginTop: 10 }}>
            <FolderPicker value={folderId} onChange={setFolderId} />
          </div>

          <button className="btn btn-primary" style={{ marginTop: 24 }} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Save question"}
          </button>
        </form>
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontFamily: "var(--font-body)" };
