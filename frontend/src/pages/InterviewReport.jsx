import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import useAiStatus from "../hooks/useAiStatus";
import { useFeatures } from "../context/FeatureContext";
import "./interviewPrep.css";

const SCORE_LABELS = {
  completeness: "Completeness", vocabulary: "Vocabulary", communication: "Communication", confidence: "Confidence",
  professionalism: "Professionalism", correctness: "Correctness", codeQuality: "Code Quality",
};

export default function InterviewReport() {
  const aiAvailable = useAiStatus();
  const { isFeatureEnabled } = useFeatures();
  const { id } = useParams();
  const location = useLocation();
  const [report, setReport] = useState(location.state?.report || null);
  const [recommendedLearning, setRecommendedLearning] = useState(location.state?.recommendedLearning || null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  // aiInsightsPhase mirrors the backend's persisted GENERATING/READY/FAILED status so a page
  // refresh mid-generation recovers into the right state instead of starting a second request —
  // "idle" means nothing has ever been requested yet.
  const [aiInsightsPhase, setAiInsightsPhase] = useState("idle");
  const [aiInsights, setAiInsights] = useState(null);
  const [aiInsightsError, setAiInsightsError] = useState("");

  // POLL_MS matches how quickly a genuine generation typically finishes; the backend self-heals
  // a stuck GENERATING row after 60s regardless, so polling never runs forever even if a response
  // is somehow missed.
  async function getAiInsights({ retry = false } = {}) {
    setAiInsightsPhase("GENERATING");
    setAiInsightsError("");
    try {
      const { data } = await api.get(`/interview/sessions/${id}/ai-insights`, { params: retry ? { retry: 1 } : undefined });
      if (data.status === "GENERATING") {
        setTimeout(() => getAiInsights(), 2500);
        return;
      }
      if (data.status === "FAILED") {
        setAiInsightsPhase("FAILED");
        setAiInsightsError(data.error || "AI analysis failed");
        return;
      }
      setAiInsights(data);
      setAiInsightsPhase("READY");
    } catch (err) {
      setAiInsightsPhase("FAILED");
      setAiInsightsError(err.response?.data?.error || "AI analysis failed");
    }
  }

  // Deliberately NOT auto-fetched on mount — this stays an explicit, billed action the student
  // opts into (unchanged from before), never fired just from viewing the report. What changed:
  // the backend now persists status, so clicking the button again after a refresh (whether a
  // generation was still running or had already finished) resumes/returns the real cached result
  // instead of firing a second Gemini call for the same request.

  useEffect(() => {
    api.get(`/interview/sessions/${id}`).then((res) => {
      setSessionStatus(res.data.session.status);
      setSession(res.data.session);
      if (res.data.session.report) setReport(res.data.session.report);
      else if (!report) setError("This interview hasn't been submitted yet.");
      if (!recommendedLearning) setRecommendedLearning(res.data.recommendedLearning || []);
    }).catch((err) => { if (!report) setError(err.response?.data?.error || "Failed to load report"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function downloadReportPdf() {
    setDownloading(true);
    try {
      const { data: blob } = await api.get(`/interview/sessions/${id}/report/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "interview-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to download report");
    } finally {
      setDownloading(false);
    }
  }

  if (error) return <div className="interview-prep"><Navbar /><div style={{ maxWidth: 800, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p></div></div>;
  if (!report) return <div className="interview-prep"><Navbar /><div style={{ maxWidth: 800, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;

  return (
    <div className="interview-prep">
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><h1>Feedback Report</h1><ChalkUnderline /></div>
          <Link to="/interview" className="btn btn-ghost">← AI Mock Interview</Link>
        </div>

        {sessionStatus === "TERMINATED" && (
          <div className="ip-glass" style={{ padding: 14, marginTop: 16, borderLeft: "4px solid var(--rust)" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rust)" }}>⚠ This interview was terminated early for proctoring rule violations.</span>
            <span style={{ fontSize: 12, opacity: 0.75, marginLeft: 6 }}>The score below reflects only what was answered before termination.</span>
          </div>
        )}

        <div className="ip-glass" style={{ padding: 28, marginTop: 20, textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 44, fontWeight: 700, color: "var(--ip-accent)" }}>{report.overallScore}%</div>
          <div style={{ opacity: 0.7 }}>Overall Score</div>
          {typeof report.companyReadinessScore === "number" && Array.isArray(session?.roundPlanSnapshot) && session.roundPlanSnapshot.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: session.eliminatedAtRound ? "var(--rust)" : "var(--ip-accent)" }}>
                {report.companyReadinessScore}%
              </div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>
                Company Readiness Score{session.config?.company ? ` — ${session.config.company}` : ""}
              </div>
            </div>
          )}
        </div>

        {Array.isArray(session?.roundPlanSnapshot) && session.roundPlanSnapshot.length > 0 && (
          <div className="ip-glass" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Round-by-Round Breakdown</div>
            {session.eliminatedAtRound && (
              <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "rgba(200,60,60,0.1)", color: "var(--rust)", fontSize: 13, fontWeight: 600 }}>
                Eliminated at Round {session.eliminatedAtRound}
              </div>
            )}
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {(session.roundResults || []).map((r) => (
                <div key={r.roundNumber} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, padding: "8px 10px", borderRadius: 6, background: "var(--card-bg, #F7F7F5)" }}>
                  <span className="badge" style={{
                    fontSize: 11,
                    background: r.status === "PASSED" ? "var(--ip-accent)" : r.status === "ELIMINATED" ? "var(--rust)" : r.status === "IN_PROGRESS" ? "var(--amber)" : "var(--ink-dim)",
                  }}>
                    {r.status === "NOT_REACHED" ? "Not Reached" : r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                  </span>
                  <span style={{ fontWeight: 600 }}>Round {r.roundNumber}: {r.label}</span>
                  {typeof r.score === "number" && <span style={{ marginLeft: "auto", opacity: 0.75 }}>{r.score}%</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {report.timeEfficiency && (
          <div className="ip-glass" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Time Efficiency</div>
            <p style={{ fontSize: 13, marginTop: 8 }}>
              You averaged <strong>{report.timeEfficiency.avgTimePerQuestionSec}s</strong> per question against a ~{report.timeEfficiency.budgetSecPerQuestion}s budget —{" "}
              {report.timeEfficiency.comparedToBudget === "over" ? "slower than the expected pace." : report.timeEfficiency.comparedToBudget === "under" ? "faster than the expected pace." : "right on pace."}
            </p>
            {report.optimizationSuggestions?.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
                {report.optimizationSuggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </div>
        )}

        {Object.keys(report.scoreBreakdown || {}).length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 16 }}>
            {Object.entries(report.scoreBreakdown).filter(([k]) => SCORE_LABELS[k]).map(([k, v]) => (
              <div key={k} className="ip-glass" style={{ padding: 14 }}>
                <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{v}%</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{SCORE_LABELS[k]}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
          <div className="ip-glass" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ip-accent)" }}>Strong Areas</div>
            {report.strongAreas?.length ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>{report.strongAreas.map((a, i) => <li key={i}>{a}</li>)}</ul>
            ) : <p style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>None identified yet.</p>}
          </div>
          <div className="ip-glass" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--rust)" }}>Weak Areas</div>
            {report.weakAreas?.length ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>{report.weakAreas.map((a, i) => <li key={i}>{a}</li>)}</ul>
            ) : <p style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>None — nice and even!</p>}
          </div>
        </div>

        <div className="ip-glass" style={{ padding: 16, marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Recommendations</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {(report.recommendations || []).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>

        <div className="ip-glass" style={{ padding: 16, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>AI Performance Analysis</div>
            {aiAvailable === false ? (
              <span style={{ fontSize: 11, color: "var(--ink-dim)" }}>Coming soon</span>
            ) : aiInsightsPhase === "FAILED" ? (
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => getAiInsights({ retry: true })}>
                Retry
              </button>
            ) : (
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => getAiInsights()} disabled={aiInsightsPhase === "GENERATING" || aiAvailable !== true}>
                {aiInsightsPhase === "GENERATING" ? "AI is analyzing your interview…" : aiInsightsPhase === "READY" ? "Regenerate" : "Get AI Analysis"}
              </button>
            )}
          </div>
          {aiAvailable === false && (
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>AI-powered analysis isn't available on this server yet.</p>
          )}
          {aiInsightsPhase === "GENERATING" && (
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>This usually takes a few seconds — checking for a result…</p>
          )}
          {aiInsightsPhase === "FAILED" && (
            <p style={{ color: "var(--rust)", fontSize: 12, marginTop: 8 }}>{aiInsightsError || "AI generation failed. Please try again."}</p>
          )}
          {aiInsightsPhase === "READY" && aiInsights && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 12 }}>
                {[
                  ["Overall", aiInsights.overallScore], ["Communication", aiInsights.communicationScore],
                  ["Technical", aiInsights.technicalScore], ["Confidence", aiInsights.confidenceScore],
                  ["Relevance", aiInsights.relevanceScore],
                ].filter(([, v]) => typeof v === "number").map(([label, value]) => (
                  <div key={label} style={{ textAlign: "center", padding: "8px 4px", borderRadius: 8, background: "var(--surface-2, rgba(0,0,0,0.04))" }}>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>{label}</div>
                  </div>
                ))}
              </div>
              {aiInsights.strengths?.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>Strengths</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{aiInsights.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </>
              )}
              {aiInsights.weaknesses?.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>Weaknesses</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{aiInsights.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </>
              )}
              {aiInsights.recommendations?.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>Recommendations</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{aiInsights.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </>
              )}
              {aiInsights.questionFeedback?.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>Per-question feedback</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {aiInsights.questionFeedback.map((qf, i) => (
                      <li key={i}><strong>{qf.question}:</strong> {qf.feedback}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        {recommendedLearning?.length > 0 && (
          <div className="ip-glass" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ip-accent)" }}>Recommended Learning</div>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {recommendedLearning.map((rec, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <strong>{rec.area}:</strong> {rec.action}{" "}
                  <Link to={rec.link} style={{ color: "var(--ip-accent)" }}>→</Link>
                  {typeof rec.suggestedCodingPractice === "number" && rec.suggestedCodingPractice > 0 && (
                    <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>{rec.suggestedCodingPractice} practice problem{rec.suggestedCodingPractice === 1 ? "" : "s"}</span>
                  )}
                  {rec.suggestedQuestions?.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {rec.suggestedQuestions.map((q) => (
                        <span key={q.id} className="mono" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)" }}>
                          {q.title || q.category} · {q.difficulty}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
          <Link to="/interview" className="btn btn-primary">Practice Again</Link>
          {isFeatureEnabled("interview_history") && <Link to="/interview/history" className="btn btn-ghost">View History</Link>}
          <button className="btn btn-ghost" onClick={downloadReportPdf} disabled={downloading}>
            {downloading ? "Preparing…" : "⬇ Download Detailed Report (PDF)"}
          </button>
        </div>
      </div>
    </div>
  );
}
