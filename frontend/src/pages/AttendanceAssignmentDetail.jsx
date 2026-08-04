import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { formatAcademicGroupLabel } from "../utils/classLabel";
import useIsMobile from "../hooks/useIsMobile";
import UploadProgressBar from "../components/UploadProgressBar";

const SLOTS = [
  { label: "Slot 1", startTime: "09:50", endTime: "10:45" },
  { label: "Slot 2", startTime: "10:45", endTime: "11:40" },
  { label: "Slot 3", startTime: "11:40", endTime: "12:35" },
  { label: "Slot 4", startTime: "13:15", endTime: "14:10" },
  { label: "Slot 5", startTime: "14:10", endTime: "15:05" },
  { label: "Slot 6", startTime: "15:25", endTime: "16:20" },
  { label: "Slot 7", startTime: "16:20", endTime: "17:15" },
];
const LECTURE_TYPE_OPTIONS = [
  { value: "REGULAR", label: "Regular Class" },
  { value: "PRACTICE_TEST", label: "Practice Test" },
  { value: "EXAM", label: "Exam" },
];

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function emptyPlanForm(suggestedNumber) {
  return { subject: "", lectureNumber: String(suggestedNumber || 1), topic: "", scheduleDate: todayStr(), slotLabel: "Slot 1", startTime: SLOTS[0].startTime, endTime: SLOTS[0].endTime, lectureType: "REGULAR" };
}

async function downloadTemplate(assignmentId) {
  const { data } = await api.get(`/attendance/assignments/${assignmentId}/plans/template`, { responseType: "blob" });
  const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "lecture-plan-template.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Replaces the old single-shot marking form: a plan (schedule) is created ahead of time here, and
// marking attendance against it is a separate step (see ExecuteAttendance.jsx) reached via
// Execute. "Lecture Plans" (full CRUD) and "Mark Attendance" (Execute-only, same data) are tabs on
// this one page so both of the landing page's card actions route here.
export default function AttendanceAssignmentDetail() {
  const { assignmentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const tab = searchParams.get("tab") === "mark" ? "mark" : "plans";

  const [assignment, setAssignment] = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState("");

  const [showPlanModal, setShowPlanModal] = useState(searchParams.get("addPlan") === "1");
  const [editingPlan, setEditingPlan] = useState(null); // null = add mode
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  function loadAssignment() {
    api.get(`/attendance/assignments/${assignmentId}`).then((res) => setAssignment(res.data)).catch((err) => setError(err.response?.data?.error || "Failed to load this assignment"));
  }
  function loadPlans() {
    api.get(`/attendance/assignments/${assignmentId}/plans`).then((res) => setPlans(res.data)).catch((err) => setError(err.response?.data?.error || "Failed to load lecture plans"));
  }

  useEffect(() => {
    loadAssignment();
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const suggestedNumber = useMemo(() => {
    if (!plans || plans.length === 0) return 1;
    return Math.max(...plans.map((p) => p.lectureNumber)) + 1;
  }, [plans]);

  function setTab(next) {
    setSearchParams({ tab: next });
  }

  function openAddPlan() {
    setEditingPlan(null);
    setShowPlanModal(true);
  }
  function openEditPlan(plan) {
    setEditingPlan(plan);
    setShowPlanModal(true);
  }
  function closePlanModal() {
    setShowPlanModal(false);
    setEditingPlan(null);
    if (searchParams.get("addPlan")) {
      const next = new URLSearchParams(searchParams);
      next.delete("addPlan");
      setSearchParams(next);
    }
  }

  async function deletePlan(plan) {
    try {
      await api.delete(`/attendance/assignments/${assignmentId}/plans/${plan.id}`);
      setConfirmingDeleteId(null);
      loadPlans();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete lecture plan");
    }
  }

  if (error && !assignment) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
          <p style={{ color: "var(--rust)" }}>{error}</p>
          <Link to="/staff/attendance" className="btn btn-ghost" style={{ marginTop: 16 }}>Back to Attendance</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <Link to="/staff/attendance" className="btn btn-ghost" style={{ fontSize: 12 }}>← Back to Attendance</Link>
        {assignment && (
          <div style={{ marginTop: 12 }}>
            <h1>{assignment.talentPoolId ? `Talent Pool: ${assignment.talentPool?.name}` : formatAcademicGroupLabel(assignment.academicGroup, assignment.class)}</h1>
            <ChalkUnderline />
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
              {assignment.talentPoolId
                ? `Institute: ${assignment.attendanceInstitute?.name} · Faculty: ${assignment.staff.name}`
                : `Semester ${assignment.semester} · Faculty: ${assignment.staff.name}`}
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 24, borderBottom: "1px solid var(--line)" }}>
          <button className={`btn ${tab === "plans" ? "btn-dark" : "btn-ghost"}`} style={{ borderRadius: "8px 8px 0 0" }} onClick={() => setTab("plans")}>Lecture Plans</button>
          <button className={`btn ${tab === "mark" ? "btn-dark" : "btn-ghost"}`} style={{ borderRadius: "8px 8px 0 0" }} onClick={() => setTab("mark")}>Mark Attendance</button>
        </div>

        {tab === "plans" && (
          <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={openAddPlan}>+ Add Plan</button>
            <button className="btn btn-ghost" onClick={() => downloadTemplate(assignmentId)}>Download Excel Template</button>
          </div>
        )}

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 16 }}>{error}</p>}

        {plans && plans.length === 0 && (
          <p style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No lectures scheduled yet.</p>
        )}

        {plans && plans.length > 0 && isMobile && (
          <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
            {plans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                tab={tab}
                assignmentId={assignmentId}
                navigate={navigate}
                onEdit={() => openEditPlan(p)}
                confirming={confirmingDeleteId === p.id}
                onAskDelete={() => setConfirmingDeleteId(p.id)}
                onCancelDelete={() => setConfirmingDeleteId(null)}
                onConfirmDelete={() => deletePlan(p)}
              />
            ))}
          </div>
        )}

        {plans && plans.length > 0 && !isMobile && (
          <div style={{ marginTop: 20, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", color: "var(--ink-dim)" }}>
                  {["Subject", "Lecture #", "Topic", "Schedule Date", "Slot", "Lecture Type", "Attendance Status", "Actions"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <PlanRow
                    key={p.id}
                    plan={p}
                    tab={tab}
                    assignmentId={assignmentId}
                    navigate={navigate}
                    onEdit={() => openEditPlan(p)}
                    confirming={confirmingDeleteId === p.id}
                    onAskDelete={() => setConfirmingDeleteId(p.id)}
                    onCancelDelete={() => setConfirmingDeleteId(null)}
                    onConfirmDelete={() => deletePlan(p)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showPlanModal && (
        <AddPlanModal
          assignmentId={assignmentId}
          suggestedNumber={suggestedNumber}
          editingPlan={editingPlan}
          onClose={closePlanModal}
          onSaved={() => { closePlanModal(); loadPlans(); }}
        />
      )}
    </div>
  );
}

function PlanRow({ plan, tab, assignmentId, navigate, onEdit, confirming, onAskDelete, onCancelDelete, onConfirmDelete }) {
  const marked = !!plan.session;
  const lectureTypeLabel = LECTURE_TYPE_OPTIONS.find((o) => o.value === plan.lectureType)?.label || plan.lectureType;
  return (
    <>
      <tr style={{ borderBottom: "1px solid var(--line)" }}>
        <td style={{ padding: "8px 10px" }}>{plan.subject}</td>
        <td style={{ padding: "8px 10px" }}>{plan.lectureNumber}</td>
        <td style={{ padding: "8px 10px" }}>{plan.topic}</td>
        <td style={{ padding: "8px 10px" }}>{plan.scheduleDate.slice(0, 10)}</td>
        <td style={{ padding: "8px 10px" }}>{plan.slotLabel} ({plan.startTime}–{plan.endTime})</td>
        <td style={{ padding: "8px 10px" }}>{lectureTypeLabel}</td>
        <td style={{ padding: "8px 10px" }}>{marked ? "🟢 Marked" : "🟠 Not Marked"}</td>
        <td style={{ padding: "8px 10px" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => navigate(`/staff/attendance/${assignmentId}/execute/${plan.id}`)}>
              Execute
            </button>
            {tab === "plans" && (
              <>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={onEdit}>Edit</button>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px", color: "var(--rust)" }} onClick={onAskDelete}>Delete</button>
              </>
            )}
          </div>
        </td>
      </tr>
      {confirming && (
        <tr>
          <td colSpan={8} style={{ padding: "10px", background: "rgba(220,38,38,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--rust)", fontWeight: 600 }}>
                {marked
                  ? "Attendance has already been marked for this lecture — deleting it will permanently remove those attendance records too. Continue?"
                  : "Delete this lecture plan?"}
              </span>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancelDelete}>Cancel</button>
              <button className="btn" style={{ fontSize: 12, background: "var(--rust)", color: "#fff", border: "none" }} onClick={onConfirmDelete}>
                {marked ? "Delete lecture and attendance" : "Delete"}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Mobile fallback for PlanRow — a flat <table> breaks down on narrow screens, so each lecture
// renders as a small stacked card instead, same data and actions as the desktop row.
function PlanCard({ plan, tab, assignmentId, navigate, onEdit, confirming, onAskDelete, onCancelDelete, onConfirmDelete }) {
  const marked = !!plan.session;
  const lectureTypeLabel = LECTURE_TYPE_OPTIONS.find((o) => o.value === plan.lectureType)?.label || plan.lectureType;
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{plan.subject}</div>
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{plan.topic}</div>
        </div>
        <span style={{ fontSize: 12 }}>{marked ? "🟢 Marked" : "🟠 Not Marked"}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
        Lecture {plan.lectureNumber} · {plan.scheduleDate.slice(0, 10)}<br />
        {plan.slotLabel} ({plan.startTime}–{plan.endTime}) · {lectureTypeLabel}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => navigate(`/staff/attendance/${assignmentId}/execute/${plan.id}`)}>
          Execute
        </button>
        {tab === "plans" && (
          <>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={onEdit}>Edit</button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px", color: "var(--rust)" }} onClick={onAskDelete}>Delete</button>
          </>
        )}
      </div>
      {confirming && (
        <div style={{ marginTop: 10, padding: 10, background: "rgba(220,38,38,0.06)", borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: "var(--rust)", fontWeight: 600 }}>
            {marked
              ? "Attendance has already been marked for this lecture — deleting it will permanently remove those attendance records too. Continue?"
              : "Delete this lecture plan?"}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancelDelete}>Cancel</button>
            <button className="btn" style={{ fontSize: 12, background: "var(--rust)", color: "#fff", border: "none" }} onClick={onConfirmDelete}>
              {marked ? "Delete lecture and attendance" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddPlanModal({ assignmentId, suggestedNumber, editingPlan, onClose, onSaved }) {
  const isEdit = !!editingPlan;
  const [mode, setMode] = useState("manual"); // "manual" | "excel"
  const [form, setForm] = useState(() => editingPlan
    ? {
        subject: editingPlan.subject, lectureNumber: String(editingPlan.lectureNumber), topic: editingPlan.topic, scheduleDate: editingPlan.scheduleDate.slice(0, 10),
        slotLabel: editingPlan.slotLabel, startTime: editingPlan.startTime, endTime: editingPlan.endTime, lectureType: editingPlan.lectureType,
      }
    : emptyPlanForm(suggestedNumber));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState("");

  const isOther = form.slotLabel === "Other";

  function setField(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }
  function selectSlot(e) {
    const label = e.target.value;
    const preset = SLOTS.find((s) => s.label === label);
    setForm((f) => ({ ...f, slotLabel: label, startTime: preset ? preset.startTime : "", endTime: preset ? preset.endTime : "" }));
  }

  async function saveManual() {
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, lectureNumber: Number(form.lectureNumber) };
      if (isEdit) {
        await api.patch(`/attendance/assignments/${assignmentId}/plans/${editingPlan.id}`, payload);
      } else {
        await api.post(`/attendance/assignments/${assignmentId}/plans`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save lecture plan");
    } finally {
      setSaving(false);
    }
  }

  async function uploadExcel() {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    setUploadResult(null);
    try {
      const data = new FormData();
      data.append("file", file);
      const res = await api.post(`/attendance/assignments/${assignmentId}/plans/bulk-upload`, data, { headers: { "Content-Type": "multipart/form-data" } });
      setUploadResult(res.data);
    } catch (err) {
      setUploadError(err.response?.data?.error || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
      <div className="card" style={{ padding: 24, maxWidth: 560, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 16 }}>{isEdit ? "Edit Lecture Plan" : "Add Plan"}</h3>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onClose}>Close</button>
        </div>

        {!isEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className={`btn ${mode === "manual" ? "btn-dark" : "btn-ghost"}`} style={{ fontSize: 12 }} onClick={() => setMode("manual")}>Manual Entry</button>
            <button className={`btn ${mode === "excel" ? "btn-dark" : "btn-ghost"}`} style={{ fontSize: 12 }} onClick={() => setMode("excel")}>Excel Upload</button>
          </div>
        )}

        {(isEdit || mode === "manual") && (
          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            <div>
              <label style={labelStyle}>Subject</label>
              <input style={inputStyle} value={form.subject} onChange={setField("subject")} placeholder="e.g. Data Structures" />
            </div>
            <div>
              <label style={labelStyle}>Lecture Number</label>
              <input type="number" min="1" style={inputStyle} value={form.lectureNumber} onChange={setField("lectureNumber")} />
            </div>
            <div>
              <label style={labelStyle}>Topic</label>
              <input style={inputStyle} value={form.topic} onChange={setField("topic")} placeholder="e.g. Introduction to Arrays" />
            </div>
            <div>
              <label style={labelStyle}>Schedule Date</label>
              <input type="date" style={inputStyle} value={form.scheduleDate} onChange={setField("scheduleDate")} />
            </div>
            <div>
              <label style={labelStyle}>Slot</label>
              <select style={inputStyle} value={form.slotLabel} onChange={selectSlot}>
                {SLOTS.map((s) => <option key={s.label} value={s.label}>{s.label} : {s.startTime} – {s.endTime}</option>)}
                <option value="Other">Other</option>
              </select>
            </div>
            {isOther && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Start Time</label>
                  <input type="time" style={inputStyle} value={form.startTime} onChange={setField("startTime")} />
                </div>
                <div>
                  <label style={labelStyle}>End Time</label>
                  <input type="time" style={inputStyle} value={form.endTime} onChange={setField("endTime")} />
                </div>
              </div>
            )}
            <div>
              <label style={labelStyle}>Lecture Type</label>
              <select style={inputStyle} value={form.lectureType} onChange={setField("lectureType")}>
                {LECTURE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {error && <p style={{ color: "var(--rust)", fontSize: 12 }}>{error}</p>}
            <button className="btn btn-primary" onClick={saveManual} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Lecture"}
            </button>
          </div>
        )}

        {!isEdit && mode === "excel" && (
          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              Columns: Subject, Lecture Number, Topic, Schedule Date, Slot, Lecture Type. If Slot is "Other", also
              fill in Start Time (if Slot is Other) / End Time (if Slot is Other).
            </p>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => downloadTemplate(assignmentId)}>Download Template</button>
            <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button className="btn btn-primary" onClick={uploadExcel} disabled={!file || uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <UploadProgressBar active={uploading} />
            {uploadError && <p style={{ color: "var(--rust)", fontSize: 12 }}>{uploadError}</p>}
            {uploadResult && (
              <div style={{ fontSize: 12 }}>
                <p style={{ fontWeight: 600 }}>
                  {uploadResult.createdCount} of {uploadResult.total} lecture(s) imported
                  {uploadResult.errorCount > 0 ? `, ${uploadResult.errorCount} failed` : ""}.
                </p>
                {uploadResult.errors?.length > 0 && (
                  <ul style={{ marginTop: 8, paddingLeft: 18, color: "var(--rust)" }}>
                    {uploadResult.errors.map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
                  </ul>
                )}
                {uploadResult.createdCount > 0 && (
                  <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onSaved}>Done</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
