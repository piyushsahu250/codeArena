import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import FolderPicker from "../components/FolderPicker";
import SubjectUnitPicker from "../components/SubjectUnitPicker";
import ProblemStatementFields from "../components/ProblemStatementFields";
import TestCasesEditor from "../components/TestCasesEditor";
import QuestionPreviewToggle from "../components/QuestionPreviewToggle";
import { MathLivePreview, MathSyntaxHint } from "../components/MathLivePreview";
import EvaluationTypeFields, { EMPTY_SIGNATURE } from "../components/EvaluationTypeFields";
import { useConfirm } from "../context/ConfirmContext";
import { CODE_LANGUAGES } from "../utils/codeEditorDefaults";

const QUESTION_TYPES = [
  { value: "CODING", label: "Coding" },
  { value: "MCQ", label: "Multiple Choice" },
  { value: "TRUE_FALSE", label: "True/False" },
  { value: "MULTISELECT", label: "Multiple Select" },
  { value: "SQL", label: "SQL Query" },
];

const emptyForm = {
  title: "", description: "", questionType: "CODING",
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
  const [searchParams] = useSearchParams();
  // Set when this page was opened from a Readiness Test's "+ Add Question" button — a
  // newly-created question is auto-added to that test's curated pool and the staff member is
  // returned straight to the test instead of the general Question Bank list.
  const readinessSubjectId = searchParams.get("readinessSubjectId");
  // Same deep-link pattern, for Challenge Admin's "+ Create New Question" — "daily" or "weekly".
  // No pool to add into (Daily/Weekly Challenge just picks one Question directly), so the newly
  // created question is simply pre-selected back on that page instead.
  const returnToChallenge = searchParams.get("returnToChallenge");

  const [form, setForm] = useState(emptyForm);
  // 2 empty visible + 5 empty hidden rows by default — matches the platform's own minimum for a
  // publishable coding question, so a new question starts with the right STRUCTURE ready to fill
  // in, instead of forcing staff to click "+ Add" seven times before they can even begin (the
  // previous single-empty-row default never matched the minimum even before it was 10). This never
  // invents test DATA — every row starts genuinely blank, exactly as blank as the old single row was.
  const emptyCase = (isHidden) => ({ input: "", expected: "", isHidden, explanation: "" });
  const [testCases, setTestCases] = useState([
    emptyCase(false), emptyCase(false),
    emptyCase(true), emptyCase(true), emptyCase(true), emptyCase(true), emptyCase(true),
  ]);
  const [options, setOptions] = useState(["", ""]);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [folderId, setFolderId] = useState("");
  const [subjectId, setSubjectId] = useState(null);
  const [unitId, setUnitId] = useState(null);
  const [topicId, setTopicId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [signature, setSignature] = useState(EMPTY_SIGNATURE);

  // Admin/Staff-authored working solution, keyed by language — run through the same judge a
  // student submission goes through, against this question's own test cases, to catch a wrong
  // expected output or a case that doesn't match the signature before publishing. Never sent to
  // students (see backend Question.referenceSolution schema comment).
  const [referenceSolution, setReferenceSolution] = useState({});
  const [refLanguage, setRefLanguage] = useState("java");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [validationError, setValidationError] = useState("");

  const [aiConfigured, setAiConfigured] = useState(true); // optimistic until checked, avoids a flash of "unavailable"
  const [aiSubject, setAiSubject] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiBtlLevel, setAiBtlLevel] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiGenerated, setAiGenerated] = useState(false);

  useEffect(() => {
    api.get("/ai/questions/status").then((res) => setAiConfigured(res.data.configured)).catch(() => {});
  }, []);

  // Drafts a question via Claude into the form for review — never saves directly. The admin/staff
  // member is expected to read, edit, and only then click the existing Save button, same as if
  // they'd typed it themselves. SQL / fill-in-the-blank / subjective aren't offered here since
  // this platform has no execution or grading path for them (see backend/src/routes/aiQuestions.js).
  //
  // Passes real BTL/skill context when the admin sets it — the backend uses these to instruct the
  // model on the actual cognitive task the question must exercise, per the Employability &
  // Readiness module's "never assign BTL randomly, always give AI real objective context" rule.
  // A successful generation forces Review Status to DRAFT and marks the question aiGenerated —
  // AI-authored content must pass through review before it can appear in a live assessment, never
  // auto-publish.
  async function generateWithAI() {
    const subject = aiSubject.trim();
    if (!subject) return setAiError("Enter a subject to generate from");
    setGenerating(true);
    setAiError("");
    try {
      const { data } = await api.post("/ai/questions/generate-question", {
        questionType: form.questionType,
        subject,
        topic: aiTopic.trim(),
        difficulty: form.difficulty,
        btlLevel: aiBtlLevel || form.btlLevel || undefined,
        skillTested: form.skillTested || undefined,
        subtopic: form.subtopic || undefined,
      });
      setForm((f) => ({
        ...f,
        title: data.title || f.title,
        description: data.description || f.description,
        explanation: data.explanation || f.explanation,
        btlLevel: data.btlLevel ?? f.btlLevel,
        skillTested: data.skillTested || f.skillTested,
        subtopic: data.subtopic || f.subtopic,
        questionStatus: "DRAFT",
      }));
      setAiGenerated(true);
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
        title: q.title || "",
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
      setAiGenerated(!!q.aiGenerated);
      if (q.functionSignature) setSignature(q.functionSignature);
      if (q.referenceSolution && typeof q.referenceSolution === "object") setReferenceSolution(q.referenceSolution);
      if (q.questionType === "CODING" || q.questionType === "SQL") {
        // The empty-array fallback only fires for a pre-existing row somehow saved with zero test
        // cases at all (already invalid under this platform's own minimum) — same 2-visible/
        // 5-hidden empty starting structure as a brand-new question, not a single lone row.
        setTestCases(q.testCases?.length ? q.testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden, explanation: tc.explanation || "" })) : [emptyCase(false), emptyCase(false), emptyCase(true), emptyCase(true), emptyCase(true), emptyCase(true), emptyCase(true)]);
      } else {
        setOptions(q.options?.length ? q.options : ["", ""]);
        setCorrectIndices(q.correctAnswer || []);
      }
      setFolderId(q.folderId || "");
      setSubjectId(q.subjectId || null);
      setUnitId(q.unitId || null);
      setTopicId(q.topicId || null);
      setLoading(false);
    });
  }, [id, isEdit]);

  async function validateReferenceSolution() {
    const code = referenceSolution[refLanguage] || "";
    if (!code.trim()) return setValidationError("Write a reference solution before validating");
    setValidating(true);
    setValidationError("");
    setValidationResult(null);
    try {
      const { data } = await api.post("/questions/validate-test-cases", {
        language: refLanguage,
        code,
        testCases,
        evaluationType: form.evaluationType,
        functionSignature: form.evaluationType === "FUNCTION" ? signature : undefined,
        timeLimitMs: Number(form.timeLimitMs) || 2000,
        memoryLimitKb: form.memoryLimitKb ? Math.round(Number(form.memoryLimitKb) * 1024) : undefined,
      });
      setValidationResult(data);
    } catch (err) {
      setValidationError(err.response?.data?.error || "Validation failed");
    } finally {
      setValidating(false);
    }
  }

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
    if (!subjectId || !unitId) {
      alert("Subject and Unit are required — every question must be classified before it can be saved.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        points: Number(form.points),
        timeLimitMs: Number(form.timeLimitMs),
        memoryLimitKb: form.memoryLimitKb ? Math.round(Number(form.memoryLimitKb) * 1024) : null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        folderId: folderId || null,
        subjectId, unitId, topicId,
        allowDuplicate: allowDuplicate || undefined,
        aiGenerated,
      };
      if (form.questionType === "CODING") {
        payload.testCases = testCases;
        if (form.evaluationType === "FUNCTION") payload.functionSignature = signature;
        payload.referenceSolution = Object.keys(referenceSolution).some((k) => referenceSolution[k]?.trim()) ? referenceSolution : undefined;
      } else if (form.questionType === "SQL") {
        payload.testCases = testCases;
        payload.sqlSchema = form.sqlSchema;
      } else {
        payload.options = options.map((o) => o.trim()).filter(Boolean);
        payload.correctAnswer = correctIndices;
      }

      if (isEdit) {
        await api.patch(`/questions/${id}`, payload);
        navigate("/staff/questions");
      } else {
        const { data: created } = await api.post("/questions", payload);
        if (readinessSubjectId) {
          await api.post(`/readiness/admin/subjects/${readinessSubjectId}/pool`, { questionIds: [created.id] }).catch(() => {});
          navigate(`/staff/readiness-subjects?edit=${readinessSubjectId}`);
        } else if (returnToChallenge) {
          navigate(`/staff/challenges?tab=${returnToChallenge}&selectQuestionId=${created.id}`);
        } else {
          navigate("/staff/questions");
        }
      }
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
      const reasons = err.response?.data?.reasons;
      alert(
        (err.response?.data?.error || "Failed to save question") +
        (Array.isArray(reasons) && reasons.length > 0 ? "\n\n" + reasons.map((r) => `• ${r}`).join("\n") : "")
      );
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
                  Drafts a {QUESTION_TYPES.find((t) => t.value === form.questionType)?.label.toLowerCase()} question below for you to review and edit — nothing is saved until you click Save. Saving an AI draft starts it at Review Status "Draft", never Published.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <input style={{ ...inputStyle, marginTop: 0, flex: "1 1 160px" }} placeholder="Subject (e.g. Java, DBMS)" value={aiSubject} onChange={(e) => setAiSubject(e.target.value)} />
                  <input style={{ ...inputStyle, marginTop: 0, flex: "1 1 160px" }} placeholder="Topic (optional)" value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} />
                  <select style={{ ...inputStyle, marginTop: 0, flex: "1 1 160px" }} value={aiBtlLevel} onChange={(e) => setAiBtlLevel(e.target.value)}>
                    <option value="">Target BTL level (optional)</option>
                    {BTL_LEVELS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                  <button type="button" className="btn btn-primary" disabled={generating} onClick={generateWithAI}>
                    {generating ? "Generating…" : "Generate"}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 6 }}>
                  Setting a target BTL level tells the model the specific cognitive task the question must require (e.g. Apply = use a concept on a new problem, not just recall it) — it doesn't guess the level from wording.
                </p>
                {aiError && <p style={{ color: "var(--rust)", fontSize: 12, marginTop: 6 }}>{aiError}</p>}
                {aiGenerated && (
                  <p className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--amber-dark, #b45309)", marginTop: 6 }}>
                    ⚠ This question is AI-generated — verify its content and correctness, then update Review Status below before it's used in a live assessment.
                  </p>
                )}
              </>
            )}
          </div>

          <label style={labelStyle}>Question Name (optional)</label>
          <input style={inputStyle} value={form.title} onChange={updateField("title")} />

          <div style={{ marginTop: 14 }}>
            <SubjectUnitPicker
              subjectId={subjectId}
              unitId={unitId}
              topicId={topicId}
              onChange={({ subjectId: s, unitId: u, topicId: t }) => { setSubjectId(s); setUnitId(u); setTopicId(t); }}
            />
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
          <MathSyntaxHint />
          <MathLivePreview text={form.description} />

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
                minHidden={5}
              />

              <div style={{ marginTop: 24, padding: 16, border: "1px solid var(--line)", borderRadius: "var(--radius)" }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Reference Solution &amp; Validation</div>
                <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 0, marginBottom: 12 }}>
                  Optional, but recommended before publishing — write a working solution and run it through the judge against every test case above to catch a wrong expected output or a broken case before students ever see it. Never shown to students.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <select
                    style={{ ...inputStyle, width: "auto" }}
                    value={refLanguage}
                    onChange={(e) => { setRefLanguage(e.target.value); setValidationResult(null); setValidationError(""); }}
                  >
                    {CODE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                  <button type="button" className="btn btn-ghost" disabled={validating} onClick={validateReferenceSolution}>
                    {validating ? "Validating…" : "Validate Test Cases"}
                  </button>
                </div>
                <textarea
                  style={{ ...inputStyle, minHeight: 160, fontFamily: "var(--font-mono)" }}
                  value={referenceSolution[refLanguage] || ""}
                  onChange={(e) => setReferenceSolution((prev) => ({ ...prev, [refLanguage]: e.target.value }))}
                  placeholder={`Write a working ${CODE_LANGUAGES.find((l) => l.id === refLanguage)?.label || refLanguage} solution here…`}
                />
                {validationError && <div style={{ color: "var(--rust)", fontSize: 12, marginTop: 8 }}>{validationError}</div>}
                {validationResult && (
                  <div style={{ marginTop: 10, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: validationResult.allPassed ? "var(--mint)" : "var(--rust)" }}>
                      {validationResult.passedCases}/{validationResult.totalCases} test cases passed
                      {validationResult.allPassed ? " — all clear" : ` (${validationResult.verdict})`}
                    </div>
                    {!validationResult.allPassed && Array.isArray(validationResult.details) && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                        {validationResult.details.filter((d) => d.verdict !== "PASS").map((d, i) => (
                          <div key={i} style={{ padding: 8, background: "var(--card-bg)", border: "1px solid var(--line)", borderRadius: 6 }}>
                            <div style={{ fontWeight: 700 }}>Case {i + 1}: {d.verdict}</div>
                            <div className="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>Input: {d.input}</div>
                            <div className="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>Expected: {d.expected}</div>
                            <div className="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>Got: {d.actual}{d.error ? ` (${d.error})` : ""}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
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
                  <div style={{ flex: 1 }}>
                    <input
                      style={inputStyle}
                      value={opt}
                      disabled={isTrueFalse}
                      onChange={(e) => updateOption(idx, e.target.value)}
                      placeholder={`Option ${idx + 1}`}
                    />
                    <MathLivePreview text={opt} />
                  </div>
                  {!isTrueFalse && options.length > 2 && (
                    <button type="button" onClick={() => removeOption(idx)} style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }}>Remove</button>
                  )}
                </div>
              ))}

              <label style={labelStyle}>Explanation (optional)</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.explanation} onChange={updateField("explanation")} placeholder="Shown to staff for review; not shown to students during the test." />
              <MathLivePreview text={form.explanation} />
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
