import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import UploadProgressBar from "../components/UploadProgressBar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useAuth } from "../context/AuthContext";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
const TABS = ["Members", "Auto-Selection", "Assessments", "Rankings & Dashboard", "Reports"];

// Admin (full management) and STAFF (institute-scoped: manual member add/remove within their own
// institute, and self-service attendance-ownership claiming — see backend/src/routes/talentPools.js
// for the exact RBAC boundary) management of Talent Pools — arbitrary, hand-picked or rule-selected
// cross-sections of students, spanning one or more institutes, given exclusive access to specific
// Tests/Mock Interview configs.
export default function TalentPools() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [pools, setPools] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newInstituteIds, setNewInstituteIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [showAnalytics, setShowAnalytics] = useState(false);

  function loadPools() {
    api.get("/talent-pools", { params: { status: statusFilter || undefined, search: searchFilter.trim() || undefined } })
      .then((res) => setPools(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load Talent Pools"));
  }
  useEffect(loadPools, [statusFilter, searchFilter]);
  useEffect(() => {
    if (isAdmin) api.get("/institutes").then((res) => setInstitutes(res.data)).catch(() => {});
  }, [isAdmin]);

  async function createPool(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const { data } = await api.post("/talent-pools", { name: newName.trim(), description: newDescription.trim() || undefined, instituteIds: newInstituteIds });
      setNewName(""); setNewDescription(""); setNewInstituteIds([]);
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

  function toggleNewInstitute(id) {
    setNewInstituteIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
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
          Curate special groups of high-performing students — spanning one or more institutes, manually or by rule —
          and give them exclusive access to specific coding tests and mock interviews.
        </p>
        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{error}</p>}

        <div style={{ marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={() => setShowAnalytics((v) => !v)}>{showAnalytics ? "Hide" : "Show"} Analytics</button>
          {showAnalytics && <AnalyticsPanel institutes={institutes} pools={pools} isAdmin={isAdmin} />}
        </div>

        {isAdmin && (
          <form onSubmit={createPool} className="card" style={{ padding: 16, marginTop: 20, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 220px" }}>
                <label style={labelStyle}>New Pool Name</label>
                <input style={inputStyle} placeholder="e.g. Elite Coders" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div style={{ flex: "1 1 260px" }}>
                <label style={labelStyle}>Description (optional)</label>
                <input style={inputStyle} placeholder="e.g. Top 30 CS students by coding score" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              </div>
              <button className="btn btn-primary" disabled={creating}>{creating ? "Creating…" : "+ New Pool"}</button>
            </div>
            {institutes.length > 0 && (
              <div>
                <label style={labelStyle}>Institutes (leave empty for a platform-wide pool)</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {institutes.map((inst) => (
                    <label key={inst.id} className="card" style={{ padding: "6px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={newInstituteIds.includes(inst.id)} onChange={() => toggleNewInstitute(inst.id)} />
                      {inst.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
          <input style={{ ...inputStyle, maxWidth: 260 }} placeholder="Search pools by name…" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} />
          <select style={{ ...inputStyle, maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
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
                {p.institutes?.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                    {p.institutes.map((i) => i.institute.name).join(" · ")}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                  {p._count.members} member(s) · {p._count.testAssignments} exclusive test(s) · {p._count.interviewConfigs} interview config(s)
                </div>
              </div>
              {isAdmin && (
                <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={(e) => { e.stopPropagation(); deletePool(p.id); }}>Delete</button>
              )}
            </div>
          ))}
          {pools.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No Talent Pools yet{isAdmin ? " — create one above." : "."}</p>}
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
            {tab === 0 && <MembersTab pool={selected} pools={pools} setError={setError} onChange={loadPools} isAdmin={isAdmin} />}
            {tab === 1 && <AutoRuleTab poolId={selected.id} setError={setError} onChange={loadPools} isAdmin={isAdmin} />}
            {tab === 2 && <AssessmentsTab pool={selected} setError={setError} onChange={loadPools} isAdmin={isAdmin} user={user} />}
            {tab === 3 && <RankingsTab poolId={selected.id} />}
            {tab === 4 && <ReportsTab pool={selected} setError={setError} />}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================== Analytics (platform/institute-wide) ===========================

function AnalyticsPanel({ institutes, pools, isAdmin }) {
  const [filters, setFilters] = useState({ poolId: "", instituteId: "", dateFrom: "", dateTo: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    const params = {};
    if (filters.poolId) params.poolId = filters.poolId;
    if (filters.instituteId) params.instituteId = filters.instituteId;
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
    api.get("/talent-pools/analytics", { params }).then((res) => setData(res.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = data
    ? [
        { label: "Total Pools", value: data.totals.totalPools },
        { label: "Active", value: data.totals.activePools },
        { label: "Inactive", value: data.totals.inactivePools },
        { label: "Total Students", value: data.totals.totalStudents },
        { label: "Assessment Completion", value: `${data.assessmentParticipation.completionRatePercent}%` },
        { label: "Avg Score", value: data.scores.average != null ? `${data.scores.average}%` : "—" },
        { label: "Highest Score", value: data.scores.highest != null ? `${data.scores.highest}%` : "—" },
        { label: "Lowest Score", value: data.scores.lowest != null ? `${data.scores.lowest}%` : "—" },
      ]
    : [];

  return (
    <div className="card" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>Pool</label>
          <select style={inputStyle} value={filters.poolId} onChange={(e) => setFilters((f) => ({ ...f, poolId: e.target.value }))}>
            <option value="">All pools</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {isAdmin && (
          <div>
            <label style={labelStyle}>Institute</label>
            <select style={inputStyle} value={filters.instituteId} onChange={(e) => setFilters((f) => ({ ...f, instituteId: e.target.value }))}>
              <option value="">All institutes</option>
              {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={labelStyle}>Pool created from</label>
          <input type="date" style={inputStyle} value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>to</label>
          <input type="date" style={inputStyle} value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
        </div>
        <button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? "…" : "Apply"}</button>
      </div>

      {data && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
            {cards.map((c) => (
              <div key={c.label} className="card" style={{ padding: 12, minWidth: 120 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{c.value}</div>
                <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>{c.label}</div>
              </div>
            ))}
          </div>

          {data.instituteWise.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700 }}>Institute-wise Distribution</h4>
              {data.instituteWise.map((row) => (
                <div key={row.name} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                  <span>{row.name}</span><span>{row.count}</span>
                </div>
              ))}
            </div>
          )}
          {data.departmentWise.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700 }}>Department-wise Distribution</h4>
              {data.departmentWise.map((row) => (
                <div key={row.departmentId} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                  <span>{row.name}</span><span>{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =========================== Members ===========================

const MEMBER_MODES = ["Search", "Browse", "Bulk Import", "Transfer"];

function MembersTab({ pool, pools, setError, onChange, isAdmin }) {
  const poolId = pool.id;
  const [members, setMembers] = useState([]);
  const [mode, setMode] = useState(0);
  const [memberSearch, setMemberSearch] = useState("");

  function loadMembers() {
    api.get(`/talent-pools/${poolId}/members`, { params: { search: memberSearch.trim() || undefined } })
      .then((res) => setMembers(res.data)).catch(() => setMembers([]));
  }
  useEffect(loadMembers, [poolId, memberSearch]);

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

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {MEMBER_MODES.map((m, i) => (
          <button
            key={m}
            className="btn btn-ghost"
            style={{ fontWeight: mode === i ? 700 : 400, borderBottom: mode === i ? "2px solid var(--ink)" : "2px solid transparent" }}
            onClick={() => setMode(i)}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 0 && <SearchAddPanel pool={pool} members={members} setError={setError} onChange={() => { loadMembers(); onChange(); }} />}
      {mode === 1 && <BrowseAddPanel pool={pool} members={members} isAdmin={isAdmin} setError={setError} onChange={() => { loadMembers(); onChange(); }} />}
      {mode === 2 && isAdmin && <BulkImportPanel pool={pool} setError={setError} onChange={() => { loadMembers(); onChange(); }} />}
      {mode === 2 && !isAdmin && <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 16 }}>Bulk Import is an Admin-only action.</p>}
      {mode === 3 && <TransferPanel pool={pool} pools={pools} members={members} setError={setError} onChange={() => { loadMembers(); onChange(); }} />}

      <div style={{ display: "flex", gap: 8, marginTop: 24, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 260px" }}>
          <label style={labelStyle}>Filter current members</label>
          <input style={inputStyle} placeholder="Search by name, roll number, or email…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
        </div>
      </div>
      <h3 style={{ fontSize: 15, marginTop: 12 }}>Members ({members.length})</h3>
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        {members.map((m) => (
          <div key={m.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>
              {m.student.rollNumber || "—"} · {m.student.name} <span style={{ color: "var(--ink-dim)" }}>({m.student.registrationNumber || m.student.email})</span>
              {m.student.institute && <span style={{ fontSize: 11, color: "var(--ink-dim)", marginLeft: 8 }}>{m.student.institute.name}</span>}
              <span style={{ fontSize: 11, color: "var(--ink-dim)", marginLeft: 8 }}>{m.addedVia === "AUTO_RULE" ? "Auto-selected" : "Manually added"}</span>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={() => removeMember(m.studentId)}>Remove</button>
          </div>
        ))}
        {members.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No members yet.</p>}
      </div>
    </div>
  );
}

function SearchAddPanel({ pool, members, setError, onChange }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      const { data } = await api.get("/users/search", { params: { q: q.trim() } });
      setResults(data.filter((u) => u.role === "STUDENT"));
      setSelected([]);
    } catch (err) {
      setError(err.response?.data?.error || "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((i) => i !== id) : [...s, id]));
  }

  async function addSelected() {
    if (!selected.length) return;
    setAdding(true);
    setError("");
    try {
      await api.post(`/talent-pools/${pool.id}/members`, { studentIds: selected });
      setSelected([]);
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add members");
    } finally {
      setAdding(false);
    }
  }

  const memberIds = new Set(members.map((m) => m.studentId));

  return (
    <div style={{ marginTop: 16 }}>
      <form onSubmit={search} style={{ display: "flex", gap: 8, maxWidth: 480 }}>
        <input style={inputStyle} placeholder="Search by name, roll number, or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary" disabled={searching}>{searching ? "…" : "Search"}</button>
      </form>
      {results.length > 0 && (
        <>
          <div style={{ display: "grid", gap: 6, marginTop: 10, maxWidth: 480 }}>
            {results.map((u) => (
              <div key={u.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: memberIds.has(u.id) ? "default" : "pointer" }}>
                  {!memberIds.has(u.id) && <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />}
                  {u.rollNumber || "—"} · {u.name} <span style={{ color: "var(--ink-dim)" }}>({u.registrationNumber || u.email})</span>
                </label>
                {memberIds.has(u.id) && <span style={{ fontSize: 12, color: "var(--mint)" }}>Already a member</span>}
              </div>
            ))}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={addSelected} disabled={!selected.length || adding}>
            {adding ? "Adding…" : `+ Add Selected (${selected.length})`}
          </button>
        </>
      )}
    </div>
  );
}

// Institute -> Department -> Section browse-and-select, mirroring StudentSearch.jsx's cascading
// filter pattern. For an institute-scoped STAFF (or scoped ADMIN), the backend auto-fixes the
// institute regardless of what's sent, so the picker is simply hidden. Institute OPTIONS are
// restricted to this pool's own configured institutes — a student can only be manually added if
// their institute is one this pool is already scoped to.
function BrowseAddPanel({ pool, members, setError, onChange }) {
  const [instituteId, setInstituteId] = useState("");
  const [groups, setGroups] = useState([]);
  const [departmentId, setDepartmentId] = useState("");
  const [section, setSection] = useState("");
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [adding, setAdding] = useState(false);

  // For a STAFF (or institute-scoped ADMIN) caller, the backend ignores/overrides whatever
  // instituteId is sent here and scopes both /academic-groups and /users/browse to their own
  // institute regardless — so it's safe to show the same picker to everyone; the picked value only
  // matters for an unscoped (platform) ADMIN.
  const poolInstitutes = (pool.institutes || []).map((i) => i.institute);
  const showInstitutePicker = poolInstitutes.length > 1;

  useEffect(() => {
    if (poolInstitutes.length === 1) setInstituteId(poolInstitutes[0].id);
  }, [pool.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setGroups([]); setDepartmentId(""); setSection(""); setStudents([]); setSelected([]);
    if (!instituteId) return;
    api.get("/academic-groups", { params: { instituteId } }).then((res) => setGroups(res.data)).catch(() => setGroups([]));
  }, [instituteId]);

  const departments = [...new Map(groups.map((g) => [g.department.id, g.department])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const sections = [...new Set(groups.filter((g) => g.department.id === departmentId).map((g) => g.section))].sort();

  async function fetchStudents() {
    if (!departmentId || !section) return;
    setFetching(true);
    setError("");
    try {
      const { data } = await api.get("/users/browse", { params: { instituteId, departmentId, section } });
      setStudents(data);
      setSelected([]);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch students");
    } finally {
      setFetching(false);
    }
  }

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((i) => i !== id) : [...s, id]));
  }

  async function addSelected() {
    if (!selected.length) return;
    setAdding(true);
    setError("");
    try {
      await api.post(`/talent-pools/${pool.id}/members`, { studentIds: selected });
      setSelected([]);
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add members");
    } finally {
      setAdding(false);
    }
  }

  const memberIds = new Set(members.map((m) => m.studentId));

  if (poolInstitutes.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 16 }}>Assign at least one institute to this pool (edit its settings) before browsing students.</p>;
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        {showInstitutePicker ? (
          <div>
            <label style={labelStyle}>Institute</label>
            <select style={inputStyle} value={instituteId} onChange={(e) => setInstituteId(e.target.value)}>
              <option value="">Select institute…</option>
              {poolInstitutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        ) : (
          instituteId && <div style={{ fontSize: 13, alignSelf: "center" }}>Institute: <strong>{poolInstitutes.find((i) => i.id === instituteId)?.name}</strong></div>
        )}
        <div>
          <label style={labelStyle}>Department</label>
          <select style={inputStyle} value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setSection(""); }} disabled={!instituteId}>
            <option value="">Select department…</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Section</label>
          <select style={inputStyle} value={section} onChange={(e) => setSection(e.target.value)} disabled={!departmentId}>
            <option value="">Select section…</option>
            {sections.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={fetchStudents} disabled={!departmentId || !section || fetching}>{fetching ? "…" : "Fetch Students"}</button>
      </div>

      {students.length > 0 && (
        <>
          <div style={{ display: "grid", gap: 6, marginTop: 12, maxWidth: 480 }}>
            {students.map((u) => (
              <div key={u.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: memberIds.has(u.id) ? "default" : "pointer" }}>
                  {!memberIds.has(u.id) && <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />}
                  {u.rollNumber || "—"} · {u.name} <span style={{ color: "var(--ink-dim)" }}>({u.registrationNumber || u.email})</span>
                </label>
                {memberIds.has(u.id) && <span style={{ fontSize: 12, color: "var(--mint)" }}>Already a member</span>}
              </div>
            ))}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={addSelected} disabled={!selected.length || adding}>
            {adding ? "Adding…" : `+ Add Selected (${selected.length})`}
          </button>
        </>
      )}
      {students.length === 0 && !fetching && departmentId && section && (
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 10 }}>Click "Fetch Students" to load this Institute/Department/Section.</p>
      )}
    </div>
  );
}

function BulkImportPanel({ pool, setError, onChange }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  async function downloadTemplate() {
    try {
      const { data } = await api.get(`/talent-pools/${pool.id}/bulk-import-template`, { responseType: "blob" });
      const blobUrl = URL.createObjectURL(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = blobUrl; a.download = "talent-pool-bulk-import-template.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setError("Failed to download template");
    }
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post(`/talent-pools/${pool.id}/bulk-import`, form);
      setResult(data);
      setFile(null);
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Bulk import failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>
        Upload an Excel file with "Institute" and "Registration Number (PRN)" columns. Institutes must be among this
        pool's configured institutes; students are matched by Registration Number only — Roll Number is not a
        template column.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-ghost" type="button" onClick={downloadTemplate}>Download Template</button>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files[0] || null)} />
        <button className="btn btn-primary" onClick={upload} disabled={!file || uploading}>{uploading ? "Importing…" : "Import"}</button>
      </div>
      <UploadProgressBar active={uploading} />

      {result && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13 }}>
            {result.total} row(s) processed — <strong>{result.addedCount}</strong> added, {result.alreadyExistingCount} already existing,{" "}
            {result.invalidInstituteCount} invalid institute, {result.invalidRegistrationNumberCount} invalid registration number, {result.failedCount} failed.
          </p>
          {[
            ["Added", result.added, "var(--mint)"],
            ["Already Existing", result.alreadyExisting, "var(--ink-dim)"],
            ["Invalid Institute", result.invalidInstitute, "var(--rust)"],
            ["Invalid Registration Number", result.invalidRegistrationNumber, "var(--rust)"],
            ["Failed", result.failed, "var(--rust)"],
          ].filter(([, rows]) => rows.length > 0).map(([title, rows, color]) => (
            <div key={title} style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color }}>{title} ({rows.length})</h4>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 6 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--ink-dim)" }}>
                      <th style={{ padding: "4px 8px" }}>Row</th><th style={{ padding: "4px 8px" }}>Institute</th>
                      <th style={{ padding: "4px 8px" }}>Reg. No. (PRN)</th><th style={{ padding: "4px 8px" }}>{title === "Added" || title === "Already Existing" ? "Name" : "Reason"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "4px 8px" }}>{r.row}</td><td style={{ padding: "4px 8px" }}>{r.institute}</td>
                        <td style={{ padding: "4px 8px" }}>{r.registrationNumber}</td><td style={{ padding: "4px 8px" }}>{r.name || r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TransferPanel({ pool, pools, members, setError, onChange }) {
  const [selected, setSelected] = useState([]);
  const [targetPoolId, setTargetPoolId] = useState("");
  const [mode, setMode] = useState("MOVE");
  const [busy, setBusy] = useState(false);

  function toggle(studentId) {
    setSelected((s) => (s.includes(studentId) ? s.filter((i) => i !== studentId) : [...s, studentId]));
  }

  async function transfer() {
    if (!selected.length || !targetPoolId) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(`/talent-pools/${pool.id}/members/transfer`, { studentIds: selected, targetPoolId, mode });
      setSelected([]);
      onChange();
      alert(`${data.addedCount} added to target pool${mode === "MOVE" ? `, ${data.removedCount} removed from this pool` : ""}.`);
    } catch (err) {
      setError(err.response?.data?.error || "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  const otherPools = pools.filter((p) => p.id !== pool.id);

  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>
        Select members below, choose a target pool, then Move (removes from this pool) or Copy (keeps them here too).
      </p>
      <div style={{ display: "grid", gap: 6, marginTop: 10, maxWidth: 480 }}>
        {members.map((m) => (
          <label key={m.id} className="card" style={{ padding: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={selected.includes(m.studentId)} onChange={() => toggle(m.studentId)} />
            {m.student.name} <span style={{ color: "var(--ink-dim)" }}>({m.student.rollNumber || m.student.email})</span>
          </label>
        ))}
        {members.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No members to transfer yet.</p>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>Target Pool</label>
          <select style={inputStyle} value={targetPoolId} onChange={(e) => setTargetPoolId(e.target.value)}>
            <option value="">Select pool…</option>
            {otherPools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Action</label>
          <select style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="MOVE">Move</option>
            <option value="COPY">Copy</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={transfer} disabled={!selected.length || !targetPoolId || busy}>
          {busy ? "…" : `${mode === "MOVE" ? "Move" : "Copy"} Selected (${selected.length})`}
        </button>
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

function AutoRuleTab({ poolId, setError, onChange, isAdmin }) {
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

  if (!isAdmin) return <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 20 }}>Auto-selection rules are an Admin-only setting.</p>;

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

function AssessmentsTab({ pool, setError, onChange, isAdmin, user }) {
  const poolId = pool.id;
  const [tests, setTests] = useState([]);
  const [availableTests, setAvailableTests] = useState([]);
  const [selectedTestId, setSelectedTestId] = useState("");
  const [configs, setConfigs] = useState([]);
  const [newConfigLabel, setNewConfigLabel] = useState("");
  const [newConfigCompany, setNewConfigCompany] = useState("");

  function loadAll() {
    api.get(`/talent-pools/${poolId}/tests`).then((res) => setTests(res.data)).catch(() => setTests([]));
    api.get(`/talent-pools/${poolId}/interview-configs`).then((res) => setConfigs(res.data)).catch(() => setConfigs([]));
    if (isAdmin) api.get("/tests").then((res) => setAvailableTests(res.data)).catch(() => setAvailableTests([]));
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
  const mandatoryTests = tests.filter((t) => t.test.attendanceMandatory);

  return (
    <div style={{ marginTop: 20 }}>
      {isAdmin && (
        <>
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
        </>
      )}
      <div style={{ display: "grid", gap: 6, marginTop: 12, maxWidth: 480 }}>
        {tests.map((link) => (
          <div key={link.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>
              {link.test.title}{link.test.company ? ` — ${link.test.company}` : ""}
              {link.test.attendanceMandatory && <span style={{ fontSize: 11, color: "var(--ink-dim)", marginLeft: 6 }}>(attendance mandatory)</span>}
            </div>
            {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={() => unassignTest(link.testId)}>Unassign</button>}
          </div>
        ))}
        {tests.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No exclusive tests assigned yet.</p>}
      </div>

      {isAdmin && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 28 }}>Exclusive Mock Interview Configs</h3>
          <form onSubmit={createConfig} style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 480, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, flex: "1 1 200px" }} placeholder="Label, e.g. Amazon Prep Round" value={newConfigLabel} onChange={(e) => setNewConfigLabel(e.target.value)} />
            <input style={{ ...inputStyle, flex: "1 1 160px" }} placeholder="Company (optional)" value={newConfigCompany} onChange={(e) => setNewConfigCompany(e.target.value)} />
            <button className="btn btn-primary">+ Create</button>
          </form>
        </>
      )}
      <div style={{ display: "grid", gap: 6, marginTop: 12, maxWidth: 480 }}>
        {configs.map((c) => (
          <div key={c.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>{c.label} {!c.isActive && <span style={{ color: "var(--ink-dim)" }}>(inactive)</span>}</div>
            {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={() => deleteConfig(c.id)}>Delete</button>}
          </div>
        ))}
        {configs.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No exclusive interview configs yet.</p>}
      </div>

      {mandatoryTests.length > 0 && <AttendanceOwnershipPanel pool={pool} isAdmin={isAdmin} user={user} setError={setError} />}
    </div>
  );
}

// Institute-wise attendance ownership for this pool's attendance-mandatory exclusive tests.
// ADMIN can assign any staff member of any institute configured on the pool; STAFF only ever
// self-assigns (no picker — see AttendanceHome.jsx for the equivalent self-service "Claim" flow),
// so this panel only renders assignment controls for ADMIN, plus a read-only list for everyone.
function AttendanceOwnershipPanel({ pool, isAdmin, user, setError }) {
  const [owners, setOwners] = useState([]);
  const [staffByInstitute, setStaffByInstitute] = useState({});
  const [picks, setPicks] = useState({});

  function loadOwners() {
    api.get(`/talent-pools/${pool.id}/attendance-owners`).then((res) => setOwners(res.data)).catch(() => setOwners([]));
  }
  useEffect(loadOwners, [pool.id]);

  useEffect(() => {
    if (!isAdmin) return;
    (pool.institutes || []).forEach((pi) => {
      api.get("/attendance/admin/staff", { params: { instituteId: pi.instituteId } })
        .then((res) => setStaffByInstitute((s) => ({ ...s, [pi.instituteId]: res.data })))
        .catch(() => {});
    });
  }, [pool.id, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  async function assign(instituteId) {
    const staffId = picks[instituteId];
    if (!staffId) return;
    setError("");
    try {
      await api.post(`/talent-pools/${pool.id}/attendance-owners`, { instituteId, staffId });
      loadOwners();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to assign attendance owner");
    }
  }

  async function remove(assignmentId) {
    setError("");
    try {
      await api.delete(`/talent-pools/${pool.id}/attendance-owners/${assignmentId}`);
      loadOwners();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to remove attendance owner");
    }
  }

  const ownerByInstitute = new Map(owners.map((o) => [o.attendanceInstituteId, o]));

  return (
    <div style={{ marginTop: 28 }}>
      <h3 style={{ fontSize: 15 }}>Attendance Ownership</h3>
      <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>
        Since this pool may span multiple institutes, each institute's attendance for its attendance-mandatory
        exclusive tests is owned by one staff member from that institute.
      </p>
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", color: "var(--ink-dim)" }}>
              {["Institute", "Owner", "Action"].map((h) => <th key={h} style={{ padding: "8px 10px" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(pool.institutes || []).map((pi) => {
              const owner = ownerByInstitute.get(pi.instituteId);
              const canManage = isAdmin || (user?.role === "STAFF" && owner?.staffId === user.id);
              return (
                <tr key={pi.instituteId} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 10px" }}>{pi.institute.name}</td>
                  <td style={{ padding: "8px 10px" }}>{owner ? owner.staff.name : <span style={{ color: "var(--ink-dim)" }}>Unassigned</span>}</td>
                  <td style={{ padding: "8px 10px" }}>
                    {isAdmin && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <select style={{ ...inputStyle, width: 180 }} value={picks[pi.instituteId] || ""} onChange={(e) => setPicks((p) => ({ ...p, [pi.instituteId]: e.target.value }))}>
                          <option value="">Select staff…</option>
                          {(staffByInstitute[pi.instituteId] || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => assign(pi.instituteId)}>{owner ? "Reassign" : "Assign"}</button>
                      </div>
                    )}
                    {canManage && owner && (
                      <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)", marginLeft: 6 }} onClick={() => remove(owner.id)}>Remove</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
      const params = isPdf ? undefined : { poolId: pool.id, format: format === "xlsx" ? "xlsx" : "csv" };
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
