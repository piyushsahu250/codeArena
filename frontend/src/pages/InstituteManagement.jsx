import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const emptyForm = { name: "", code: "", address: "", contact: "" };
const emptyEditForm = { name: "", code: "", address: "", contact: "", passwordExpiryDays: "", passwordHistoryDepth: 3, singleSessionOnly: false, aiHintsEnabled: false };

export default function InstituteManagement() {
  const [institutes, setInstitutes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [analyticsOpenId, setAnalyticsOpenId] = useState(null);
  const [analyticsById, setAnalyticsById] = useState({});
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  function load() {
    api.get("/institutes").then((res) => setInstitutes(res.data));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post("/institutes", form);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add institute");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(inst) {
    setEditingId(inst.id);
    setEditForm({
      name: inst.name, code: inst.code || "", address: inst.address || "", contact: inst.contact || "",
      passwordExpiryDays: inst.passwordExpiryDays ?? "", passwordHistoryDepth: inst.passwordHistoryDepth ?? 3,
      singleSessionOnly: !!inst.singleSessionOnly, aiHintsEnabled: !!inst.aiHintsEnabled,
    });
  }

  async function saveEdit(id) {
    try {
      await api.patch(`/institutes/${id}`, editForm);
      setEditingId(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update institute");
    }
  }

  async function toggleActive(inst) {
    await api.patch(`/institutes/${inst.id}`, { isActive: !inst.isActive });
    load();
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/institutes/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete institute");
    }
  }

  function toggleAnalytics(inst) {
    if (analyticsOpenId === inst.id) {
      setAnalyticsOpenId(null);
      return;
    }
    setAnalyticsOpenId(inst.id);
    if (!analyticsById[inst.id]) {
      setAnalyticsLoading(true);
      api.get(`/institutes/${inst.id}/course-analytics`)
        .then((res) => setAnalyticsById((prev) => ({ ...prev, [inst.id]: res.data })))
        .catch(() => setAnalyticsById((prev) => ({ ...prev, [inst.id]: null })))
        .finally(() => setAnalyticsLoading(false));
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Institute Management</h1>
            <ChalkUnderline />
          </div>
          <Link to="/admin" className="btn btn-ghost">← Back to Admin</Link>
        </div>
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Create an institute before adding classes or users under it. Deactivate an institute to hide it from new
          assignments without losing history; deleting is only allowed once it has no classes or users left.
        </p>

        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginTop: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Institute name</label>
              <input style={inputStyle} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. ABC Engineering College" />
            </div>
            <div>
              <label style={labelStyle}>Code (optional)</label>
              <input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. ABC001" />
            </div>
            <div>
              <label style={labelStyle}>Address (optional)</label>
              <input style={inputStyle} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Contact details (optional)</label>
              <input style={inputStyle} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Phone / email" />
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={saving}>{saving ? "Adding…" : "+ Add institute"}</button>
        </form>
        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{error}</p>}

        <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
          {institutes.map((inst) => (
            <div key={inst.id} className="card" style={{ padding: 16, opacity: inst.isActive ? 1 : 0.55 }}>
              {editingId === inst.id ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <input style={inputStyle} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Name" />
                  <input style={inputStyle} value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} placeholder="Code" />
                  <input style={inputStyle} value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} placeholder="Address" />
                  <input style={inputStyle} value={editForm.contact} onChange={(e) => setEditForm({ ...editForm, contact: e.target.value })} placeholder="Contact" />

                  <div style={{ gridColumn: "1 / -1", marginTop: 8, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 8 }}>Security Policy</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={labelStyle}>Password expiry (days, blank = never)</label>
                        <input style={inputStyle} type="number" min={0} value={editForm.passwordExpiryDays} onChange={(e) => setEditForm({ ...editForm, passwordExpiryDays: e.target.value })} placeholder="Never" />
                      </div>
                      <div>
                        <label style={labelStyle}>Block reuse of last N passwords</label>
                        <input style={inputStyle} type="number" min={0} value={editForm.passwordHistoryDepth} onChange={(e) => setEditForm({ ...editForm, passwordHistoryDepth: e.target.value })} />
                      </div>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
                      <input type="checkbox" checked={editForm.singleSessionOnly} onChange={(e) => setEditForm({ ...editForm, singleSessionOnly: e.target.checked })} />
                      Single active session per account (new login signs out other devices)
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={editForm.aiHintsEnabled} onChange={(e) => setEditForm({ ...editForm, aiHintsEnabled: e.target.checked })} />
                      Enable AI coding hints in Learning Modules (never shown during formal assessments)
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 8, gridColumn: "1 / -1" }}>
                    <button className="btn btn-primary" onClick={() => saveEdit(inst.id)}>Save</button>
                    <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{inst.name}</span>
                    {inst.code && <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginLeft: 8 }}>{inst.code}</span>}
                    <span className="badge" style={{ marginLeft: 10, color: inst.isActive ? "var(--mint)" : "var(--ink-dim)" }}>
                      {inst.isActive ? "Active" : "Inactive"}
                    </span>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {inst._count?.classes || 0} classes · {inst._count?.users || 0} users
                      {inst.address && ` · ${inst.address}`}
                      {inst.contact && ` · ${inst.contact}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost" onClick={() => toggleAnalytics(inst)}>
                      {analyticsOpenId === inst.id ? "Hide analytics" : "Course analytics"}
                    </button>
                    <button className="btn btn-ghost" onClick={() => startEdit(inst)}>Edit</button>
                    <button className="btn btn-dark" onClick={() => toggleActive(inst)}>
                      {inst.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button className="btn btn-ghost" style={{ color: "var(--rust)", borderColor: "var(--rust)" }} onClick={() => handleDelete(inst.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              )}
              {analyticsOpenId === inst.id && editingId !== inst.id && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                  {analyticsLoading && !analyticsById[inst.id] ? (
                    <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>
                  ) : !analyticsById[inst.id] ? (
                    <p style={{ fontSize: 13, color: "var(--rust)" }}>Failed to load course analytics.</p>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, color: "var(--ink-dim)", marginBottom: 10 }}>
                        <strong>{analyticsById[inst.id].assignedCourseCount}</strong> course{analyticsById[inst.id].assignedCourseCount === 1 ? "" : "s"} assigned to this institute.
                      </div>
                      {analyticsById[inst.id].courses.length === 0 ? (
                        <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No courses assigned yet.</p>
                      ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                          {analyticsById[inst.id].courses.map((c) => (
                            <div key={c.courseId} className="card" style={{ padding: 10, fontSize: 12.5 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontWeight: 600 }}>{c.courseName}</span>
                                <span className="badge">{c.status}</span>
                              </div>
                              <div className="mono" style={{ color: "var(--ink-dim)", marginTop: 6 }}>
                                {c.activeLearners} active learner{c.activeLearners === 1 ? "" : "s"} · {c.certificatesIssued} cert{c.certificatesIssued === 1 ? "" : "s"} issued
                                {c.codingAttempts > 0 && ` · avg coding score ${c.avgCodingScore}% · ${c.codingSuccessRate}% pass rate (${c.codingAttempts} attempt${c.codingAttempts === 1 ? "" : "s"})`}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {institutes.length === 0 && (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--ink-dim)" }}>
              No institutes yet. Add your first one above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
