import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useConfirm } from "../context/ConfirmContext";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };

// Academic groups (Institute -> Batch -> Department -> Section) are derived automatically from
// registered students (Bulk Upload/Registration, or the one-time migration from the old Class
// system) — there's no "create a group" flow here, and empty groups are cleaned up automatically
// server-side the moment their last student is reassigned or removed (see
// backend/src/utils/academicGroups.js). Manual deletion (below) is the one exception: an Admin can
// still remove a non-empty group outright, which permanently deletes every student in it too — not
// available to Staff at all, matching this page's own ADMIN-only route gating in App.jsx.
export default function AcademicGroups() {
  const confirmDialog = useConfirm();
  const [groups, setGroups] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [filterInstituteId, setFilterInstituteId] = useState("");
  const [filterBatch, setFilterBatch] = useState("");
  // Derived from the last unfiltered-by-batch fetch (i.e. whenever filterBatch itself is empty) —
  // kept independent of the currently-displayed `groups` so the dropdown's own option list never
  // narrows to just whatever batch happens to be selected.
  const [availableBatches, setAvailableBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [resettingId, setResettingId] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // the group pending deletion, or null
  const [deleteStep, setDeleteStep] = useState("warn"); // "warn" | "password"
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Filtering happens server-side (GET /academic-groups' `batch` param, backed by AcademicGroup's
  // existing @@index([instituteId, batch])) — this only ever fetches the already-filtered result,
  // never the full list filtered client-side. When batch is empty ("All Batches"), the response
  // also doubles as the source for the batch dropdown's own option list.
  function load(instituteId, batch) {
    setLoading(true);
    const params = {};
    if (instituteId) params.instituteId = instituteId;
    if (batch) params.batch = batch;
    api.get("/academic-groups", { params })
      .then((res) => {
        setGroups(res.data);
        if (!batch) {
          const batches = [...new Set(res.data.map((g) => g.batch))].filter(Boolean)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          setAvailableBatches(batches);
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    api.get("/institutes").then((res) => setInstitutes(res.data));
  }, []);

  // Covers both the initial load and every subsequent filter change — avoids firing the identical
  // request twice on mount (one bare, one from this effect) the way the institute-only version of
  // this page used to.
  useEffect(() => {
    load(filterInstituteId, filterBatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterInstituteId, filterBatch]);

  function changeInstitute(instituteId) {
    // Changing institute clears the batch filter — a batch selected under one institute may not
    // exist under another, and this avoids a confusing "no results" state from a stale combination.
    setFilterInstituteId(instituteId);
    setFilterBatch("");
  }

  async function toggleRoster(group) {
    if (expandedId === group.id) {
      setExpandedId(null);
      setRoster(null);
      return;
    }
    setExpandedId(group.id);
    setRoster(null);
    setRosterLoading(true);
    try {
      const { data } = await api.get(`/academic-groups/${group.id}/students`);
      setRoster(data.students);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to load students");
    } finally {
      setRosterLoading(false);
    }
  }

  async function bulkResetPasswords(group) {
    const label = `${group.department.name} · ${group.section} (${group.batch})`;
    const ok = await confirmDialog({
      title: "Reset all passwords",
      message: `Reset every student's password in ${label}? Each gets their own new unique password.`,
      confirmLabel: "Reset all",
      danger: true,
    });
    if (!ok) return;
    setResettingId(group.id);
    try {
      const { data } = await api.post(`/academic-groups/${group.id}/bulk-reset-password`);
      if (data.resetCount === 0) {
        alert(`No students in ${label} to reset.`);
      } else {
        setResetResult({ groupLabel: label, students: data.students });
      }
    } catch (err) {
      alert(err.response?.data?.error || "Failed to reset passwords");
    } finally {
      setResettingId(null);
    }
  }

  function openDeleteDialog(group) {
    setDeleteTarget(group);
    setDeleteStep("warn");
    setDeletePassword("");
    setDeleteError("");
  }

  function closeDeleteDialog() {
    if (deleting) return; // don't let the dialog vanish mid-request
    setDeleteTarget(null);
  }

  async function confirmDeleteGroup() {
    if (!deletePassword) {
      setDeleteError("Enter your password to confirm.");
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      const { data } = await api.delete(`/academic-groups/${deleteTarget.id}`, { data: { password: deletePassword } });
      setGroups((prev) => prev.filter((g) => g.id !== deleteTarget.id));
      if (expandedId === deleteTarget.id) { setExpandedId(null); setRoster(null); }
      alert(`Deleted the group and ${data.deletedStudents} student record${data.deletedStudents === 1 ? "" : "s"}.`);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err.response?.data?.error || "Failed to delete academic group");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Academic Groups</h1>
            <ChalkUnderline />
          </div>
          <Link to="/admin" className="btn btn-ghost">← Back to Admin</Link>
        </div>
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Every unique Institute · Batch · Department · Section combination, created automatically the moment a
          student is registered with it — via Bulk Upload or manual account creation. There's nothing to set up
          here; this is a read-only view of what's already been derived from your student data.
        </p>

        <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
          <div>
            <label style={{ ...labelStyle, marginTop: 0 }}>Filter by institute</label>
            <select style={{ ...inputStyle, maxWidth: 300 }} value={filterInstituteId} onChange={(e) => changeInstitute(e.target.value)} disabled={loading}>
              <option value="">All institutes</option>
              {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ ...labelStyle, marginTop: 0 }}>Filter by batch</label>
            <select style={{ ...inputStyle, maxWidth: 220 }} value={filterBatch} onChange={(e) => setFilterBatch(e.target.value)} disabled={loading}>
              <option value="">All batches</option>
              {availableBatches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        {!loading && groups.length > 0 && (
          <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 10 }}>
            {groups.length} group{groups.length === 1 ? "" : "s"} · {groups.reduce((sum, g) => sum + (g._count?.users || 0), 0)} student{groups.reduce((sum, g) => sum + (g._count?.users || 0), 0) === 1 ? "" : "s"} total
          </p>
        )}
        {loading && <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 10 }}>Loading…</p>}

        {resetResult && (
          <div className="card" style={{ padding: 20, marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--mint)" }}>
                  Reset {resetResult.students.length} password{resetResult.students.length === 1 ? "" : "s"} in {resetResult.groupLabel}
                </div>
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                  Each student got their own new temporary password — share these individually. They'll be asked to
                  set a new one on next login.
                </p>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setResetResult(null)}>Dismiss</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                  <th style={{ padding: "6px 4px" }}>Roll no.</th>
                  <th>Name</th>
                  <th>Registration No. (PRN)</th>
                  <th>Email</th>
                  <th>New temporary password</th>
                </tr>
              </thead>
              <tbody>
                {resetResult.students.map((s) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                    <td className="mono" style={{ padding: "6px 4px" }}>{s.rollNumber || "—"}</td>
                    <td>{s.name}</td>
                    <td className="mono">{s.registrationNumber || "—"}</td>
                    <td className="mono">{s.email}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{s.newPassword}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
          {groups.map((g) => (
            <div key={g.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{g.department.name} · {g.section}</span>
                  <span className="badge" style={{ marginLeft: 8 }}>{g.batch}</span>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                    {g.institute?.name || "No institute"} · {g._count?.users ?? 0} student{g._count?.users === 1 ? "" : "s"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost" onClick={() => toggleRoster(g)}>
                    {expandedId === g.id ? "Hide students" : "View students"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => bulkResetPasswords(g)} disabled={resettingId === g.id}>
                    {resettingId === g.id ? "Resetting…" : "Reset all passwords"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--rust)" }}
                    onClick={() => openDeleteDialog(g)}
                  >
                    Delete group
                  </button>
                </div>
              </div>

              {expandedId === g.id && (
                <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                  {rosterLoading && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>}
                  {roster && roster.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No students in this group.</p>}
                  {roster && roster.length > 0 && (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                          <th style={{ padding: "6px 4px" }}>Roll no.</th>
                          <th>Name</th>
                          <th>Registration No. (PRN)</th>
                          <th>Email</th>
                          <th>Mobile</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roster.map((s) => (
                          <tr key={s.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                            <td className="mono" style={{ padding: "6px 4px" }}>{s.rollNumber || "—"}</td>
                            <td>{s.name}</td>
                            <td className="mono">{s.registrationNumber || "—"}</td>
                            <td className="mono">{s.email}</td>
                            <td className="mono">{s.mobile || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
          {!loading && groups.length === 0 && (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--ink-dim)" }}>
              {filterInstituteId || filterBatch
                ? "No academic groups match the selected filters."
                : "No academic groups yet — they'll appear here as soon as students are registered."}
            </div>
          )}
        </div>
      </div>

      {deleteTarget && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center", padding: 16 }}
          onClick={closeDeleteDialog}
        >
          <div className="card" style={{ maxWidth: 460, width: "100%", padding: 24, position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn btn-ghost" style={{ position: "absolute", top: 12, right: 12, padding: 6 }} onClick={closeDeleteDialog} disabled={deleting} aria-label="Close">
              <X size={16} />
            </button>

            {deleteStep === "warn" ? (
              <>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <AlertTriangle size={22} style={{ color: "var(--rust)", flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <h3 style={{ fontSize: 16, margin: 0 }}>Delete this academic group?</h3>
                    <p style={{ fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
                      <strong>{deleteTarget.department.name} · {deleteTarget.section} ({deleteTarget.batch})</strong> contains{" "}
                      <strong style={{ color: "var(--rust)" }}>
                        {deleteTarget._count?.users ?? 0} student record{(deleteTarget._count?.users ?? 0) === 1 ? "" : "s"}
                      </strong>.
                    </p>
                    <p style={{ fontSize: 13, marginTop: 8, lineHeight: 1.6, color: "var(--rust)" }}>
                      Deleting this group will permanently remove the group AND all {deleteTarget._count?.users ?? 0} of those
                      student accounts — logins, submissions, certificates, everything. This action is irreversible and cannot
                      be undone.
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
                  <button type="button" className="btn btn-ghost" onClick={closeDeleteDialog}>Cancel</button>
                  <button type="button" className="btn btn-primary" style={{ background: "var(--rust)", color: "#fff" }} onClick={() => setDeleteStep("password")}>Continue</button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 16, margin: 0 }}>Confirm your password</h3>
                <p style={{ fontSize: 13, marginTop: 8, color: "var(--ink-dim)" }}>
                  For your security, re-enter your own admin password to permanently delete this group and its{" "}
                  {deleteTarget._count?.users ?? 0} student record{(deleteTarget._count?.users ?? 0) === 1 ? "" : "s"}.
                </p>
                <input
                  type="password"
                  autoFocus
                  style={inputStyle}
                  placeholder="Your password"
                  value={deletePassword}
                  onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !deleting) confirmDeleteGroup(); }}
                />
                {deleteError && <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 6 }}>{deleteError}</p>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
                  <button type="button" className="btn btn-ghost" onClick={closeDeleteDialog} disabled={deleting}>Cancel</button>
                  <button type="button" className="btn btn-primary" style={{ background: "var(--rust)", color: "#fff" }} onClick={confirmDeleteGroup} disabled={deleting}>
                    {deleting ? "Deleting…" : "Delete permanently"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
