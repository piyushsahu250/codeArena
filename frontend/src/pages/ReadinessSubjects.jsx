import { useEffect, useMemo, useState } from "react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import AcademicGroupPicker from "../components/AcademicGroupPicker";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { useAuth } from "../context/AuthContext";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontFamily: "var(--font-body)" };
const smallBtn = { fontSize: 12, padding: "4px 10px" };

const BTL_LEVELS = [1, 2, 3, 4, 5, 6];
const QUESTION_TYPES = [
  { value: "MCQ", label: "MCQ" }, { value: "MULTISELECT", label: "Multi-Select" },
  { value: "TRUE_FALSE", label: "True/False" }, { value: "CODING", label: "Coding" }, { value: "SQL", label: "SQL" },
];
// Standard six modes from the spec — a starting point the admin can edit or delete rows from,
// not a fixed requirement (a subject may not need every mode, e.g. no BTL 6 "Create" round).
const DEFAULT_MODES = [
  { key: "FOUNDATION", label: "Foundation Readiness", btlMin: 1, btlMax: 2 },
  { key: "APPLICATION", label: "Application Readiness", btlMin: 3, btlMax: 3 },
  { key: "PROBLEM_SOLVING", label: "Problem-Solving Readiness", btlMin: 3, btlMax: 4 },
  { key: "INTERVIEW", label: "Interview Readiness", btlMin: 2, btlMax: 5 },
  { key: "ADVANCED", label: "Advanced Employability Readiness", btlMin: 4, btlMax: 6 },
  { key: "COMPLETE", label: "Complete Subject Employability Assessment", btlMin: 1, btlMax: 6 },
];
const DEFAULT_THRESHOLDS = [
  { label: "EXCELLENTLY_READY", min: 90 }, { label: "JOB_READY", min: 75 }, { label: "NEARLY_READY", min: 60 },
  { label: "DEVELOPING", min: 45 }, { label: "NEEDS_IMPROVEMENT", min: 25 }, { label: "FOUNDATION_REQUIRED", min: 0 },
];
const DEFAULT_DISTRIBUTION = { "1": 10, "2": 15, "3": 25, "4": 25, "5": 15, "6": 10 };

function emptyForm() {
  return {
    name: "", code: "", department: "", program: "", description: "",
    topics: [{ name: "", subtopics: "" }],
    questionTypesAllowed: ["MCQ", "CODING"],
    defaultBtlDistribution: { ...DEFAULT_DISTRIBUTION },
    assessmentModes: DEFAULT_MODES.map((m) => ({ ...m })),
    employabilityIndicators: "",
    defaultDurationMin: 45, passingPercent: 50,
    readinessThresholds: DEFAULT_THRESHOLDS.map((t) => ({ ...t })),
    isActive: true,
    certificateEnabled: false, certificateMinLevel: "JOB_READY",
  };
}

export default function ReadinessSubjects() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const { user } = useAuth();
  const [subjects, setSubjects] = useState(null);
  const [editingId, setEditingId] = useState(null); // null = list only; "NEW" = create; else subject id
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState("");
  // Collapsed by default — Question Types/BTL Distribution/Assessment Modes/Thresholds/Certificate
  // all ship with sensible defaults (DEFAULT_MODES etc. above), so a first-time admin can create a
  // working test with just a name, topics, and Save, without needing to understand BTL levels or
  // assessment-mode keys up front. Power admins can still open this to fine-tune everything.
  const [showAdvanced, setShowAdvanced] = useState(false);
  // True when viewing (not editing) a test created by another staff member — visible because
  // it's assigned to one of the current staff's own classes, per the backend's read-visibility
  // rule, but the backend rejects PATCH/DELETE from anyone but the creator (or Admin). Mirrored
  // here so the UI doesn't offer actions that would just fail with a 403.
  const [viewOnly, setViewOnly] = useState(false);

  function isOwner(s) {
    return user?.role !== "STAFF" || !s.createdById || s.createdById === user?.id;
  }
  const [coverage, setCoverage] = useState(null); // { subjectId, ...} for whichever subject was last checked
  const [checkingCoverage, setCheckingCoverage] = useState(null);

  // Academic-group isolation (spec: assessments must be assigned to specific Institute+Batch+
  // Department+Section groups, never accidentally open to everyone) — academicGroups feeds both
  // the AcademicGroupPicker in the edit view and the list-view Batch/Department/Section filters.
  const [academicGroups, setAcademicGroups] = useState([]);
  const [assignments, setAssignments] = useState([]); // current subject's ReadinessSubjectAcademicGroup rows, only while editing
  const [pickerGroupIds, setPickerGroupIds] = useState([]);
  const [pickerProgram, setPickerProgram] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [removingGroupId, setRemovingGroupId] = useState(null);
  const [filterBatch, setFilterBatch] = useState("");
  const [filterDepartmentId, setFilterDepartmentId] = useState("");
  const [filterSection, setFilterSection] = useState("");
  // Institute filter — a harmless no-op for a scoped Admin (the backend ignores this param and
  // always uses their own institute), but the only way an unscoped Platform Admin can narrow this
  // list to one institute at a time instead of seeing every institute's subjects blended together.
  // Same always-rendered dropdown pattern AcademicGroups.jsx already uses for the identical case.
  const [institutes, setInstitutes] = useState([]);
  const [filterInstituteId, setFilterInstituteId] = useState("");

  const departmentOptions = useMemo(() => {
    const map = new Map();
    academicGroups.forEach((g) => g.department && map.set(g.department.id, g.department.name));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [academicGroups]);
  const batchOptions = useMemo(() => [...new Set(academicGroups.map((g) => g.batch))].sort().reverse(), [academicGroups]);
  const sectionOptions = useMemo(() => [...new Set(academicGroups.map((g) => g.section))].sort(), [academicGroups]);

  function load() {
    api.get("/readiness/admin/subjects", { params: { batch: filterBatch || undefined, departmentId: filterDepartmentId || undefined, section: filterSection || undefined, instituteId: filterInstituteId || undefined } })
      .then((res) => setSubjects(res.data)).catch(() => toast.error("Failed to load tests"));
  }
  useEffect(load, [filterBatch, filterDepartmentId, filterSection, filterInstituteId]);
  useEffect(() => { api.get("/academic-groups").then((res) => setAcademicGroups(res.data)).catch(() => {}); }, []);
  useEffect(() => { api.get("/institutes").then((res) => setInstitutes(res.data)).catch(() => {}); }, []);

  function startCreate() {
    setForm(emptyForm());
    setWarning("");
    setAssignments([]);
    setPickerGroupIds([]);
    setPickerProgram("");
    setShowAdvanced(false);
    setViewOnly(false);
    setEditingId("NEW");
  }

  function applySubjectToForm(s) {
    setForm({
      name: s.name, code: s.code || "", department: s.department || "", program: s.program || "",
      description: s.description || "",
      topics: Array.isArray(s.topics) && s.topics.length > 0 ? s.topics.map((t) => ({ name: t.name, subtopics: (t.subtopics || []).join(", ") })) : [{ name: "", subtopics: "" }],
      questionTypesAllowed: s.questionTypesAllowed || [],
      defaultBtlDistribution: { ...DEFAULT_DISTRIBUTION, ...s.defaultBtlDistribution },
      assessmentModes: s.assessmentModes?.length ? s.assessmentModes : DEFAULT_MODES.map((m) => ({ ...m })),
      employabilityIndicators: Array.isArray(s.employabilityIndicators) ? s.employabilityIndicators.join(", ") : "",
      defaultDurationMin: s.defaultDurationMin, passingPercent: s.passingPercent,
      readinessThresholds: s.readinessThresholds?.length ? s.readinessThresholds : DEFAULT_THRESHOLDS.map((t) => ({ ...t })),
      isActive: s.isActive,
      certificateEnabled: !!s.certificateEnabled, certificateMinLevel: s.certificateMinLevel || "JOB_READY",
    });
    setAssignments(s.academicGroupAssignments || []);
  }

  async function startEdit(s) {
    setWarning("");
    setPickerGroupIds([]);
    setPickerProgram("");
    setShowAdvanced(false);
    setViewOnly(!isOwner(s));
    setEditingId(s.id);
    try {
      const res = await api.get(`/readiness/admin/subjects/${s.id}`);
      applySubjectToForm(res.data);
    } catch {
      toast.error("Failed to load test detail");
      applySubjectToForm(s);
    }
  }

  async function assignGroups() {
    if (!pickerGroupIds.length) return;
    setAssigning(true);
    try {
      await api.post(`/readiness/admin/subjects/${editingId}/assignments`, {
        assignments: pickerGroupIds.map((academicGroupId) => ({ academicGroupId, program: pickerProgram.trim() || null })),
      });
      const res = await api.get(`/readiness/admin/subjects/${editingId}`);
      setAssignments(res.data.academicGroupAssignments || []);
      setPickerGroupIds([]);
      setPickerProgram("");
      toast.success("Academic group(s) assigned.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to assign academic groups");
    } finally {
      setAssigning(false);
    }
  }

  async function unassignGroup(academicGroupId) {
    setRemovingGroupId(academicGroupId);
    try {
      await api.delete(`/readiness/admin/subjects/${editingId}/assignments`, { data: { academicGroupIds: [academicGroupId] } });
      setAssignments((prev) => prev.filter((a) => a.academicGroupId !== academicGroupId));
      toast.success("Academic group removed.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to remove academic group");
    } finally {
      setRemovingGroupId(null);
    }
  }

  function distributionSum() {
    return BTL_LEVELS.reduce((s, lvl) => s + (Number(form.defaultBtlDistribution[String(lvl)]) || 0), 0);
  }

  function toggleQuestionType(type) {
    setForm((f) => ({
      ...f,
      questionTypesAllowed: f.questionTypesAllowed.includes(type)
        ? f.questionTypesAllowed.filter((t) => t !== type)
        : [...f.questionTypesAllowed, type],
    }));
  }

  function updateTopic(idx, field, value) {
    setForm((f) => ({ ...f, topics: f.topics.map((t, i) => (i === idx ? { ...t, [field]: value } : t)) }));
  }
  function addTopic() { setForm((f) => ({ ...f, topics: [...f.topics, { name: "", subtopics: "" }] })); }
  function removeTopic(idx) { setForm((f) => ({ ...f, topics: f.topics.filter((_, i) => i !== idx) })); }

  function updateMode(idx, field, value) {
    setForm((f) => ({ ...f, assessmentModes: f.assessmentModes.map((m, i) => (i === idx ? { ...m, [field]: value } : m)) }));
  }
  function addMode() { setForm((f) => ({ ...f, assessmentModes: [...f.assessmentModes, { key: "", label: "", btlMin: 1, btlMax: 6 }] })); }
  function removeMode(idx) { setForm((f) => ({ ...f, assessmentModes: f.assessmentModes.filter((_, i) => i !== idx) })); }

  function updateThreshold(idx, field, value) {
    setForm((f) => ({ ...f, readinessThresholds: f.readinessThresholds.map((t, i) => (i === idx ? { ...t, [field]: value } : t)) }));
  }
  function addThreshold() { setForm((f) => ({ ...f, readinessThresholds: [...f.readinessThresholds, { label: "", min: 0 }] })); }
  function removeThreshold(idx) { setForm((f) => ({ ...f, readinessThresholds: f.readinessThresholds.filter((_, i) => i !== idx) })); }

  async function save() {
    setSaving(true);
    setWarning("");
    try {
      const payload = {
        name: form.name.trim(), code: form.code.trim() || null, department: form.department.trim() || null,
        program: form.program.trim() || null, description: form.description.trim() || null,
        topics: form.topics.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), subtopics: t.subtopics.split(",").map((s) => s.trim()).filter(Boolean) })),
        questionTypesAllowed: form.questionTypesAllowed,
        defaultBtlDistribution: Object.fromEntries(BTL_LEVELS.map((lvl) => [String(lvl), Number(form.defaultBtlDistribution[String(lvl)]) || 0])),
        assessmentModes: form.assessmentModes.filter((m) => m.key.trim() && m.label.trim()).map((m) => ({ key: m.key.trim(), label: m.label.trim(), btlMin: Number(m.btlMin), btlMax: Number(m.btlMax) })),
        employabilityIndicators: form.employabilityIndicators.split(",").map((s) => s.trim()).filter(Boolean),
        defaultDurationMin: Number(form.defaultDurationMin) || 45, passingPercent: Number(form.passingPercent) || 50,
        readinessThresholds: form.readinessThresholds.filter((t) => t.label.trim()).map((t) => ({ label: t.label.trim(), min: Number(t.min) })),
        isActive: form.isActive,
        certificateEnabled: form.certificateEnabled, certificateMinLevel: form.certificateEnabled ? form.certificateMinLevel : null,
      };
      const wasNew = editingId === "NEW";
      const res = wasNew ? await api.post("/readiness/admin/subjects", payload) : await api.patch(`/readiness/admin/subjects/${editingId}`, payload);
      if (res.data.warning) setWarning(res.data.warning);

      if (wasNew) {
        const newSubjectId = res.data.subject.id;
        // Any groups picked in the academic-group panel while creating are assigned right away in
        // the same save action — no separate "save, then come back and assign" round trip. A brand
        // new subject with zero assignments is "open to the entire institute" until assigned, per
        // the platform's empty-assignment convention, so applying picks immediately avoids
        // accidentally leaving a wide-open subject if the admin never returns to assign it.
        if (pickerGroupIds.length) {
          try {
            await api.post(`/readiness/admin/subjects/${newSubjectId}/assignments`, {
              assignments: pickerGroupIds.map((academicGroupId) => ({ academicGroupId, program: pickerProgram.trim() || null })),
            });
          } catch (assignErr) {
            toast.error(assignErr.response?.data?.error || "Test created, but assigning academic groups failed — assign them from the Edit screen.");
          }
        }
        toast.success("Test created.");
        // Stay on the edit screen so the admin can review/adjust the assignment right away.
        setEditingId(newSubjectId);
        setPickerGroupIds([]);
        setPickerProgram("");
        try {
          const detail = await api.get(`/readiness/admin/subjects/${newSubjectId}`);
          setAssignments(detail.data.academicGroupAssignments || []);
        } catch {
          setAssignments([]);
        }
      } else {
        toast.success("Test updated.");
        setEditingId(null);
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save test");
    } finally {
      setSaving(false);
    }
  }

  async function remove(s) {
    const ok = await confirmDialog({ title: "Delete Test", message: `Delete "${s.name}"? This only works if no student assessments reference it yet.`, confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await api.delete(`/readiness/admin/subjects/${s.id}`);
      toast.success("Test deleted.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete test");
    }
  }

  async function checkCoverage(s) {
    setCheckingCoverage(s.id);
    setCoverage(null);
    try {
      const res = await api.get(`/readiness/admin/subjects/${s.id}/coverage`);
      setCoverage(res.data);
    } catch {
      toast.error("Failed to check coverage");
    } finally {
      setCheckingCoverage(null);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Readiness Tests</h1>
            <ChalkUnderline />
            <p style={{ fontSize: 13, opacity: 0.75, marginTop: 6, maxWidth: 560 }}>
              Create a test once — pick topics, who it's for, and how long it takes. CodeArena
              generates a fresh, individually-assembled assessment for every student automatically,
              so you never hand-pick questions per attempt.
            </p>
          </div>
          {editingId === null && <button className="btn btn-primary" onClick={startCreate}>+ Create Test</button>}
        </div>

        {editingId === null && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              <div style={{ flex: "1 1 160px" }}>
                <label style={{ ...labelStyle, marginTop: 0 }}>Institute</label>
                <select style={inputStyle} value={filterInstituteId} onChange={(e) => setFilterInstituteId(e.target.value)}>
                  <option value="">All institutes</option>
                  {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <label style={{ ...labelStyle, marginTop: 0 }}>Batch</label>
                <select style={inputStyle} value={filterBatch} onChange={(e) => setFilterBatch(e.target.value)}>
                  <option value="">All batches</option>
                  {batchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div style={{ flex: "1 1 180px" }}>
                <label style={{ ...labelStyle, marginTop: 0 }}>Department</label>
                <select style={inputStyle} value={filterDepartmentId} onChange={(e) => setFilterDepartmentId(e.target.value)}>
                  <option value="">All departments</option>
                  {departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <label style={{ ...labelStyle, marginTop: 0 }}>Section</label>
                <select style={inputStyle} value={filterSection} onChange={(e) => setFilterSection(e.target.value)}>
                  <option value="">All sections</option>
                  {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {(filterBatch || filterDepartmentId || filterSection || filterInstituteId) && (
                <button className="btn btn-ghost" style={{ ...smallBtn, alignSelf: "flex-end" }} onClick={() => { setFilterBatch(""); setFilterDepartmentId(""); setFilterSection(""); setFilterInstituteId(""); }}>Clear filters</button>
              )}
            </div>

            {subjects === null ? (
              <p className="mono" style={{ opacity: 0.7 }}>Loading…</p>
            ) : subjects.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <p style={{ opacity: 0.7, marginBottom: 14 }}>
                  No readiness tests yet — create your first one to get started, or clear the filters above.
                </p>
                <button className="btn btn-primary" onClick={startCreate}>+ Create Test</button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {subjects.map((s) => (
                  <div key={s.id} className="card" style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <strong>{s.name}</strong>{s.code ? <span className="mono" style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>{s.code}</span> : null}
                        {!s.isActive && <span className="badge" style={{ marginLeft: 8, background: "var(--rust)" }}>Inactive</span>}
                        <span className="badge" style={{ marginLeft: 8, background: s._count?.academicGroupAssignments ? "var(--mint, #2e7d32)" : "var(--amber)" }}>
                          {s._count?.academicGroupAssignments ? `Assigned to ${s._count.academicGroupAssignments} group(s)` : "Open to entire institute"}
                        </span>
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                          {(s.department || "Any department")} · {(s.program || "Any program")} · {Array.isArray(s.topics) ? s.topics.length : 0} topics · {Array.isArray(s.assessmentModes) ? s.assessmentModes.length : 0} modes
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-ghost" style={smallBtn} onClick={() => checkCoverage(s)} disabled={checkingCoverage === s.id}>
                          {checkingCoverage === s.id ? "Checking…" : "Check Coverage"}
                        </button>
                        <button className="btn btn-ghost" style={smallBtn} onClick={() => startEdit(s)}>{isOwner(s) ? "Edit" : "View"}</button>
                        {isOwner(s) && (
                          <button className="btn btn-ghost" style={{ ...smallBtn, color: "var(--rust)" }} onClick={() => remove(s)}>Delete</button>
                        )}
                      </div>
                    </div>
                    {!isOwner(s) && (
                      <p style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>Created by another staff member — visible to you because it's assigned to one of your classes.</p>
                    )}

                    {coverage && coverage.subjectId === s.id && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                        {coverage.topicsWithNoQuestions.length > 0 && (
                          <p style={{ fontSize: 12, color: "var(--rust)" }}>No questions yet for: {coverage.topicsWithNoQuestions.join(", ")}</p>
                        )}
                        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                          {coverage.modeCoverage.map((m) => (
                            <div key={m.key} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <span>{m.label} (BTL {m.btlMin}–{m.btlMax})</span>
                              <span style={{ color: m.ready ? "var(--mint, #2e7d32)" : "var(--rust)" }}>
                                {m.totalAvailable} question(s) available{m.zeroCoverageLevels.length > 0 ? ` — BTL ${m.zeroCoverageLevels.join(", ")} has none` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {editingId !== null && (
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={() => setEditingId(null)}>← Back to list</button>
            {warning && <p style={{ fontSize: 13, color: "var(--rust)", marginTop: 10 }}>{warning}</p>}
            {viewOnly && (
              <p style={{ fontSize: 13, marginTop: 10, background: "var(--paper-alt, #f7f5f0)", padding: "8px 12px", borderRadius: 8 }}>
                View only — this test was created by another staff member. You can see it because it's assigned to one of your classes, but only its creator (or an Admin) can edit or delete it.
              </p>
            )}

            <label style={labelStyle}>Test Name</label>
            <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Structures &amp; Algorithms" />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>Code</label><input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
              <div><label style={labelStyle}>Department</label><input style={inputStyle} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
              <div><label style={labelStyle}>Program</label><input style={inputStyle} value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} /></div>
            </div>

            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

            <div className="card" style={{ padding: 14, marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Assign to Academic Groups</div>
              <p style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                {assignments.length === 0
                  ? "No groups assigned yet — this test is currently open to every student in the institute. Assign specific Institute/Batch/Department/Section groups below to restrict it."
                  : "Only students in the assigned groups below (matching the group's program, if one is set) can see and start this assessment."}
              </p>

              {assignments.length > 0 && (
                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  {assignments.map((a) => (
                    <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, background: "var(--paper-alt, #f7f5f0)", borderRadius: 8, padding: "6px 10px" }}>
                      <span>
                        {a.academicGroup?.institute?.name} · {a.academicGroup?.batch} · {a.academicGroup?.department?.name} · Section {a.academicGroup?.section}
                        {a.program ? ` · ${a.program}` : ""}
                      </span>
                      {!viewOnly && (
                        <button type="button" className="btn btn-ghost" style={{ ...smallBtn, color: "var(--rust)" }} disabled={removingGroupId === a.academicGroupId} onClick={() => unassignGroup(a.academicGroupId)}>
                          {removingGroupId === a.academicGroupId ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!viewOnly && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <AcademicGroupPicker multi groups={academicGroups} value={pickerGroupIds} onChange={setPickerGroupIds} />
                  <label style={{ ...labelStyle, marginTop: 10 }}>Program (optional — blank applies to every program in the selected groups)</label>
                  <input style={inputStyle} value={pickerProgram} onChange={(e) => setPickerProgram(e.target.value)} placeholder="e.g. Integrated M.Tech" />
                  {editingId === "NEW" ? (
                    pickerGroupIds.length > 0 && (
                      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>{pickerGroupIds.length} group(s) selected — assigned automatically when you save the test below.</p>
                    )
                  ) : (
                    <button type="button" className="btn btn-primary" style={{ ...smallBtn, marginTop: 10 }} disabled={!pickerGroupIds.length || assigning} onClick={assignGroups}>
                      {assigning ? "Assigning…" : `Assign ${pickerGroupIds.length || ""} Selected Group(s)`}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 14, marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Topics &amp; Subtopics</div>
              {form.topics.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                  <input style={{ ...inputStyle, marginTop: 0, flex: "1 1 160px" }} placeholder="Topic (e.g. Arrays)" value={t.name} onChange={(e) => updateTopic(i, "name", e.target.value)} />
                  <input style={{ ...inputStyle, marginTop: 0, flex: "2 1 220px" }} placeholder="Subtopics, comma-separated" value={t.subtopics} onChange={(e) => updateTopic(i, "subtopics", e.target.value)} />
                  <button type="button" className="btn btn-ghost" style={smallBtn} onClick={() => removeTopic(i)}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost" style={{ ...smallBtn, marginTop: 8 }} onClick={addTopic}>+ Add Topic</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div><label style={labelStyle}>Duration (min)</label><input style={inputStyle} type="number" value={form.defaultDurationMin} onChange={(e) => setForm({ ...form, defaultDurationMin: e.target.value })} /></div>
              <div><label style={labelStyle}>Passing %</label><input style={inputStyle} type="number" value={form.passingPercent} onChange={(e) => setForm({ ...form, passingPercent: e.target.value })} /></div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active (visible to students)
            </label>

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <button type="button" className="btn btn-ghost" style={smallBtn} onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? "▾ Hide advanced settings" : "▸ Advanced settings (question types, difficulty mix, pass levels, certificate)"}
              </button>
              <p style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
                Optional — sensible defaults are already applied, so you only need this if you want to fine-tune it.
              </p>

              {showAdvanced && (
                <>
                  <div className="card" style={{ padding: 14, marginTop: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Question Types Allowed</div>
                    <p style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>Only types this platform can actually grade — Short Answer/Case Study/System Design free-response have no grading path yet.</p>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                      {QUESTION_TYPES.map((t) => (
                        <label key={t.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                          <input type="checkbox" checked={form.questionTypesAllowed.includes(t.value)} onChange={() => toggleQuestionType(t.value)} /> {t.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="card" style={{ padding: 14, marginTop: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Difficulty Mix (BTL Distribution %)</div>
                    <p style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                      How much of the test is easy recall (BTL 1) vs. hard problem-solving (BTL 6).
                      Sum: <strong style={{ color: Math.abs(distributionSum() - 100) > 10 ? "var(--rust)" : "inherit" }}>{distributionSum()}%</strong> — should be roughly 100%.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginTop: 8 }}>
                      {BTL_LEVELS.map((lvl) => (
                        <div key={lvl}>
                          <label style={{ ...labelStyle, marginTop: 0, fontSize: 11 }}>BTL {lvl}</label>
                          <input style={inputStyle} type="number" min="0" max="100" value={form.defaultBtlDistribution[String(lvl)]}
                            onChange={(e) => setForm({ ...form, defaultBtlDistribution: { ...form.defaultBtlDistribution, [String(lvl)]: e.target.value } })} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card" style={{ padding: 14, marginTop: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Assessment Modes</div>
                    <p style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>The different variants of this test a student can choose from (e.g. a quick Foundation check vs. the full Complete assessment).</p>
                    {form.assessmentModes.map((m, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input style={{ ...inputStyle, marginTop: 0, flex: "1 1 120px" }} placeholder="KEY" value={m.key} onChange={(e) => updateMode(i, "key", e.target.value.toUpperCase().replace(/\s+/g, "_"))} />
                        <input style={{ ...inputStyle, marginTop: 0, flex: "2 1 200px" }} placeholder="Label" value={m.label} onChange={(e) => updateMode(i, "label", e.target.value)} />
                        <select style={{ ...inputStyle, marginTop: 0, flex: "0 1 90px" }} value={m.btlMin} onChange={(e) => updateMode(i, "btlMin", e.target.value)}>
                          {BTL_LEVELS.map((l) => <option key={l} value={l}>Min {l}</option>)}
                        </select>
                        <select style={{ ...inputStyle, marginTop: 0, flex: "0 1 90px" }} value={m.btlMax} onChange={(e) => updateMode(i, "btlMax", e.target.value)}>
                          {BTL_LEVELS.map((l) => <option key={l} value={l}>Max {l}</option>)}
                        </select>
                        <button type="button" className="btn btn-ghost" style={smallBtn} onClick={() => removeMode(i)}>Remove</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-ghost" style={{ ...smallBtn, marginTop: 8 }} onClick={addMode}>+ Add Mode</button>
                  </div>

                  <label style={labelStyle}>Employability Indicators (comma-separated, optional)</label>
                  <input style={inputStyle} value={form.employabilityIndicators} onChange={(e) => setForm({ ...form, employabilityIndicators: e.target.value })} placeholder="e.g. SQL, Database Design, Transactions" />

                  <div className="card" style={{ padding: 14, marginTop: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Readiness Level Thresholds</div>
                    <p style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>The score bands a student's result falls into (e.g. Job Ready at 75%+).</p>
                    {form.readinessThresholds.map((t, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                        <input style={{ ...inputStyle, marginTop: 0, flex: "2 1 180px" }} placeholder="LABEL" value={t.label} onChange={(e) => updateThreshold(i, "label", e.target.value.toUpperCase().replace(/\s+/g, "_"))} />
                        <input style={{ ...inputStyle, marginTop: 0, flex: "1 1 90px" }} type="number" placeholder="Min %" value={t.min} onChange={(e) => updateThreshold(i, "min", e.target.value)} />
                        <button type="button" className="btn btn-ghost" style={smallBtn} onClick={() => removeThreshold(i)}>Remove</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-ghost" style={{ ...smallBtn, marginTop: 8 }} onClick={addThreshold}>+ Add Threshold</button>
                  </div>

                  <div className="card" style={{ padding: 14, marginTop: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Certificate on Completion</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      Off by default — a student is never auto-issued an employability certificate unless enabled here with a minimum level.
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
                      <input type="checkbox" checked={form.certificateEnabled} onChange={(e) => setForm({ ...form, certificateEnabled: e.target.checked })} /> Issue a certificate automatically when a student qualifies
                    </label>
                    {form.certificateEnabled && (
                      <div style={{ marginTop: 10 }}>
                        <label style={labelStyle}>Minimum Readiness Level Required</label>
                        <select style={inputStyle} value={form.certificateMinLevel} onChange={(e) => setForm({ ...form, certificateMinLevel: e.target.value })}>
                          {[...DEFAULT_THRESHOLDS].reverse().map((t) => (
                            <option key={t.label} value={t.label}>{t.label.replace(/_/g, " ")}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {!viewOnly && (
              <button className="btn btn-primary" style={{ marginTop: 20 }} disabled={saving || !form.name.trim()} onClick={save}>
                {saving ? "Saving…" : "Save Test"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
