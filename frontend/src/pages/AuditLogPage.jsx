import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { Download } from "lucide-react";

// Renders at /admin/audit-log and /staff/audit-log (basePath controls the back link). Backend
// scopes the data itself — Staff only ever see their own institute's activity, an unscoped
// platform Admin sees every institute (same convention as PasswordResetHistory).
export default function AuditLogPage({ basePath }) {
  const [logs, setLogs] = useState(null);
  const [pageMeta, setPageMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [actions, setActions] = useState([]);
  const [actionFilter, setActionFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function load() {
    const params = { page, pageSize: 50 };
    if (actionFilter) params.action = actionFilter;
    if (from) params.from = from;
    if (to) params.to = to;
    api.get("/users/audit-log", { params }).then((res) => {
      setLogs(res.data.rows);
      setPageMeta({ page: res.data.page, totalPages: res.data.totalPages, total: res.data.total });
    });
  }

  useEffect(() => {
    api.get("/users/audit-log/actions").then((res) => setActions(res.data)).catch(() => {});
  }, []);
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, from, to]);
  useEffect(load, [actionFilter, from, to, page]);

  function exportCsv() {
    const params = new URLSearchParams({ format: "csv" });
    if (actionFilter) params.set("action", actionFilter);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const token = localStorage.getItem("token");
    const base = api.defaults.baseURL;
    // A plain <a> download can't carry an Authorization header, so this fetches the CSV as a
    // blob first and saves it client-side — same approach as every other export button on this
    // platform that requires auth (report/certificate downloads use the same pattern).
    fetch(`${base}/users/audit-log?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "audit-log.csv";
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Audit Log</h1>
            <ChalkUnderline />
          </div>
          <Link to={basePath || "/admin"} className="btn btn-ghost">← Back</Link>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 16 }}>
          A record of security-relevant actions across the platform — logins, password changes, test and
          certificate activity, and account/institute management.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={labelStyle}>Action</label>
            <select style={inputStyle} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>From</label>
            <input style={inputStyle} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input style={inputStyle} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </button>
        </div>

        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                <th style={{ padding: "10px 12px" }}>Timestamp</th>
                <th style={{ padding: "10px 12px" }}>Action</th>
                <th style={{ padding: "10px 12px" }}>Actor</th>
                <th style={{ padding: "10px 12px" }}>Role</th>
                <th style={{ padding: "10px 12px" }}>IP Address</th>
                <th style={{ padding: "10px 12px" }}>Device</th>
                <th style={{ padding: "10px 12px" }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs === null && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }} className="mono">Loading…</td></tr>
              )}
              {logs?.map((log) => (
                <tr key={log.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <td className="mono" style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{new Date(log.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "10px 12px" }}><span className="mono" style={{ fontWeight: 700 }}>{log.action}</span></td>
                  <td style={{ padding: "10px 12px" }}>{log.adminName}</td>
                  <td style={{ padding: "10px 12px" }}>{log.adminRole || "—"}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{log.ipAddress || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{log.deviceInfo || "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: "var(--ink-dim)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={JSON.stringify(log.details)}>
                    {JSON.stringify(log.details)}
                  </td>
                </tr>
              ))}
              {logs?.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No matching activity.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {logs !== null && pageMeta.totalPages > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center", alignItems: "center" }}>
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span className="mono" style={{ fontSize: 13 }}>Page {pageMeta.page} / {pageMeta.totalPages} ({pageMeta.total} total)</span>
            <button className="btn btn-ghost" disabled={page >= pageMeta.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 };
const inputStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
