import { useEffect, useState } from "react";
import api from "../api";
import { CATEGORIES } from "../constants/interviewCategories";

const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 4 };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--ink-dim)" };
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];

function emptyRound() {
  return { category: "HR", count: 2, eliminationThreshold: 40, label: "" };
}

// One company's weighted topic-selection config for a given category — a set of "topic: weight"
// rows plus a 3-way difficulty mix. Weights don't need to sum to 1 (the backend's weightedSample
// just uses them as relative proportions), but the hint below nudges admins toward something
// legible.
function CategoryWeightsEditor({ category, value, onChange }) {
  const topicWeights = value?.topicWeights || {};
  const difficultyMix = value?.difficultyMix || {};
  const rows = Object.entries(topicWeights);

  function setTopicRow(i, key, val) {
    const entries = [...rows];
    entries[i] = [key, val];
    onChange({ ...value, topicWeights: Object.fromEntries(entries) });
  }
  function addTopicRow() {
    onChange({ ...value, topicWeights: { ...topicWeights, "": 0.1 } });
  }
  function removeTopicRow(i) {
    const entries = rows.filter((_, idx) => idx !== i);
    onChange({ ...value, topicWeights: Object.fromEntries(entries) });
  }
  function setDifficulty(d, v) {
    onChange({ ...value, difficultyMix: { ...difficultyMix, [d]: v } });
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{category}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        {DIFFICULTIES.map((d) => (
          <label key={d} style={{ fontSize: 11 }}>
            {d}
            <input type="number" step="0.05" min="0" max="1" style={{ ...inputStyle, width: 70 }} value={difficultyMix[d] ?? ""} onChange={(e) => setDifficulty(d, e.target.value ? Number(e.target.value) : undefined)} />
          </label>
        ))}
      </div>
      <p style={{ fontSize: 10, color: "var(--ink-dim)", marginTop: 4 }}>Relative weights, e.g. 0.3/0.5/0.2 — don't need to sum to 1.</p>
      <div style={{ marginTop: 8 }}>
        <span style={labelStyle}>Topic weights</span>
        {rows.map(([topic, weight], i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder="Topic e.g. Arrays" value={topic} onChange={(e) => setTopicRow(i, e.target.value, weight)} />
            <input type="number" step="0.05" min="0" style={{ ...inputStyle, width: 70 }} value={weight} onChange={(e) => setTopicRow(i, topic, Number(e.target.value))} />
            <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => removeTopicRow(i)}>✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" style={{ fontSize: 11, marginTop: 6 }} onClick={addTopicRow}>+ Add topic</button>
      </div>
    </div>
  );
}

function RoundPlanEditor({ roundPlan, onChange }) {
  function update(i, patch) {
    const next = roundPlan.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  }
  function remove(i) {
    onChange(roundPlan.filter((_, idx) => idx !== i));
  }
  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= roundPlan.length) return;
    const next = [...roundPlan];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {roundPlan.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr 80px 110px 1fr auto auto auto", gap: 6, alignItems: "center", border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
          <span className="mono" style={{ fontSize: 11, opacity: 0.6 }}>#{i + 1}</span>
          <select style={inputStyle} value={r.category} onChange={(e) => update(i, { category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="number" min="1" max="10" style={inputStyle} value={r.count} onChange={(e) => update(i, { count: Number(e.target.value) })} title="Questions in this round" />
          <input
            type="number" min="0" max="100" style={inputStyle}
            placeholder="No elimination"
            value={r.eliminationThreshold ?? ""}
            onChange={(e) => update(i, { eliminationThreshold: e.target.value === "" ? null : Number(e.target.value) })}
            title="Min % score to advance — blank = no elimination check"
          />
          <input style={inputStyle} placeholder="Label, e.g. Technical Round" value={r.label || ""} onChange={(e) => update(i, { label: e.target.value })} />
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} disabled={i === roundPlan.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, color: "var(--rust)" }} onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, justifySelf: "start" }} onClick={() => onChange([...roundPlan, emptyRound()])}>
        + Add round
      </button>
    </div>
  );
}

const EMPTY_FORM = { id: null, company: "", isActive: true, notes: "", roundPlan: [], categoryWeights: {} };

export default function CompanyProfilesPanel() {
  const [profiles, setProfiles] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    api.get("/interview/admin/company-profiles").then((res) => setProfiles(res.data)).catch(() => setProfiles([]));
  }
  useEffect(load, []);
  useEffect(() => { api.get("/interview/companies/browse").then((res) => setCompanies(res.data.map((c) => c.company))).catch(() => {}); }, []);

  function startNew() {
    setForm(EMPTY_FORM);
    setEditing(true);
    setError("");
  }
  function startEdit(p) {
    setForm({
      id: p.id, company: p.company, isActive: p.isActive, notes: p.notes || "",
      roundPlan: Array.isArray(p.roundPlan) ? p.roundPlan : [],
      categoryWeights: p.categoryWeights || {},
    });
    setEditing(true);
    setError("");
  }

  // Auto-derives which categories have a weights editor from the round plan, so an admin doesn't
  // have to separately manage two disconnected lists of categories.
  const roundCategories = [...new Set(form.roundPlan.map((r) => r.category))];

  async function save() {
    if (!form.company.trim()) { setError("A company name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const body = { company: form.company.trim(), isActive: form.isActive, notes: form.notes, roundPlan: form.roundPlan.length ? form.roundPlan : null, categoryWeights: Object.keys(form.categoryWeights).length ? form.categoryWeights : null };
      if (form.id) await api.patch(`/interview/admin/company-profiles/${form.id}`, body);
      else await api.post("/interview/admin/company-profiles", body);
      setEditing(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function remove(p) {
    if (!confirm(`Delete the interview profile for "${p.company}"? Company Round sessions for it will fall back to today's generic composition.`)) return;
    try {
      await api.delete(`/interview/admin/company-profiles/${p.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete");
    }
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
        Configure which topics/difficulty a Company Round leans toward, and an optional sequential round-elimination
        structure. Based on general, publicly-known interview style — never presented as a specific real question.
        A company with no profile here keeps today's plain random composition.
      </p>

      {!editing && (
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={startNew}>+ New Company Profile</button>
      )}

      {editing && (
        <div className="card" style={{ padding: 16, marginTop: 12, display: "grid", gap: 12 }}>
          {error && <p style={{ color: "var(--rust)", fontSize: 12 }}>{error}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Company</label>
              <input style={inputStyle} list="company-profile-companies" value={form.company} disabled={!!form.id} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
              <datalist id="company-profile-companies">
                {companies.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 20, fontSize: 12 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Active
            </label>
          </div>

          <div>
            <label style={labelStyle}>Round Plan (leave empty to keep today's flat HR+Technical+Coding+Managerial mix)</label>
            <div style={{ marginTop: 6 }}>
              <RoundPlanEditor roundPlan={form.roundPlan} onChange={(roundPlan) => setForm((f) => ({ ...f, roundPlan }))} />
            </div>
          </div>

          {roundCategories.length > 0 && (
            <div>
              <label style={labelStyle}>Selection weighting per round category</label>
              {roundCategories.map((cat) => (
                <CategoryWeightsEditor
                  key={cat}
                  category={cat}
                  value={form.categoryWeights[cat]}
                  onChange={(v) => setForm((f) => ({ ...f, categoryWeights: { ...f.categoryWeights, [cat]: v } }))}
                />
              ))}
            </div>
          )}

          <div>
            <label style={labelStyle}>Notes (sourcing / rationale, not shown to students)</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g. Sourced from general public interview-prep guidance" />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Profile"}</button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {profiles === null ? (
          <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>
        ) : profiles.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No company profiles configured yet — every Company Round uses the generic mix.</p>
        ) : (
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                  <th style={{ padding: "10px 12px" }}>Company</th>
                  <th style={{ padding: "10px 12px" }}>Active</th>
                  <th style={{ padding: "10px 12px" }}>Rounds</th>
                  <th style={{ padding: "10px 12px" }}>Weighted Categories</th>
                  <th style={{ padding: "10px 12px" }}></th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>{p.company}</td>
                    <td style={{ padding: "10px 12px" }}>{p.isActive ? "Yes" : "No"}</td>
                    <td style={{ padding: "10px 12px" }}>{Array.isArray(p.roundPlan) ? `${p.roundPlan.length} round${p.roundPlan.length === 1 ? "" : "s"}` : "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{p.categoryWeights ? Object.keys(p.categoryWeights).join(", ") : "—"}</td>
                    <td style={{ padding: "10px 12px", display: "flex", gap: 8 }}>
                      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => startEdit(p)}>Edit</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={() => remove(p)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
