import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import UploadProgressBar from "../components/UploadProgressBar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useAuth } from "../context/AuthContext";

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
const STATUS_COLORS = { DRAFT: "var(--ink-dim)", PUBLISHED: "var(--mint)", UNPUBLISHED: "var(--rust)" };

const EMPTY_FORM = {
  title: "", description: "", instituteId: "", batch: "", divisions: "", semester: "", examDate: "", publishDate: "",
  totalMarks: "", passingMarks: "", passingPercent: "", passLabel: "Pass", failLabel: "Fail",
  allowPdfDownload: true, showRank: false, showClassAverage: false, showAttendance: false, visibility: "SAVE_DRAFT",
};

// Admin (full: create/edit/publish/unpublish/delete examinations) and Staff/Clerk (institute-
// scoped: manual entry + bulk import, but only while an examination is still Draft — see
// backend/src/routes/resultManagement.js's canEditEntries() for the exact RBAC boundary) view of
// the Result Management module — manually-entered marksheets for offline/manually-conducted
// exams, entirely independent of the online Test/ModuleCodingTest engines.
export default function ResultManagement() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const backTo = user?.role === "CLERK" ? "/clerk" : user?.role === "STAFF" ? "/staff" : "/admin";

  const [exams, setExams] = useState([]);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [departments, setDepartments] = useState([]);
  const [formDeptIds, setFormDeptIds] = useState([]);
  const [institutes, setInstitutes] = useState([]);

  function loadExams() {
    api.get("/results/admin/examinations", { params: { status: statusFilter || undefined, search: searchFilter.trim() || undefined } })
      .then((res) => setExams(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load examinations"));
  }
  useEffect(loadExams, [statusFilter, searchFilter]);
  useEffect(() => {
    if (isAdmin) api.get("/attendance/admin/departments").then((res) => setDepartments(res.data)).catch(() => setDepartments([]));
  }, [isAdmin]);
  // Only a platform-level Admin (no fixed instituteId of their own — the backend falls back to
  // requiring one explicitly in this case, see resultManagement.js's POST /admin/examinations)
  // actually needs to pick an institute; an institute-scoped Admin's own institute is always used
  // automatically. Fetching the list is harmless either way — the selector just stays hidden for
  // scoped admins since attachRequesterInstitute already resolves it server-side.
  useEffect(() => {
    if (isAdmin) api.get("/institutes").then((res) => setInstitutes(res.data)).catch(() => setInstitutes([]));
  }, [isAdmin]);

  async function createExam(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.examDate || !form.totalMarks) return;
    if (!form.passingMarks && !form.passingPercent) {
      setError("Provide either Passing Marks or Passing Percentage");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post("/results/admin/examinations", { ...form, departmentIds: formDeptIds });
      setForm(EMPTY_FORM);
      setFormDeptIds([]);
      setCreating(false);
      loadExams();
      setSelectedId(data.id);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create examination");
    } finally {
      setSaving(false);
    }
  }

  async function deleteExam(id) {
    if (!confirm("Delete this examination and all its entries? This cannot be undone.")) return;
    setError("");
    try {
      await api.delete(`/results/admin/examinations/${id}`);
      if (selectedId === id) setSelectedId(null);
      loadExams();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete examination");
    }
  }

  function toggleDept(id) {
    setFormDeptIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  const selected = exams.find((e) => e.id === selectedId);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Result Management</h1>
            <ChalkUnderline />
          </div>
          <Link to={backTo} className="btn btn-ghost">← Back</Link>
        </div>
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Publish marksheets for offline/manually-conducted examinations — independent of the online assessment engine.
        </p>

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 16 }}>{error}</p>}

        {!selected && (
          <>
            <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...inputStyle, maxWidth: 260 }} placeholder="Search by title…" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} />
              <select style={{ ...inputStyle, maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="UNPUBLISHED">Unpublished</option>
              </select>
              {isAdmin && (
                <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setCreating((c) => !c)}>
                  {creating ? "Cancel" : "+ New Examination"}
                </button>
              )}
            </div>

            {creating && (
              <form onSubmit={createExam} className="card" style={{ padding: 20, marginTop: 16, display: "grid", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Examination Title</label>
                  <input style={inputStyle} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Placement Readiness Examination" required />
                </div>
                {institutes.length > 0 && (
                  <div>
                    <label style={labelStyle}>Institute (only needed if your account isn't tied to one institute)</label>
                    <select style={inputStyle} value={form.instituteId} onChange={(e) => setForm((f) => ({ ...f, instituteId: e.target.value }))}>
                      <option value="">— Use my own institute —</option>
                      {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Description (Optional)</label>
                  <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Batch (Optional)</label>
                    <input style={inputStyle} value={form.batch} onChange={(e) => setForm((f) => ({ ...f, batch: e.target.value }))} placeholder="e.g. 2025-2028" />
                  </div>
                  <div>
                    <label style={labelStyle}>Division(s) (Optional)</label>
                    <input style={inputStyle} value={form.divisions} onChange={(e) => setForm((f) => ({ ...f, divisions: e.target.value }))} placeholder="e.g. A, B" />
                  </div>
                  <div>
                    <label style={labelStyle}>Semester (Optional)</label>
                    <input style={inputStyle} value={form.semester} onChange={(e) => setForm((f) => ({ ...f, semester: e.target.value }))} placeholder="e.g. Semester 5" />
                  </div>
                </div>
                {departments.length > 0 && (
                  <div>
                    <label style={labelStyle}>Department(s)</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {departments.map((d) => (
                        <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px" }}>
                          <input type="checkbox" checked={formDeptIds.includes(d.id)} onChange={() => toggleDept(d.id)} /> {d.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Examination Date</label>
                    <input type="date" style={inputStyle} value={form.examDate} onChange={(e) => setForm((f) => ({ ...f, examDate: e.target.value }))} required />
                  </div>
                  <div>
                    <label style={labelStyle}>Result Publish Date (Optional)</label>
                    <input type="date" style={inputStyle} value={form.publishDate} onChange={(e) => setForm((f) => ({ ...f, publishDate: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Total Marks</label>
                    <input type="number" min="1" style={inputStyle} value={form.totalMarks} onChange={(e) => setForm((f) => ({ ...f, totalMarks: e.target.value }))} required />
                  </div>
                  <div>
                    <label style={labelStyle}>Passing Marks</label>
                    <input type="number" min="0" style={inputStyle} value={form.passingMarks} onChange={(e) => setForm((f) => ({ ...f, passingMarks: e.target.value, passingPercent: "" }))} placeholder="or use %" />
                  </div>
                  <div>
                    <label style={labelStyle}>Passing Percentage</label>
                    <input type="number" min="0" max="100" style={inputStyle} value={form.passingPercent} onChange={(e) => setForm((f) => ({ ...f, passingPercent: e.target.value, passingMarks: "" }))} placeholder="or use marks" />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Pass Label</label>
                    <input style={inputStyle} value={form.passLabel} onChange={(e) => setForm((f) => ({ ...f, passLabel: e.target.value }))} placeholder='e.g. "Pass" or "Qualified"' />
                  </div>
                  <div>
                    <label style={labelStyle}>Fail Label</label>
                    <input style={inputStyle} value={form.failLabel} onChange={(e) => setForm((f) => ({ ...f, failLabel: e.target.value }))} placeholder='e.g. "Fail" or "Not Qualified"' />
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={form.allowPdfDownload} onChange={(e) => setForm((f) => ({ ...f, allowPdfDownload: e.target.checked }))} />
                  Allow students to download a PDF marksheet
                </label>
                <div>
                  <label style={labelStyle}>Premium Marksheet Extras (Optional)</label>
                  <div style={{ display: "flex", gap: 14, fontSize: 13, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={form.showRank} onChange={(e) => setForm((f) => ({ ...f, showRank: e.target.checked }))} />
                      Show rank on marksheet
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={form.showClassAverage} onChange={(e) => setForm((f) => ({ ...f, showClassAverage: e.target.checked }))} />
                      Show class average
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={form.showAttendance} onChange={(e) => setForm((f) => ({ ...f, showAttendance: e.target.checked }))} />
                      Show attendance %
                    </label>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Result Visibility</label>
                  <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
                    {[["PUBLISH_NOW", "Publish Immediately"], ["SAVE_DRAFT", "Save as Draft"], ["PUBLISH_LATER", "Publish Later"]].map(([val, label]) => (
                      <label key={val} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="radio" name="visibility" checked={form.visibility === val} onChange={() => setForm((f) => ({ ...f, visibility: val }))} /> {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Create Examination"}</button>
                </div>
              </form>
            )}

            <div className="card" style={{ marginTop: 20, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                    <th style={{ padding: "10px 12px" }}>Title</th>
                    <th style={{ padding: "10px 12px" }}>Institute</th>
                    <th style={{ padding: "10px 12px" }}>Exam Date</th>
                    <th style={{ padding: "10px 12px" }}>Entries</th>
                    <th style={{ padding: "10px 12px" }}>Status</th>
                    <th style={{ padding: "10px 12px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {exams.map((exam) => (
                    <tr key={exam.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13, cursor: "pointer" }} onClick={() => setSelectedId(exam.id)}>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{exam.title}</td>
                      <td style={{ padding: "10px 12px" }}>{exam.institute?.name}</td>
                      <td style={{ padding: "10px 12px" }}>{new Date(exam.examDate).toLocaleDateString()}</td>
                      <td style={{ padding: "10px 12px" }}>{exam._count?.entries ?? 0}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ color: STATUS_COLORS[exam.status], fontWeight: 700 }}>{exam.status}</span>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {isAdmin && (
                          <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={(e) => { e.stopPropagation(); deleteExam(exam.id); }}>Delete</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {exams.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "var(--ink-dim)" }}>No examinations found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {selected && (
          <ExamDetail
            examId={selected.id}
            isAdmin={isAdmin}
            onBack={() => { setSelectedId(null); loadExams(); }}
          />
        )}
      </div>
    </div>
  );
}

function ExamDetail({ examId, isAdmin, onBack }) {
  const [exam, setExam] = useState(null);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentResults, setStudentResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [marks, setMarks] = useState("");
  const [grade, setGrade] = useState("");
  const [remarks, setRemarks] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSummary, setBulkSummary] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [publishing, setPublishing] = useState(false);

  function loadExam() {
    api.get(`/results/admin/examinations/${examId}`).then((res) => setExam(res.data)).catch((err) => setError(err.response?.data?.error || "Failed to load examination"));
  }
  function loadEntries() {
    api.get(`/results/admin/examinations/${examId}/entries`).then((res) => setEntries(res.data)).catch(() => setEntries([]));
  }
  useEffect(() => { loadExam(); loadEntries(); }, [examId]);
  useEffect(() => {
    api.get("/results/admin/analytics", { params: { examinationId: examId } }).then((res) => setAnalytics(res.data)).catch(() => setAnalytics(null));
  }, [examId, entries.length]);

  useEffect(() => {
    if (!studentQuery.trim()) { setStudentResults([]); return; }
    const t = setTimeout(() => {
      api.get("/users/search", { params: { q: studentQuery.trim(), role: "STUDENT" } }).then((res) => setStudentResults(res.data.rows)).catch(() => setStudentResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [studentQuery]);

  async function saveEntry() {
    if (!selectedStudent || !marks) return;
    setSavingEntry(true);
    setError("");
    try {
      await api.post(`/results/admin/examinations/${examId}/entries`, { studentId: selectedStudent.id, obtainedMarks: Number(marks), grade: grade || undefined, remarks: remarks || undefined });
      setSelectedStudent(null); setStudentQuery(""); setMarks(""); setGrade(""); setRemarks(""); setAddingEntry(false);
      loadEntries();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save entry");
    } finally {
      setSavingEntry(false);
    }
  }

  async function removeEntry(entryId) {
    if (!confirm("Remove this student's entry?")) return;
    try {
      await api.delete(`/results/admin/examinations/${examId}/entries/${entryId}`);
      loadEntries();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to remove entry");
    }
  }

  async function downloadTemplate() {
    const res = await api.get(`/results/admin/examinations/${examId}/bulk-template`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url; link.download = "result-bulk-import-template.xlsx";
    document.body.appendChild(link); link.click(); link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function uploadBulk(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBulkUploading(true);
    setBulkSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/results/admin/examinations/${examId}/bulk-import`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setBulkSummary(data);
      loadEntries();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to import file");
    } finally {
      setBulkUploading(false);
      e.target.value = "";
    }
  }

  async function publish() {
    if (!confirm("Publish this examination? Students with an entry will be notified immediately.")) return;
    setPublishing(true);
    setError("");
    try {
      await api.patch(`/results/admin/examinations/${examId}/publish`);
      loadExam();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to publish");
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    if (!confirm("Unpublish this examination? Students will no longer be able to see it.")) return;
    setError("");
    try {
      await api.patch(`/results/admin/examinations/${examId}/unpublish`);
      loadExam();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to unpublish");
    }
  }

  async function previewMarksheet(entryId) {
    try {
      const res = await api.get(`/results/admin/examinations/${examId}/entries/${entryId}/marksheet.pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      window.open(url, "_blank");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to load marksheet preview");
    }
  }

  async function exportEntries() {
    const res = await api.get("/results/admin/export", { params: { examinationId: examId, format: "xlsx" }, responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url; link.download = `results-${examId}.xlsx`;
    document.body.appendChild(link); link.click(); link.remove();
    window.URL.revokeObjectURL(url);
  }

  if (!exam) return <p style={{ marginTop: 24, color: "var(--ink-dim)" }}>Loading…</p>;

  return (
    <div style={{ marginTop: 24 }}>
      <button className="btn btn-ghost" onClick={onBack}>← All Examinations</button>

      <div className="card" style={{ padding: 20, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{exam.title}</div>
            {exam.description && <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>{exam.description}</div>}
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>
              {exam.institute?.name}{exam.batch ? ` · ${exam.batch}` : ""} · {new Date(exam.examDate).toLocaleDateString()}
            </div>
          </div>
          <span style={{ color: STATUS_COLORS[exam.status], fontWeight: 700 }}>{exam.status}</span>
        </div>

        <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
          <div><div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Total Marks</div><div style={{ fontSize: 15, fontWeight: 700 }}>{exam.totalMarks}</div></div>
          <div><div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Passing</div><div style={{ fontSize: 15, fontWeight: 700 }}>{exam.passingPercent != null ? `${exam.passingPercent}%` : exam.passingMarks}</div></div>
          <div><div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Entries</div><div style={{ fontSize: 15, fontWeight: 700 }}>{entries.length}</div></div>
        </div>

        {isAdmin && (
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            {exam.status !== "PUBLISHED" && (
              <button className="btn btn-primary" onClick={publish} disabled={publishing}>{publishing ? "Publishing…" : "Publish Results"}</button>
            )}
            {exam.status === "PUBLISHED" && (
              <button className="btn btn-ghost" onClick={unpublish}>Unpublish</button>
            )}
          </div>
        )}

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>

      {analytics && (
        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Analytics</div>
          <div style={{ display: "flex", gap: 24, marginTop: 10, flexWrap: "wrap" }}>
            <Stat label="Appeared" value={analytics.studentsAppeared} />
            <Stat label="Passed" value={analytics.studentsPassed} />
            <Stat label="Failed" value={analytics.studentsFailed} />
            <Stat label="Pass %" value={`${analytics.passPercent}%`} />
            <Stat label="Highest" value={analytics.highestMarks} />
            <Stat label="Lowest" value={analytics.lowestMarks} />
            <Stat label="Average" value={analytics.averageMarks} />
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Entries</div>
          <div style={{ display: "flex", gap: 8 }}>
            {exam.canEdit && (
              <>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setAddingEntry((a) => !a)}>{addingEntry ? "Cancel" : "+ Add Entry"}</button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setBulkOpen((b) => !b)}>{bulkOpen ? "Close Bulk Upload" : "Bulk Excel Upload"}</button>
              </>
            )}
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={exportEntries}>Export</button>
          </div>
        </div>

        {!exam.canEdit && (
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
            This examination is {exam.status.toLowerCase()} — only an Admin can update its results now.
          </p>
        )}

        {addingEntry && (
          <div style={{ marginTop: 14, padding: 14, border: "1px solid var(--line)", borderRadius: 8 }}>
            <label style={labelStyle}>Search Student (name, roll number, email)</label>
            <input style={inputStyle} value={studentQuery} onChange={(e) => { setStudentQuery(e.target.value); setSelectedStudent(null); }} placeholder="Type to search…" />
            {studentResults.length > 0 && !selectedStudent && (
              <div style={{ border: "1px solid var(--line)", borderRadius: 8, marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                {studentResults.map((s) => (
                  <div key={s.id} style={{ padding: "8px 10px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid var(--line)" }} onClick={() => { setSelectedStudent(s); setStudentQuery(`${s.name} (${s.rollNumber || s.email})`); setStudentResults([]); }}>
                    {s.rollNumber && <span className="mono">{s.rollNumber}</span>} {s.name} <span className="mono" style={{ color: "var(--ink-dim)" }}>({s.registrationNumber || s.email})</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, marginTop: 10, alignItems: "end" }}>
              <div>
                <label style={labelStyle}>Marks Obtained</label>
                <input type="number" min="0" max={exam.totalMarks} style={inputStyle} value={marks} onChange={(e) => setMarks(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Grade (Optional)</label>
                <input style={inputStyle} value={grade} onChange={(e) => setGrade(e.target.value)} />
              </div>
              <button className="btn btn-primary" disabled={!selectedStudent || !marks || savingEntry} onClick={saveEntry}>{savingEntry ? "Saving…" : "Save"}</button>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>Remarks (Optional)</label>
              <input style={inputStyle} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder='e.g. "Excellent performance"' />
            </div>
          </div>
        )}

        {bulkOpen && (
          <div style={{ marginTop: 14, padding: 14, border: "1px solid var(--line)", borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              Columns: <strong>Institute Name</strong>, <strong>Registration Number (PRN)</strong>, <strong>Marks Obtained</strong>. Students are
              matched by Registration Number only — Roll Number is not a template column.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={downloadTemplate}>Download Template</button>
              <label className="btn btn-primary" style={{ fontSize: 12, cursor: "pointer" }}>
                {bulkUploading ? "Uploading…" : "Upload File"}
                <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={uploadBulk} disabled={bulkUploading} />
              </label>
            </div>
            <UploadProgressBar active={bulkUploading} />
            {bulkSummary && (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <div>Imported: <strong>{bulkSummary.imported.length}</strong> · Duplicate: <strong>{bulkSummary.duplicate.length}</strong> · Invalid Institute: <strong>{bulkSummary.invalidInstitute.length}</strong> · Invalid Registration Number: <strong>{bulkSummary.invalidRegistrationNumber.length}</strong> · Failed: <strong>{bulkSummary.failed.length}</strong></div>
                {[...bulkSummary.invalidInstitute, ...bulkSummary.invalidRegistrationNumber, ...bulkSummary.failed].length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer" }}>View failed rows</summary>
                    <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                      {[...bulkSummary.invalidInstitute, ...bulkSummary.invalidRegistrationNumber, ...bulkSummary.failed].map((r, i) => (
                        <div key={i} style={{ color: "var(--rust)" }}>Row {r.row}: {r.reason}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                <th style={{ padding: "8px 10px" }}>Roll No.</th>
                <th style={{ padding: "8px 10px" }}>Student</th>
                <th style={{ padding: "8px 10px" }}>Registration No. (PRN)</th>
                <th style={{ padding: "8px 10px" }}>Department</th>
                <th style={{ padding: "8px 10px" }}>Marks</th>
                <th style={{ padding: "8px 10px" }}>%</th>
                <th style={{ padding: "8px 10px" }}>Result</th>
                <th style={{ padding: "8px 10px" }}>Remarks</th>
                <th style={{ padding: "8px 10px" }}>Marksheet ID</th>
                <th style={{ padding: "8px 10px" }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((en) => (
                <tr key={en.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <td className="mono" style={{ padding: "8px 10px" }}>{en.rollNumber || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{en.studentName}</td>
                  <td className="mono" style={{ padding: "8px 10px" }}>{en.registrationNumber || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{en.department || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{en.obtainedMarks} / {exam.totalMarks}</td>
                  <td style={{ padding: "8px 10px" }}>{en.percentage}%</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ color: en.passed ? "var(--mint)" : "var(--rust)", fontWeight: 700 }}>{en.passed ? exam.passLabel : exam.failLabel}</span>
                  </td>
                  <td style={{ padding: "8px 10px", maxWidth: 160 }}>{en.remarks || "—"}</td>
                  <td className="mono" style={{ padding: "8px 10px", fontSize: 11 }}>{en.verificationCode || "—"}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => previewMarksheet(en.id)}>
                      Preview
                    </button>
                    {exam.canEdit && (
                      <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--rust)" }} onClick={() => removeEntry(en.id)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 20, textAlign: "center", color: "var(--ink-dim)" }}>No entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
