import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import api from "../api";
import { useToast } from "../context/ToastContext";

// Same status derivation StudentDashboard.jsx uses for its "Upcoming Tests" cards — kept as a
// local copy rather than a shared import since this platform's convention is each dashboard page
// owns its own small status-label helper (StaffDashboard/StudentDashboard both do the same).
function statusOf(test) {
  if (test.myStatus === "SUBMITTED" || test.myStatus === "AUTO_SUBMITTED") return { label: "Completed", color: "var(--mint)", completed: true };
  if (!test.isPublished) return { label: "Not yet published", color: "var(--ink-dim)" };
  const now = new Date();
  const start = new Date(test.startTime), end = new Date(test.endTime);
  if (now < start) return { label: "Upcoming", color: "var(--ink-dim)" };
  if (now > end) return { label: "Closed", color: "var(--rust)" };
  return { label: "Live now", color: "var(--mint)" };
}

// Student's own Talent Pool memberships — self-scoped entirely server-side (GET
// /talent-pools/my-pools reads req.user.id only), same "nothing to filter, just display"
// shape as MyAttendance.jsx.
export default function MyTalentPools() {
  const navigate = useNavigate();
  const toast = useToast();
  const [pools, setPools] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/talent-pools/my-pools")
      .then((res) => setPools(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load your Talent Pools"));
  }, []);

  async function attend(test) {
    try {
      await api.post(`/tests/${test.id}/start`);
      navigate(`/test/${test.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not start test");
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <h1>My Talent Pools</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Special groups you've been added to, with any exclusive assessments reserved for members.
        </p>

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 16 }}>{error}</p>}
        {!pools && !error && <p style={{ marginTop: 24, color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>}

        {pools && pools.length === 0 && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center", color: "var(--ink-dim)" }}>
            You're not currently a member of any Talent Pool.
          </div>
        )}

        <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
          {pools?.map((entry) => (
            <div key={entry.pool.id} className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{entry.pool.name}</div>
                  {entry.pool.description && <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>{entry.pool.description}</div>}
                </div>
                <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>Added {new Date(entry.addedAt).toLocaleDateString()}</span>
              </div>

              <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Test Rank</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {entry.testRank.rank != null ? `${entry.testRank.rank} / ${entry.testRank.totalStudents}` : "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Interview Rank</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {entry.interviewRank.rank != null ? `${entry.interviewRank.rank} / ${entry.interviewRank.totalStudents}` : "—"}
                  </div>
                </div>
              </div>

              {entry.exclusiveTests.length > 0 && (
                <>
                  <h4 style={{ fontSize: 13, marginTop: 16 }}>Exclusive Tests</h4>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {entry.exclusiveTests.map((t) => {
                      const status = statusOf(t);
                      return (
                        <div
                          key={t.id}
                          style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10,
                            fontSize: 13, padding: "10px 12px", background: "var(--paper-alt, #f7f5ef)", borderRadius: 8,
                          }}
                        >
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <strong>{t.title}</strong>
                              <span className="mono" style={{ fontSize: 11, color: status.color, fontWeight: 700 }}>● {status.label}</span>
                            </div>
                            <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 3 }}>
                              {t._count?.questions || 0} questions · {t.durationMin} min · {new Date(t.startTime).toLocaleString()}
                            </p>
                          </div>
                          <button
                            className="btn btn-dark"
                            disabled={status.label !== "Live now"}
                            style={{ opacity: status.label !== "Live now" ? 0.4 : 1, fontSize: 12 }}
                            onClick={() => attend(t)}
                          >
                            {status.label === "Live now" ? "Start Test →" : status.label}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {entry.interviewConfigs.length > 0 && (
                <>
                  <h4 style={{ fontSize: 13, marginTop: 16 }}>Exclusive Mock Interviews</h4>
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    {entry.interviewConfigs.map((c) => (
                      <div key={c.id} style={{ fontSize: 13, padding: "8px 12px", background: "var(--paper-alt, #f7f5ef)", borderRadius: 8 }}>
                        {c.label}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {entry.exclusiveTests.length === 0 && entry.interviewConfigs.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 12 }}>No exclusive assessments assigned yet.</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
