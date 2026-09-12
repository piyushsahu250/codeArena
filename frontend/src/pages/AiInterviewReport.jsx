import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api";
import Card from "../components/Card";
import Button from "../components/Button";
import "./aiInterview.css";
import "./aiInterviewReport.css";

const DECISION_LABEL = {
  STRONG: "Strong",
  GOOD: "Good",
  BORDERLINE: "Borderline",
  NEEDS_IMPROVEMENT: "Needs Improvement",
};

const SCORE_ROWS = [
  { key: "technicalScore", label: "Technical Knowledge" },
  { key: "problemSolvingScore", label: "Problem Solving" },
  { key: "communicationScore", label: "Communication" },
  { key: "confidenceScore", label: "Confidence" },
  { key: "roleFitScore", label: "Role Fit" },
];

export default function AiInterviewReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data } = await api.get(`/ai-interviews/${id}/report`);
        if (!cancelled) setReport(data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || "Report is not available yet.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  async function loadTranscript() {
    if (transcript) { setShowTranscript((s) => !s); return; }
    const { data } = await api.get(`/ai-interviews/${id}/transcript`);
    setTranscript(data);
    setShowTranscript(true);
  }

  if (loading) return <div className="ai-int-page ai-int-centered"><p>Generating your report…</p></div>;

  if (error) {
    return (
      <div className="ai-int-page ai-int-centered">
        <p className="ai-int-error">{error}</p>
        <Button variant="ghost" onClick={() => navigate("/ai-interview")}>Back to AI Interviews</Button>
      </div>
    );
  }

  return (
    <div className="ai-int-page ai-report-wrap">
      <div className="ai-report-container">
        <div className="ai-report-header">
          <div>
            <h1>Interview Report</h1>
            <p>{new Date(report.createdAt).toLocaleString()}</p>
          </div>
          <div className={`ai-report-decision ${report.decision.toLowerCase()}`}>
            {DECISION_LABEL[report.decision] || report.decision}
          </div>
        </div>

        <Card padding={24} className="ai-report-overall">
          <div className="ai-report-overall-score">{report.overallScore}</div>
          <div className="ai-report-overall-label">Overall Score / 100</div>
        </Card>

        <Card padding={20} className="ai-report-scores">
          {SCORE_ROWS.map((row) => (
            <div key={row.key} className="ai-report-score-row">
              <span>{row.label}</span>
              <div className="ai-report-score-bar">
                <div className="ai-report-score-fill" style={{ width: `${report[row.key]}%` }} />
              </div>
              <span className="ai-report-score-value">{report[row.key]}</span>
            </div>
          ))}
        </Card>

        {Object.keys(report.skillScores || {}).length > 0 && (
          <Card padding={20}>
            <h3>Skill Coverage</h3>
            <div className="ai-report-skill-grid">
              {Object.entries(report.skillScores).map(([skill, score]) => (
                <div key={skill} className="ai-report-skill-chip">
                  <span>{skill}</span>
                  <strong>{Math.round(score)}%</strong>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="ai-report-grid-2">
          <Card padding={20}>
            <h3>Strengths</h3>
            <ul>{(report.strengths || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
          </Card>
          <Card padding={20}>
            <h3>Areas to Improve</h3>
            <ul>{(report.weaknesses || []).map((w, i) => <li key={i}>{w}</li>)}</ul>
          </Card>
        </div>

        {report.recommendedLearning?.length > 0 && (
          <Card padding={20}>
            <h3>Recommended Learning</h3>
            <ul>{report.recommendedLearning.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </Card>
        )}

        <div className="ai-report-actions">
          <Button variant="ghost" onClick={loadTranscript}>{showTranscript ? "Hide Transcript" : "View Transcript"}</Button>
          <Button variant="primary" onClick={() => navigate("/ai-interview")}>Back to AI Interviews</Button>
        </div>

        {showTranscript && transcript && (
          <Card padding={20} className="ai-report-transcript">
            {transcript.map((turn) => (
              <div key={turn.turnIndex} className="ai-report-transcript-turn">
                <p className="ai-report-transcript-q"><strong>Q{turn.turnIndex + 1}.</strong> {turn.questionText}</p>
                <p className="ai-report-transcript-a">{turn.skipped ? "(skipped)" : turn.answerText || "(no answer recorded)"}</p>
              </div>
            ))}
          </Card>
        )}

        <p className="ai-report-footnote">Decision rule version: {report.decisionRuleVersion} — computed from configured scoring weights, not a freeform AI judgment.</p>
      </div>
    </div>
  );
}
