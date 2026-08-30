import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import UploadProgressBar from "../components/UploadProgressBar";
import ChalkUnderline from "../components/ChalkUnderline";
import AcademicGroupPicker from "../components/AcademicGroupPicker";
import { useAuth } from "../context/AuthContext";

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
const STATUS_COLORS = { DRAFT: "var(--ink-dim)", IN_REVIEW: "var(--amber-dark)", READY_TO_PUBLISH: "var(--amber-dark)", PUBLISHED: "var(--mint)", UNPUBLISHED: "var(--rust)", ARCHIVED: "var(--ink-dim)" };
const STATUS_LABELS = { DRAFT: "Draft", IN_REVIEW: "In Review", READY_TO_PUBLISH: "Ready to Publish", PUBLISHED: "Published", UNPUBLISHED: "Unpublished", ARCHIVED: "Archived" };
const MARK_STATUS_OPTIONS = [["PRESENT", "Present"], ["ABSENT", "Absent"], ["EXEMPTED", "Exempted"], ["NOT_APPEARED", "Not Appeared"]];

const EMPTY_FORM = {
  title: "", description: "", instituteId: "", batch: "", divisions: "", semester: "", examDate: "", publishDate: "",
  totalMarks: "", passingMarks: "", passingPercent: "", passLabel: "Pass", failLabel: "Fail",
  allowPdfDownload: true, showRank: false, showClassAverage: false, showAttendance: false, visibility: "SAVE_DRAFT",
  // Spec section 1: "select either Academic Groups or Talent Pool", then the specific groups/pools
  // this exam was conducted for — mirrors CreateTest.jsx's identical groupSelectionMode convention.
  groupSelectionMode: "ACADEMIC", academicGroupIds: [], talentPoolIds: [],
};

// Admin (full: create/edit/publish/unpublish/delete examinations) and Staff/Clerk (institute-
// scoped: manual entry + bulk import, but only while an examination is still Draft — see
// backend/src/routes/resultManagement.js's canEditEntries() for the exact RBAC boundary) view of
// the Result Management module — manually-entered marksheets for offline/manually-conducted
// exams, entirely independent of the online Test/ModuleCodingTest engines.
export default function ResultManagement() {
  const { user } = useAuth();
  // Matches the backend's own role lists on the create/edit/delete/publish routes exactly
  // (requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN") in resultManagement.js) — this was
  // previously "ADMIN" only, which silently hid every admin-only action (New Examination,
  // Publish/Unpublish, Delete) from Institute Admin and Super Admin accounts, the same class of
  // bug found and fixed in tests.js's GET /tests this session.
  const isAdmin = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"].includes(user?.role);
  const backTo = user?.role === "CLERK" ? "/clerk" : user?.role === "STAFF" ? "/staff" : "/admin";
  const [dashboard, setDashboard] = useState(null);
  useEffect(() => { api.get("/results/admin/dashboard").then((res) => setDashboard(res.data)).catch(() => setDashboard(null)); }, []);

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
  const [academicGroups, setAcademicGroups] = useState([]);
  const [talentPools, setTalentPools] = useState([]);

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
  useEffect(() => {
    if (isAdmin) {
      api.get("/academic-groups").then((res) => setAcademicGroups(res.data)).catch(() => setAcademicGroups([]));
      api.get("/talent-pools").then((res) => setTalentPools(res.data)).catch(() => setTalentPools([]));
    }
  }, [isAdmin]);

  async function createExam(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.examDate || !form.totalMarks) return;
    if (!form.passingMarks && !form.passingPercent) {
      setError("Provide either Passing Marks or Passing Percentage");
      return;
    }
    // Spec section 1: pick Academic Groups or Talent Pool, then at least one specific group/pool
    // — mirrored client-side (the backend enforces this too) so the error surfaces immediately
    // instead of round-tripping to the server first.
    if (form.groupSelectionMode === "TALENT_POOL" ? form.talentPoolIds.length === 0 : form.academicGroupIds.length === 0) {
      setError(form.groupSelectionMode === "TALENT_POOL" ? "Select at least one Talent Pool" : "Select at least one Academic Group");
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
            {dashboard && (
              <div className="card" style={{ padding: 16, marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 8 }}>Dashboard</div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <Stat label="Total Exams" value={dashboard.totalExams} />
                  <Stat label="Draft" value={dashboard.draft} />
                  <Stat label="In Review" value={dashboard.inReview} />
                  <Stat label="Ready to Publish" value={dashboard.readyToPublish} />
                  <Stat label="Published" value={dashboard.published} />
                  <Stat label="Archived" value={dashboard.archived} />
                  <Stat label="Students Evaluated" value={dashboard.studentsEvaluated} />
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...inputStyle, maxWidth: 260 }} placeholder="Search by title…" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} />
              <select style={{ ...inputStyle, maxWidth: 180 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                {Object.entries(STATUS_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
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
                    <label style={labelStyle}>Department(s) (Optional, descriptive/filter tag only)</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {departments.map((d) => (
                        <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px" }}>
                          <input type="checkbox" checked={formDeptIds.includes(d.id)} onChange={() => toggleDept(d.id)} /> {d.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Who was this examination for?</div>
                  <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
                    Pick a Batch, then the specific Academic Group(s) — or a Talent Pool instead. Only the groups
                    you select here get associated with this examination (used for the bulk-upload template and
                    export group filters below).
                  </p>
                  <div style={{ display: "flex", gap: 14, fontSize: 13, marginTop: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="radio" name="groupSelectionMode" checked={form.groupSelectionMode === "ACADEMIC"} onChange={() => setForm((f) => ({ ...f, groupSelectionMode: "ACADEMIC" }))} /> Academic Groups
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="radio" name="groupSelectionMode" checked={form.groupSelectionMode === "TALENT_POOL"} onChange={() => setForm((f) => ({ ...f, groupSelectionMode: "TALENT_POOL" }))} /> Talent Pool
                    </label>
                  </div>
                  {form.groupSelectionMode === "ACADEMIC" ? (
                    academicGroups.length > 0 ? (
                      <div style={{ marginTop: 10 }}>
                        <AcademicGroupPicker multi groups={academicGroups} value={form.academicGroupIds} onChange={(ids) => setForm((f) => ({ ...f, academicGroupIds: ids }))} />
                      </div>
                    ) : (
                      <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>No academic groups found yet.</p>
                    )
                  ) : talentPools.length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      {talentPools.map((p) => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px" }}>
                          <input
                            type="checkbox" checked={form.talentPoolIds.includes(p.id)}
                            onChange={() => setForm((f) => ({ ...f, talentPoolIds: f.talentPoolIds.includes(p.id) ? f.talentPoolIds.filter((i) => i !== p.id) : [...f.talentPoolIds, p.id] }))}
                          /> {p.name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>No Talent Pools exist yet — create one from the Talent Pools admin page first.</p>
                  )}
                </div>
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
                        <span style={{ color: STATUS_COLORS[exam.status], fontWeight: 700 }}>{STATUS_LABELS[exam.status] || exam.status}</span>
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
  // Unfreeze is INSTITUTE_ADMIN-only per spec (see resultManagement.js's PATCH .../unfreeze) —
  // isAdmin lumps ADMIN/SUPER_ADMIN/INSTITUTE_ADMIN together, so this needs the exact role.
  const { user } = useAuth();
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
  const [academicGroups, setAcademicGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [markStatus, setMarkStatus] = useState("PRESENT");
  const [publishCheck, setPublishCheck] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkCommitting, setBulkCommitting] = useState(false);
  const [historyEntryId, setHistoryEntryId] = useState(null);
  const [history, setHistory] = useState([]);
  const [correctionReason, setCorrectionReason] = useState("");
  // Freeze/Unfreeze (spec section 3) — independent of the publish workflow buttons above.
  const [freezing, setFreezing] = useState(false);
  // Limited editing (spec section 6) — only non-critical fields (Title/Description here); the
  // backend itself is what actually enforces which fields stay editable once entries exist, this
  // is just the corresponding UI.
  const [editingExam, setEditingExam] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingExamEdit, setSavingExamEdit] = useState(false);
  // Configurable result tags (spec section 5).
  const [tagsOpen, setTagsOpen] = useState(false);
  const [remarkBands, setRemarkBands] = useState(null);
  const [savingBands, setSavingBands] = useState(false);
  // Export group selection (spec section 7).
  const [exportOpen, setExportOpen] = useState(false);
  const [exportGroupIds, setExportGroupIds] = useState([]);
  const [exporting, setExporting] = useState(false);

  function loadExam() {
    api.get(`/results/admin/examinations/${examId}`).then((res) => setExam(res.data)).catch((err) => setError(err.response?.data?.error || "Failed to load examination"));
  }
  function loadEntries() {
    api.get(`/results/admin/examinations/${examId}/entries`).then((res) => setEntries(res.data)).catch(() => setEntries([]));
  }
  useEffect(() => { loadExam(); loadEntries(); }, [examId]);
  useEffect(() => {
    api.get("/results/admin/analytics", { params: { examinationId: examId } }).then((res) => setAnalytics(res.data)).catch(() => setAnalytics(null));
    api.get(`/results/admin/examinations/${examId}/publish-check`).then((res) => setPublishCheck(res.data)).catch(() => setPublishCheck(null));
  }, [examId, entries.length]);

  // Every workflow move (submit-for-review, mark-ready, send-back-to-draft, archive, unarchive)
  // is the same shape: PATCH one sub-route, reload, show any error. One handler for all five so
  // the buttons below stay simple.
  async function transition(action, confirmMessage) {
    if (confirmMessage && !confirm(confirmMessage)) return;
    setTransitioning(true);
    setError("");
    try {
      await api.patch(`/results/admin/examinations/${examId}/${action}`);
      loadExam();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update status");
    } finally {
      setTransitioning(false);
    }
  }

  // Scoped to this examination's own institute — an exam always belongs to exactly one institute
  // already (exam.institute.name is shown above), so the "Select Institute" step of the template
  // workflow is implicit here; only Academic Group needs its own picker.
  useEffect(() => {
    if (!exam?.instituteId) return;
    api.get("/academic-groups", { params: { instituteId: exam.instituteId } }).then((res) => setAcademicGroups(res.data)).catch(() => setAcademicGroups([]));
  }, [exam?.instituteId]);

  useEffect(() => {
    if (!studentQuery.trim()) { setStudentResults([]); return; }
    const t = setTimeout(() => {
      api.get("/users/search", { params: { q: studentQuery.trim(), role: "STUDENT" } }).then((res) => setStudentResults(res.data.rows)).catch(() => setStudentResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [studentQuery]);

  async function saveEntry() {
    if (!selectedStudent || (markStatus === "PRESENT" && !marks)) return;
    // Spec section 2: "The system should prevent saving/submitting the entry if EX is selected
    // without a remark" — mirrored client-side (the backend enforces this too, via
    // exemptionRemarkError() in resultManagement.js).
    if (markStatus === "EXEMPTED" && !remarks.trim()) {
      setError("A remark is required when status is Exempted (e.g. Placed, Medical).");
      return;
    }
    if (exam.status === "PUBLISHED" && !correctionReason.trim()) {
      setError("A reason is required to correct a published result.");
      return;
    }
    setSavingEntry(true);
    setError("");
    try {
      await api.post(`/results/admin/examinations/${examId}/entries`, {
        studentId: selectedStudent.id, status: markStatus,
        obtainedMarks: markStatus === "PRESENT" ? Number(marks) : undefined,
        grade: grade || undefined, remarks: remarks || undefined, reason: correctionReason || undefined,
      });
      setSelectedStudent(null); setStudentQuery(""); setMarks(""); setGrade(""); setRemarks(""); setMarkStatus("PRESENT"); setCorrectionReason(""); setAddingEntry(false);
      loadEntries();
    } catch (err) {
      if (err.response?.status === 409) setError("This result was modified by another user. Please refresh before saving.");
      else setError(err.response?.data?.error || "Failed to save entry");
    } finally {
      setSavingEntry(false);
    }
  }

  function loadHistory(entryId) {
    if (historyEntryId === entryId) { setHistoryEntryId(null); return; }
    setHistoryEntryId(entryId);
    api.get(`/results/admin/examinations/${examId}/entries/${entryId}/history`).then((res) => setHistory(res.data)).catch(() => setHistory([]));
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
    try {
      const params = exam.groupSelectionMode === "TALENT_POOL"
        ? (selectedGroupId ? { poolId: selectedGroupId } : {})
        : (selectedGroupId ? { academicGroupId: selectedGroupId } : {});
      const res = await api.get(`/results/admin/examinations/${examId}/bulk-template`, { params, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url; link.download = "result-bulk-import-template.xlsx";
      document.body.appendChild(link); link.click(); link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // A blob-typed error response body needs decoding before its .error message is readable.
      const text = err.response?.data instanceof Blob ? await err.response.data.text() : null;
      const message = text ? JSON.parse(text).error : err.response?.data?.error;
      alert(message || "Failed to generate template");
    }
  }

  // Combines every non-success bucket into one CSV, tagging each row with which bucket it came
  // from — same pattern as BulkUpload.jsx's error report (the closest existing precedent for a
  // report spanning multiple failure categories in one file).
  function downloadErrorReport() {
    if (!bulkSummary) return;
    const tagged = [
      ...bulkSummary.invalidInstitute.map((r) => ({ ...r, type: "Invalid Institute Name" })),
      ...bulkSummary.invalidRegistrationNumber.map((r) => ({ ...r, type: "Invalid PRN" })),
      ...bulkSummary.duplicate.map((r) => ({ ...r, type: "Duplicate Record" })),
      ...bulkSummary.failed.map((r) => ({ ...r, type: "Failed Row" })),
    ];
    if (tagged.length === 0) return;
    const header = ["Row", "Type", "Institute", "Registration Number (PRN)", "Reason"];
    const rows = tagged.map((r) => [r.row, r.type, r.institute || "", r.registrationNumber || "", r.reason || (r.type === "Duplicate Record" ? "Same PRN already appears earlier in this file." : "")]);
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `result-import-errors-${examId}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    window.URL.revokeObjectURL(url);
  }

  // Preview -> Validate -> Confirm Import (spec section 7): selecting a file always runs a dry
  // run first (no `commit` flag) — nothing is written until the admin reviews the buckets below
  // and explicitly clicks Confirm Import, which resubmits the SAME file with commit:true.
  async function previewBulk(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBulkFile(file);
    setBulkUploading(true);
    setBulkSummary(null);
    setBulkPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/results/admin/examinations/${examId}/bulk-import`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setBulkPreview(data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to validate file");
    } finally {
      setBulkUploading(false);
      e.target.value = "";
    }
  }

  async function confirmBulkImport() {
    if (!bulkFile) return;
    setBulkCommitting(true);
    try {
      const fd = new FormData();
      fd.append("file", bulkFile);
      const { data } = await api.post(`/results/admin/examinations/${examId}/bulk-import?commit=true`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setBulkSummary(data);
      setBulkPreview(null);
      setBulkFile(null);
      loadEntries();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to import file");
    } finally {
      setBulkCommitting(false);
    }
  }

  function cancelBulkPreview() {
    setBulkPreview(null);
    setBulkFile(null);
  }

  async function publish() {
    const summaryLines = publishCheck
      ? [
          `${publishCheck.marksEnteredCount} student(s) have marks entered.`,
          publishCheck.missingCount ? `${publishCheck.missingCount} student(s) are missing marks.` : null,
          publishCheck.absentCount ? `${publishCheck.absentCount} absent, ${publishCheck.exemptedCount} exempted, ${publishCheck.notAppearedCount} not appeared.` : null,
          ...publishCheck.warnings.map((w) => `⚠ ${w.message}`),
        ].filter(Boolean).join("\n")
      : "";
    if (!confirm(`Publish this result?\n\nThis will make the result visible to eligible students.\n\n${summaryLines}`)) return;
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

  async function freezeMarks() {
    if (!confirm("Freeze this examination's marks? No one — including Admins — will be able to edit them until an Institute Admin unfreezes.")) return;
    setFreezing(true);
    setError("");
    try {
      await api.patch(`/results/admin/examinations/${examId}/freeze`);
      loadExam();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to freeze marks");
    } finally {
      setFreezing(false);
    }
  }

  async function unfreezeMarks() {
    if (!confirm("Unfreeze this examination's marks? Editing will be allowed again per normal permissions.")) return;
    setFreezing(true);
    setError("");
    try {
      await api.patch(`/results/admin/examinations/${examId}/unfreeze`);
      loadExam();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to unfreeze marks");
    } finally {
      setFreezing(false);
    }
  }

  function startEditExam() {
    setEditTitle(exam.title);
    setEditDescription(exam.description || "");
    setEditingExam(true);
  }

  async function saveExamEdit() {
    if (!editTitle.trim()) return;
    setSavingExamEdit(true);
    setError("");
    try {
      await api.patch(`/results/admin/examinations/${examId}`, { title: editTitle.trim(), description: editDescription.trim() || null });
      setEditingExam(false);
      loadExam();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update examination");
    } finally {
      setSavingExamEdit(false);
    }
  }

  function openTagsPanel() {
    if (tagsOpen) { setTagsOpen(false); return; }
    setTagsOpen(true);
    api.get(`/results/admin/examinations/${examId}/remark-bands`)
      .then((res) => setRemarkBands(res.data.length ? res.data : [{ label: "", minPercent: "", maxPercent: "", minMarks: "", maxMarks: "" }]))
      .catch(() => setRemarkBands([{ label: "", minPercent: "", maxPercent: "", minMarks: "", maxMarks: "" }]));
  }

  function addBand() {
    setRemarkBands((bands) => [...bands, { label: "", minPercent: "", maxPercent: "", minMarks: "", maxMarks: "" }]);
  }
  function updateBand(i, field, value) {
    setRemarkBands((bands) => bands.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)));
  }
  function removeBand(i) {
    setRemarkBands((bands) => bands.filter((_, idx) => idx !== i));
  }

  async function saveBands() {
    setSavingBands(true);
    setError("");
    try {
      const bands = remarkBands.filter((b) => b.label.trim());
      await api.put(`/results/admin/examinations/${examId}/remark-bands`, { bands });
      setTagsOpen(false);
      loadEntries();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save result tags");
    } finally {
      setSavingBands(false);
    }
  }

  function toggleExportGroup(id) {
    setExportGroupIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
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

  // Spec section 7: "select group(s)... export data only for the selected groups." An empty
  // selection means "every group" (unchanged, pre-existing behavior) — exportGroupIds is only
  // sent when the admin has actually narrowed it down to specific groups.
  async function exportEntries() {
    setExporting(true);
    try {
      const res = await api.get("/results/admin/export", {
        params: { examinationId: examId, format: "xlsx", academicGroupIds: exportGroupIds.length ? exportGroupIds.join(",") : undefined },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url; link.download = `results-${examId}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      window.URL.revokeObjectURL(url);
      setExportOpen(false);
    } finally {
      setExporting(false);
    }
  }

  if (!exam) return <p style={{ marginTop: 24, color: "var(--ink-dim)" }}>Loading…</p>;

  return (
    <div style={{ marginTop: 24 }}>
      <button className="btn btn-ghost" onClick={onBack}>← All Examinations</button>

      <div className="card" style={{ padding: 20, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            {editingExam ? (
              <div style={{ display: "grid", gap: 8, maxWidth: 480 }}>
                <div>
                  <label style={labelStyle}>Examination Title</label>
                  <input style={inputStyle} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea style={{ ...inputStyle, minHeight: 50 }} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={saveExamEdit} disabled={savingExamEdit || !editTitle.trim()}>{savingExamEdit ? "Saving…" : "Save"}</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditingExam(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{exam.title}</div>
                  {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={startEditExam}>Edit</button>}
                  {exam.marksFrozen && <span className="badge" style={{ background: "var(--rust)" }}>🔒 Marks Frozen</span>}
                </div>
                {exam.description && <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>{exam.description}</div>}
                <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>
                  {exam.institute?.name}{exam.batch ? ` · ${exam.batch}` : ""} · {new Date(exam.examDate).toLocaleDateString()}
                  {exam.groupSelectionMode === "TALENT_POOL"
                    ? (exam.talentPools?.length ? ` · Talent Pool: ${exam.talentPools.map((tp) => tp.pool.name).join(", ")}` : "")
                    : (exam.academicGroupIds?.length ? ` · ${exam.academicGroupIds.length} academic group(s) associated` : "")}
                </div>
                {exam.marksFrozen && exam.frozenByName && (
                  <div style={{ fontSize: 11, color: "var(--rust)", marginTop: 4 }}>
                    Frozen by {exam.frozenByName} on {new Date(exam.frozenAt).toLocaleString()}
                  </div>
                )}
              </>
            )}
          </div>
          <span style={{ color: STATUS_COLORS[exam.status], fontWeight: 700 }}>{STATUS_LABELS[exam.status] || exam.status}</span>
        </div>

        <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
          <div><div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Total Marks</div><div style={{ fontSize: 15, fontWeight: 700 }}>{exam.totalMarks}</div></div>
          <div><div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Passing</div><div style={{ fontSize: 15, fontWeight: 700 }}>{exam.passingPercent != null ? `${exam.passingPercent}%` : exam.passingMarks}</div></div>
          <div><div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Entries</div><div style={{ fontSize: 15, fontWeight: 700 }}>{entries.length}</div></div>
        </div>

        {isAdmin && (
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            {exam.status === "DRAFT" && (
              <button className="btn btn-ghost" onClick={() => transition("submit-for-review", "Submit this examination for review?")} disabled={transitioning}>Submit for Review</button>
            )}
            {exam.status === "IN_REVIEW" && (
              <>
                <button className="btn btn-ghost" onClick={() => transition("mark-ready", "Mark this examination Ready to Publish?")} disabled={transitioning}>Mark Ready to Publish</button>
                <button className="btn btn-ghost" onClick={() => transition("send-back-to-draft", "Send this examination back to Draft?")} disabled={transitioning}>Send Back to Draft</button>
              </>
            )}
            {exam.status === "READY_TO_PUBLISH" && (
              <button className="btn btn-ghost" onClick={() => transition("send-back-to-draft", "Send this examination back to Draft?")} disabled={transitioning}>Send Back to Draft</button>
            )}
            {exam.status !== "PUBLISHED" && exam.status !== "ARCHIVED" && (
              <button className="btn btn-primary" onClick={publish} disabled={publishing || (publishCheck && !publishCheck.canPublish)}>{publishing ? "Publishing…" : "Publish Result"}</button>
            )}
            {exam.status === "PUBLISHED" && (
              <button className="btn btn-ghost" onClick={unpublish}>Unpublish</button>
            )}
            {(exam.status === "PUBLISHED" || exam.status === "UNPUBLISHED") && (
              <button className="btn btn-ghost" onClick={() => transition("archive", "Archive this examination? It will be moved out of active workflows but kept for records.")} disabled={transitioning}>Archive</button>
            )}
            {exam.status === "ARCHIVED" && (
              <button className="btn btn-ghost" onClick={() => transition("unarchive", "Restore this examination from the archive?")} disabled={transitioning}>Unarchive</button>
            )}
            {/* Freeze/Unfreeze (spec section 3) -- deliberately independent of the publish workflow
                buttons above; freezing is never required to publish and publishing never implies
                frozen, so these are always shown regardless of exam.status. */}
            {!exam.marksFrozen && exam.canEdit && (
              <button className="btn btn-ghost" style={{ color: "var(--rust)" }} onClick={freezeMarks} disabled={freezing}>{freezing ? "Freezing…" : "🔒 Freeze Marks"}</button>
            )}
            {exam.marksFrozen && user?.role === "INSTITUTE_ADMIN" && (
              <button className="btn btn-ghost" onClick={unfreezeMarks} disabled={freezing}>{freezing ? "Unfreezing…" : "🔓 Unfreeze Marks"}</button>
            )}
            {exam.marksFrozen && user?.role !== "INSTITUTE_ADMIN" && (
              <span style={{ fontSize: 12, color: "var(--ink-dim)", alignSelf: "center" }}>Only an Institute Admin can unfreeze this examination.</span>
            )}
            <button className="btn btn-ghost" onClick={openTagsPanel}>{tagsOpen ? "Close Result Tags" : "Configure Result Tags"}</button>
          </div>
        )}

        {tagsOpen && (
          <div style={{ marginTop: 14, padding: 14, border: "1px solid var(--line)", borderRadius: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Result Remarks / Tags</div>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
              Beyond {exam.passLabel}/{exam.failLabel}, define score bands with their own tag — e.g. "Topper" at
              90%+, "Needs Improvement" at 40% or below. Set either a percentage range or a marks range per tag,
              not both. Leave empty to keep using just {exam.passLabel}/{exam.failLabel}.
            </p>
            {remarkBands === null ? (
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>Loading…</p>
            ) : (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {remarkBands.map((b, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input style={{ ...inputStyle, flex: "1 1 140px" }} placeholder="Tag label, e.g. Topper" value={b.label} onChange={(e) => updateBand(i, "label", e.target.value)} />
                    <input style={{ ...inputStyle, flex: "0 1 100px" }} type="number" placeholder="Min %" value={b.minPercent} onChange={(e) => updateBand(i, "minPercent", e.target.value)} />
                    <input style={{ ...inputStyle, flex: "0 1 100px" }} type="number" placeholder="Max %" value={b.maxPercent} onChange={(e) => updateBand(i, "maxPercent", e.target.value)} />
                    <span style={{ fontSize: 11, color: "var(--ink-dim)" }}>or</span>
                    <input style={{ ...inputStyle, flex: "0 1 100px" }} type="number" placeholder="Min marks" value={b.minMarks} onChange={(e) => updateBand(i, "minMarks", e.target.value)} />
                    <input style={{ ...inputStyle, flex: "0 1 100px" }} type="number" placeholder="Max marks" value={b.maxMarks} onChange={(e) => updateBand(i, "maxMarks", e.target.value)} />
                    <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--rust)" }} onClick={() => removeBand(i)}>Remove</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={addBand}>+ Add Tag</button>
                  <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={saveBands} disabled={savingBands}>{savingBands ? "Saving…" : "Save Tags"}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>

      {publishCheck && exam.status !== "PUBLISHED" && exam.status !== "ARCHIVED" && (
        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Review Before Publish</div>
          <div style={{ display: "flex", gap: 24, marginTop: 10, flexWrap: "wrap" }}>
            <Stat label="Marks Entered" value={publishCheck.marksEnteredCount} />
            {publishCheck.missingCount != null && <Stat label="Missing Marks" value={publishCheck.missingCount} />}
            <Stat label="Passed" value={publishCheck.passedCount} />
            <Stat label="Failed" value={publishCheck.failedCount} />
            <Stat label="Absent" value={publishCheck.absentCount} />
            <Stat label="Exempted" value={publishCheck.exemptedCount} />
            <Stat label="Not Appeared" value={publishCheck.notAppearedCount} />
            <Stat label="Average" value={publishCheck.averageMarks} />
            <Stat label="Highest" value={publishCheck.highestMarks} />
            <Stat label="Lowest" value={publishCheck.lowestMarks} />
          </div>
          {publishCheck.warnings.length > 0 && (
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              {publishCheck.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 13, color: w.level === "error" ? "var(--rust)" : "var(--amber-dark)" }}>⚠ {w.message}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {analytics && (
        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Analytics</div>
          <div style={{ display: "flex", gap: 24, marginTop: 10, flexWrap: "wrap" }}>
            <Stat label="Appeared" value={analytics.studentsAppeared} />
            <Stat label="Absent" value={analytics.studentsAbsent} />
            <Stat label="Exempted" value={analytics.studentsExempted} />
            <Stat label="Not Appeared" value={analytics.studentsNotAppeared} />
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
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setExportOpen((v) => !v)}>{exportOpen ? "Close Export" : "Export"}</button>
          </div>
        </div>

        {exportOpen && (
          <div style={{ marginTop: 14, padding: 14, border: "1px solid var(--line)", borderRadius: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Export — select group(s)</div>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
              Leave everything unchecked to export every group. Check one or more of this examination's associated
              Academic Groups to export only their students.
            </p>
            {exam.groupSelectionMode === "ACADEMIC" && academicGroups.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {academicGroups.filter((g) => exam.academicGroupIds?.includes(g.id)).map((g) => (
                  <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px" }}>
                    <input type="checkbox" checked={exportGroupIds.includes(g.id)} onChange={() => toggleExportGroup(g.id)} /> {g.batch} · {g.department?.name} · {g.section}
                  </label>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
                {exam.groupSelectionMode === "TALENT_POOL" ? "This examination is Talent-Pool-based — export includes all its entries." : "No specific groups associated — export includes all entries."}
              </p>
            )}
            <button className="btn btn-primary" style={{ fontSize: 12, marginTop: 10 }} onClick={exportEntries} disabled={exporting}>
              {exporting ? "Exporting…" : exportGroupIds.length ? `Export ${exportGroupIds.length} Selected Group(s)` : "Export All"}
            </button>
          </div>
        )}

        {!exam.canEdit && (
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
            {exam.marksFrozen ? "This examination's marks are frozen — only an Institute Admin can unfreeze them before further edits." : `This examination is ${exam.status.toLowerCase()} — only an Admin can update its results now.`}
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, marginTop: 10, alignItems: "end" }}>
              <div>
                <label style={labelStyle}>Status</label>
                <select style={inputStyle} value={markStatus} onChange={(e) => setMarkStatus(e.target.value)}>
                  {MARK_STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Marks Obtained</label>
                <input type="number" min="0" max={exam.totalMarks} style={inputStyle} value={marks} onChange={(e) => setMarks(e.target.value)} disabled={markStatus !== "PRESENT"} placeholder={markStatus !== "PRESENT" ? "No mark — " + markStatus.toLowerCase() : undefined} />
              </div>
              <div>
                <label style={labelStyle}>Grade (Optional)</label>
                <input style={inputStyle} value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Auto if configured" />
              </div>
              <button className="btn btn-primary" disabled={!selectedStudent || (markStatus === "PRESENT" && !marks) || (markStatus === "EXEMPTED" && !remarks.trim()) || savingEntry} onClick={saveEntry}>{savingEntry ? "Saving…" : "Save"}</button>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>{markStatus === "EXEMPTED" ? "Remarks (required — reason for exemption)" : "Remarks (Optional)"}</label>
              <input
                style={{ ...inputStyle, borderColor: markStatus === "EXEMPTED" && !remarks.trim() ? "var(--rust)" : undefined }}
                value={remarks} onChange={(e) => setRemarks(e.target.value)}
                placeholder={markStatus === "EXEMPTED" ? 'e.g. "Placed", "Medical"' : 'e.g. "Excellent performance"'}
              />
            </div>
            {exam.status === "PUBLISHED" && (
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle}>Reason for Correction (required — this examination is already published)</label>
                <input style={inputStyle} value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} placeholder='e.g. "Correction after re-verification"' />
              </div>
            )}
          </div>
        )}

        {bulkOpen && (
          <div style={{ marginTop: 14, padding: 14, border: "1px solid var(--line)", borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              Select {exam.groupSelectionMode === "TALENT_POOL" ? "the Talent Pool" : "an Academic Group"} associated
              with this examination to download a template pre-filled with every student in it —
              Institute Name, Student Name, and Registration Number (PRN) are filled in for you; just enter{" "}
              <strong>Marks Obtained</strong> (and optionally Status — Present/Absent/Exempted/Not Appeared). If
              Status is Exempted, the <strong>Remarks</strong> column is required (e.g. "Placed", "Medical") — the
              row is rejected on import without one. Then re-upload the same file. Students are matched by
              Registration Number only — Student Name is shown for verification and Roll Number is never used for
              matching. Uploading only VALIDATES the file — nothing is saved until you review the results below and
              click Confirm Import.
            </p>

            <div style={{ maxWidth: 320, marginTop: 10 }}>
              <label style={labelStyle}>{exam.groupSelectionMode === "TALENT_POOL" ? "Talent Pool" : "Academic Group"}</label>
              {exam.groupSelectionMode === "TALENT_POOL" ? (
                <select style={inputStyle} value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
                  <option value="">Select…</option>
                  {(exam.talentPools || []).map((tp) => <option key={tp.poolId} value={tp.poolId}>{tp.pool.name}</option>)}
                </select>
              ) : (
                <select style={inputStyle} value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
                  <option value="">Select a batch/department/section…</option>
                  {academicGroups.filter((g) => !exam.academicGroupIds?.length || exam.academicGroupIds.includes(g.id)).map((g) => (
                    <option key={g.id} value={g.id}>{g.batch} · {g.department?.name} · {g.section} ({g._count?.users ?? 0} students)</option>
                  ))}
                </select>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={downloadTemplate} disabled={!selectedGroupId} title={!selectedGroupId ? "Select an Academic Group first" : undefined}>
                Download Template
              </button>
              <label className="btn btn-primary" style={{ fontSize: 12, cursor: "pointer" }}>
                {bulkUploading ? "Validating…" : "Choose File to Preview"}
                <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={previewBulk} disabled={bulkUploading} />
              </label>
            </div>
            <UploadProgressBar active={bulkUploading} />

            {bulkPreview && (
              <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--amber-dark)", borderRadius: 8, background: "rgba(200,150,0,0.06)" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Preview — nothing has been saved yet</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  Valid rows: <strong style={{ color: "var(--mint)" }}>{bulkPreview.imported.length}</strong> ·
                  {" "}Invalid PRNs: <strong>{bulkPreview.invalidRegistrationNumber.length}</strong> ·
                  {" "}Invalid Institute Names: <strong>{bulkPreview.invalidInstitute.length}</strong> ·
                  {" "}Duplicate Records: <strong>{bulkPreview.duplicate.length}</strong> ·
                  {" "}Failed Rows: <strong>{bulkPreview.failed.length}</strong> ·
                  {" "}Total Rows: <strong>{bulkPreview.totalRows}</strong>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary" onClick={confirmBulkImport} disabled={bulkCommitting || bulkPreview.imported.length === 0}>
                    {bulkCommitting ? "Importing…" : `Confirm Import (${bulkPreview.imported.length} row(s))`}
                  </button>
                  <button className="btn btn-ghost" onClick={cancelBulkPreview} disabled={bulkCommitting}>Cancel</button>
                </div>
              </div>
            )}

            {bulkSummary && (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <div>
                  Successfully Updated: <strong style={{ color: "var(--mint)" }}>{bulkSummary.imported.length}</strong> ·
                  {" "}Invalid PRNs: <strong>{bulkSummary.invalidRegistrationNumber.length}</strong> ·
                  {" "}Invalid Institute Names: <strong>{bulkSummary.invalidInstitute.length}</strong> ·
                  {" "}Duplicate Records: <strong>{bulkSummary.duplicate.length}</strong> ·
                  {" "}Failed Rows: <strong>{bulkSummary.failed.length}</strong>
                </div>
                {(bulkSummary.invalidInstitute.length + bulkSummary.invalidRegistrationNumber.length + bulkSummary.duplicate.length + bulkSummary.failed.length) > 0 && (
                  <>
                    <button className="btn btn-ghost" style={{ fontSize: 11, marginTop: 8 }} onClick={downloadErrorReport}>⬇ Download error report (CSV)</button>
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer" }}>View skipped/failed rows</summary>
                      <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                        {[...bulkSummary.invalidInstitute, ...bulkSummary.invalidRegistrationNumber].map((r, i) => (
                          <div key={`ii-${i}`} style={{ color: "var(--rust)" }}>Row {r.row}: {r.reason}</div>
                        ))}
                        {bulkSummary.duplicate.map((r, i) => (
                          <div key={`d-${i}`} style={{ color: "var(--amber-dark)" }}>Row {r.row}: Duplicate — {r.name} ({r.registrationNumber}) already appears earlier in this file.</div>
                        ))}
                        {bulkSummary.failed.map((r, i) => (
                          <div key={`f-${i}`} style={{ color: "var(--rust)" }}>Row {r.row}: {r.reason}</div>
                        ))}
                      </div>
                    </details>
                  </>
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
                <th style={{ padding: "8px 10px" }}>Status</th>
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
                <Fragment key={en.id}>
                  <tr style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                    <td className="mono" style={{ padding: "8px 10px" }}>{en.rollNumber || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{en.studentName}</td>
                    <td className="mono" style={{ padding: "8px 10px" }}>{en.registrationNumber || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{en.department || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>
                      {en.status === "PRESENT" ? <span style={{ color: "var(--mint)" }}>Present</span> : <span style={{ color: "var(--amber-dark)" }}>{MARK_STATUS_OPTIONS.find(([v]) => v === en.status)?.[1] || en.status}</span>}
                    </td>
                    <td style={{ padding: "8px 10px" }}>{en.status === "PRESENT" ? `${en.obtainedMarks} / ${exam.totalMarks}` : "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{en.status === "PRESENT" ? `${en.percentage}%` : "—"}</td>
                    <td style={{ padding: "8px 10px" }}>
                      {en.status === "PRESENT" ? (
                        <>
                          <span style={{ color: en.passed ? "var(--mint)" : "var(--rust)", fontWeight: 700 }}>{en.passed ? exam.passLabel : exam.failLabel}</span>
                          {en.resultTag && <span className="badge" style={{ marginLeft: 6, background: "var(--amber)", fontSize: 10 }}>{en.resultTag}</span>}
                        </>
                      ) : <span style={{ color: "var(--ink-dim)" }}>—</span>}
                    </td>
                    <td style={{ padding: "8px 10px", maxWidth: 160 }}>{en.remarks || "—"}</td>
                    <td className="mono" style={{ padding: "8px 10px", fontSize: 11 }}>{en.verificationCode || "—"}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => previewMarksheet(en.id)}>
                        Preview
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => loadHistory(en.id)}>
                        {historyEntryId === en.id ? "Hide History" : "History"}
                      </button>
                      {exam.canEdit && (
                        <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--rust)" }} onClick={() => removeEntry(en.id)}>Remove</button>
                      )}
                    </td>
                  </tr>
                  {historyEntryId === en.id && (
                    <tr>
                      <td colSpan={10} style={{ padding: "8px 16px", background: "var(--paper)" }}>
                        {history.length === 0
                          ? <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>No changes recorded for this entry yet.</span>
                          : (
                            <div style={{ display: "grid", gap: 4 }}>
                              {history.map((h) => (
                                <div key={h.id} className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                                  {new Date(h.createdAt).toLocaleString()} — {h.field}: {h.oldValue ?? "—"} → {h.newValue ?? "—"} — by {h.changedByName} — "{h.reason}"
                                </div>
                              ))}
                            </div>
                          )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 20, textAlign: "center", color: "var(--ink-dim)" }}>No entries yet.</td></tr>
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
