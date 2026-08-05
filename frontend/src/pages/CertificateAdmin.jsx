import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

const TYPE_LABEL = { LEARNING_MODULE: "Learning Module", CODING_ASSESSMENT: "Coding Assessment", MANUAL: "Manual" };

// Renders at /admin/certificates and /staff/certificates (basePath controls the back link).
// Manual issuance is for activities with no underlying data model on this platform — workshops,
// FDP, bootcamps, placement-prep programs, institute certifications — an admin/staff member just
// types the program name and picks the student. LEARNING_MODULE/CODING_ASSESSMENT certificates
// are system-issued automatically and only show up here for browsing/revocation.
export default function CertificateAdmin({ basePath }) {
  const [certs, setCerts] = useState(null);
  const [typeFilter, setTypeFilter] = useState("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [programName, setProgramName] = useState("");
  const [title, setTitle] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [revokingId, setRevokingId] = useState(null);
  const confirmDialog = useConfirm();
  const toast = useToast();
  const { user } = useAuth();
  const canRevoke = user?.role === "ADMIN";

  function load() {
    api.get("/certificates/admin", { params: typeFilter ? { type: typeFilter } : {} }).then((res) => setCerts(res.data));
  }
  useEffect(load, [typeFilter]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get("/users/search", { params: { q: query.trim(), role: "STUDENT" } }).then((res) => setResults(res.data.rows)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function issue(e) {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!selectedStudent) return setError("Select a student first");
    if (!programName.trim()) return setError("Program name is required");
    setIssuing(true);
    try {
      await api.post("/certificates/manual", { studentId: selectedStudent.id, programName: programName.trim(), title: title.trim() || undefined });
      setSuccess(`Certificate issued to ${selectedStudent.name}.`);
      setSelectedStudent(null); setQuery(""); setResults([]); setProgramName(""); setTitle("");
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to issue certificate");
    } finally {
      setIssuing(false);
    }
  }

  async function revoke(cert) {
    const ok = await confirmDialog({
      title: "Revoke certificate?",
      message: `This will permanently mark "${cert.programName || cert.title}" for ${cert.studentName} as revoked. This cannot be undone.`,
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    setRevokingId(cert.id);
    try {
      await api.post(`/certificates/${cert.id}/revoke`, {});
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to revoke certificate");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Certificates</h1>
            <ChalkUnderline />
          </div>
          <Link to={basePath || "/admin"} className="btn btn-ghost">← Back</Link>
        </div>

        <div className="card" style={{ padding: 20, marginTop: 24 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Issue a Certificate</h3>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
            For workshops, FDPs, bootcamps, placement-prep programs, or any institute certification with no
            dedicated module on the platform. Learning Module and Coding Assessment certificates are issued
            automatically when a student completes them.
          </p>
          <form onSubmit={issue} style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ position: "relative" }}>
              <label style={labelStyle}>Student</label>
              {selectedStudent ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="badge">{selectedStudent.name} ({selectedStudent.email})</span>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setSelectedStudent(null)}>Change</button>
                </div>
              ) : (
                <>
                  <input style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, roll number, or email" />
                  {results.length > 0 && (
                    <div className="card" style={{ position: "absolute", zIndex: 5, width: "100%", maxHeight: 220, overflowY: "auto", padding: 4, marginTop: 2 }}>
                      {results.map((s) => (
                        <div key={s.id} style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13, borderRadius: 6 }}
                          onClick={() => { setSelectedStudent(s); setResults([]); }}>
                          <strong>{s.name}</strong> — {s.rollNumber || "no roll #"} — {s.email}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <label style={labelStyle}>Program / Activity Name</label>
              <input style={inputStyle} value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder="e.g. FDP: Advanced Java Workshop" />
            </div>
            <div>
              <label style={labelStyle}>Certificate Title (optional, defaults to program name)</label>
              <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Certificate of Participation" />
            </div>
            {error && <p style={{ color: "var(--rust)", fontSize: 13 }}>{error}</p>}
            {success && <p style={{ color: "var(--mint)", fontSize: 13 }}>{success}</p>}
            <button className="btn btn-primary" disabled={issuing} style={{ justifySelf: "start" }}>{issuing ? "Issuing…" : "Issue Certificate"}</button>
          </form>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
          {["", "LEARNING_MODULE", "CODING_ASSESSMENT", "MANUAL"].map((t) => (
            <button key={t || "all"} className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px", background: typeFilter === t ? "var(--amber)" : undefined }} onClick={() => setTypeFilter(t)}>
              {t ? TYPE_LABEL[t] : "All"}
            </button>
          ))}
        </div>

        <div className="card" style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                <th style={{ padding: "10px 12px" }}>Student</th>
                <th style={{ padding: "10px 12px" }}>Type</th>
                <th style={{ padding: "10px 12px" }}>Program / Title</th>
                <th style={{ padding: "10px 12px" }}>Certificate ID</th>
                <th style={{ padding: "10px 12px" }}>Issued</th>
                <th style={{ padding: "10px 12px" }}>Status</th>
                <th style={{ padding: "10px 12px" }}></th>
              </tr>
            </thead>
            <tbody>
              {certs === null && <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }} className="mono">Loading…</td></tr>}
              {certs?.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <td style={{ padding: "10px 12px" }}>{c.studentName}<br /><span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>{c.studentEmail}</span></td>
                  <td style={{ padding: "10px 12px" }}>{TYPE_LABEL[c.type] || c.type}</td>
                  <td style={{ padding: "10px 12px" }}>{c.programName || c.title}</td>
                  <td className="mono" style={{ padding: "10px 12px", fontSize: 11 }}>{c.certificateCode}</td>
                  <td className="mono" style={{ padding: "10px 12px", fontSize: 11 }}>{new Date(c.issuedAt).toLocaleDateString()}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: c.status === "REVOKED" ? "var(--rust)" : "var(--mint)" }}>{c.status}</span>
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    {c.status !== "REVOKED" && canRevoke && (
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px", color: "var(--rust)" }} disabled={revokingId === c.id} onClick={() => revoke(c)}>
                        {revokingId === c.id ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {certs?.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No certificates yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
