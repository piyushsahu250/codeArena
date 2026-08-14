import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import InfoTip from "../components/InfoTip";
import api from "../api";
import useIsMobile from "../hooks/useIsMobile";

const LEVEL_COLORS = {
  EXCELLENTLY_READY: "#16a34a", JOB_READY: "#22c55e", NEARLY_READY: "#84cc16",
  DEVELOPING: "#f59e0b", NEEDS_IMPROVEMENT: "#f97316", FOUNDATION_REQUIRED: "#dc2626",
};
const BTL_LABELS = { 1: "Remember", 2: "Understand", 3: "Apply", 4: "Analyze", 5: "Evaluate", 6: "Create" };
const STRENGTH_COLORS = { STRONG: "#16a34a", NEEDS_IMPROVEMENT: "#f59e0b", CRITICAL: "#dc2626" };

function levelLabel(level) {
  return String(level || "").replace(/_/g, " ");
}

function scoreBar(percent, color = "var(--mint)") {
  return (
    <div style={{ height: 8, borderRadius: 999, background: "var(--card-bg, #eee)", overflow: "hidden", marginTop: 6 }}>
      <div style={{ width: `${percent}%`, height: "100%", background: color, borderRadius: 999 }} />
    </div>
  );
}

// Student-facing readiness report — deliberately avoids collapsing performance into one number:
// BTL-level breakdown (with NOT ASSESSED shown honestly for any level with zero attempted
// questions, per the module's "never fake a 0%" rule — see readinessScoring.js), topic strengths/
// weaknesses, difficulty performance, and a documented "why this level" explanation, all sourced
// directly from the ReadinessReport row the backend already computed — this page does no scoring
// of its own, only rendering.
export default function ReadinessReport() {
  const { assessmentId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.get(`/readiness/assessments/${assessmentId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load report"));
  }, [assessmentId]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const res = await api.get(`/readiness/assessments/${assessmentId}/report.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `readiness-report-${assessmentId.slice(0, 8)}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to download PDF report");
    } finally {
      setDownloading(false);
    }
  }

  if (error) {
    return (
      <div><Navbar /><div style={{ maxWidth: 700, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p></div></div>
    );
  }
  if (!data) {
    return (
      <div><Navbar /><div style={{ maxWidth: 700, margin: "0 auto", padding: 48, color: "var(--ink-dim)" }}>Loading…</div></div>
    );
  }

  const { assessment } = data;
  const report = assessment.report;

  if (!report) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: 48 }}>
          <p style={{ color: "var(--ink-dim)" }}>This assessment hasn't been submitted yet.</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate(`/readiness/take/${assessmentId}`)}>Continue assessment</button>
        </div>
      </div>
    );
  }

  const color = LEVEL_COLORS[report.readinessLevel] || "#6b7280";

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: isMobile ? "24px 16px" : "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>{assessment.subject?.name} — Readiness Report</h1>
            <ChalkUnderline />
          </div>
          <button type="button" className="btn btn-ghost" disabled={downloading} onClick={downloadPdf}>
            {downloading ? "Preparing…" : "⬇ Download PDF"}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
          {assessment.assessmentMode.replace(/_/g, " ")} · Submitted {assessment.submittedAt ? new Date(assessment.submittedAt).toLocaleString() : "—"}
        </p>
        {assessment.academicContext && (
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>{assessment.academicContext}</p>
        )}

        <div className="card" style={{ padding: 28, marginTop: 24, textAlign: "center", background: `${color}14`, border: `1px solid ${color}55` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-dim)", letterSpacing: "0.04em", display: "flex", alignItems: "center", justifyContent: "center" }}>
            OVERALL READINESS
            <InfoTip
              label="Overall Readiness"
              text="A weighted composite of your performance across every cognitive level (BTL) this assessment tested — not a simple correct/total percentage. Your readiness level below is derived from this score plus admin-configured thresholds for this subject."
            />
          </div>
          <div style={{ fontSize: 48, fontWeight: 800, marginTop: 8 }}>{report.overallScore}%</div>
          <div className="mono" style={{ display: "inline-block", marginTop: 10, fontSize: 14, fontWeight: 700, padding: "6px 16px", borderRadius: 999, color: "#fff", background: color }}>
            {levelLabel(report.readinessLevel)}
          </div>
          {assessment.coverage != null && (
            <div style={{ marginTop: 14, fontSize: 12.5, color: assessment.coverage < 70 ? "var(--rust)" : "var(--ink-dim)", fontWeight: assessment.coverage < 70 ? 700 : 400, display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
              Assessment Coverage: {assessment.coverage}%
              {assessment.coverage < 70 && " — Limited assessment coverage; additional assessment recommended."}
              <InfoTip
                label="Assessment Coverage"
                text="How much of this assessment's planned question mix (across cognitive levels) was actually available and delivered from the question bank. Lower coverage means the result is based on fewer questions than intended — treat it as a preliminary signal."
              />
            </div>
          )}
        </div>

        <h2 style={{ marginTop: 40, display: "flex", alignItems: "center" }}>
          Bloom's Taxonomy Performance
          <InfoTip
            label="Bloom's Taxonomy (BTL)"
            text="BTL 1-6 (Remember → Understand → Apply → Analyze → Evaluate → Create) is a scale of cognitive difficulty, not question difficulty. Low BTL means recalling facts; high BTL means applying, analyzing, and creating solutions — closer to what interviews and real jobs actually demand."
          />
        </h2>
        <ChalkUnderline />
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
          Levels with no questions in this assessment show "Not assessed" rather than a misleading 0%.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 16 }}>
          {[1, 2, 3, 4, 5, 6].map((lvl) => {
            const b = report.btlScores?.[lvl];
            return (
              <div key={lvl} className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>BTL {lvl} — {BTL_LABELS[lvl]}</div>
                {b ? (
                  <>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{b.percent}%</div>
                    {scoreBar(b.percent)}
                    <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 6 }}>{b.correct}/{b.attempted} correct</div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 10 }}>Not assessed</div>
                )}
              </div>
            );
          })}
        </div>

        {Array.isArray(report.topicScores) && report.topicScores.length > 0 && (
          <>
            <h2 style={{ marginTop: 40 }}>Topic Performance</h2>
            <ChalkUnderline />
            <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
              {report.topicScores.map((t, i) => (
                <div key={i} className="card" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{t.topic}{t.subtopic ? ` — ${t.subtopic}` : ""}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>{t.questionsAttempted} question(s) attempted</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700 }}>{t.accuracy}%</span>
                    <span className="mono" style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999, color: "#fff", background: STRENGTH_COLORS[t.strength] || "#6b7280" }}>
                      {t.strength.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <h2 style={{ marginTop: 40 }}>Difficulty Performance</h2>
        <ChalkUnderline />
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 14, marginTop: 16 }}>
          {["EASY", "MEDIUM", "HARD"].map((d) => {
            const v = report.difficultyScores?.[d];
            return (
              <div key={d} className="card" style={{ padding: 14, textAlign: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{d}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{v != null ? `${v}%` : "—"}</div>
                {v == null && <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Not assessed</div>}
              </div>
            );
          })}
        </div>

        {((report.dimensionScores?.coding != null) || (Array.isArray(report.employabilityIndicators) && report.employabilityIndicators.length > 0)) && (
          <>
            <h2 style={{ marginTop: 40, display: "flex", alignItems: "center" }}>
              Practical Skills
              <InfoTip
                label="Practical Skills"
                text="Scores from this assessment's actual coding/application questions, evaluated on real functionality — separate from the BTL cognitive-level breakdown above, which mixes all question types together."
              />
            </h2>
            <ChalkUnderline />
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
              How this assessment's actual coding/application questions went — separate from the
              cognitive-level breakdown above.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 16 }}>
              {report.dimensionScores?.coding != null && (
                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Coding Ability</div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{report.dimensionScores.coding}%</div>
                  {scoreBar(report.dimensionScores.coding)}
                </div>
              )}
              {report.employabilityIndicators?.map((ind, i) => (
                <div key={i} className="card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{ind.indicator}</div>
                  {ind.score != null ? (
                    <>
                      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{ind.score}%</div>
                      {scoreBar(ind.score)}
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 10 }}>Not assessed</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {(report.strongAreas?.length > 0 || report.weakAreas?.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginTop: 40 }}>
            <div>
              <h3>Strengths</h3>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {report.strongAreas?.length > 0 ? report.strongAreas.map((a, i) => (
                  <span key={i} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#16a34a22", color: "#16a34a", fontWeight: 700 }}>{a}</span>
                )) : <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>None yet — keep practicing.</span>}
              </div>
            </div>
            <div>
              <h3>Areas to Improve</h3>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {report.weakAreas?.length > 0 ? report.weakAreas.map((a, i) => (
                  <span key={i} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#dc262622", color: "#dc2626", fontWeight: 700 }}>{a}</span>
                )) : <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>None — well-rounded performance.</span>}
              </div>
            </div>
          </div>
        )}

        {Array.isArray(report.recommendations) && report.recommendations.length > 0 && (
          <>
            <h2 style={{ marginTop: 40 }}>Recommended Action Plan</h2>
            <ChalkUnderline />
            <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
              {report.recommendations.map((r, i) => (
                <div key={i} className="card" style={{ padding: 14, display: "flex", gap: 12 }}>
                  <div style={{ fontWeight: 800, fontSize: 18, color: "var(--mint)", minWidth: 24 }}>{r.priority}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.topic}</div>
                    <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 2 }}>{r.action}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {report.nextAssessmentSuggestion && (
          <div className="card" style={{ padding: 16, marginTop: 24, background: "var(--card-bg, #F7F7F5)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>WHAT'S NEXT</div>
            <p style={{ fontSize: 14, marginTop: 6 }}>{report.nextAssessmentSuggestion}</p>
          </div>
        )}

        <button type="button" className="btn btn-ghost" style={{ marginTop: 32 }} onClick={() => navigate("/readiness")}>← Back to Readiness Hub</button>
      </div>
    </div>
  );
}
