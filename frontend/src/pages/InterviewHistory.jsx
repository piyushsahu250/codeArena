import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import "./interviewPrep.css";

export default function InterviewHistory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  function load() {
    setError("");
    // Previously had no .catch() at all — a failed request left `data` null forever, so the page
    // showed "Loading…" indefinitely with no error and no way to recover short of a full reload.
    api.get("/interview/sessions", { params: { page } })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load interview history."));
  }

  useEffect(load, [page]);

  return (
    <div className="interview-prep">
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><h1>Interview History</h1><ChalkUnderline /></div>
          <Link to="/interview" className="btn btn-ghost">← AI Mock Interview</Link>
        </div>

        {!data && !error && <p className="mono" style={{ marginTop: 24 }}>Loading…</p>}
        {error && (
          <div className="ip-glass" style={{ padding: 24, marginTop: 24, textAlign: "center" }}>
            <p style={{ color: "var(--rust)" }}>{error}</p>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={load}>Retry</button>
          </div>
        )}
        {data && data.sessions.length === 0 && <div className="ip-glass" style={{ padding: 24, marginTop: 24, textAlign: "center" }}>No completed interviews yet.</div>}

        <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
          {data?.sessions.map((s) => {
            const durationSec = s.submittedAt ? Math.round((new Date(s.submittedAt) - new Date(s.startedAt)) / 1000) : null;
            const durationLabel = durationSec != null ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : "—";
            const typeLabel = s.isMock ? "Mock Interview" : s.isCompanyRound ? "Company Round" : s.isResumeBased ? "Resume-based Interview" : `${s.category} Interview`;
            return (
              <Link key={s.id} to={`/interview/report/${s.id}`} className="ip-glass" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none", color: "inherit", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {typeLabel}
                    {s.config?.company && <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}>{s.config.company}</span>}
                    {s.status === "TERMINATED" && <span className="badge" style={{ marginLeft: 8, fontSize: 11, background: "var(--rust)", color: "#fff" }}>Terminated</span>}
                  </div>
                  <div className="mono" style={{ fontSize: 12, opacity: 0.7 }}>
                    {new Date(s.submittedAt).toLocaleString()} · {durationLabel}
                  </div>
                </div>
                <div className="mono" style={{ fontWeight: 700, color: s.status === "TERMINATED" ? "var(--rust)" : "var(--ip-accent)" }}>{s.report?.overallScore ?? "—"}%</div>
              </Link>
            );
          })}
        </div>

        {data && data.totalPages > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "center" }}>
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span className="mono" style={{ alignSelf: "center", fontSize: 13 }}>Page {data.page} / {data.totalPages}</span>
            <button className="btn btn-ghost" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
