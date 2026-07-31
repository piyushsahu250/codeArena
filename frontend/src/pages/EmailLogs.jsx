import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useToast } from "../context/ToastContext";

const STATUS_COLOR = { PENDING: "var(--ink-dim)", SENT: "var(--mint)", FAILED: "var(--rust)", RETRYING: "var(--amber-dark)" };
const TYPE_LABEL = { WELCOME: "Welcome Email", PASSWORD_RESET: "Password Reset" };

export default function EmailLogs() {
  const toast = useToast();
  const [logs, setLogs] = useState(null);
  const [pageMeta, setPageMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [retryingId, setRetryingId] = useState(null);

  function load() {
    const params = { page, pageSize: 50 };
    if (statusFilter) params.status = statusFilter;
    api.get("/admin/email-logs", { params }).then((res) => {
      setLogs(res.data.rows);
      setPageMeta({ page: res.data.page, totalPages: res.data.totalPages, total: res.data.total });
    });
  }

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);
  useEffect(load, [statusFilter, page]);

  // There's no way to literally "resend" the original message — passwords are never stored in
  // plaintext, so a retry generates a fresh unique password (same as any other reset) and sends
  // a new email with it. This calls the same reset-password endpoint the Student Management
  // "Send Credentials" action uses.
  async function retry(log) {
    if (!log.studentId) {
      toast.error("Can't retry — this student's account no longer exists.");
      return;
    }
    setRetryingId(log.id);
    try {
      const { data } = await api.post(`/users/${log.studentId}/reset-password`, { sendEmail: true });
      toast[data.emailSent ? "success" : "error"](
        data.emailSent ? "Email resent successfully." : `Retry failed: ${data.emailError || "Unknown error"}`
      );
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to retry");
    } finally {
      setRetryingId(null);
    }
  }

  const failedCount = logs?.filter((l) => l.status === "FAILED").length ?? 0;

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Email Logs</h1>
            <ChalkUnderline />
          </div>
          <Link to="/admin" className="btn btn-ghost">← Back to Admin</Link>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 16 }}>
          Every welcome and password-reset email the platform has attempted to send, with the real status
          confirmed by the email provider — not just "the code ran without throwing."
          {failedCount > 0 && <span style={{ color: "var(--rust)", fontWeight: 600 }}> {failedCount} failed and can be retried below.</span>}
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {["", "SENT", "FAILED", "PENDING", "RETRYING"].map((s) => (
            <button
              key={s || "all"}
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "6px 12px", background: statusFilter === s ? "var(--amber)" : undefined }}
              onClick={() => setStatusFilter(s)}
            >
              {s || "All"}
            </button>
          ))}
        </div>

        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                <th style={{ padding: "10px 12px" }}>Student</th>
                <th style={{ padding: "10px 12px" }}>Email</th>
                <th style={{ padding: "10px 12px" }}>Type</th>
                <th style={{ padding: "10px 12px" }}>Sent Time</th>
                <th style={{ padding: "10px 12px" }}>Status</th>
                <th style={{ padding: "10px 12px" }}>Error</th>
                <th style={{ padding: "10px 12px" }}></th>
              </tr>
            </thead>
            <tbody>
              {logs === null && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }} className="mono">Loading…</td></tr>
              )}
              {logs?.map((log) => (
                <tr key={log.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <td style={{ padding: "10px 12px" }}>{log.recipientName}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{log.recipientEmail}</td>
                  <td style={{ padding: "10px 12px" }}>{TYPE_LABEL[log.emailType] || log.emailType}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{new Date(log.sentAt || log.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span className="mono" style={{ fontWeight: 700, color: STATUS_COLOR[log.status] }}>{log.status}</span>
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--rust)", fontSize: 12, maxWidth: 260 }}>{log.errorMessage || "—"}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    {log.status === "FAILED" && (
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => retry(log)} disabled={retryingId === log.id}>
                        {retryingId === log.id ? "Retrying…" : "Retry"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {logs?.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No email activity yet.</td></tr>
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
