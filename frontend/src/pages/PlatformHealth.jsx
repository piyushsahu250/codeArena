import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const STATUS_COLOR = { HEALTHY: "var(--mint)", WARNING: "var(--amber-dark)", CRITICAL: "var(--rust)" };
const PRIORITY_COLOR = { P0: "var(--rust)", P1: "var(--amber-dark)", P2: "var(--ink-dim)", P3: "var(--ink-dim)" };

// SUPER_ADMIN-only read view of backend/scripts/dailyHealthCheck.js's persisted results. This is
// detect-and-report only — nothing here triggers a fix or a deploy. See docs/PLATFORM_HEALTH.md
// for exactly what the checks do and don't cover before treating a HEALTHY status as "bug-free".
export default function PlatformHealth() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/platform-health/latest").then((res) => setLatest(res.data.report)).catch((err) => setError(err.response?.data?.error || "Failed to load"));
    api.get("/platform-health").then((res) => setHistory(res.data.reports)).catch(() => {});
  }, []);

  const findings = latest?.findings?.findings || [];

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Platform Health</h1>
            <ChalkUnderline />
          </div>
          <Link to="/admin" className="btn btn-ghost">← Back</Link>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 16 }}>
          Results of the automated daily detect-and-report check. Nothing here auto-fixes or auto-deploys —
          see <Link to="/admin/issue-reports">Reported Problems</Link> for the human review queue.
          A HEALTHY status means these specific checks passed on this run, not that the platform is bug-free.
        </p>

        {error && <p style={{ color: "var(--rust)", marginTop: 24 }}>{error}</p>}

        {latest === null && !error && <p className="mono" style={{ color: "var(--ink-dim)", marginTop: 24 }}>Loading…</p>}
        {latest === undefined || (latest === null && !error) ? null : latest && (
          <div className="card" style={{ marginTop: 20, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: STATUS_COLOR[latest.overallStatus] }}>{latest.overallStatus}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{new Date(latest.runAt).toLocaleString()}</span>
            </div>
            <p style={{ fontSize: 13, marginTop: 8 }}>
              {latest.issuesFound} issue(s) found — P0: {latest.p0Count} · P1: {latest.p1Count} · P2: {latest.p2Count} · P3: {latest.p3Count}
              {" "}({latest.durationMs}ms)
            </p>

            {findings.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {findings.map((f, i) => (
                  <div key={i} style={{ borderLeft: `3px solid ${PRIORITY_COLOR[f.priority] || "var(--ink-dim)"}`, paddingLeft: 10, fontSize: 13 }}>
                    <strong style={{ color: PRIORITY_COLOR[f.priority] }}>[{f.priority}]</strong> {f.category}/{f.check}: {f.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {history?.length > 1 && (
          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 15 }}>History</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                  <th style={{ padding: "8px 10px" }}>Run</th>
                  <th style={{ padding: "8px 10px" }}>Status</th>
                  <th style={{ padding: "8px 10px" }}>Issues</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                    <td className="mono" style={{ padding: "8px 10px" }}>{new Date(h.runAt).toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", color: STATUS_COLOR[h.overallStatus], fontWeight: 600 }}>{h.overallStatus}</td>
                    <td style={{ padding: "8px 10px" }}>{h.issuesFound}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
