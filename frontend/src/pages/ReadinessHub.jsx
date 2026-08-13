import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useToast } from "../context/ToastContext";
import api from "../api";

const LEVEL_COLORS = {
  EXCELLENTLY_READY: "#16a34a", JOB_READY: "#22c55e", NEARLY_READY: "#84cc16",
  DEVELOPING: "#f59e0b", NEEDS_IMPROVEMENT: "#f97316", FOUNDATION_REQUIRED: "#dc2626",
};

function levelLabel(level) {
  return String(level || "").replace(/_/g, " ");
}

// Student hub for the Employability & Subject Readiness Assessment module — browse
// admin-configured subjects, pick an assessment mode (each mode is a BTL-range slice of the
// subject, e.g. Foundation Readiness = BTL1-2), and start/resume; plus a look back at completed
// attempts. Mirrors the two-section (browse + history) shape MyTalentPools.jsx/InterviewHub.jsx
// already use for other student-facing modules.
export default function ReadinessHub() {
  const navigate = useNavigate();
  const toast = useToast();
  const [subjects, setSubjects] = useState(null);
  const [history, setHistory] = useState(null);
  const [starting, setStarting] = useState(null);

  useEffect(() => {
    api.get("/readiness/subjects").then((res) => setSubjects(res.data)).catch(() => toast.error("Failed to load subjects"));
    api.get("/readiness/history").then((res) => setHistory(res.data.assessments)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startAssessment(subjectId, mode) {
    const key = `${subjectId}:${mode.key}`;
    setStarting(key);
    try {
      const res = await api.post("/readiness/assessments", { subjectId, assessmentMode: mode.key });
      navigate(`/readiness/take/${res.data.assessment.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to start assessment");
    } finally {
      setStarting(null);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Employability &amp; Readiness Assessment</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14, maxWidth: 700 }}>
          Subject-wise assessments that go beyond a simple quiz score — each report breaks your
          performance down by cognitive level (Bloom's Taxonomy), topic, and difficulty, and
          explains exactly why you received the readiness level you did.
        </p>

        {!subjects && <p style={{ marginTop: 24, color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>}
        {subjects && subjects.length === 0 && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center", color: "var(--ink-dim)" }}>
            No readiness subjects have been configured for your institute yet.
          </div>
        )}

        <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
          {subjects?.map((s) => (
            <div key={s.id} className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                    {[s.department, s.program].filter(Boolean).join(" · ") || null}
                  </div>
                  {s.description && <p style={{ fontSize: 13, marginTop: 8, color: "var(--ink-dim)" }}>{s.description}</p>}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                {(Array.isArray(s.assessmentModes) ? s.assessmentModes : []).map((m) => {
                  const key = `${s.id}:${m.key}`;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      className="btn btn-primary"
                      disabled={starting === key}
                      onClick={() => startAssessment(s.id, m)}
                      title={`Bloom's Taxonomy levels ${m.btlMin}-${m.btlMax}`}
                    >
                      {starting === key ? "Starting…" : m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 48 }}>Your Assessment History</h2>
        <ChalkUnderline />
        {!history && <p style={{ marginTop: 16, color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>}
        {history && history.length === 0 && (
          <div className="card" style={{ padding: 20, marginTop: 16, textAlign: "center", color: "var(--ink-dim)" }}>
            No completed assessments yet.
          </div>
        )}
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {history?.map((a) => (
            <div
              key={a.id}
              className="card"
              style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, cursor: "pointer" }}
              onClick={() => navigate(`/readiness/report/${a.id}`)}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{a.subject?.name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                  {a.assessmentMode.replace(/_/g, " ")} · {a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : "—"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{a.report?.overallScore ?? "—"}%</span>
                {a.report && (
                  <span
                    className="mono"
                    style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: "#fff", background: LEVEL_COLORS[a.report.readinessLevel] || "#6b7280" }}
                  >
                    {levelLabel(a.report.readinessLevel)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
