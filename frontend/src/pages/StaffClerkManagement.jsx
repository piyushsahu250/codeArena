import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { SkeletonGrid } from "../components/Skeleton";
import EditStaffClerkProfileModal from "../components/EditStaffClerkProfileModal";
import ResetStaffPasswordModal from "../components/ResetStaffPasswordModal";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

const STATUS_LABEL = { ACTIVE: "Active", INACTIVE: "Inactive", LOCKED: "Locked", SUSPENDED: "Suspended" };
const STATUS_COLOR = { ACTIVE: "var(--mint)", INACTIVE: "var(--ink-dim)", LOCKED: "var(--rust)", SUSPENDED: "var(--amber-dark)" };
// Every status a given current status can transition to, and the button label for each — mirrors
// the backend's TRANSITION_META (staffClerk.js), just with LOCKED->ACTIVE labeled "Unlock" here too.
const NEXT_STATUS_OPTIONS = {
  ACTIVE: [{ value: "INACTIVE", label: "Deactivate" }, { value: "LOCKED", label: "Lock" }, { value: "SUSPENDED", label: "Suspend" }],
  INACTIVE: [{ value: "ACTIVE", label: "Activate" }],
  LOCKED: [{ value: "ACTIVE", label: "Unlock" }, { value: "SUSPENDED", label: "Suspend" }],
  SUSPENDED: [{ value: "ACTIVE", label: "Reinstate" }],
};

const inputStyle = { padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
const labelStyle = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--ink-dim)", marginBottom: 4 };

export default function StaffClerkManagement() {
  const confirmDialog = useConfirm();
  const toast = useToast();

  const [overview, setOverview] = useState(null);
  const [institutes, setInstitutes] = useState([]);
  const [filters, setFilters] = useState({
    q: "", role: "", instituteId: "", department: "", designation: "", accountStatus: "", hasActiveSession: "",
    dateJoinedFrom: "", dateJoinedTo: "", lastLoginFrom: "", lastLoginTo: "",
  });
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(1);
  const [pageMeta, setPageMeta] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [resettingId, setResettingId] = useState(null);
  const [statusDraft, setStatusDraft] = useState({}); // userId -> chosen next status
  const [statusChangingId, setStatusChangingId] = useState(null);

  useEffect(() => {
    api.get("/institutes").then((res) => setInstitutes(res.data)).catch(() => {});
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadOverview() {
    api.get("/staff-clerk/overview").then((res) => setOverview(res.data)).catch(() => setOverview(null));
  }

  useEffect(() => {
    const t = setTimeout(() => loadRows(1), 300); // debounce so typing in the search box doesn't fire a request per keystroke
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function loadRows(targetPage) {
    setLoading(true);
    const params = { page: targetPage, pageSize: 25 };
    for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;
    api.get("/staff-clerk", { params })
      .then((res) => {
        setRows(res.data.rows);
        setPage(res.data.page);
        setPageMeta({ total: res.data.total, totalPages: res.data.totalPages });
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  function setFilter(key) {
    return (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  }

  async function changeStatus(user) {
    const nextStatus = statusDraft[user.id];
    if (!nextStatus) return;
    const option = NEXT_STATUS_OPTIONS[user.accountStatus]?.find((o) => o.value === nextStatus);
    const danger = nextStatus !== "ACTIVE";
    const ok = await confirmDialog({
      title: `${option?.label || "Change status"} — ${user.name}`,
      message: `Are you sure you want to ${(option?.label || "change the status of").toLowerCase()} this account?${danger ? " Any active sessions will be signed out immediately." : ""}`,
      confirmLabel: option?.label || "Confirm",
      danger,
    });
    if (!ok) return;
    setStatusChangingId(user.id);
    try {
      await api.patch(`/staff-clerk/${user.id}/status`, { status: nextStatus });
      toast.success(`${user.name}'s account was ${(option?.label || "updated").toLowerCase()}d.`);
      setStatusDraft((d) => ({ ...d, [user.id]: "" }));
      loadRows(page);
      loadOverview();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update account status");
    } finally {
      setStatusChangingId(null);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Staff &amp; Clerk Management</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Manage Staff and Clerk accounts, monitor activity, and perform password/account actions from one place.
        </p>

        {!overview ? (
          <div style={{ marginTop: 20 }}><SkeletonGrid count={8} minWidth={130} /></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginTop: 20 }}>
            <StatCard label="Total Staff" value={overview.totalStaff} />
            <StatCard label="Total Clerks" value={overview.totalClerk} />
            <StatCard label="Active" value={overview.active} accent="var(--mint)" />
            <StatCard label="Inactive" value={overview.inactive} accent="var(--ink-dim)" />
            <StatCard label="Locked" value={overview.locked} accent="var(--rust)" />
            <StatCard label="Suspended" value={overview.suspended} accent="var(--amber-dark)" />
            <StatCard label="Added (30d)" value={overview.recentlyAdded} />
            <StatCard label="Logged in now" value={overview.currentlyLoggedIn} accent="var(--mint)" />
            <StatCard label="Logged in (24h)" value={overview.loggedInLast24h} />
            <StatCard label="Password resets (30d)" value={overview.passwordResetRequests} />
          </div>
        )}

        {overview?.recentActivity?.length > 0 && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Recent Activity</div>
            <div style={{ display: "grid", gap: 6 }}>
              {overview.recentActivity.map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--ink-dim)" }}>
                  <span>{a.action.replace(/_/g, " ")} — by {a.adminName}</span>
                  <span className="mono">{new Date(a.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 16, marginTop: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <div>
              <label style={labelStyle}>Search (name / employee ID / email / mobile)</label>
              <input style={{ ...inputStyle, width: "100%" }} value={filters.q} onChange={setFilter("q")} placeholder="Search…" />
            </div>
            <div>
              <label style={labelStyle}>Role</label>
              <select style={{ ...inputStyle, width: "100%" }} value={filters.role} onChange={setFilter("role")}>
                <option value="">All (Staff + Institute Admin + Clerk)</option>
                <option value="STAFF">Staff</option>
                <option value="INSTITUTE_ADMIN">Institute Admin</option>
                <option value="CLERK">Clerk</option>
              </select>
            </div>
            {institutes.length > 0 && (
              <div>
                <label style={labelStyle}>Institute</label>
                <select style={{ ...inputStyle, width: "100%" }} value={filters.instituteId} onChange={setFilter("instituteId")}>
                  <option value="">All institutes</option>
                  {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Department</label>
              <input style={{ ...inputStyle, width: "100%" }} value={filters.department} onChange={setFilter("department")} />
            </div>
            <div>
              <label style={labelStyle}>Designation</label>
              <input style={{ ...inputStyle, width: "100%" }} value={filters.designation} onChange={setFilter("designation")} />
            </div>
            <div>
              <label style={labelStyle}>Account Status</label>
              <select style={{ ...inputStyle, width: "100%" }} value={filters.accountStatus} onChange={setFilter("accountStatus")}>
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Active Session</label>
              <select style={{ ...inputStyle, width: "100%" }} value={filters.hasActiveSession} onChange={setFilter("hasActiveSession")}>
                <option value="">Any</option>
                <option value="true">Currently logged in</option>
                <option value="false">Not logged in</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Date Joined From</label>
              <input style={{ ...inputStyle, width: "100%" }} type="date" value={filters.dateJoinedFrom} onChange={setFilter("dateJoinedFrom")} />
            </div>
            <div>
              <label style={labelStyle}>Date Joined To</label>
              <input style={{ ...inputStyle, width: "100%" }} type="date" value={filters.dateJoinedTo} onChange={setFilter("dateJoinedTo")} />
            </div>
            <div>
              <label style={labelStyle}>Last Login From</label>
              <input style={{ ...inputStyle, width: "100%" }} type="date" value={filters.lastLoginFrom} onChange={setFilter("lastLoginFrom")} />
            </div>
            <div>
              <label style={labelStyle}>Last Login To</label>
              <input style={{ ...inputStyle, width: "100%" }} type="date" value={filters.lastLoginTo} onChange={setFilter("lastLoginTo")} />
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {loading && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>}
          {!loading && rows?.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No accounts match these filters.</div>
          )}
          {rows?.map((u) => (
            <div key={u.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                {u.profilePhotoUrl ? (
                  <img src={u.profilePhotoUrl} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--line)", flexShrink: 0 }} />
                )}
                <Link to={`/admin/staff-clerk/${u.id}`} style={{ textDecoration: "none", color: "inherit", flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {u.name} <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>{u.role}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                    {u.employeeId || "—"} · {u.email} · {u.mobile || "—"}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
                    {u.institute?.name || "—"}{u.department ? ` · ${u.department}` : ""}{u.designation ? ` · ${u.designation}` : ""}
                    {" · Last login: "}{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                  </div>
                </Link>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="badge" style={{ background: STATUS_COLOR[u.accountStatus], color: "#fff", fontWeight: 700 }}>
                  {STATUS_LABEL[u.accountStatus]}
                </span>
                <select
                  style={{ ...inputStyle, fontSize: 12 }}
                  value={statusDraft[u.id] || ""}
                  onChange={(e) => setStatusDraft((d) => ({ ...d, [u.id]: e.target.value }))}
                >
                  <option value="">Change status…</option>
                  {(NEXT_STATUS_OPTIONS[u.accountStatus] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={!statusDraft[u.id] || statusChangingId === u.id} onClick={() => changeStatus(u)}>
                  {statusChangingId === u.id ? "…" : "Apply"}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setResettingId(u.id)}>Reset Password</button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditingId(u.id)}>Edit</button>
                <Link to={`/admin/staff-clerk/${u.id}`} className="btn btn-ghost" style={{ fontSize: 12 }}>View →</Link>
              </div>
            </div>
          ))}
        </div>

        {pageMeta.totalPages > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center", alignItems: "center" }}>
            <button className="btn btn-ghost" disabled={page <= 1 || loading} onClick={() => loadRows(page - 1)}>← Prev</button>
            <span className="mono" style={{ fontSize: 13 }}>Page {page} / {pageMeta.totalPages} ({pageMeta.total} total)</span>
            <button className="btn btn-ghost" disabled={page >= pageMeta.totalPages || loading} onClick={() => loadRows(page + 1)}>Next →</button>
          </div>
        )}
      </div>

      {editingId && (
        <EditStaffClerkProfileModal
          userId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); toast.success("Profile updated."); loadRows(page); }}
        />
      )}
      {resettingId && (
        <ResetStaffPasswordModal
          userId={resettingId}
          userName={rows?.find((r) => r.id === resettingId)?.name}
          onClose={() => setResettingId(null)}
          onDone={loadOverview}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 10.5, color: "var(--ink-dim)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: accent || "inherit" }}>{value}</div>
    </div>
  );
}
