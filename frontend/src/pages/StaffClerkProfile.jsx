import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import EditStaffClerkProfileModal from "../components/EditStaffClerkProfileModal";
import ResetStaffPasswordModal from "../components/ResetStaffPasswordModal";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

const STATUS_LABEL = { ACTIVE: "Active", INACTIVE: "Inactive", LOCKED: "Locked", SUSPENDED: "Suspended" };
const STATUS_COLOR = { ACTIVE: "var(--mint)", INACTIVE: "var(--ink-dim)", LOCKED: "var(--rust)", SUSPENDED: "var(--amber-dark)" };
const NEXT_STATUS_OPTIONS = {
  ACTIVE: [{ value: "INACTIVE", label: "Deactivate" }, { value: "LOCKED", label: "Lock" }, { value: "SUSPENDED", label: "Suspend" }],
  INACTIVE: [{ value: "ACTIVE", label: "Activate" }],
  LOCKED: [{ value: "ACTIVE", label: "Unlock" }, { value: "SUSPENDED", label: "Suspend" }],
  SUSPENDED: [{ value: "ACTIVE", label: "Reinstate" }],
};
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "sessions", label: "Login History" },
  { key: "activity", label: "Activity Timeline" },
  { key: "permissions", label: "Permissions" },
];

// A simple completion % over the fields this dashboard actually manages — display-only, no
// backend computation needed for this simple case (unlike Student's more elaborate checklist).
function computeProfileCompletion(u) {
  if (!u) return 0;
  const checks = [!!u.name, !!u.email, !!u.mobile, !!u.employeeId, !!u.designation, !!u.department, !!u.profilePhotoUrl, !!u.institute];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export default function StaffClerkProfile() {
  const { id } = useParams();
  const confirmDialog = useConfirm();
  const toast = useToast();
  const { user: viewer } = useAuth();

  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  const [statusChanging, setStatusChanging] = useState(false);

  const [sessions, setSessions] = useState(null);
  const [activity, setActivity] = useState(null);
  const [permissions, setPermissions] = useState(null);

  function load() {
    api.get(`/staff-clerk/${id}`).then((res) => setUser(res.data)).catch(() => setUser(false));
  }
  useEffect(load, [id]);

  useEffect(() => {
    if (tab === "sessions" && !sessions) api.get(`/staff-clerk/${id}/sessions`).then((res) => setSessions(res.data)).catch(() => setSessions([]));
    if (tab === "activity" && !activity) api.get("/users/audit-log", { params: { studentId: id, pageSize: 100 } }).then((res) => setActivity(res.data.rows)).catch(() => setActivity([]));
    if (tab === "permissions" && !permissions) api.get(`/staff-clerk/${id}/permissions`).then((res) => setPermissions(res.data)).catch(() => setPermissions(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, id]);

  async function changeStatus() {
    if (!statusDraft) return;
    const option = NEXT_STATUS_OPTIONS[user.accountStatus]?.find((o) => o.value === statusDraft);
    const danger = statusDraft !== "ACTIVE";
    const ok = await confirmDialog({
      title: `${option?.label || "Change status"} — ${user.name}`,
      message: `Are you sure you want to ${(option?.label || "change the status of").toLowerCase()} this account?${danger ? " Any active sessions will be signed out immediately." : ""}`,
      confirmLabel: option?.label || "Confirm",
      danger,
    });
    if (!ok) return;
    setStatusChanging(true);
    try {
      await api.patch(`/staff-clerk/${id}/status`, { status: statusDraft });
      toast.success(`Account ${(option?.label || "updated").toLowerCase()}d.`);
      setStatusDraft("");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update account status");
    } finally {
      setStatusChanging(false);
    }
  }

  async function forceLogout(sessionId) {
    const ok = await confirmDialog({ title: "Sign Out Session", message: "Force-logout this session? The user will need to log in again.", confirmLabel: "Sign Out", danger: true });
    if (!ok) return;
    try {
      await api.delete(`/staff-clerk/${id}/sessions/${sessionId}`);
      toast.success("Session signed out.");
      setSessions(null);
      api.get(`/staff-clerk/${id}/sessions`).then((res) => setSessions(res.data));
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to sign out session");
    }
  }

  if (user === false) {
    return (
      <div><Navbar /><div style={{ maxWidth: 800, margin: "0 auto", padding: 48 }}>
        <p style={{ color: "var(--rust)" }}>Account not found, or you don't have access to it.</p>
        <Link to="/admin/staff-clerk" className="btn btn-ghost">← Back to Staff &amp; Clerk</Link>
      </div></div>
    );
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <Link to="/admin/staff-clerk" className="btn btn-ghost" style={{ fontSize: 12 }}>← Back to Staff &amp; Clerk</Link>
        <ChalkUnderline />

        {!user ? (
          <p style={{ color: "var(--ink-dim)", marginTop: 16 }}>Loading…</p>
        ) : (
          <>
            <div className="card" style={{ padding: 20, marginTop: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              {user.profilePhotoUrl ? (
                <img src={user.profilePhotoUrl} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--line)" }} />
              )}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  {user.name} <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>{user.role}</span>
                </div>
                <div className="mono" style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 2 }}>
                  {user.employeeId || "No employee ID"} · {user.email} · {user.mobile || "—"}
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                  {user.institute?.name || "—"}{user.department ? ` · ${user.department}` : ""}{user.designation ? ` · ${user.designation}` : ""}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="badge" style={{ background: STATUS_COLOR[user.accountStatus], color: "#fff", fontWeight: 700 }}>{STATUS_LABEL[user.accountStatus]}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>Profile completion: {computeProfileCompletion(user)}%</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setShowEdit(true)}>Edit Profile</button>
                <button className="btn btn-ghost" onClick={() => setShowReset(true)}>Reset Password</button>
              </div>
            </div>

            <div className="card" style={{ padding: 16, marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Account Status</span>
              {user.role === "INSTITUTE_ADMIN" && viewer?.role !== "SUPER_ADMIN" ? (
                <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>Only the Super Admin can change an Institute Admin's account status.</span>
              ) : (
                <>
                  <select style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }} value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)}>
                    <option value="">Change status…</option>
                    {(NEXT_STATUS_OPTIONS[user.accountStatus] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={!statusDraft || statusChanging} onClick={changeStatus}>
                    {statusChanging ? "Applying…" : "Apply"}
                  </button>
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
              {TABS.map((t) => (
                <button key={t.key} className={tab === t.key ? "btn btn-dark" : "btn btn-ghost"} style={{ fontSize: 12.5 }} onClick={() => setTab(t.key)}>{t.label}</button>
              ))}
            </div>

            {tab === "overview" && (
              <div className="card" style={{ padding: 20, marginTop: 16 }}>
                <Row label="Full Name" value={user.name} />
                <Row label="Employee ID" value={user.employeeId || "—"} />
                <Row label="Email" value={user.email} />
                <Row label="Mobile" value={user.mobile || "—"} />
                <Row label="Role" value={user.role} />
                <Row label="Institute" value={user.institute?.name || "—"} />
                <Row label="Department" value={user.department || "—"} />
                <Row label="Designation" value={user.designation || "—"} />
                <Row label="Account Status" value={STATUS_LABEL[user.accountStatus]} />
                <Row label="Must change password on next login" value={user.mustChangePassword ? "Yes" : "No"} />
                <Row label="Account Created" value={new Date(user.createdAt).toLocaleString()} />
                <Row label="Last Login" value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"} />
              </div>
            )}

            {tab === "sessions" && (
              <div className="card" style={{ padding: 20, marginTop: 16 }}>
                {sessions === null && <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>}
                {sessions?.length === 0 && <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>No login history yet.</p>}
                <div style={{ display: "grid", gap: 8 }}>
                  {sessions?.map((s) => (
                    <div key={s.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12.5 }}>
                        <div><strong>{new Date(s.loginAt).toLocaleString()}</strong> {s.isActive ? <span className="badge" style={{ background: "var(--mint)", color: "#fff", marginLeft: 6 }}>Active</span> : ""}</div>
                        <div className="mono" style={{ color: "var(--ink-dim)", marginTop: 2 }}>
                          {s.browser} on {s.os} · {s.device} · {s.ip || "—"}
                          {" · "}{s.logoutAt ? `Signed out ${new Date(s.logoutAt).toLocaleString()}` : "Still active"}
                          {s.durationMs != null && ` · Duration: ${Math.round(s.durationMs / 60000)} min`}
                        </div>
                      </div>
                      {s.isActive && <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--rust)" }} onClick={() => forceLogout(s.id)}>Force Logout</button>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "activity" && (
              <div className="card" style={{ padding: 20, marginTop: 16 }}>
                {activity === null && <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>}
                {activity?.length === 0 && <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>No recorded activity yet.</p>}
                <div style={{ display: "grid", gap: 6 }}>
                  {activity?.map((a) => (
                    <div key={a.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600 }}>
                        <span>{a.action.replace(/_/g, " ")}</span>
                        <span className="mono" style={{ fontWeight: 400, color: "var(--ink-dim)" }}>{new Date(a.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-dim)", marginTop: 2 }}>
                        By {a.adminName} ({a.adminRole || "—"}) · IP {a.ipAddress || "—"} · {a.deviceInfo || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "permissions" && (
              <PermissionsTab userId={id} data={permissions} onChanged={() => { setPermissions(null); api.get(`/staff-clerk/${id}/permissions`).then((res) => setPermissions(res.data)); }} />
            )}
          </>
        )}
      </div>

      {showEdit && (
        <EditStaffClerkProfileModal userId={id} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); toast.success("Profile updated."); load(); }} />
      )}
      {showReset && (
        <ResetStaffPasswordModal userId={id} userName={user?.name} onClose={() => setShowReset(false)} onDone={load} />
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
      <span style={{ color: "var(--ink-dim)" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// Reuses the existing Attendance staff-assignment routes directly (no new backend), per the
// "Permission Overview follows the existing RBAC architecture" design decision — a Staff member's
// assigned classes ARE their permission scope on this platform. CLERK accounts never have any
// (attendance.js's own assignment route rejects non-STAFF), so this renders read-only for them.
function PermissionsTab({ userId, data, onChanged }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [institutes, setInstitutes] = useState([]);
  const [instituteId, setInstituteId] = useState("");
  const [groups, setGroups] = useState([]);
  const [academicGroupId, setAcademicGroupId] = useState("");
  const [semester, setSemester] = useState("");
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (data?.role !== "STAFF") return;
    api.get("/institutes").then((res) => setInstitutes(res.data)).catch(() => {});
  }, [data?.role]);

  useEffect(() => {
    if (data?.role !== "STAFF") return;
    const targetInstituteId = instituteId || data?.institute?.id;
    if (!targetInstituteId) { setGroups([]); return; }
    api.get("/academic-groups", { params: { instituteId: targetInstituteId } }).then((res) => setGroups(res.data)).catch(() => setGroups([]));
  }, [data?.role, data?.institute?.id, instituteId]);

  async function assign() {
    if (!academicGroupId || !semester.trim()) return;
    setAssigning(true);
    try {
      await api.post("/attendance/admin/staff-assignments", { staffId: userId, academicGroupId, semester: semester.trim() });
      toast.success("Assignment saved.");
      setAcademicGroupId(""); setSemester("");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save assignment");
    } finally {
      setAssigning(false);
    }
  }

  async function remove(assignmentId) {
    const ok = await confirmDialog({ title: "Remove Assignment", message: "Remove this class assignment?", confirmLabel: "Remove", danger: true });
    if (!ok) return;
    try {
      await api.delete(`/attendance/admin/staff-assignments/${assignmentId}`);
      toast.success("Assignment removed.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to remove assignment");
    }
  }

  if (!data) return <div className="card" style={{ padding: 20, marginTop: 16 }}><p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p></div>;

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <Row label="Role" value={data.role} />
      <Row label="Institute" value={data.institute?.name || "—"} />
      <Row label="Department" value={data.department || "—"} />

      {data.role !== "STAFF" ? (
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 12 }}>
          Clerk accounts are scoped by role and institute only — there is no per-class assignment concept for this role.
        </p>
      ) : (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 16, marginBottom: 8 }}>Class / Attendance Assignments</div>
          <div style={{ display: "grid", gap: 6 }}>
            {data.staffClassAssignments.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No assignments yet.</p>}
            {data.staffClassAssignments.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                <span>{a.groupLabel} — Semester {a.semester}</span>
                <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--rust)" }} onClick={() => remove(a.id)}>Remove</button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "flex-end" }}>
            {institutes.length > 0 && (
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--ink-dim)" }}>Institute</label>
                <select style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }} value={instituteId} onChange={(e) => setInstituteId(e.target.value)}>
                  <option value="">{data.institute?.name || "Select…"}</option>
                  {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--ink-dim)" }}>Academic Group</label>
              <select style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }} value={academicGroupId} onChange={(e) => setAcademicGroupId(e.target.value)}>
                <option value="">Select…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.department?.name} · {g.section} ({g.batch})</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--ink-dim)" }}>Semester</label>
              <input style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, width: 100 }} value={semester} onChange={(e) => setSemester(e.target.value)} placeholder="e.g. 5" />
            </div>
            <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={!academicGroupId || !semester.trim() || assigning} onClick={assign}>
              {assigning ? "Assigning…" : "Assign"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
