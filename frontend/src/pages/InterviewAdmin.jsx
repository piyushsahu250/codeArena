import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import ProblemStatementFields from "../components/ProblemStatementFields";
import TestCasesEditor from "../components/TestCasesEditor";
import QuestionPreviewToggle from "../components/QuestionPreviewToggle";
import EvaluationTypeFields, { EMPTY_SIGNATURE } from "../components/EvaluationTypeFields";
import { CATEGORIES, APTITUDE_CATS } from "../constants/interviewCategories";

const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 4 };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--ink-dim)" };

const EMPTY_Q = {
  category: "HR", subject: "", company: "", aptitudeCategory: "", difficulty: "EASY", title: "", prompt: "",
  expectedKeywords: "", modelAnswer: "", options: "", correctAnswer: "", explanation: "", starterCode: "",
  testCases: [{ input: "", expected: "", isHidden: false, explanation: "" }], language: "java", tags: "", followUpQuestionId: "",
  estimatedTimeMin: null, realWorldScenario: "", constraints: "", inputFormat: "", outputFormat: "",
  notes: "", edgeCases: "", problemExplanation: "", evaluationType: "STDIO",
};

export default function InterviewAdmin() {
  const [stats, setStats] = useState(null);
  const [students, setStudents] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [weakTopics, setWeakTopics] = useState(null);
  const [filterCategory, setFilterCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_Q);
  const [signature, setSignature] = useState(EMPTY_SIGNATURE);
  const [pendingDraftCount, setPendingDraftCount] = useState(0);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);

  function loadAll() {
    api.get("/interview/admin/stats").then((res) => setStats(res.data));
    api.get("/interview/admin/students").then((res) => setStudents(res.data.rows));
    api.get("/interview/admin/weak-topics").then((res) => setWeakTopics(res.data));
    api.get("/interview/admin/drafts/questions", { params: { status: "PENDING", pageSize: 1 } }).then((res) => setPendingDraftCount(res.data.total)).catch(() => {});
    loadQuestions();
  }
  function loadQuestions() {
    api.get("/interview/admin/questions", { params: filterCategory ? { category: filterCategory } : {} }).then((res) => setQuestions(res.data.rows));
  }
  useEffect(loadAll, []);
  useEffect(loadQuestions, [filterCategory]);

  async function createQuestion(e) {
    e.preventDefault();
    try {
      const payload = {
        category: form.category, subject: form.subject || null, company: form.company || null,
        aptitudeCategory: form.category === "APTITUDE" ? (form.aptitudeCategory || null) : null,
        difficulty: form.difficulty, title: form.category === "CODING" ? (form.title || null) : undefined, prompt: form.prompt,
        expectedKeywords: form.expectedKeywords ? form.expectedKeywords.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        modelAnswer: form.modelAnswer || null,
        options: form.options ? form.options.split("|").map((s) => s.trim()).filter(Boolean) : undefined,
        correctAnswer: form.correctAnswer !== "" ? Number(form.correctAnswer) : undefined,
        explanation: form.explanation || null,
        starterCode: form.starterCode || null,
        testCases: form.category === "CODING" ? form.testCases : undefined,
        language: form.language || null,
        tags: form.category === "CODING" && form.tags ? form.tags.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        followUpQuestionId: form.followUpQuestionId || null,
        estimatedTimeMin: form.category === "CODING" ? form.estimatedTimeMin : undefined,
        realWorldScenario: form.category === "CODING" ? (form.realWorldScenario || null) : undefined,
        constraints: form.category === "CODING" ? (form.constraints || null) : undefined,
        inputFormat: form.category === "CODING" ? (form.inputFormat || null) : undefined,
        outputFormat: form.category === "CODING" ? (form.outputFormat || null) : undefined,
        notes: form.category === "CODING" ? (form.notes || null) : undefined,
        edgeCases: form.category === "CODING" ? (form.edgeCases || null) : undefined,
        problemExplanation: form.category === "CODING" ? (form.problemExplanation || null) : undefined,
        hints: form.category === "CODING" ? (form.hints ?? undefined) : undefined,
        timeComplexity: form.category === "CODING" ? (form.timeComplexity || null) : undefined,
        spaceComplexity: form.category === "CODING" ? (form.spaceComplexity || null) : undefined,
        editorial: form.category === "CODING" ? (form.editorial ?? undefined) : undefined,
        similarQuestions: form.category === "CODING" ? (form.similarQuestions ?? undefined) : undefined,
        evaluationType: form.category === "CODING" ? form.evaluationType : undefined,
        functionSignature: form.category === "CODING" && form.evaluationType === "FUNCTION" ? signature : undefined,
      };
      await api.post("/interview/admin/questions", payload);
      setForm(EMPTY_Q);
      setSignature(EMPTY_SIGNATURE);
      setAdding(false);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create question");
    }
  }

  async function deleteQuestion(id) {
    if (!confirm("Delete this question?")) return;
    await api.delete(`/interview/admin/questions/${id}`);
    loadQuestions();
  }

  async function exportCsv() {
    const { data } = await api.get("/interview/admin/questions/export", { params: filterCategory ? { category: filterCategory } : {}, responseType: "blob" });
    const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "interview-questions.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function importCsv(e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    setImportResult(null);
    try {
      const { data } = await api.post("/interview/admin/questions/import", formData, { headers: { "Content-Type": "multipart/form-data" } });
      setImportResult(data);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function downloadErrorReport() {
    const rows = (importResult.errors || []).map((e) => ["Failed", e.row, e.reason]);
    const header = ["Status", "Row", "Reason"];
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "interview-import-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>AI Mock Interview — Admin</h1>
            <ChalkUnderline />
          </div>
          <Link to="/staff/interview-drafts" className="btn btn-ghost">
            🤖 AI Draft Review{pendingDraftCount > 0 ? ` (${pendingDraftCount} pending)` : ""}
          </Link>
        </div>

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 24 }}>
            <StatCard label="Students" value={stats.totalStudents} />
            <StatCard label="Participated" value={`${stats.studentsParticipated} (${stats.completionPercent}%)`} />
            <StatCard label="Sessions" value={`${stats.completedSessions}/${stats.totalSessions}`} />
            <StatCard label="Average Score" value={`${stats.averageScore}%`} />
            <StatCard label="Total Questions" value={stats.totalQuestions} />
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32, flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ fontSize: 16 }}>Question Bank</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select style={{ ...inputStyle, marginTop: 0 }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-ghost" onClick={exportCsv}>⬇ Export CSV</button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>⬆ Import CSV</button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: "none" }} onChange={importCsv} />
            <button className="btn btn-primary" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ Add Question"}</button>
          </div>
        </div>

        {importResult && (
          <div className="card" style={{ padding: 16, marginTop: 12 }}>
            <p style={{ fontSize: 13 }}>
              <strong>{importResult.created}</strong> question{importResult.created === 1 ? "" : "s"} imported
              out of {importResult.total}.{importResult.errorCount > 0 && ` ${importResult.errorCount} failed.`}
            </p>
            {importResult.errors?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={downloadErrorReport}>
                  ⬇ Download error report
                </button>
                <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                  {importResult.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--rust)" }} className="mono">Row {e.row}: {e.reason}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {adding && (
          <form onSubmit={createQuestion} className="card" style={{ padding: 20, marginTop: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10 }}>
              <div>
                <label style={labelStyle}>Category</label>
                <select style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {form.category === "TECHNICAL" || form.category === "CODING" || form.category === "SYSTEM_DESIGN" ? (
                <div><label style={labelStyle}>Subject / Topic</label><input style={inputStyle} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
              ) : form.category === "APTITUDE" ? (
                <div>
                  <label style={labelStyle}>Aptitude Category</label>
                  <select style={inputStyle} value={form.aptitudeCategory} onChange={(e) => setForm({ ...form, aptitudeCategory: e.target.value })}>
                    <option value="">Select…</option>
                    {APTITUDE_CATS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              ) : null}
              <div>
                <label style={labelStyle}>Difficulty</label>
                <select style={inputStyle} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                  <option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Company (optional — leave blank for the general pool)</label>
                <input style={inputStyle} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="e.g. TCS, Amazon" />
              </div>
            </div>

            <label style={labelStyle}>Prompt</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} required value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />

            {(form.category === "HR" || form.category === "TECHNICAL" || form.category === "SYSTEM_DESIGN" || form.category === "BEHAVIORAL") && (
              <>
                <label style={labelStyle}>Expected Keywords (comma-separated)</label>
                <input style={inputStyle} value={form.expectedKeywords} onChange={(e) => setForm({ ...form, expectedKeywords: e.target.value })} />
                <label style={labelStyle}>Model Answer (optional)</label>
                <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.modelAnswer} onChange={(e) => setForm({ ...form, modelAnswer: e.target.value })} />
              </>
            )}

            {form.category === "APTITUDE" && (
              <>
                <label style={labelStyle}>Options (pipe-separated: A|B|C|D)</label>
                <input style={inputStyle} value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} />
                <label style={labelStyle}>Correct Answer Index (0-based)</label>
                <input style={inputStyle} type="number" min="0" value={form.correctAnswer} onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })} />
                <label style={labelStyle}>Explanation</label>
                <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
              </>
            )}

            {form.category === "CODING" && (
              <>
                <label style={labelStyle}>Title (optional)</label>
                <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <label style={labelStyle}>Tags (comma-separated, optional)</label>
                <input style={inputStyle} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Arrays, Recursion" />

                <div style={{ marginTop: 10 }}>
                  <ProblemStatementFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
                </div>

                <label style={labelStyle}>Default language (which one the candidate sees first)</label>
                <select style={inputStyle} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                  <option value="java">Java</option><option value="python">Python</option><option value="javascript">JavaScript</option><option value="c">C</option><option value="cpp">C++</option>
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

            <label style={labelStyle}>Follow-up question (optional — asked automatically right after this one is answered)</label>
            <select style={inputStyle} value={form.followUpQuestionId} onChange={(e) => setForm({ ...form, followUpQuestionId: e.target.value })}>
              <option value="">None</option>
              {(questions || []).map((q) => <option key={q.id} value={q.id}>[{q.category}] {q.prompt.slice(0, 60)}{q.prompt.length > 60 ? "…" : ""}</option>)}
            </select>

            <button className="btn btn-primary" style={{ marginTop: 14 }}>Save Question</button>
          </form>
        )}

        <div style={{ display: "grid", gap: 8, marginTop: 16, maxHeight: 400, overflowY: "auto" }}>
          {(questions || []).map((q) => <QuestionRow key={q.id} q={q} onDelete={deleteQuestion} />)}
          {questions && questions.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No questions in this category yet.</p>}
        </div>

        <h3 style={{ fontSize: 16, marginTop: 32 }}>Student Reports</h3>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {(students || []).map((s) => (
            <div key={s.studentId} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>{s.rollNumber || s.email}</div>
              </div>
              <div className="mono" style={{ textAlign: "right" }}>
                <div>{s.averageScore}%</div>
                <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>{s.sessionsCompleted} sessions</div>
              </div>
            </div>
          ))}
        </div>

        <h3 style={{ fontSize: 16, marginTop: 32 }}>Weak Topics (across all students)</h3>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {weakTopics && weakTopics.topics.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Not enough report data yet.</p>}
          {(weakTopics?.topics || []).map((t, i) => (
            <div key={t.topic} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
              <div><span className="mono" style={{ opacity: 0.5, marginRight: 8 }}>#{i + 1}</span>{t.topic}</div>
              <span className="badge">{t.count} report{t.count === 1 ? "" : "s"}</span>
            </div>
          ))}
          {weakTopics && <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>Based on {weakTopics.totalReports} report{weakTopics.totalReports === 1 ? "" : "s"}.</p>}
        </div>
      </div>
    </div>
  );
}

// Real, platform-usage analytics (never AI-authored text — see interviewDrafts.js's
// GET /admin/questions/:id/analytics) shown in its own visually distinct "Platform Usage (real)"
// card, fetched only when the admin expands a row, so the question list itself stays cheap to load.
function QuestionRow({ q, onDelete }) {
  const [usage, setUsage] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  function toggleUsage() {
    if (usage) { setUsage(null); return; }
    setLoadingUsage(true);
    api.get(`/interview/admin/questions/${q.id}/analytics`).then((res) => setUsage(res.data.realUsage)).finally(() => setLoadingUsage(false));
  }

  return (
    <div className="card" style={{ padding: 12, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span className="badge">{q.category}{q.subject ? ` · ${q.subject}` : ""}{q.aptitudeCategory ? ` · ${q.aptitudeCategory}` : ""}{q.company ? ` · ${q.company}` : ""}</span>
          {q.followUpQuestionId && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>↳ has follow-up</span>}
          <div style={{ marginTop: 4 }}>{q.prompt}</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
          <button style={{ background: "none", border: "none", color: "var(--ink-dim)", fontSize: 12 }} onClick={toggleUsage}>
            {loadingUsage ? "Loading…" : usage ? "Hide usage" : "View usage"}
          </button>
          <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => onDelete(q.id)}>Delete</button>
        </div>
      </div>
      {usage && (
        <div className="mono" style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)", fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Platform Usage (real)</div>
          Served {usage.timesServed} time{usage.timesServed === 1 ? "" : "s"}
          {usage.averageScore != null && ` · Avg score ${usage.averageScore}%`}
          {usage.skipRate != null && ` · Skip rate ${usage.skipRate}%`}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
    </div>
  );
}
