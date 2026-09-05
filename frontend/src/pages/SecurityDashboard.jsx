import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

// SUPER_ADMIN-only read view of GET /admin/security-dashboard — see that route's own comment for
// exactly what's real (read from the existing AuditLog table, no new logging system) vs. a known,
// currently-untracked gap. This page is intentionally as honest about the gaps as the backend
// comment is; a security page that quietly omits what it doesn't cover is worse than one that says so.
const POLL_MS = 30000;

function StatCard({ label, value, sub, warn }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: warn ? "var(--rust)" : undefined }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function SecurityDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  function load() {
    api.get("/admin/security-dashboard").then((res) => {
      setData(res.data);
      setLastUpdated(new Date());
      setError("");
    }).catch((err) => setError(err.response?.data?.error || "Failed to load security dashboard"));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1>Security Dashboard</h1>
            <ChalkUnderline />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {lastUpdated && <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>Updated {lastUpdated.toLocaleTimeString()} · refreshes every {POLL_MS / 1000}s</span>}
            <Link to="/admin" className="btn btn-ghost">← Back</Link>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
          Aggregated from the same Audit Log every other admin view already reads — no separate logging
          system. See <Link to="/admin/audit-log">Audit Log</Link> for the full, filterable history.
        </p>

        {error && <p style={{ color: "var(--rust)", marginTop: 20 }}>{error}</p>}
        {!data && !error && <p className="mono" style={{ marginTop: 20 }}>Loading…</p>}

        {data && (
          <>
            <h3 style={{ fontSize: 15, marginTop: 28 }}>Failed Logins</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
              <StatCard label="Last 24h" value={data.failedLogins.last24h} warn={data.failedLogins.last24h > 20} />
              <StatCard label="Last 7d" value={data.failedLogins.last7d} />
            </div>
            {data.failedLogins.recent.length > 0 && (
              <div className="card" style={{ padding: 12, marginTop: 10, fontSize: 12, maxHeight: 220, overflowY: "auto" }}>
                {data.failedLogins.recent.map((r, i) => (
                  <div key={i} className="mono" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", borderBottom: i < data.failedLogins.recent.length - 1 ? "1px solid var(--line)" : "none" }}>
                    <span>{r.details?.email || "—"}</span>
                    <span style={{ color: "var(--ink-dim)" }}>{r.ipAddress || "—"} · {r.deviceInfo || "—"}</span>
                    <span style={{ color: "var(--ink-dim)" }}>{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            <h3 style={{ fontSize: 15, marginTop: 28 }}>Password Reset Activity (24h)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
              <StatCard label="Requested" value={data.passwordResets.requested24h} />
              <StatCard label="Blocked (24h cooldown)" value={data.passwordResets.blocked24h} />
              <StatCard label="Failed (expired/used token)" value={data.passwordResets.failed24h} warn={data.passwordResets.failed24h > 10} />
            </div>

            <h3 style={{ fontSize: 15, marginTop: 28 }}>Unauthorized Access Attempts</h3>
            <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
              An authenticated user's role didn't match what a route required (e.g. a STUDENT session hitting
              an admin-only endpoint) — logged the moment it happens, platform-wide. Does not yet include
              institute-scoping rejections (a valid role hitting another institute's data) — those aren't
              centralized behind one check the way role gates are, so they aren't tracked here yet.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
              <StatCard label="Last 24h" value={data.unauthorizedAttempts.last24h} warn={data.unauthorizedAttempts.last24h > 10} />
              <StatCard label="Last 7d" value={data.unauthorizedAttempts.last7d} />
            </div>
            {data.unauthorizedAttempts.recent.length > 0 && (
              <div className="card" style={{ padding: 12, marginTop: 10, fontSize: 12, maxHeight: 220, overflowY: "auto" }}>
                {data.unauthorizedAttempts.recent.map((r, i) => (
                  <div key={i} className="mono" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", borderBottom: i < data.unauthorizedAttempts.recent.length - 1 ? "1px solid var(--line)" : "none" }}>
                    <span>{r.adminName} ({r.adminRole})</span>
                    <span style={{ color: "var(--ink-dim)" }}>{r.details?.method} {r.details?.path}</span>
                    <span style={{ color: "var(--ink-dim)" }}>{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            <h3 style={{ fontSize: 15, marginTop: 28 }}>Feature Changes (7d)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
              <StatCard label="Total changes" value={data.featureChanges.last7d} />
            </div>
            {data.featureChanges.recent.length > 0 && (
              <div className="card" style={{ padding: 12, marginTop: 10, fontSize: 12, maxHeight: 220, overflowY: "auto" }}>
                {data.featureChanges.recent.map((r, i) => (
                  <div key={i} className="mono" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", borderBottom: i < data.featureChanges.recent.length - 1 ? "1px solid var(--line)" : "none" }}>
                    <span>{r.adminName}</span>
                    <span style={{ color: "var(--ink-dim)" }}>{JSON.stringify(r.details)}</span>
                    <span style={{ color: "var(--ink-dim)" }}>{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            <h3 style={{ fontSize: 15, marginTop: 28 }}>Not Yet Tracked</h3>
            <div className="card" style={{ padding: 16, marginTop: 10, fontSize: 13, color: "var(--ink-dim)" }}>
              Rate-limit events, compiler/sandbox security events, and a cross-institute-specific breakdown
              of access attempts aren't logged yet — shown here plainly rather than presenting an incomplete
              picture as if it were complete.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
