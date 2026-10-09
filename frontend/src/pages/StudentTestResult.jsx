import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

export default function StudentTestResult() {
  const { id } = useParams();
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/tests/${id}/my-result`)
      .then((res) => setResult(res.data))
      .catch((err) => setError(err.response?.data?.error || "Could not load result"))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Your result</h1>
            <ChalkUnderline />
          </div>
          <Link to="/dashboard" className="btn btn-ghost">← Back to tests</Link>
        </div>

        {loading && <p className="mono" style={{ marginTop: 24 }}>Loading…</p>}
        {error && <p style={{ color: "var(--rust)", marginTop: 24 }}>{error}</p>}

        {result && !result.showResults && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center", color: "var(--ink-dim)" }}>
            Your test has been submitted (status: {result.status}). Results for this test aren't published to
            students yet — check back later or ask your faculty.
          </div>
        )}

        {result && result.showResults && (
          <div className="card" style={{ padding: 24, marginTop: 24 }}>
            <div className="mono" style={{ fontSize: 40, fontWeight: 700, color: "var(--mint)" }}>{result.totalScore}</div>
            <div style={{ fontSize: 13, color: "var(--ink-dim)" }}>
              total points{result.maxScore != null ? ` out of ${result.maxScore}` : ""}{result.passingMarks != null ? ` · passing marks: ${result.passingMarks}` : ""}
            </div>
            {result.expectedQuestionCount != null && (
              <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>
                {result.expectedQuestionCount} questions assigned · {result.answeredCount} answered{result.unansweredCount > 0 ? ` · ${result.unansweredCount} unanswered (scored 0)` : ""}
              </div>
            )}
            {result.passingMarks != null && (
              <div className="mono" style={{ marginTop: 8, fontWeight: 700, color: result.totalScore >= result.passingMarks ? "var(--mint)" : "var(--rust)" }}>
                {result.totalScore >= result.passingMarks ? "PASSED" : "NOT PASSED"}
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 12 }}>
              Submitted {new Date(result.submittedAt).toLocaleString()}
              {result.tabSwitchCount > 0 && ` · ${result.tabSwitchCount} tab switch${result.tabSwitchCount > 1 ? "es" : ""} recorded`}
            </div>

            <div style={{ marginTop: 20, display: "grid", gap: 8 }}>
              {result.submissions.map((s, i) => {
                const isCoding = s.totalCases > 0 || s.timeMs != null;
                return (
                  <div key={s.id} className="card" style={{ padding: 12, fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span className="mono">{isCoding ? `Question ${i + 1}` : s.verdict}</span>
                      <span className="mono" style={{ fontWeight: 700 }}>{s.score} pts</span>
                    </div>
                    {isCoding && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-dim)" }} className="mono">
                        {s.verdict} — {s.passedCases}/{s.totalCases} hidden test case{s.totalCases === 1 ? "" : "s"} passed
                        {s.timeMs != null && ` · ⏱ ${s.timeMs} ms`}
                        {s.memoryKb != null && ` · ${(s.memoryKb / 1024).toFixed(1)} MB`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
