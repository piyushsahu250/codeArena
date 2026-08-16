import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useToast } from "../context/ToastContext";

const STATUS_COLOR = { PENDING: "var(--ink-dim)", SENT: "var(--mint)", FAILED: "var(--rust)", RETRYING: "var(--amber-dark)" };
const TYPE_LABEL = {
  WELCOME: "Welcome Email", PASSWORD_RESET: "Password Reset",
  CREDENTIALS: "Credentials", CREDENTIALS_RESEND: "Credentials Resend", OTHER_SYSTEM_EMAIL: "System Email",
};
// Matches backend/src/utils/mailer.js's MAX_EMAIL_RETRIES default — used only to disable the
// button a beat earlier client-side; the server enforces the real cap regardless.
const MAX_EMAIL_RETRIES = 5;

export default function EmailLogs() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState(null);
  const [pageMeta, setPageMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [batchId, setBatchId] = useState(searchParams.get("batchId") || "");
  const [retryingId, setRetryingId] = useState(null);

  const [status, setStatus] = useState(null); // system-status panel
  const [testTo, setTestTo] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, error }

  function loadStatus() {
    api.get("/admin/email-logs/status").then((res) => setStatus(res.data)).catch(() => {});
  }

  function load() {
    const params = { page, pageSize: 50 };
    if (statusFilter) params.status = statusFilter;
    if (typeFilter) params.type = typeFilter;
    if (q.trim()) params.q = q.trim();
    if (from) params.from = from;
    if (to) params.to = to;
    if (batchId) params.batchId = batchId;
    api.get("/admin/email-logs", { params }).then((res) => {
      setLogs(res.data.rows);
      setPageMeta({ page: res.data.page, totalPages: res.data.totalPages, total: res.data.total });
    });
  }

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter, q, from, to, batchId]);
  useEffect(load, [statusFilter, typeFilter, q, from, to, batchId, page]);

  function clearBatchFilter() {
    setBatchId("");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("batchId");
      return next;
    });
  }

  async function sendTestEmail(e) {
    e.preventDefault();
    if (!testTo.trim()) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const { data } = await api.post("/admin/email-logs/test", { to: testTo.trim() });
      setTestResult(data);
      if (data.ok) toast.success("Test email sent — check the inbox.");
      else toast.error(`Test email failed: ${data.error || "Unknown error"}`);
      loadStatus();
      load();
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to send test email";
      setTestResult({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setTestSending(false);
    }
  }

  // There's no way to literally "resend" the original message — passwords are never stored in
  // plaintext, so a retry generates a fresh unique password (same as any other reset) and sends
  // a new email with it. Unlike the old workaround (calling the generic reset-password route,
  // which always created a brand-new EmailLog row), this dedicated route updates the SAME log
  // row's retryCount/status and enforces a real retry cap server-side.
  async function retry(log) {
    if (!log.studentId) {
      toast.error("Can't retry — this student's account no longer exists.");
      return;
    }
    setRetryingId(log.id);
    try {
      const { data } = await api.post(`/admin/email-logs/${log.id}/retry`);
      toast[data.emailSent ? "success" : "error"](
        data.emailSent ? "Email resent successfully." : `Retry failed: ${data.emailError || "Unknown error"}`
      );
      load();
      loadStatus();
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
          confirmed by the mail server — not just "the code ran without throwing."
          {failedCount > 0 && <span style={{ color: "var(--rust)", fontWeight: 600 }}> {failedCount} failed and can be retried below.</span>}
        </p>

        {/* Email system status panel */}
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: status?.connected ? "var(--mint)" : "var(--rust)",
                  display: "inline-block",
                }}
              />
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                {status ? (status.connected ? "Email System Connected" : "Email System Not Connected") : "Checking…"}
              </span>
            </div>
            {status?.senderEmail && (
              <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                Sender: <span className="mono">{status.senderEmail}</span>
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              Last successful send: {status?.lastSuccessfulAt ? new Date(status.lastSuccessfulAt).toLocaleString() : "—"}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              Queued: <span className="mono" style={{ fontWeight: 700 }}>{status?.queuedCount ?? "—"}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              Failed: <span className="mono" style={{ fontWeight: 700, color: status?.failedCount > 0 ? "var(--rust)" : undefined }}>{status?.failedCount ?? "—"}</span>
            </div>
          </div>

          <form onSubmit={sendTestEmail} style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="email"
              placeholder="Send a test email to…"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              style={{ flex: "1 1 240px", padding: "6px 10px", fontSize: 13 }}
            />
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} disabled={!testTo.trim() || testSending}>
              {testSending ? "Sending…" : "Send Test Email"}
            </button>
            {testResult && (
              <span style={{ fontSize: 12, color: testResult.ok ? "var(--mint)" : "var(--rust)", fontWeight: 600 }}>
                {testResult.ok ? "✓ Sent" : `✗ Failed: ${testResult.error || "Unknown error"}`}
              </span>
            )}
          </form>
        </div>

        {batchId && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13 }}>
            <span>Filtered to upload batch <span className="mono">{batchId}</span></span>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 10px" }} onClick={clearBatchFilter}>Clear</button>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
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

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ fontSize: 13, padding: "6px 10px" }}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABEL).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search email, name, or PRN…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ fontSize: 13, padding: "6px 10px", minWidth: 220 }}
          />
          <label style={{ fontSize: 12, color: "var(--ink-dim)", display: "flex", alignItems: "center", gap: 6 }}>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ fontSize: 13, padding: "5px 8px" }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--ink-dim)", display: "flex", alignItems: "center", gap: 6 }}>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ fontSize: 13, padding: "5px 8px" }} />
          </label>
          {(typeFilter || q || from || to) && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "5px 10px" }}
              onClick={() => { setTypeFilter(""); setQ(""); setFrom(""); setTo(""); }}
            >
              Clear filters
            </button>
          )}
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
                      (log.retryCount ?? 0) >= MAX_EMAIL_RETRIES ? (
                        <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>Retry limit reached</span>
                      ) : (
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => retry(log)} disabled={retryingId === log.id}>
                          {retryingId === log.id ? "Retrying…" : `Retry${log.retryCount ? ` (${log.retryCount}/${MAX_EMAIL_RETRIES})` : ""}`}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {logs?.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No email activity matches these filters.</td></tr>
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
