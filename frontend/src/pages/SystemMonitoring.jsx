import { useEffect, useState } from "react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

// Every number on this page comes straight from the live backend process and database — nothing
// here is simulated. Deliberately absent: system-wide "CPU Usage %" (not obtainable from Node
// without an external metrics agent — the load-average figure below is a different, real thing,
// labeled honestly) and per-route error counts for routes that already catch and handle their own
// errors (only uncaught process-level failures are tracked, see backend/src/utils/metrics.js).
const POLL_MS = 10000;

function StatCard({ label, value, sub, warn }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: warn ? "var(--rust)" : undefined }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function SystemMonitoring() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  function load() {
    api.get("/admin/monitoring").then((res) => {
      setData(res.data);
      setLastUpdated(new Date());
      setError("");
    }).catch((err) => setError(err.response?.data?.error || "Failed to load monitoring data"));
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
          <div><h1>System Monitoring</h1><ChalkUnderline /></div>
          {lastUpdated && <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>Updated {lastUpdated.toLocaleTimeString()} · refreshes every {POLL_MS / 1000}s</span>}
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>
          Live metrics from this backend process and its database connection — single instance, no external monitoring agent.
        </p>

        {error && <p style={{ color: "var(--rust)", marginTop: 20 }}>{error}</p>}
        {!data && !error && <p className="mono" style={{ marginTop: 20 }}>Loading…</p>}

        {data && (
          <>
            <h3 style={{ fontSize: 15, marginTop: 28 }}>Process Health</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
              <StatCard label="Uptime" value={`${Math.floor(data.process.uptimeSec / 3600)}h ${Math.floor((data.process.uptimeSec % 3600) / 60)}m`} />
              <StatCard label="Memory (RSS)" value={`${data.process.memoryMb.rss} MB`} sub={`Heap ${data.process.memoryMb.heapUsed}/${data.process.memoryMb.heapTotal} MB`} />
              <StatCard label="Load Average (1m)" value={data.process.loadAverage1m} sub="Host load average, not CPU %" />
              <StatCard
                label="Event Loop Lag"
                value={`${data.process.eventLoopLagMs} ms`}
                warn={data.process.eventLoopLagMs > 200}
                sub={data.process.eventLoopLagMs > 200 ? "Elevated — process is struggling to keep up" : "Healthy"}
              />
            </div>

            <h3 style={{ fontSize: 15, marginTop: 28 }}>Database</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
              <StatCard label="DB Ping (SELECT 1)" value={`${data.database.pingMs} ms`} warn={data.database.pingMs > 200} />
            </div>

            <h3 style={{ fontSize: 15, marginTop: 28 }}>API Response Time (last {data.requestTiming.sampleSize} requests)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
              <StatCard label="Average" value={data.requestTiming.avg != null ? `${data.requestTiming.avg} ms` : "—"} />
              <StatCard label="p50" value={data.requestTiming.p50 != null ? `${data.requestTiming.p50} ms` : "—"} />
              <StatCard label="p95" value={data.requestTiming.p95 != null ? `${data.requestTiming.p95} ms` : "—"} warn={data.requestTiming.p95 > 1000} />
              <StatCard label="p99" value={data.requestTiming.p99 != null ? `${data.requestTiming.p99} ms` : "—"} warn={data.requestTiming.p99 > 3000} />
            </div>

            <h3 style={{ fontSize: 15, marginTop: 28 }}>Judge Queue (Code Execution)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
              <StatCard label="Running Now" value={`${data.judgeQueue.active} / ${data.judgeQueue.maxConcurrent}`} />
              <StatCard label="Waiting in Queue" value={data.judgeQueue.waiting} warn={data.judgeQueue.waiting > 5} />
            </div>

            <h3 style={{ fontSize: 15, marginTop: 28 }}>Active Sessions Right Now</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
              <StatCard label="Coding Tests" value={data.activeSessions.codingTests} />
              <StatCard label="Module Coding Assessments" value={data.activeSessions.moduleCodingAssessments} />
              <StatCard label="Mock Interviews" value={data.activeSessions.mockInterviews} />
            </div>

            <h3 style={{ fontSize: 15, marginTop: 28 }}>AI Provider ({data.aiProvider.provider})</h3>
            {!data.aiProvider.configured ? (
              <div className="card" style={{ padding: 16, marginTop: 10, fontSize: 13, color: "var(--ink-dim)" }}>
                Not configured on this server (GEMINI_API_KEY is not set) — every AI feature is currently returning a graceful "not configured" error rather than attempting a call.
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 10 }}>
                  <StatCard label="Requests Today" value={data.aiProvider.today.total} sub={data.aiProvider.model} />
                  <StatCard
                    label="Success Rate Today"
                    value={data.aiProvider.today.total === 0 ? "—" : `${Math.round((data.aiProvider.today.success / data.aiProvider.today.total) * 100)}%`}
                    warn={data.aiProvider.today.total > 0 && data.aiProvider.today.failed / data.aiProvider.today.total > 0.1}
                    sub={`${data.aiProvider.today.success} ok / ${data.aiProvider.today.failed} failed`}
                  />
                  <StatCard label="Avg Latency (successful calls)" value={data.aiProvider.today.avgLatencyMs != null ? `${data.aiProvider.today.avgLatencyMs} ms` : "—"} />
                  <StatCard
                    label="Daily Quota Used (platform)"
                    value={`${data.aiProvider.quota.globalUsed} / ${data.aiProvider.quota.globalLimit}`}
                    warn={data.aiProvider.quota.globalUsed / data.aiProvider.quota.globalLimit > 0.8}
                    sub={`Per-institute cap: ${data.aiProvider.quota.perInstituteLimit}/day`}
                  />
                </div>
                {Object.keys(data.aiProvider.today.byErrorType).length > 0 && (
                  <div className="card" style={{ padding: 12, marginTop: 10, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Failures today by reason</div>
                    {Object.entries(data.aiProvider.today.byErrorType).map(([type, count]) => (
                      <div key={type} className="mono" style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span>{type}</span><span>{count}</span>
                      </div>
                    ))}
                  </div>
                )}
                {data.aiProvider.lastFailure && (
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8 }}>
                    Last failure: {data.aiProvider.lastFailure.errorType || "UNKNOWN"} on {data.aiProvider.lastFailure.feature} at {new Date(data.aiProvider.lastFailure.createdAt).toLocaleString()}
                  </div>
                )}
              </>
            )}

            <h3 style={{ fontSize: 15, marginTop: 28 }}>Recent Uncaught Errors</h3>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
              Only process-level failures that weren't already caught and handled by a route — most errors on this platform are caught and return a normal error response, so this list is usually empty.
            </p>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {data.recentErrors.length === 0 && (
                <div className="card" style={{ padding: 16, textAlign: "center", color: "var(--ink-dim)", fontSize: 13 }}>No uncaught errors since this process started.</div>
              )}
              {data.recentErrors.map((e, i) => (
                <div key={i} className="card" style={{ padding: 12, fontSize: 12 }}>
                  <span className="mono" style={{ color: "var(--rust)", fontWeight: 700 }}>{e.context}</span>
                  <span className="mono" style={{ color: "var(--ink-dim)", marginLeft: 8 }}>{new Date(e.time).toLocaleString()}</span>
                  <div className="mono" style={{ marginTop: 4 }}>{e.message}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
