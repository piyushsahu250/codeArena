import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
const TABS = ["Members", "Auto-Selection", "Assessments", "Rankings & Dashboard", "Reports"];

// Admin (and STAFF read-only, per requireRole("ADMIN","STAFF") on the list/view routes) management
// of Talent Pools — arbitrary, hand-picked or rule-selected cross-sections of students, given
// exclusive access to specific Tests/Mock Interview configs. See backend/src/routes/talentPools.js
// for the full API surface this page drives.
export default function TalentPools() {
  const [pools, setPools] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  function loadPools() {
    api.get("/talent-pools").then((res) => setPools(res.data)).catch((err) => setError(err.response?.data?.error || "Failed to load Talent Pools"));
  }
  useEffect(loadPools, []);

  async function createPool(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const { data } = await api.post("/talent-pools", { name: newName.trim(), description: newDescription.trim() || undefined });
      setNewName(""); setNewDescription("");
      loadPools();
      setSelectedId(data.id);
      setTab(0);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create Talent Pool");
    } finally {
      setCreating(false);
    }
  }

  async function deletePool(id) {
    setError("");
    try {
      await api.delete(`/talent-pools/${id}`);
      if (selectedId === id) setSelectedId(null);
      loadPools();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete Talent Pool");
    }
  }

  const selected = pools.find((p) => p.id === selectedId);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Talent Pools</h1>
            <ChalkUnderline />
          </div>
          <Link to="/admin" className="btn btn-ghost">← Back to Admin</Link>
        </div>
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Curate special groups of high-performing students — manually or by rule — and give them exclusive access to
          specific coding tests and mock interviews.
        </p>
        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{error}</p>}

        <form onSubmit={createPool} className="card" style={{ padding: 16, marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 220px" }}>
            <label style={labelStyle}>New Pool Name</label>
            <input style={inputStyle} placeholder="e.g. Elite Coders" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div style={{ flex: "1 1 260px" }}>
            <label style={labelStyle}>Description (optional)</label>
            <input style={inputStyle} placeholder="e.g. Top 30 CS students by coding score" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={creating}>{creating ? "Creating…" : "+ New Pool"}</button>
        </form>

        <div style={{ display: "grid", gap: 8, marginTop: 20 }}>
          {pools.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", border: selectedId === p.id ? "2px solid var(--ink)" : undefined }}
              onClick={() => { setSelectedId(p.id); setTab(0); }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name} {!p.isActive && <span style={{ color: "var(--ink-dim)", fontWeight: 400, fontSize: 12 }}>(Inactive)</span>}</div>
                {p.description && <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{p.description}</div>}
                <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                  {p._count.members} member(s) · {p._count.testAssignments} exclusive test(s) · {p._count.interviewConfigs} interview config(s)
                </div>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={(e) => { e.stopPropagation(); deletePool(p.id); }}>Delete</button>
            </div>
          ))}
          {pools.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No Talent Pools yet — create one above.</p>}
        </div>

        {selected && (
          <div style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 18 }}>{selected.name}</h2>
            <div style={{ display: "flex", gap: 8, marginTop: 12, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
              {TABS.map((t, i) => (
                <button
                  key={t}
                  className="btn btn-ghost"
                  style={{ borderRadius: "8px 8px 0 0", borderBottom: tab === i ? "2px solid var(--ink)" : "2px solid transparent", fontWeight: tab === i ? 700 : 400 }}
                  onClick={() => setTab(i)}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === 0 && <MembersTab poolId={selected.id} setError={setError} onChange={loadPools} />}
            {tab === 1 && <AutoRuleTab poolId={selected.id} setError={setError} onChange={loadPools} />}
            {tab === 2 && <AssessmentsTab poolId={selected.id} setError={setError} onChange={loadPools} />}
            {tab === 3 && <RankingsTab poolId={selected.id} />}
            {tab === 4 && <ReportsTab pool={selected} setError={setError} />}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================== Members ===========================

function MembersTab({ poolId, setError, onChange }) {
  const [members, setMembers] = useState([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  function loadMembers() {
    api.get(`/talent-pools/${poolId}/members`).then((res) => setMembers(res.data)).catch(() => setMembers([]));
  }
  useEffect(loadMembers, [poolId]);

  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      const { data } = await api.get("/users/search", { params: { q: q.trim() } });
      setResults(data.filter((u) => u.role === "STUDENT"));
    } catch (err) {
      setError(err.response?.data?.error || "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function addStudent(studentId) {
    setError("");
    try {
      await api.post(`/talent-pools/${poolId}/members`, { studentIds: [studentId] });
      loadMembers();
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add member");
    }
  }

  async function removeMember(studentId) {
    setError("");
    try {
      await api.delete(`/talent-pools/${poolId}/members/${studentId}`);
      loadMembers();
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to remove member");
    }
  }

  const memberIds = new Set(members.map((m) => m.studentId));

  return (
    <div style={{ marginTop: 20 }}>
      <form onSubmit={search} style={{ display: "flex", gap: 8, maxWidth: 480 }}>
        <input style={inputStyle} placeholder="Search by name, roll number, or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary" disabled={searching}>{searching ? "…" : "Search"}</button>
      </form>
      {results.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 10, maxWidth: 480 }}>
          {results.map((u) => (
            <div key={u.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13 }}>{u.name} <span style={{ color: "var(--ink-dim)" }}>({u.rollNumber || u.email})</span></div>
              {memberIds.has(u.id) ? (
                <span style={{ fontSize: 12, color: "var(--mint)" }}>Already a member</span>
              ) : (
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => addStudent(u.id)}>+ Add</button>
              )}
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 15, marginTop: 24 }}>Members ({members.length})</h3>
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        {members.map((m) => (
          <div key={m.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>
              {m.student.name} <span style={{ color: "var(--ink-dim)" }}>({m.student.rollNumber || m.student.email})</span>
              <span style={{ fontSize: 11, color: "var(--ink-dim)", marginLeft: 8 }}>{m.addedVia === "AUTO_RULE" ? "Auto-selected" : "Manually added"}</span>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={() => removeMember(m.studentId)}>Remove</button>
          </div>
        ))}
        {members.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No members yet — search above or use the Auto-Selection tab.</p>}
      </div>
    </div>
  );
}

// =========================== Auto-selection rule ===========================

const RULE_FIELDS = [
  { key: "minCgpa", label: "Minimum CGPA", max: 10, step: 0.1 },
  { key: "minAttendancePercent", label: "Minimum Attendance %", max: 100, step: 1 },
  { key: "minAverageScorePercent", label: "Minimum Average Coding Score %", max: 100, step: 1 },
  { key: "minCompletionPercent", label: "Minimum Learning Module Completion %", max: 100, step: 1 },
];

function AutoRuleTab({ poolId, setError, onChange }) {
  const [rule, setRule] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  function loadRule() {
    api.get(`/talent-pools/${poolId}/auto-rule`).then((res) => setRule(res.data || {})).catch(() => setRule({}));
  }
  useEffect(loadRule, [poolId]);

  function setField(key, value) {
    setRule((r) => ({ ...r, [key]: value === "" ? null : Number(value) }));
    setPreview(null);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/talent-pools/${poolId}/auto-rule`, rule);
      setRule(data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save rule");
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    setPreviewing(true);
    setError("");
    try {
      const { data } = await api.post(`/talent-pools/${poolId}/auto-rule/preview`);
      setPreview(data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to preview auto-selection");
    } finally {
      setPreviewing(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError("");
    try {
      const { data } = await api.post(`/talent-pools/${poolId}/auto-rule/run`);
      setPreview(null);
      onChange();
      alert(`${data.addedCount} student(s) added.`);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to run auto-selection");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ marginTop: 20, maxWidth: 480 }}>
      <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>
        Set one or more thresholds below (any left blank are ignored). Running this only ADDS newly-matching students —
        it never removes an existing member, even if they later fall below a threshold.
      </p>
      {RULE_FIELDS.map((f) => (
        <div key={f.key} style={{ marginTop: 12 }}>
          <label style={labelStyle}>{f.label}</label>
          <input
            type="number" min="0" max={f.max} step={f.step} style={inputStyle}
            value={rule[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)}
          />
        </div>
      ))}
      <div style={{ marginTop: 12 }}>
        <label style={labelStyle}>Match Mode</label>
        <select style={inputStyle} value={rule.matchMode || "ALL"} onChange={(e) => setRule((r) => ({ ...r, matchMode: e.target.value }))}>
          <option value="ALL">Must meet ALL set thresholds</option>
          <option value="ANY">Must meet ANY set threshold</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Rule"}</button>
        <button className="btn btn-ghost" onClick={runPreview} disabled={previewing}>{previewing ? "Previewing…" : "Preview Matches"}</button>
        <button className="btn btn-primary" onClick={runNow} disabled={running}>{running ? "Running…" : "Run Now"}</button>
      </div>

      {preview && (
        <p style={{ fontSize: 13, marginTop: 12 }}>
          <strong>{preview.matchedCount}</strong> student(s) currently match this rule — <strong>{preview.newCount}</strong> would be newly added (the rest are already members).
        </p>
      )}
      {rule.lastRunAt && (
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
          Last run {new Date(rule.lastRunAt).toLocaleString()} — added {rule.lastRunAddedCount ?? 0} student(s).
        </p>
      )}
    </div>
  );
}

// =========================== Assessments ===========================

function AssessmentsTab({ poolId, setError, onChange }) {
  const [tests, setTests] = useState([]);
  const [availableTests, setAvailableTests] = useState([]);
  const [selectedTestId, setSelectedTestId] = useState("");
  const [configs, setConfigs] = useState([]);
  const [newConfigLabel, setNewConfigLabel] = useState("");
  const [newConfigCompany, setNewConfigCompany] = useState("");

  function loadAll() {
    api.get(`/talent-pools/${poolId}/tests`).then((res) => setTests(res.data)).catch(() => setTests([]));
    api.get(`/talent-pools/${poolId}/interview-configs`).then((res) => setConfigs(res.data)).catch(() => setConfigs([]));
    api.get("/tests").then((res) => setAvailableTests(res.data)).catch(() => setAvailableTests([]));
  }
  useEffect(loadAll, [poolId]);

  async function assignTest() {
    if (!selectedTestId) return;
    setError("");
    try {
      await api.post(`/talent-pools/${poolId}/tests`, { testId: selectedTestId });
      setSelectedTestId("");
      loadAll();
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to assign test");
    }
  }

  async function unassignTest(testId) {
    await api.delete(`/talent-pools/${poolId}/tests/${testId}`).catch(() => {});
    loadAll();
    onChange();
  }

  async function createConfig(e) {
    e.preventDefault();
    if (!newConfigLabel.trim()) return;
    setError("");
    try {
      await api.post(`/talent-pools/${poolId}/interview-configs`, {
        label: newConfigLabel.trim(),
        config: newConfigCompany.trim() ? { company: newConfigCompany.trim() } : {},
      });
      setNewConfigLabel(""); setNewConfigCompany("");
      loadAll();
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create interview config");
    }
  }

  async function deleteConfig(id) {
    await api.delete(`/talent-pools/${poolId}/interview-configs/${id}`).catch(() => {});
    loadAll();
  }

  const assignedTestIds = new Set(tests.map((t) => t.testId));

  return (
    <div style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 15 }}>Exclusive Coding/MCQ Tests</h3>
      <div style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 480 }}>
        <select style={inputStyle} value={selectedTestId} onChange={(e) => setSelectedTestId(e.target.value)}>
          <option value="">Select a test to assign…</option>
          {availableTests.filter((t) => !assignedTestIds.has(t.id)).map((t) => (
            <option key={t.id} value={t.id}>{t.title}{t.company ? ` (${t.company})` : ""}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={assignTest} disabled={!selectedTestId}>Assign</button>
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 12, maxWidth: 480 }}>
        {tests.map((link) => (
          <div key={link.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>{link.test.title}{link.test.company ? ` — ${link.test.company}` : ""}</div>
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={() => unassignTest(link.testId)}>Unassign</button>
          </div>
        ))}
        {tests.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No exclusive tests assigned yet.</p>}
      </div>

      <h3 style={{ fontSize: 15, marginTop: 28 }}>Exclusive Mock Interview Configs</h3>
      <form onSubmit={createConfig} style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 480, flexWrap: "wrap" }}>
        <input style={{ ...inputStyle, flex: "1 1 200px" }} placeholder="Label, e.g. Amazon Prep Round" value={newConfigLabel} onChange={(e) => setNewConfigLabel(e.target.value)} />
        <input style={{ ...inputStyle, flex: "1 1 160px" }} placeholder="Company (optional)" value={newConfigCompany} onChange={(e) => setNewConfigCompany(e.target.value)} />
        <button className="btn btn-primary">+ Create</button>
      </form>
      <div style={{ display: "grid", gap: 6, marginTop: 12, maxWidth: 480 }}>
        {configs.map((c) => (
          <div key={c.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>{c.label} {!c.isActive && <span style={{ color: "var(--ink-dim)" }}>(inactive)</span>}</div>
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={() => deleteConfig(c.id)}>Delete</button>
          </div>
        ))}
        {configs.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No exclusive interview configs yet.</p>}
      </div>
    </div>
  );
}

// =========================== Rankings & Dashboard ===========================

function RankingsTab({ poolId }) {
  const [dashboard, setDashboard] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    api.get(`/talent-pools/${poolId}/dashboard`).then((res) => setDashboard(res.data)).catch(() => setDashboard(null));
    api.get(`/talent-pools/${poolId}/leaderboard`).then((res) => setLeaderboard(res.data)).catch(() => setLeaderboard([]));
  }, [poolId]);

  const stats = dashboard
    ? [
        { label: "Total Members", value: dashboard.totalMembers },
        { label: "Assessments Assigned", value: dashboard.assessmentsAssigned },
        { label: "Assessments Completed", value: dashboard.assessmentsCompleted },
        { label: "Avg Coding Score", value: dashboard.avgCodingScore != null ? `${dashboard.avgCodingScore}%` : "—" },
        { label: "Avg Interview Score", value: dashboard.avgInterviewScore != null ? `${dashboard.avgInterviewScore}%` : "—" },
      ]
    : [];

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {stats.map((s) => (
          <div key={s.label} className="card" style={{ padding: 14, minWidth: 140 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 15, marginTop: 24 }}>Rankings</h3>
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", color: "var(--ink-dim)" }}>
              {["Student", "Test Rank", "Interview Rank"].map((h) => <th key={h} style={{ padding: "8px 10px" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((row) => (
              <tr key={row.student.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 10px" }}>{row.student.name}</td>
                <td style={{ padding: "8px 10px" }}>{row.testRank.rank != null ? `${row.testRank.rank} / ${row.testRank.totalStudents}` : "—"}</td>
                <td style={{ padding: "8px 10px" }}>{row.interviewRank.rank != null ? `${row.interviewRank.rank} / ${row.interviewRank.totalStudents}` : "—"}</td>
              </tr>
            ))}
            {leaderboard.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =========================== Reports ===========================

// Downloads need the axios instance's auth header (a bare window.open/<a> GET would 401 on these
// protected routes) — so fetch as a blob and trigger a synthetic download link, same pattern
// AttendanceReports.jsx's exportAs() already uses.
function ReportsTab({ pool, setError }) {
  const [downloading, setDownloading] = useState("");

  async function download(format) {
    setDownloading(format);
    try {
      const isPdf = format === "pdf";
      const url = isPdf ? `/talent-pools/${pool.id}/report.pdf` : "/export/talentPools";
      const params = isPdf ? undefined : { poolId: pool.id, format };
      const { data } = await api.get(url, { params, responseType: "blob" });
      const mime = format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : format === "pdf" ? "application/pdf" : "text/csv";
      const blobUrl = URL.createObjectURL(new Blob([data], { type: mime }));
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `talent-pool-${pool.name.replace(/[^a-z0-9]/gi, "-")}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError?.(err.response?.data?.error || "Download failed");
    } finally {
      setDownloading("");
    }
  }

  return (
    <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
      <button className="btn btn-primary" onClick={() => download("pdf")} disabled={!!downloading}>{downloading === "pdf" ? "…" : "Download PDF Report"}</button>
      <button className="btn btn-ghost" onClick={() => download("xlsx")} disabled={!!downloading}>{downloading === "xlsx" ? "…" : "Download Excel"}</button>
      <button className="btn btn-ghost" onClick={() => download("csv")} disabled={!!downloading}>{downloading === "csv" ? "…" : "Download CSV"}</button>
    </div>
  );
}
