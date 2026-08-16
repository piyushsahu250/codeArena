import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import EditStudentProfileModal from "../components/EditStudentProfileModal";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

// Search term, browse filters, and the last fetched result set are persisted to sessionStorage
// (keyed per basePath, so Admin/Staff/Clerk never leak into each other) so that navigating into a
// student's profile — e.g. to verify a document/certificate — and then hitting Back restores
// exactly where the admin/staff/clerk left off, instead of resetting every filter and forcing a
// re-fetch for each student they check. sessionStorage (not localStorage) so this naturally clears
// when the tab closes rather than persisting indefinitely.
const PERSIST_PREFIX = "studentSearchState:";

function loadPersisted(basePath) {
  try {
    const raw = sessionStorage.getItem(PERSIST_PREFIX + basePath);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function downloadCsv(filename, headers, rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Shared by /admin/students and /staff/students — basePath controls where a result's
// profile link points, since Admin and Staff sit under different route prefixes.
export default function StudentSearch({ basePath }) {
  const confirmDialog = useConfirm();
  const toast = useToast();
  const { user } = useAuth();
  const canRegenerate = user?.role === "ADMIN"; // matches the backend's ADMIN-only bulk-regenerate-password route
  const canEditProfile = user?.role === "ADMIN"; // matches the backend's ADMIN-only PATCH /users/:id
  const persisted = loadPersisted(basePath);
  const [q, setQ] = useState(persisted.q || "");
  const [results, setResults] = useState(persisted.results ?? null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState([]);
  const [regenerating, setRegenerating] = useState(false);
  const [emailCredentials, setEmailCredentials] = useState(true);
  const [editingStudentId, setEditingStudentId] = useState(null);

  // Hierarchical browse — Institute -> Department -> Section — as an alternative to typing a
  // search term, for pulling up an entire section's roster at once instead of one student at a
  // time. Admin picks an institute explicitly; Staff has none to pick (their own institute is
  // applied server-side automatically, same scoping the search box above already relies on), so
  // the picker only renders for Admin.
  const [institutes, setInstitutes] = useState([]);
  const [browseInstituteId, setBrowseInstituteId] = useState(persisted.browseInstituteId || "");
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState("");
  const [browseDepartmentId, setBrowseDepartmentId] = useState(persisted.browseDepartmentId || "");
  const [browseSection, setBrowseSection] = useState(persisted.browseSection || "");
  const [browsing, setBrowsing] = useState(false);
  const [browseBatch, setBrowseBatch] = useState(persisted.browseBatch || "");
  const [browsePlacementParticipation, setBrowsePlacementParticipation] = useState(persisted.browsePlacementParticipation || "");
  const [browseVerificationStatus, setBrowseVerificationStatus] = useState(persisted.browseVerificationStatus || "");
  const [browseDocumentType, setBrowseDocumentType] = useState(persisted.browseDocumentType || "");
  const [browseDocumentStatus, setBrowseDocumentStatus] = useState(persisted.browseDocumentStatus || "");
  const [docTypes, setDocTypes] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [browsePageMeta, setBrowsePageMeta] = useState(persisted.browsePageMeta || { page: 1, totalPages: 1, total: 0 });
  const [lastMode, setLastMode] = useState(persisted.lastMode || null); // "search" | "browse" — controls whether Prev/Next renders
  const [searchParams] = useSearchParams();

  // Deep-link support — e.g. the Admin Dashboard's "Check test completion" lookup box links here
  // with ?q=<registrationNumber> so a PRN search can lead straight into Edit Profile, without a
  // second copy of the search box or a duplicate results view.
  useEffect(() => {
    const initialQ = searchParams.get("q");
    if (initialQ) {
      setQ(initialQ);
      handleSearch(null, initialQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user?.role === "ADMIN") api.get("/institutes").then((res) => setInstitutes(res.data)).catch(() => {});
  }, [user?.role]);

  useEffect(() => {
    api.get("/documents/types").then((res) => setDocTypes(res.data)).catch(() => setDocTypes([]));
  }, []);

  function loadGroups() {
    if (user?.role === "ADMIN" && !browseInstituteId) {
      setGroups([]);
      setGroupsError("");
      return;
    }
    setGroupsLoading(true);
    setGroupsError("");
    api
      .get("/academic-groups", user?.role === "ADMIN" ? { params: { instituteId: browseInstituteId } } : {})
      .then((res) => setGroups(res.data))
      .catch((err) => {
        setGroups([]);
        setGroupsError(err.response?.data?.error || "Failed to load departments/sections. Try again.");
      })
      .finally(() => setGroupsLoading(false));
  }

  // Loads the academic-group list for whichever institute is in scope — explicitly for Admin
  // (only once one is picked), immediately for Staff/Clerk (the backend scopes it to their own
  // institute regardless of what's passed, so no instituteId param is needed at all).
  useEffect(loadGroups, [user?.role, browseInstituteId]);

  const departments = [...new Map(groups.map((g) => [g.department.id, g.department])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const sections = [...new Set(groups.filter((g) => g.department.id === browseDepartmentId).map((g) => g.section))].sort();
  const batches = [...new Set(groups.filter((g) => g.department.id === browseDepartmentId).map((g) => g.batch))].filter(Boolean).sort();

  // Keeps the sessionStorage snapshot in sync with every filter/result change (see loadPersisted
  // above) — so Back from a student's profile lands here with the same search/filters/results
  // still showing, instead of resetting and forcing a re-fetch for every student checked.
  useEffect(() => {
    try {
      sessionStorage.setItem(PERSIST_PREFIX + basePath, JSON.stringify({
        q, results, lastMode, browseInstituteId, browseDepartmentId, browseSection, browseBatch,
        browsePlacementParticipation, browseVerificationStatus, browseDocumentType, browseDocumentStatus, browsePageMeta,
      }));
    } catch {}
  }, [
    basePath, q, results, lastMode, browseInstituteId, browseDepartmentId, browseSection, browseBatch,
    browsePlacementParticipation, browseVerificationStatus, browseDocumentType, browseDocumentStatus, browsePageMeta,
  ]);

  async function handleSearch(e, termOverride) {
    e?.preventDefault?.();
    const term = (termOverride ?? q).trim();
    if (!term) return;
    setSearching(true);
    setError("");
    setSelected([]);
    try {
      const { data } = await api.get("/users/search", {
        params: {
          q: term, role: "STUDENT",
          documentType: browseDocumentType || undefined, documentVerificationStatus: browseDocumentStatus || undefined,
        },
      });
      setResults(data.rows);
      setLastMode("search");
    } catch (err) {
      setError(err.response?.data?.error || "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function handleFetch(page = 1) {
    if (!browseDepartmentId || !browseSection) return;
    setBrowsing(true);
    setError("");
    setSelected([]);
    try {
      const { data } = await api.get("/users/browse", {
        params: {
          instituteId: browseInstituteId || undefined, departmentId: browseDepartmentId, section: browseSection,
          batch: browseBatch || undefined, placementParticipation: browsePlacementParticipation || undefined,
          offerVerificationStatus: browseVerificationStatus || undefined,
          documentType: browseDocumentType || undefined, documentVerificationStatus: browseDocumentStatus || undefined,
          page, pageSize: 50,
        },
      });
      setResults(data.rows);
      setBrowsePageMeta({ page: data.page, totalPages: data.totalPages, total: data.total });
      setLastMode("browse");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load students");
    } finally {
      setBrowsing(false);
    }
  }

  // Reuses the generic Export Center's "students" entity (already the only one CLERK can reach)
  // with the same filters as the browse panel above, rather than building a separate export path.
  async function exportFiltered() {
    setExporting(true);
    try {
      const { data } = await api.get("/export/students", {
        params: {
          departmentId: browseDepartmentId || undefined, batch: browseBatch || undefined,
          placementParticipation: browsePlacementParticipation || undefined, offerVerificationStatus: browseVerificationStatus || undefined,
          format: "xlsx",
        },
        responseType: "blob",
      });
      const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "students-export.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.error || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAll() {
    setSelected((prev) => (prev.length === results.length ? [] : results.map((s) => s.id)));
  }

  // Regenerates a fresh, unique random password per selected student (never a shared fixed
  // value — see the note on generateTempPassword) and immediately offers the results as a CSV
  // download, since these plaintext passwords are never stored anywhere and this is the only
  // moment they're ever visible.
  async function regeneratePasswords() {
    const ok = await confirmDialog({
      title: `Regenerate ${selected.length} password${selected.length === 1 ? "" : "s"}?`,
      message: `Each selected student gets a new, unique temporary password and will be asked to set their own on next login.${emailCredentials ? " Each student will also be emailed their new password directly." : ""} This action cannot be undone.`,
      confirmLabel: "Regenerate",
      danger: true,
    });
    if (!ok) return;
    setRegenerating(true);
    try {
      const { data } = await api.post("/users/bulk-regenerate-password", { studentIds: selected, sendEmail: emailCredentials });
      downloadCsv(
        "regenerated-passwords.csv",
        ["Name", "Email", "Roll Number", "New Temporary Password"],
        data.results.map((u) => [u.name, u.email, u.rollNumber, u.generatedPassword])
      );
      toast.success(
        `${data.results.length} password${data.results.length === 1 ? "" : "s"} regenerated — CSV downloaded${emailCredentials ? ` and ${data.emailsQueued} email${data.emailsQueued === 1 ? "" : "s"} queued for delivery` : ""}.`
      );
      setSelected([]);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to regenerate passwords");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Student performance dashboard</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Search for a student by Student ID, Roll Number, Name, or Official Email to view their
          overall performance across all tests.
        </p>

        <form onSubmit={handleSearch} className="card" style={{ padding: 16, marginTop: 20, display: "flex", gap: 10 }}>
          <input
            style={{ ...inputStyle, marginTop: 0, flex: 1 }}
            placeholder="Student ID, roll number, name, or official email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <button className="btn btn-primary" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {/* Hierarchical browse — an alternative to search for pulling up a whole section at once */}
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Or browse by Institute · Department · Section</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            {user?.role === "ADMIN" && (
              <div style={{ flex: "1 1 180px" }}>
                <label style={labelStyle}>Institute</label>
                <select
                  style={inputStyle}
                  value={browseInstituteId}
                  onChange={(e) => { setBrowseInstituteId(e.target.value); setBrowseDepartmentId(""); setBrowseSection(""); }}
                >
                  <option value="">Select institute…</option>
                  {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ flex: "1 1 180px" }}>
              <label style={labelStyle}>Department</label>
              <select
                style={inputStyle}
                value={browseDepartmentId}
                onChange={(e) => { setBrowseDepartmentId(e.target.value); setBrowseSection(""); }}
                disabled={(user?.role === "ADMIN" && !browseInstituteId) || groupsLoading || !!groupsError}
              >
                <option value="">
                  {groupsLoading ? "Loading departments…" : groupsError ? "Failed to load — see below" : departments.length === 0 ? "No departments found" : "Select department…"}
                </option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label style={labelStyle}>Division (Section)</label>
              <select style={inputStyle} value={browseSection} onChange={(e) => setBrowseSection(e.target.value)} disabled={!browseDepartmentId}>
                <option value="">Select section…</option>
                {sections.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>Batch</label>
              <select style={inputStyle} value={browseBatch} onChange={(e) => setBrowseBatch(e.target.value)} disabled={!browseDepartmentId}>
                <option value="">All batches</option>
                {batches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <label style={labelStyle}>Placement Registration</label>
              <select style={inputStyle} value={browsePlacementParticipation} onChange={(e) => setBrowsePlacementParticipation(e.target.value)}>
                <option value="">All students</option>
                <option value="INTERESTED">Registered</option>
                <option value="NOT_INTERESTED">Not Registered</option>
              </select>
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <label style={labelStyle}>Offer Verification</label>
              <select style={inputStyle} value={browseVerificationStatus} onChange={(e) => setBrowseVerificationStatus(e.target.value)}>
                <option value="">All students</option>
                <option value="VERIFIED">Has Verified Offer</option>
                <option value="PENDING">Has Pending Offer</option>
              </select>
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <label style={labelStyle}>Document Type</label>
              <select style={inputStyle} value={browseDocumentType} onChange={(e) => setBrowseDocumentType(e.target.value)}>
                <option value="">All document types</option>
                {docTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <label style={labelStyle}>Document Status</label>
              <select style={inputStyle} value={browseDocumentStatus} onChange={(e) => setBrowseDocumentStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="VERIFIED">Verified</option>
                <option value="REJECTED">Rejected</option>
                <option value="REUPLOAD_REQUIRED">Re-upload Required</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={() => handleFetch(1)} disabled={!browseDepartmentId || !browseSection || browsing}>
              {browsing ? "Fetching…" : "Fetch"}
            </button>
            <button className="btn btn-ghost" onClick={exportFiltered} disabled={exporting}>
              {exporting ? "Exporting…" : "Export to Excel"}
            </button>
          </div>
          {groupsError && (
            <p style={{ color: "var(--rust)", fontSize: 12.5, marginTop: 10 }}>
              {groupsError}{" "}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 8px", marginLeft: 4 }} onClick={loadGroups}>
                Retry
              </button>
            </p>
          )}
        </div>

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{error}</p>}

        {results && results.length > 0 && canRegenerate && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, flexWrap: "wrap", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={selected.length === results.length} onChange={toggleAll} />
              Select all ({selected.length} selected)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-dim)" }}>
                <input type="checkbox" checked={emailCredentials} onChange={(e) => setEmailCredentials(e.target.checked)} />
                ✉ Email new passwords to students
              </label>
              <button className="btn btn-ghost" style={{ color: "var(--rust)", borderColor: "var(--rust)" }} onClick={regeneratePasswords} disabled={selected.length === 0 || regenerating}>
                {regenerating ? "Regenerating…" : `Regenerate Passwords${selected.length ? ` (${selected.length})` : ""}`}
              </button>
            </div>
          </div>
        )}

        {results && (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {results.map((s) => (
              <div key={s.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                  {canRegenerate && <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />}
                  <Link to={`${basePath}/students/${s.id}`} style={{ textDecoration: "none", color: "inherit", flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}><span className="mono" style={{ fontWeight: 400, marginRight: 6 }}>{s.rollNumber || "—"}</span>{s.name}</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                      {s.registrationNumber || "—"} · {s.email}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
                      {s.institute?.name || "—"}
                      {s.academicGroup
                        ? ` · ${s.academicGroup.department?.name || "—"} - ${s.academicGroup.section}${s.academicGroup.batch ? ` (${s.academicGroup.batch})` : ""}`
                        : (s.class?.name ? ` · ${s.class.name}${s.class.batchYear ? ` (${s.class.batchYear})` : ""}` : "")}
                    </div>
                  </Link>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {canEditProfile && (
                    <button className="btn btn-ghost" onClick={() => setEditingStudentId(s.id)}>Edit Profile</button>
                  )}
                  <Link to={`${basePath}/students/${s.id}`} className="btn btn-ghost">View dashboard →</Link>
                </div>
              </div>
            ))}
            {results.length === 0 && (
              <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>
                No students found.
              </div>
            )}
          </div>
        )}

        {lastMode === "browse" && browsePageMeta.totalPages > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center", alignItems: "center" }}>
            <button className="btn btn-ghost" disabled={browsePageMeta.page <= 1 || browsing} onClick={() => handleFetch(browsePageMeta.page - 1)}>← Prev</button>
            <span className="mono" style={{ fontSize: 13 }}>Page {browsePageMeta.page} / {browsePageMeta.totalPages} ({browsePageMeta.total} total)</span>
            <button className="btn btn-ghost" disabled={browsePageMeta.page >= browsePageMeta.totalPages || browsing} onClick={() => handleFetch(browsePageMeta.page + 1)}>Next →</button>
          </div>
        )}
      </div>

      {editingStudentId && (
        <EditStudentProfileModal
          studentId={editingStudentId}
          onClose={() => setEditingStudentId(null)}
          onSaved={() => {
            setEditingStudentId(null);
            toast.success("Profile updated.");
            // Re-run whichever fetch produced the current list so the edited row reflects the
            // save immediately instead of showing stale data until the next search/fetch.
            if (q.trim()) handleSearch({ preventDefault() {} });
            else if (browseDepartmentId && browseSection) handleFetch(browsePageMeta.page);
          }}
        />
      )}
    </div>
  );
}

const inputStyle = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 };
