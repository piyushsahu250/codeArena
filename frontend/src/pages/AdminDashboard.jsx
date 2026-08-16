import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { Building2, Upload, PlusCircle, Users as UsersIcon, BarChart3, FileText, Mic, Settings, Trophy, Mail } from "lucide-react";
import api from "../api";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { SkeletonGrid, SkeletonCard } from "../components/Skeleton";

const ROLES = ["STUDENT", "STAFF", "ADMIN", "CLERK"];
const emptyForm = {
  name: "", email: "", role: "STUDENT", instituteId: "",
  rollNumber: "", registrationNumber: "", department: "", mobile: "", gender: "",
  program: "", batchYear: "", section: "",
};

export default function AdminDashboard() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [users, setUsers] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [stats, setStats] = useState(null);
  const [tests, setTests] = useState(null);
  const [gamiStats, setGamiStats] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdCredential, setCreatedCredential] = useState(null);
  const [resending, setResending] = useState(false);
  const [copied, setCopied] = useState(false);

  const [rollQuery, setRollQuery] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  // Cross-role account search (PRN/Employee ID/Name/Email/Mobile) — separate from the plain
  // `users` list above (which stays as-is, still feeding the create-form's Batch/Department/
  // Section autocomplete). When a search is active, the account list below renders these
  // DB-paginated results instead of the full unfiltered list.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRole, setSearchRole] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searching, setSearching] = useState(false);

  function runSearch(page) {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setSearching(true);
    api.get("/users/search", { params: { q: searchQuery.trim(), role: searchRole || undefined, page, pageSize: 20 } })
      .then((res) => {
        setSearchResults(res.data.rows);
        setSearchTotalPages(res.data.totalPages);
        setSearchTotal(res.data.total);
      })
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false));
  }

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    const t = setTimeout(() => runSearch(searchPage), 300);
    return () => clearTimeout(t);
  }, [searchQuery, searchRole, searchPage]);

  useEffect(() => { setSearchPage(1); }, [searchQuery, searchRole]);

  function load() {
    api.get("/users", { params: { pageSize: 500 } }).then((res) => setUsers(res.data.rows));
    api.get("/admin/stats").then((res) => setStats(res.data));
  }

  useEffect(() => {
    load();
    api.get("/institutes").then((res) => setInstitutes(res.data));
    api.get("/tests").then((res) => setTests(res.data)).catch(() => setTests([]));
    api.get("/gamification/admin/stats").then((res) => setGamiStats(res.data)).catch(() => setGamiStats({ topStudents: [] }));
  }, []);

  function updateField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  // Autocomplete options for Batch/Department/Section, derived from students already loaded for
  // the selected institute (covers both legacy free-text fields and the new academicGroup, so
  // suggestions work regardless of when a student was created) — no dedicated endpoint needed.
  const instituteStudents = users.filter((u) => u.role === "STUDENT" && u.institute?.id === form.instituteId);
  const batchOptions = [...new Set(instituteStudents.map((u) => u.academicGroup?.batch || u.batchYear).filter(Boolean))];
  const departmentOptions = [...new Set(instituteStudents.map((u) => u.academicGroup?.department?.name || u.department).filter(Boolean))];
  const sectionOptions = [...new Set(instituteStudents.map((u) => u.academicGroup?.section || u.section).filter(Boolean))];

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setCreatedCredential(null);
    setCopied(false);
    if (!form.instituteId) return setError("Please choose an institute");
    if (form.role === "STUDENT" && !form.mobile.trim()) return setError("Mobile number is required for students");
    if (form.role === "STUDENT" && !form.batchYear.trim()) return setError("Batch is required for students");
    setSaving(true);
    try {
      const { data } = await api.post("/users", form);
      setCreatedCredential({ id: data.id, name: data.name, email: data.email, password: data.generatedPassword, emailSent: data.emailSent, emailError: data.emailError });
      setForm({ ...emptyForm, instituteId: form.instituteId, role: form.role });
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  async function resendWelcomeEmail() {
    if (!createdCredential) return;
    setResending(true);
    try {
      const { data } = await api.post(`/users/${createdCredential.id}/reset-password`, { sendEmail: true });
      setCreatedCredential({ ...createdCredential, password: data.defaultPassword, emailSent: data.emailSent, emailError: data.emailError });
      toast[data.emailSent ? "success" : "error"](data.emailSent ? "Welcome email resent." : `Email could not be delivered: ${data.emailError || "Unknown error"}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to resend email");
    } finally {
      setResending(false);
    }
  }

  function copyCredentials() {
    if (!createdCredential) return;
    const text = `Email: ${createdCredential.email}\nPassword: ${createdCredential.password}\nLogin: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleDelete(id, name) {
    const ok = await confirmDialog({
      title: "Delete account?",
      message: "Are you sure you want to delete this user? This action cannot be undone. If the account contains academic records, it is recommended to deactivate the account instead.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/users/${id}`);
      load();
      refreshSearch();
      toast.success("Account deleted successfully.");
    } catch (err) {
      if (err.response?.status === 409) {
        const deactivateInstead = await confirmDialog({
          title: "Can't permanently delete",
          message: `${err.response.data?.error || "This account has related records and can't be permanently deleted."} Deactivate it instead?`,
          confirmLabel: "Deactivate",
          danger: false,
        });
        if (deactivateInstead) {
          try {
            await api.patch(`/users/${id}`, { isActive: false });
            load();
            refreshSearch();
            toast.success(`${name}'s account has been deactivated.`);
          } catch (err2) {
            toast.error(err2.response?.data?.error || "Failed to deactivate account");
          }
        }
        return;
      }
      toast.error(err.response?.data?.error || "Failed to delete account");
    }
  }

  function refreshSearch() {
    if (searchQuery.trim()) runSearch(searchPage);
  }

  async function handleResetPassword(u) {
    try {
      const { data } = await api.post(`/users/${u.id}/reset-password`);
      toast.success(`Password reset for ${u.name} to "${data.defaultPassword}". They'll be asked to set a new one on next login.`, 6000);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reset password");
    }
  }

  async function handleRollLookup(e) {
    e.preventDefault();
    if (!rollQuery.trim()) return;
    setLookingUp(true);
    setLookupError("");
    setLookupResult(null);
    try {
      const { data } = await api.get(`/users/lookup/${encodeURIComponent(rollQuery.trim())}`);
      setLookupResult(data);
    } catch (err) {
      setLookupError(err.response?.data?.error || "Lookup failed");
    } finally {
      setLookingUp(false);
    }
  }

  async function handleAllowReattempt(a) {
    const ok = await confirmDialog({ title: "Allow reattempt?", message: "This resets the student's previous attempt for this test. This action cannot be undone.", confirmLabel: "Allow Reattempt", danger: true });
    if (!ok) return;
    try {
      await api.post(`/tests/${a.test.id}/attempts/${lookupResult.id}/reattempt`);
      toast.success("Reattempt has been enabled successfully for this student.");
      const { data } = await api.get(`/users/lookup/${encodeURIComponent(rollQuery.trim())}`);
      setLookupResult(data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to enable reattempt");
    }
  }

  return (
    <div>
      <Navbar />
      <div className="page-container" style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1>Admin control room</h1>
            <ChalkUnderline />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link to="/admin/institutes" className="btn btn-ghost"><Building2 size={15} /> Create Institute</Link>
            <Link to="/admin/bulk-upload" className="btn btn-primary"><Upload size={15} /> Bulk Student Upload</Link>
            <Link to="/staff/tests/new" className="btn btn-ghost"><PlusCircle size={15} /> Create Test</Link>
            <Link to="/admin/students" className="btn btn-ghost"><UsersIcon size={15} /> Student Performance</Link>
            <Link to="/admin/email-logs" className="btn btn-ghost"><Mail size={15} /> Email Logs</Link>
            <Link to="/staff/resumes" className="btn btn-ghost"><FileText size={15} /> Resume Analytics</Link>
            <Link to="/staff/interviews" className="btn btn-ghost"><Mic size={15} /> Mock Interviews</Link>
            <Link to="/staff/gamification" className="btn btn-ghost"><Trophy size={15} /> Gamification</Link>
            <Link to="/account" className="btn btn-ghost"><Settings size={15} /> Platform Settings</Link>
          </div>
        </div>

        {stats === null ? (
          <div style={{ marginTop: 28 }}><SkeletonGrid count={10} minWidth={130} /></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginTop: 28 }}>
            <StatCard label="Institutes" value={stats.totalInstitutes} />
            <StatCard label="Academic Groups" value={stats.totalAcademicGroups} />
            <StatCard label="Students" value={stats.totalStudents} />
            <StatCard label="Staff" value={stats.totalStaff} />
            <StatCard label="Learning Modules" value={stats.totalCourses} />
            <StatCard label="Coding Problems" value={stats.totalPracticeQuestions} />
            <StatCard label="Certificates Issued" value={stats.certificatesIssued} accent="var(--amber-dark)" />
            <StatCard label="Active Tests" value={stats.activeTests} accent="var(--mint)" />
            <StatCard label="Scheduled Tests" value={stats.scheduledTests} accent="var(--amber-dark)" />
            <StatCard label="Completed Tests" value={stats.completedTests} accent="var(--ink-dim)" />
          </div>
        )}

        {stats && stats.studentsUnlinkedFromAcademicGroup > 0 && (
          <div className="card" style={{ padding: 14, marginTop: 16, borderLeft: "3px solid var(--rust)" }}>
            <p style={{ fontSize: 13, color: "var(--rust)", fontWeight: 600 }}>
              {stats.studentsUnlinkedFromAcademicGroup} student{stats.studentsUnlinkedFromAcademicGroup === 1 ? "" : "s"} still {stats.studentsUnlinkedFromAcademicGroup === 1 ? "has" : "have"} a class but no academic group.
            </p>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
              The Institute/Batch/Department/Section migration hasn't finished for everyone yet — this should reach 0 shortly after deploy.
            </p>
          </div>
        )}

        {/* Platform analytics — built entirely from real, currently-tracked data. Daily/Monthly
            Active User trend charts from the spec are intentionally omitted: this platform has no
            login/session event log to derive them from honestly, and fabricating a plausible-looking
            trend line would be worse than not showing one. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginTop: 24 }}>
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Test Status Distribution</h3>
            <div className="card" style={{ padding: 20, height: 220 }}>
              {tests === null ? (
                <SkeletonCard height={220} />
              ) : tests.length === 0 ? (
                <p style={{ color: "var(--ink-dim)", fontSize: 13, textAlign: "center", paddingTop: 60 }}>No tests yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={adminTestStatusData(tests)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="var(--amber)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Top Students Platform-wide (XP)</h3>
            <div className="card" style={{ padding: 20, height: 220, overflowY: "auto" }}>
              {gamiStats === null ? (
                <SkeletonCard height={220} />
              ) : gamiStats.topStudents.length === 0 ? (
                <p style={{ color: "var(--ink-dim)", fontSize: 13, textAlign: "center", paddingTop: 60 }}>Not enough activity yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {gamiStats.topStudents.slice(0, 6).map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span>#{i + 1} {s.name}</span>
                      <span className="mono" style={{ color: "var(--mint)", fontWeight: 700 }}>{s.xp} XP</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 24, marginTop: 32 }}>
          <h3 style={{ fontSize: 16, marginBottom: 4 }}>Check test completion by roll number, email, or student ID</h3>
          <p style={{ fontSize: 13, color: "var(--ink-dim)", marginBottom: 16 }}>
            Look up a student to see every test they've started, finished, or not touched yet — and grant an
            individual reattempt if needed.
          </p>
          <form onSubmit={handleRollLookup} style={{ display: "flex", gap: 10 }}>
            <input
              style={{ ...inputStyle, marginTop: 0 }}
              placeholder="Registration number (PRN), roll number, email, or student ID"
              value={rollQuery}
              onChange={(e) => setRollQuery(e.target.value)}
            />
            <button className="btn btn-primary" disabled={lookingUp}>
              {lookingUp ? "Searching…" : "Search"}
            </button>
          </form>

          {lookupError && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{lookupError}</p>}

          {lookupResult && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{lookupResult.rollNumber || "—"} · {lookupResult.name} <span className="mono" style={{ fontWeight: 400, color: "var(--ink-dim)", fontSize: 13 }}>({lookupResult.registrationNumber || "PRN not set"}) · {lookupResult.email}</span></div>
                <Link
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  to={`/admin/students?q=${encodeURIComponent(lookupResult.registrationNumber || lookupResult.email)}`}
                >
                  Edit Profile →
                </Link>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {lookupResult.attempts.map((a, idx) => (
                  <div key={idx} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{a.test.title}</div>
                      <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                        {a.status === "IN_PROGRESS"
                          ? `started ${new Date(a.startedAt).toLocaleString()}`
                          : `submitted ${new Date(a.submittedAt).toLocaleString()}`}
                        {a.tabSwitchCount > 0 && ` · ${a.tabSwitchCount} tab switch${a.tabSwitchCount > 1 ? "es" : ""}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {a.status !== "IN_PROGRESS" && (
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => handleAllowReattempt(a)}>
                          Allow Reattempt
                        </button>
                      )}
                      <div style={{ textAlign: "right" }}>
                        <span
                          className="mono"
                          style={{
                            fontWeight: 700,
                            color: a.status === "IN_PROGRESS" ? "var(--amber-dark)" : "var(--mint)",
                          }}
                        >
                          {a.status === "IN_PROGRESS" ? "Not completed" : "Completed"}
                        </span>
                        <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{a.totalScore} pts</div>
                      </div>
                    </div>
                  </div>
                ))}
                {lookupResult.attempts.length === 0 && (
                  <div className="card" style={{ padding: 16, textAlign: "center", color: "var(--ink-dim)", fontSize: 13 }}>
                    This student hasn't started any test yet.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 32, marginTop: 32, alignItems: "start" }}>
          <form onSubmit={handleCreate} className="card" style={{ padding: 24, maxWidth: 520 }}>
            <h3 style={{ fontSize: 16, marginBottom: 16 }}>Create account</h3>

            {institutes.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
                <Link to="/admin/institutes">Add an institute first</Link> before creating accounts.
              </p>
            ) : (
              <>
                <label style={labelStyle}>Full name</label>
                <input style={inputStyle} required value={form.name} onChange={updateField("name")} />

                <label style={labelStyle}>Email</label>
                <input style={inputStyle} type="email" required value={form.email} onChange={updateField("email")} />

                <label style={labelStyle}>Role</label>
                <select style={inputStyle} value={form.role} onChange={updateField("role")}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>

                <label style={labelStyle}>Institute</label>
                <select style={inputStyle} required value={form.instituteId} onChange={updateField("instituteId")}>
                  <option value="">Select institute…</option>
                  {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>

                {form.role === "STUDENT" && (
                  <>
                    <label style={labelStyle}>Registration number (PRN)</label>
                    <input style={inputStyle} required maxLength={12} value={form.registrationNumber} onChange={updateField("registrationNumber")} placeholder="9-12 alphanumeric characters" />

                    <label style={labelStyle}>Roll number (optional)</label>
                    <input style={inputStyle} maxLength={3} value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value.slice(0, 3) })} placeholder="Auto-filled from PRN's last 3 characters if left blank" />

                    <label style={labelStyle}>Mobile number</label>
                    <input style={inputStyle} required value={form.mobile} onChange={updateField("mobile")} placeholder="9876543210" />

                    <label style={labelStyle}>Gender (optional)</label>
                    <select style={inputStyle} value={form.gender} onChange={updateField("gender")}>
                      <option value="">— Not specified —</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>

                    <label style={labelStyle}>Course (optional)</label>
                    <input style={inputStyle} value={form.program} onChange={updateField("program")} placeholder="e.g. MCA" />

                    <label style={labelStyle}>Batch</label>
                    <input
                      style={inputStyle}
                      required
                      list="batch-options"
                      value={form.batchYear}
                      onChange={updateField("batchYear")}
                      placeholder="e.g. 2025–2027"
                    />
                    <datalist id="batch-options">
                      {batchOptions.map((b) => <option key={b} value={b} />)}
                    </datalist>
                    <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
                      Pick an existing batch or type a new one. Together with Department and Section below, this
                      places the student into an academic group — auto-created if it's new, reused if it exists.
                    </p>

                    <label style={labelStyle}>Section (optional)</label>
                    <input style={inputStyle} list="section-options" value={form.section} onChange={updateField("section")} placeholder="Defaults to Section A" />
                    <datalist id="section-options">
                      {sectionOptions.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </>
                )}

                <label style={labelStyle}>Department</label>
                <input style={inputStyle} list="department-options" value={form.department} onChange={updateField("department")} placeholder={form.role === "STUDENT" ? "Defaults to Unassigned" : undefined} />
                <datalist id="department-options">
                  {departmentOptions.map((d) => <option key={d} value={d} />)}
                </datalist>

                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 12 }}>
                  A unique, randomly generated password is created automatically for this account — never a shared or predictable one. The account must change it on first login.
                </p>

                {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{error}</p>}

                {createdCredential && (
                  <div className="card" style={{ padding: 12, marginTop: 12, background: "var(--mint-bg, rgba(76,175,80,0.08))" }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Student Account Created Successfully</div>
                    <div className="mono" style={{ fontSize: 12, marginTop: 4 }}>
                      {createdCredential.email} — password: <strong>{createdCredential.password}</strong>
                    </div>
                    {createdCredential.emailSent === true && (
                      <p style={{ fontSize: 12, color: "var(--mint)", marginTop: 6, fontWeight: 600 }}>✓ Welcome email sent successfully.</p>
                    )}
                    {createdCredential.emailSent === false && (
                      <div style={{ marginTop: 6 }}>
                        <p style={{ fontSize: 12, color: "var(--rust)", fontWeight: 600 }}>✗ Welcome email could not be sent.</p>
                        <p className="mono" style={{ fontSize: 11, color: "var(--rust)", marginTop: 2 }}>Reason: {createdCredential.emailError || "Unknown error"}</p>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={copyCredentials}>
                        {copied ? "✓ Copied" : "Copy Login Credentials"}
                      </button>
                      {createdCredential.emailSent === false && (
                        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={resendWelcomeEmail} disabled={resending}>
                          {resending ? "Resending…" : "✉ Resend Welcome Email"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <button className="btn btn-primary" style={{ width: "100%", marginTop: 18 }} disabled={saving}>
                  {saving ? "Creating…" : "Create account"}
                </button>
              </>
            )}
          </form>

          <div>
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>All accounts</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <input
                style={{ ...inputStyle, flex: "1 1 220px" }}
                placeholder="Search by PRN / Employee ID / Name / Email / Mobile…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select style={{ ...inputStyle, width: 140 }} value={searchRole} onChange={(e) => setSearchRole(e.target.value)}>
                <option value="">All roles</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {searchQuery.trim() && (
                <button type="button" className="btn btn-ghost" onClick={() => { setSearchQuery(""); setSearchRole(""); }}>
                  Clear
                </button>
              )}
            </div>

            {searchQuery.trim() ? (
              <>
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 10 }}>
                  {searching ? "Searching…" : `${searchTotal} result${searchTotal === 1 ? "" : "s"}`}
                </p>
                <div style={{ display: "grid", gap: 10 }}>
                  {(searchResults || []).map((u) => (
                    <UserRow key={u.id} u={u} onResetPassword={handleResetPassword} onDelete={handleDelete} />
                  ))}
                </div>
                {searchTotalPages > 1 && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 16 }}>
                    <button className="btn btn-ghost" disabled={searchPage <= 1} onClick={() => setSearchPage((p) => p - 1)}>Prev</button>
                    <span style={{ fontSize: 13 }}>Page {searchPage} of {searchTotalPages}</span>
                    <button className="btn btn-ghost" disabled={searchPage >= searchTotalPages} onClick={() => setSearchPage((p) => p + 1)}>Next</button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {users.map((u) => (
                  <UserRow key={u.id} u={u} onResetPassword={handleResetPassword} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserRow({ u, onResetPassword, onDelete }) {
  return (
    <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{u.email}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
          {u.institute?.name || "—"}
          {u.academicGroup ? ` · ${u.academicGroup.department?.name} · ${u.academicGroup.section} (${u.academicGroup.batch})` : (u.class?.name ? ` · ${u.class.name}${u.class.batchYear ? ` (${u.class.batchYear})` : ""}` : "")}
          {(u.registrationNumber || u.employeeId) ? ` · ${u.registrationNumber ? `PRN ${u.registrationNumber}` : `ID ${u.employeeId}`}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {u.isActive === false && <span className="badge" style={{ background: "var(--rust)", color: "#fff" }}>Inactive</span>}
        <span className="badge">{u.role}</span>
        {u.role === "STUDENT" && (
          <button
            onClick={() => onResetPassword(u)}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            Reset password
          </button>
        )}
        <button
          onClick={() => onDelete(u.id, u.name)}
          style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: accent || "var(--ink)" }}>{value ?? "—"}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function adminTestStatusData(tests) {
  const now = new Date();
  const counts = { Draft: 0, Scheduled: 0, Active: 0, Completed: 0 };
  for (const t of tests) {
    const start = new Date(t.startTime), end = new Date(t.endTime);
    const label = !t.isPublished ? "Draft" : now < start ? "Scheduled" : now > end ? "Completed" : "Active";
    counts[label]++;
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count }));
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
