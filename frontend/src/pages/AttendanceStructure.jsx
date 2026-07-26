import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
const TABS = ["Departments", "Staff Assignment", "Attendance Rules"];

// Admin-only structural setup for Attendance Management. Academic groups (Institute -> Batch ->
// Department -> Section) are auto-derived from registered students — Bulk Upload/Registration
// create/reuse them automatically, so there's no "assign a class into a group" step here anymore.
// This page is only for: managing Departments (the one piece of structure an admin still curates),
// and assigning staff to a group so they can mark attendance only for what they're given access to.
export default function AttendanceStructure() {
  const [tab, setTab] = useState(0);
  const [departments, setDepartments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState("");

  // The logged-in admin's own client-side user object never carries an instituteId (a
  // platform-level Super Admin has none), and every /attendance/admin/* route requires one to
  // scope its query. Rather than guessing whether this particular admin is institute-scoped,
  // always show the picker — same pattern StudentSearch.jsx already uses for ADMIN — and
  // auto-select when there's only one institute so the common case needs no extra click.
  const [institutes, setInstitutes] = useState([]);
  const [instituteId, setInstituteId] = useState("");

  useEffect(() => {
    api.get("/institutes").then((res) => {
      setInstitutes(res.data);
      if (res.data.length === 1) setInstituteId(res.data[0].id);
    }).catch(() => setInstitutes([]));
  }, []);

  function loadAll() {
    if (!instituteId) return;
    api.get("/attendance/admin/departments", { params: { instituteId } }).then((res) => setDepartments(res.data));
    api.get("/attendance/admin/staff", { params: { instituteId } }).then((res) => setStaff(res.data));
  }
  useEffect(loadAll, [instituteId]);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Attendance Setup</h1>
            <ChalkUnderline />
          </div>
          <Link to="/admin" className="btn btn-ghost">← Back to Admin</Link>
        </div>
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Academic groups (Institute · Batch · Department · Section) are created automatically from registered
          students — there's nothing to set up for them here. Assign staff to a group below so they can mark
          attendance only for what they're given access to.
        </p>

        <div className="card" style={{ padding: 16, marginTop: 20, maxWidth: 420 }}>
          <label style={labelStyle}>Institute</label>
          <select style={inputStyle} value={instituteId} onChange={(e) => setInstituteId(e.target.value)}>
            <option value="">Select institute…</option>
            {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>

        {!instituteId ? (
          <p style={{ color: "var(--ink-dim)", fontSize: 14, marginTop: 20 }}>
            Select an institute above to manage its departments, staff assignments, and attendance rules.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginTop: 24, borderBottom: "1px solid var(--line)" }}>
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
            {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{error}</p>}

            {tab === 0 && (
              <DepartmentsTab departments={departments} instituteId={instituteId} onChange={loadAll} setError={setError} />
            )}
            {tab === 1 && (
              <GroupAssignmentTab staff={staff} instituteId={instituteId} setError={setError} />
            )}
            {tab === 2 && <AttendanceRulesTab instituteId={instituteId} setError={setError} />}
          </>
        )}
      </div>
    </div>
  );
}

// Display-only warning threshold: shown on a student's own attendance view when their per-subject
// percentage falls below it. Never blocks anything (no test/login enforcement) — purely
// informational, per the explicit scope decided for this feature.
function AttendanceRulesTab({ instituteId, setError }) {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoaded(false);
    api.get("/attendance/admin/rules", { params: { instituteId } })
      .then((res) => setValue(res.data.attendanceMinPercent != null ? String(res.data.attendanceMinPercent) : ""))
      .catch((err) => setError(err.response?.data?.error || "Failed to load attendance rules"))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instituteId]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await api.patch("/attendance/admin/rules", { attendanceMinPercent: value === "" ? null : value, instituteId });
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save attendance rules");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p style={{ marginTop: 20, color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>;

  return (
    <div className="card" style={{ padding: 20, marginTop: 20, maxWidth: 420 }}>
      <label style={labelStyle}>Minimum Attendance Percentage</label>
      <p style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 10 }}>
        Students below this percentage (per subject) see a warning badge on their own Attendance page. This is
        informational only — it never blocks a test or any other feature. Leave blank to turn the warning off.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="number" min="0" max="100" style={{ ...inputStyle, maxWidth: 120 }}
          placeholder="e.g. 75" value={value} onChange={(e) => setValue(e.target.value)}
        />
        <span style={{ fontSize: 13 }}>%</span>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
      {saved && <p style={{ fontSize: 12, color: "var(--mint)", marginTop: 8 }}>Saved.</p>}
    </div>
  );
}

function DepartmentsTab({ departments, instituteId, onChange, setError }) {
  const [deptName, setDeptName] = useState("");
  const [savingDept, setSavingDept] = useState(false);

  async function addDepartment(e) {
    e.preventDefault();
    if (!deptName.trim()) return;
    setSavingDept(true);
    setError("");
    try {
      await api.post("/attendance/admin/departments", { name: deptName.trim(), instituteId });
      setDeptName("");
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add department");
    } finally {
      setSavingDept(false);
    }
  }

  async function deleteDept(id) {
    try {
      await api.delete(`/attendance/admin/departments/${id}`);
      onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete department");
    }
  }

  return (
    <div style={{ marginTop: 20, maxWidth: 480 }}>
      <h3 style={{ fontSize: 15 }}>Departments</h3>
      <form onSubmit={addDepartment} style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input style={inputStyle} placeholder="e.g. Computer Science" value={deptName} onChange={(e) => setDeptName(e.target.value)} />
        <button className="btn btn-primary" disabled={savingDept}>Add</button>
      </form>
      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        {departments.map((d) => (
          <div key={d.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</div>
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={() => deleteDept(d.id)}>Delete</button>
          </div>
        ))}
        {departments.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No departments yet — one gets created automatically the first time a student names it during Bulk Upload/Registration, or add one here in advance.</p>}
      </div>
    </div>
  );
}

// Admin Attendance Assignment: Batch -> Fetch -> table of every academic group in that batch, one
// row each, "Assigned Staff" as a searchable field (native <datalist>, filters as you type) scoped
// to this institute's staff. Assigning/re-assigning takes effect immediately — POST
// /staff-assignments finds any existing assignment for that group and updates its staff in place
// (one staff per group), so there's never a second row to reconcile.
function GroupAssignmentTab({ staff, instituteId, setError }) {
  const [batches, setBatches] = useState([]);
  const [batchYear, setBatchYear] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchDrafts, setSearchDrafts] = useState({}); // academicGroupId -> in-progress search text

  useEffect(() => {
    setBatchYear("");
    setRows(null);
    api.get("/attendance/admin/batches", { params: { instituteId } }).then((res) => setBatches(res.data)).catch(() => setBatches([]));
  }, [instituteId]);

  async function fetchTable() {
    if (!batchYear) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/attendance/admin/group-table", { params: { instituteId, batchYear } });
      setRows(data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }

  async function assignStaff(row, staffId) {
    if (!staffId) return;
    try {
      await api.post("/attendance/admin/staff-assignments", { staffId, academicGroupId: row.academicGroupId, semester: row.assignment?.semester || "1" });
      setSearchDrafts((prev) => { const next = { ...prev }; delete next[row.academicGroupId]; return next; });
      fetchTable();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to assign staff");
    }
  }

  function handleSearchInput(row, text) {
    setSearchDrafts((prev) => ({ ...prev, [row.academicGroupId]: text }));
    const match = staff.find((s) => `${s.name} (${s.email})` === text);
    if (match) assignStaff(row, match.id);
  }

  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
        Each academic group gets exactly one assigned staff member. Assigning a new staff member replaces the current one.
      </p>
      <div className="card" style={{ padding: 16, marginTop: 10, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={labelStyle}>Batch</label>
          <select style={inputStyle} value={batchYear} onChange={(e) => setBatchYear(e.target.value)}>
            <option value="">Select batch…</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={fetchTable} disabled={!batchYear || loading}>{loading ? "Fetching…" : "Fetch"}</button>
      </div>
      {batches.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>No academic groups exist for this institute yet — they're created automatically once students are registered.</p>
      )}

      <datalist id="attendance-staff-options">
        {staff.map((s) => <option key={s.id} value={`${s.name} (${s.email})`} />)}
      </datalist>

      {rows && (
        <div style={{ marginTop: 20, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", color: "var(--ink-dim)" }}>
                {["Department", "Section", "Assigned Staff", "Action"].map((h) => <th key={h} style={{ padding: "8px 10px" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.academicGroupId} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 10px" }}>{r.department.name}</td>
                  <td style={{ padding: "8px 10px" }}>{r.section}</td>
                  <td style={{ padding: "8px 10px" }}>
                    {r.assignment ? r.assignment.staff.name : <span style={{ color: "var(--ink-dim)" }}>Not Assigned</span>}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <input
                      style={{ ...inputStyle, maxWidth: 240 }}
                      list="attendance-staff-options"
                      placeholder={r.assignment ? "Change Staff…" : "Select Staff…"}
                      value={searchDrafts[r.academicGroupId] ?? ""}
                      onChange={(e) => handleSearchInput(r, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No academic groups found for this batch.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
