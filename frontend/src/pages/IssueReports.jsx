import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const STATUSES = ["PENDING", "TRIAGED", "IN_PROGRESS", "RESOLVED", "DUPLICATE", "WONT_FIX"];
const STATUS_COLOR = {
  PENDING: "var(--rust)", TRIAGED: "var(--amber-dark)", IN_PROGRESS: "var(--amber-dark)",
  RESOLVED: "var(--mint)", DUPLICATE: "var(--ink-dim)", WONT_FIX: "var(--ink-dim)",
};

// Manual review queue for user-submitted "Report a Problem" issues. No auto-classification, no
// auto-fix — an admin/institute-admin/super-admin reads each report and sets status/severity/notes
// by hand. See backend/src/routes/issueReports.js for the institute-scoping rule.
export default function IssueReports({ basePath }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [savingId, setSavingId] = useState(null);

  function load() {
    api.get("/issue-reports", { params: statusFilter ? { status: statusFilter } : {} })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load reports"));
  }

  useEffect(load, [statusFilter]);

  async function updateStatus(id, status) {
    setSavingId(id);
    try {
      await api.patch(`/issue-reports/${id}`, { status });
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update report");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Reported Problems</h1>
            <ChalkUnderline />
          </div>
          <Link to={basePath || "/admin"} className="btn btn-ghost">← Back</Link>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 16 }}>
          Problems submitted by students/staff via "Report a Problem". Triage manually — nothing here is auto-fixed or auto-deployed.
          {data && typeof data.openCount === "number" && <strong> {data.openCount} open.</strong>}
        </p>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className={`btn ${statusFilter === "" ? "btn-primary" : "btn-ghost"}`} onClick={() => setStatusFilter("")}>All</button>
          {STATUSES.map((s) => (
            <button key={s} className={`btn ${statusFilter === s ? "btn-primary" : "btn-ghost"}`} onClick={() => setStatusFilter(s)}>
              {s.replace("_", " ")}
            </button>
          ))}
        </div>

        {error && <p style={{ color: "var(--rust)", marginTop: 24 }}>{error}</p>}

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {data === null && !error && <p className="mono" style={{ color: "var(--ink-dim)" }}>Loading…</p>}
          {data?.issues.length === 0 && <p style={{ color: "var(--ink-dim)" }}>No reports match this filter.</p>}
          {data?.issues.map((issue) => (
            <div key={issue.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <span style={{ fontWeight: 600, color: STATUS_COLOR[issue.status] }}>{issue.status.replace("_", " ")}</span>
                  {issue.page && <span style={{ marginLeft: 10, fontSize: 12, color: "var(--ink-dim)" }}>Page: {issue.page}</span>}
                  {issue.feature && <span style={{ marginLeft: 10, fontSize: 12, color: "var(--ink-dim)" }}>Feature: {issue.feature}</span>}
                </div>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{new Date(issue.createdAt).toLocaleString()}</span>
              </div>
              <p style={{ marginTop: 10, fontSize: 14 }}>{issue.description}</p>
              <p style={{ marginTop: 6, fontSize: 12, color: "var(--ink-dim)" }}>
                Reported by role: {issue.reportedByRole}{issue.errorId && ` · Error ID: ${issue.errorId}`}
              </p>
              {issue.reviewNotes && (
                <p style={{ marginTop: 6, fontSize: 12, fontStyle: "italic", color: "var(--ink-dim)" }}>
                  Note: {issue.reviewNotes} {issue.reviewedByName && `— ${issue.reviewedByName}`}
                </p>
              )}
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {STATUSES.filter((s) => s !== issue.status).map((s) => (
                  <button
                    key={s}
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "6px 10px" }}
                    disabled={savingId === issue.id}
                    onClick={() => updateStatus(issue.id, s)}
                  >
                    Mark {s.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
