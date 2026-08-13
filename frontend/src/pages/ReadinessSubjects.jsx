import { useEffect, useState } from "react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";

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
  const [subjects, setSubjects] = useState(null);
  const [editingId, setEditingId] = useState(null); // null = list only; "NEW" = create; else subject id
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState("");
  const [coverage, setCoverage] = useState(null); // { subjectId, ...} for whichever subject was last checked
  const [checkingCoverage, setCheckingCoverage] = useState(null);

  function load() {
    api.get("/readiness/admin/subjects").then((res) => setSubjects(res.data)).catch(() => toast.error("Failed to load subjects"));
  }
  useEffect(load, []);

  function startCreate() {
    setForm(emptyForm());
    setWarning("");
    setEditingId("NEW");
  }

  function startEdit(s) {
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
    setWarning("");
    setEditingId(s.id);
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
      const res = editingId === "NEW" ? await api.post("/readiness/admin/subjects", payload) : await api.patch(`/readiness/admin/subjects/${editingId}`, payload);
      if (res.data.warning) setWarning(res.data.warning);
      toast.success(editingId === "NEW" ? "Subject created." : "Subject updated.");
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save subject");
    } finally {
      setSaving(false);
    }
  }

  async function remove(s) {
    const ok = await confirmDialog({ title: "Delete Subject", message: `Delete "${s.name}"? This only works if no student assessments reference it yet.`, confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await api.delete(`/readiness/admin/subjects/${s.id}`);
      toast.success("Subject deleted.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete subject");
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
            <h1>Employability Readiness Subjects</h1>
            <ChalkUnderline />
          </div>
          {editingId === null && <button className="btn btn-primary" onClick={startCreate}>New Subject</button>}
        </div>

        {editingId === null && (
          <div style={{ marginTop: 20 }}>
            {subjects === null ? (
              <p className="mono" style={{ opacity: 0.7 }}>Loading…</p>
            ) : subjects.length === 0 ? (
              <p style={{ opacity: 0.7 }}>No subjects yet — create one to start building Readiness assessments.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {subjects.map((s) => (
                  <div key={s.id} className="card" style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <strong>{s.name}</strong>{s.code ? <span className="mono" style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>{s.code}</span> : null}
                        {!s.isActive && <span className="badge" style={{ marginLeft: 8, background: "var(--rust)" }}>Inactive</span>}
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                          {(s.department || "Any department")} · {(s.program || "Any program")} · {Array.isArray(s.topics) ? s.topics.length : 0} topics · {Array.isArray(s.assessmentModes) ? s.assessmentModes.length : 0} modes
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-ghost" style={smallBtn} onClick={() => checkCoverage(s)} disabled={checkingCoverage === s.id}>
                          {checkingCoverage === s.id ? "Checking…" : "Check Coverage"}
                        </button>
                        <button className="btn btn-ghost" style={smallBtn} onClick={() => startEdit(s)}>Edit</button>
                        <button className="btn btn-ghost" style={{ ...smallBtn, color: "var(--rust)" }} onClick={() => remove(s)}>Delete</button>
                      </div>
                    </div>

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

            <label style={labelStyle}>Subject Name</label>
            <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Structures &amp; Algorithms" />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>Code</label><input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
              <div><label style={labelStyle}>Department</label><input style={inputStyle} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
              <div><label style={labelStyle}>Program</label><input style={inputStyle} value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} /></div>
            </div>

            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

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
              <div style={{ fontSize: 13, fontWeight: 700 }}>Default BTL Distribution (%)</div>
              <p style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div><label style={labelStyle}>Default Duration (min)</label><input style={inputStyle} type="number" value={form.defaultDurationMin} onChange={(e) => setForm({ ...form, defaultDurationMin: e.target.value })} /></div>
              <div><label style={labelStyle}>Passing %</label><input style={inputStyle} type="number" value={form.passingPercent} onChange={(e) => setForm({ ...form, passingPercent: e.target.value })} /></div>
            </div>

            <label style={labelStyle}>Employability Indicators (comma-separated, optional)</label>
            <input style={inputStyle} value={form.employabilityIndicators} onChange={(e) => setForm({ ...form, employabilityIndicators: e.target.value })} placeholder="e.g. SQL, Database Design, Transactions" />

            <div className="card" style={{ padding: 14, marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Readiness Level Thresholds</div>
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

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active (visible to students)
            </label>

            <button className="btn btn-primary" style={{ marginTop: 20 }} disabled={saving || !form.name.trim()} onClick={save}>
              {saving ? "Saving…" : "Save Subject"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
