import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import Badge from "../components/Badge";
import { Timeline } from "./ExamSecurityMonitor";

// Staff/admin view of integrity evidence for one formal test (MCQ / company / coding test). Risk bands are guidance for a
// human reviewer built from observable signals; they never prove misconduct and never fail a student by themselves.
const RISK_TONE = { LOW: "default", MEDIUM: "warning", HIGH: "danger", CRITICAL: "danger" };
const fmt = (d) => new Date(d).toLocaleTimeString();
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function Tile({ label, value, tone }) {
  return (
    <div className="card" style={{ padding: "10px 14px", minWidth: 120, borderTop: tone ? `3px solid var(--${tone})` : undefined }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
    </div>
  );
}

export default function TestSecurityMonitor() {
  const { testId } = useParams();
  const [page, setPage] = useState(1);
  const [risk, setRisk] = useState("");
  const [live, setLive] = useState(true);
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [open, setOpen] = useState(null);
  const load = useCallback((quiet) => {
    if (!quiet) setState((s) => ({ ...s, loading: true, error: "" }));
    api.get(`/exam-security/exams/${testId}/monitor`, { params: { page, pageSize: 25, risk: risk || undefined } })
      .then((r) => setState({ loading: false, error: "", data: r.data }))
      .catch((e) => setState((s) => ({ loading: false, error: e.response?.data?.error || (e.response ? "Could not load the monitor" : "You appear to be offline"), data: quiet ? s.data : null })));
  }, [testId, page, risk]);
  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => { if (!document.hidden) load(true); }, 10000);
    return () => clearInterval(id);
  }, [live, load]);

  const d = state.data;
  const sm = d?.summary;
  const th = { padding: "8px 10px" };
  return (
    <div>
      <Navbar />
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 16px 64px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <h1 style={{ fontSize: 24 }}>Assessment security monitor</h1>
          <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12.5 }}>Risk{" "}
              <select value={risk} onChange={(e) => { setRisk(e.target.value); setPage(1); }}>
                <option value="">All</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
              </select>
            </label>
            <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Auto-refresh every 10 s
            </label>
          </span>
        </div>
        {d && <p className="mono" style={{ color: "var(--ink-dim)", margin: "6px 0 14px", fontSize: 12.5 }}>{d.test.title} · level {d.policy.level} · {d.policy.multiSession === "BLOCK" ? "one tab only" : "tab monitoring"} · phones {d.policy.mobileAllowed ? "allowed" : "refused"} · fullscreen {d.policy.requireFullscreen ? "required" : "not required"}</p>}
        {state.error && <div role="alert" className="card" style={{ padding: 16 }}><p style={{ color: "var(--rust)" }}>{state.error}</p><button className="btn btn-primary" onClick={() => load(false)}>Retry</button></div>}
        {state.loading && !d && <p className="mono">Loading…</p>}
        {d && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }} aria-label="Summary">
              <Tile label="Attempts" value={sm.attempts} />
              <Tile label="Active now" value={sm.active} tone="mint" />
              <Tile label="High risk" value={sm.bands.HIGH} tone={sm.bands.HIGH ? "rust" : undefined} />
              <Tile label="Critical" value={sm.bands.CRITICAL} tone={sm.bands.CRITICAL ? "rust" : undefined} />
              <Tile label="Fullscreen exits" value={sm.fullscreenExits} tone={sm.fullscreenExits ? "amber" : undefined} />
              <Tile label="Tab switches" value={sm.tabSwitches} tone={sm.tabSwitches ? "amber" : undefined} />
              <Tile label="Possible external activity" value={sm.possibleExternalActivity} tone={sm.possibleExternalActivity ? "amber" : undefined} />
              <Tile label="Session conflicts" value={sm.sessionConflicts} tone={sm.sessionConflicts ? "rust" : undefined} />
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1100 }}>
                <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                  {["Student", "Roll / PRN", "Status", "Time left", "Risk", "Strikes", "FS exits", "Tab switches", "Focus lost", "Split screen", "Copy / paste", "Conflicts", "Last event", "Review", ""].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.attemptId} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={th}>{r.student.name}</td>
                      <td style={th} className="mono">{r.student.rollNumber || r.student.registrationNumber || "—"}</td>
                      <td style={th} className="mono">{r.status.replace("_", " ")}</td>
                      <td style={th} className="mono">{r.status === "IN_PROGRESS" ? mmss(r.secondsLeft) : "—"}</td>
                      <td style={th}><Badge tone={RISK_TONE[r.risk]}>{r.risk}</Badge></td>
                      <td style={th}>{r.strikes}</td>
                      <td style={th}>{r.counts.fullscreenExits}</td>
                      <td style={th}>{r.counts.tabSwitches}</td>
                      <td style={th}>{r.counts.focusLoss}</td>
                      <td style={th}>{r.counts.splitScreen}</td>
                      <td style={th}>{r.counts.copy + r.counts.paste}</td>
                      <td style={th}>{r.counts.sessionConflicts}</td>
                      <td style={th} className="mono">{r.lastEvent ? `${r.lastEvent.type.replace(/_/g, " ")} · ${fmt(r.lastEvent.at)}` : "—"}</td>
                      <td style={th}>{r.pendingReview || "—"}</td>
                      <td style={{ ...th, whiteSpace: "nowrap" }}><button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setOpen(r.attemptId)}>Security timeline</button></td>
                    </tr>
                  ))}
                  {d.rows.length === 0 && <tr><td colSpan={15} style={{ padding: 16 }}>No attempts match.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</button>
              <span className="mono" style={{ fontSize: 12 }}>Page {d.page} of {Math.max(1, Math.ceil(d.total / d.pageSize))} · {d.total} attempts</span>
              <button className="btn btn-ghost" disabled={page * d.pageSize >= d.total} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
            {open && <Timeline attemptId={open} base="/exam-security/exam-attempts" onClose={() => setOpen(null)} />}
          </>
        )}
        <p style={{ marginTop: 24, fontSize: 12, color: "var(--ink-dim)", maxWidth: 760 }}>
          Signals such as "focus lost" or "split screen" mean the assessment window may have been shared with another window or overlay; they do not identify any application and do not prove misconduct. Review the timeline before acting.{" "}
          <Link to={`/staff/tests/${testId}/results`}>Test results</Link>
        </p>
      </main>
    </div>
  );
}
