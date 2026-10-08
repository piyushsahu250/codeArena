import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import Badge from "../components/Badge";

// Staff view of the exam-security evidence for one coding assessment: a risk-banded row per student attempt, and a
// chronological timeline per attempt where a person reviews each piece of evidence. Risk bands are guidance, never a verdict.
const RISK_TONE = { LOW: "default", MEDIUM: "warning", HIGH: "danger", CRITICAL: "danger" };
const REVIEW_LABEL = { PENDING: "Needs review", REVIEWED: "Reviewed", LEGITIMATE: "Legitimate", SUSPICIOUS: "Suspicious", ESCALATED: "Escalated" };
const fmt = (d) => new Date(d).toLocaleTimeString();

export function Timeline({ attemptId, onClose, base = "/exam-security/attempts", query = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.get(`${base}/${attemptId}/timeline${query}`).then((r) => setData(r.data)).catch((e) => setError(e.response?.data?.error || "Could not load the timeline"));
  }, [attemptId, base, query]);
  useEffect(() => { load(); }, [load]);

  async function review(id, reviewStatus) {
    const note = reviewStatus === "SUSPICIOUS" || reviewStatus === "ESCALATED" ? prompt("Add a note for this decision (optional)") : null;
    try { await api.patch(`/exam-security/events/${id}/review`, { reviewStatus, note }); load(); }
    catch (e) { alert(e.response?.data?.error || "Could not save the review"); }
  }

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }} aria-live="polite">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <strong>{data ? `${data.student.name}${data.student.registrationNumber ? ` (${data.student.registrationNumber})` : ""}` : "Timeline"}</strong>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {data && <Badge tone={RISK_TONE[data.risk]}>Risk: {data.risk} ({data.riskScore})</Badge>}
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onClose}>Close</button>
        </span>
      </div>
      {error && <p style={{ color: "var(--rust)" }}>{error}</p>}
      {!data && !error && <p className="mono">Loading…</p>}
      {data && (
        <ol style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 6 }}>
          {data.timeline.map((e, i) => (
            <li key={e.id || i} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
              <span className="mono" style={{ color: "var(--ink-dim)", minWidth: 78 }}>{fmt(e.at)}</span>
              <span style={{ fontWeight: 600 }}>{e.type.replace(/_/g, " ")}</span>
              {e.severity && <Badge tone={e.severity === "HIGH" || e.severity === "CONFIRMED_VIOLATION" ? "danger" : e.severity === "MEDIUM" || e.severity === "SUSPICIOUS" ? "warning" : "default"}>{e.severity.replace("_", " ")}</Badge>}
              {e.penalized && <Badge tone="danger">counted as a strike</Badge>}
              {e.metadata && <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>{Object.entries(e.metadata).map(([k, v]) => `${k}=${v}`).join(" · ")}</span>}
              {e.reviewable && (
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 11 }}>{REVIEW_LABEL[e.reviewStatus]}{e.reviewNote ? ` — ${e.reviewNote}` : ""}</span>
                  {["LEGITIMATE", "REVIEWED", "SUSPICIOUS", "ESCALATED"].map((s) => (
                    <button key={s} className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} disabled={e.reviewStatus === s} onClick={() => review(e.id, s)}>{REVIEW_LABEL[s]}</button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const CONN_LABEL = {
  CONNECTED: ["Connected", "success"], TEMPORARILY_DISCONNECTED: ["Reconnecting", "warning"], RECOVERING: ["Recovering", "warning"],
  SECURITY_SESSION_LOST: ["Session lost", "danger"], LOCKED: ["Locked", "danger"], ENDED: ["Finished", "default"],
  NO_SECURE_SESSION: ["No secure client", "danger"], SESSION_ENDED: ["Session ended", "danger"], BROWSER: ["Browser", "default"],
};
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function Tile({ label, value, tone }) {
  return (
    <div className="card" style={{ padding: "10px 14px", minWidth: 120, borderTop: tone ? `3px solid var(--${tone})` : undefined }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
    </div>
  );
}

export default function ExamSecurityMonitor() {
  const { testId } = useParams();
  const [page, setPage] = useState(1);
  const [live, setLive] = useState(true);
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [open, setOpen] = useState(null);
  const load = useCallback((quiet) => {
    if (!quiet) setState((s) => ({ ...s, loading: true, error: "" }));
    api.get(`/exam-security/tests/${testId}/monitor?page=${page}&pageSize=25`)
      .then((r) => setState({ loading: false, error: "", data: r.data }))
      .catch((e) => setState((s) => ({ loading: false, error: e.response?.data?.error || (e.response ? "Could not load the monitor" : "You appear to be offline"), data: quiet ? s.data : null })));
  }, [testId, page]);
  useEffect(() => { load(false); }, [load]);
  // Live refresh: one batched request every 10 s (never per second), paused while the tab is hidden or live mode is off.
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => { if (!document.hidden) load(true); }, 10000);
    return () => clearInterval(id);
  }, [live, load]);

  async function unlock(attemptId) {
    if (!confirm("Unlock this student's exam? Only do this after you have checked their computer and seat.")) return;
    try { await api.post(`/secure-exam/attempts/${attemptId}/unlock`); load(true); } catch (e) { alert(e.response?.data?.error || "Could not unlock"); }
  }

  const d = state.data;
  const sm = d?.summary;
  return (
    <div>
      <Navbar />
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px 64px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <h1 style={{ fontSize: 24 }}>Live exam monitor</h1>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Auto-refresh every 10 s
          </label>
        </div>
        {d && (
          <p className="mono" style={{ color: "var(--ink-dim)", margin: "6px 0 14px", fontSize: 12.5 }}>
            {d.test.title} · mode {d.policy.level} · {d.policy.multiSession === "BLOCK" ? "one tab only" : "tab monitoring"} · fullscreen {d.policy.requireFullscreen ? "required" : "not required"} · camera {d.proctoring.camera ? "required" : "off"} · microphone {d.proctoring.microphone ? "required" : "off"}
            {d.policy.secureBrowserRequired && ` · secure exam client required · on lost connection: ${String(d.policy.exitAction).replace("_", " ").toLowerCase()} after ${d.policy.graceSec}s`}
            {!d.proctoring.enabled && " · proctoring OFF for this test"}
          </p>
        )}
        {state.error && (
          <div role="alert" className="card" style={{ padding: 16 }}><p style={{ color: "var(--rust)" }}>{state.error}</p><button className="btn btn-primary" onClick={() => load(false)}>Retry</button></div>
        )}
        {state.loading && !d && <p className="mono">Loading…</p>}
        {d && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }} aria-label="Exam summary">
              <Tile label="Students" value={sm.totalStudents} />
              <Tile label="Active now" value={sm.active} tone="mint" />
              <Tile label="Completed" value={sm.completed} />
              <Tile label="Disconnected" value={sm.disconnected} tone={sm.disconnected ? "rust" : undefined} />
              <Tile label="Security warnings" value={sm.securityWarnings} tone={sm.securityWarnings ? "amber" : undefined} />
              <Tile label="High risk" value={sm.highRisk} tone={sm.highRisk ? "rust" : undefined} />
              <Tile label="Critical" value={sm.critical} tone={sm.critical ? "rust" : undefined} />
              <Tile label="Device failures" value={sm.deviceFailures} tone={sm.deviceFailures ? "rust" : undefined} />
              <Tile label="Network failures" value={sm.networkFailures} tone={sm.networkFailures ? "amber" : undefined} />
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 980 }}>
                <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                  {["Student", "Roll / PRN", "Device", "Connection", "Progress", "Time left", "Risk", "Strikes", "Last event", "Review", ""].map((h) => <th key={h} style={{ padding: "8px 10px" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.rows.map((r) => {
                    const [connLabel, connTone] = CONN_LABEL[r.connection] || [r.connection, "default"];
                    return (
                      <tr key={r.attemptId} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "8px 10px" }}>{r.student.name}</td>
                        <td style={{ padding: "8px 10px" }} className="mono">{r.student.registrationNumber || "—"}</td>
                        <td style={{ padding: "8px 10px" }} className="mono">{r.device ? (r.device.label || r.device.deviceId) : "—"}</td>
                        <td style={{ padding: "8px 10px" }}><Badge tone={connTone}>{connLabel}</Badge></td>
                        <td style={{ padding: "8px 10px" }} className="mono">{r.progress.answered} answered · {r.progress.accepted} accepted</td>
                        <td style={{ padding: "8px 10px" }} className="mono">{r.status === "IN_PROGRESS" ? mmss(r.secondsLeft) : r.status.replace("_", " ")}{r.autoSubmitReason ? ` (${r.autoSubmitReason})` : ""}</td>
                        <td style={{ padding: "8px 10px" }}><Badge tone={RISK_TONE[r.risk]}>{r.risk}</Badge></td>
                        <td style={{ padding: "8px 10px" }}>{r.violationCount}</td>
                        <td style={{ padding: "8px 10px" }} className="mono">{r.lastEvent ? `${r.lastEvent.type.replace(/_/g, " ")} · ${fmt(r.lastEvent.at)}` : "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.pendingReview || "—"}</td>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setOpen(r.attemptId)}>Security timeline</button>
                          {r.connection === "LOCKED" && <button className="btn btn-primary" style={{ fontSize: 12, marginLeft: 6 }} onClick={() => unlock(r.attemptId)}>Unlock</button>}
                        </td>
                      </tr>
                    );
                  })}
                  {d.rows.length === 0 && <tr><td colSpan={11} style={{ padding: 16 }}>No attempts yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</button>
              <span className="mono" style={{ fontSize: 12 }}>Page {d.page} of {Math.max(1, Math.ceil(d.total / d.pageSize))} · {d.total} attempts</span>
              <button className="btn btn-ghost" disabled={page * d.pageSize >= d.total} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
            {open && <Timeline attemptId={open} onClose={() => setOpen(null)} />}
          </>
        )}
        <p style={{ marginTop: 24, fontSize: 12, color: "var(--ink-dim)", maxWidth: 760 }}>
          Risk is a guide for a human reviewer, built from the evidence the exam environment can observe. It never proves misconduct on its own.
          {" "}<Link to="/staff/secure-devices">Registered exam devices</Link> · <Link to="/staff/learning">Learning Management</Link>
        </p>
      </main>
    </div>
  );
}
