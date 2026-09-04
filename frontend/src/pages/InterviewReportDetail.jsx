import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const SCORE_LABELS = {
  completeness: "Completeness", vocabulary: "Vocabulary", communication: "Communication", confidence: "Confidence",
  professionalism: "Professionalism", correctness: "Correctness", codeQuality: "Code Quality",
};
const CATEGORY_LABEL = { HR: "HR", TECHNICAL: "Technical", CODING: "Coding", APTITUDE: "Aptitude", SYSTEM_DESIGN: "System Design", BEHAVIORAL: "Behavioral", MANAGERIAL: "Managerial" };

// Mirrors backend/src/utils/proctoringSeverity.js's 4-level taxonomy purely for display —
// NORMAL never reaches this page at all (it's never logged), so only these three ever appear.
const SEVERITY_COLOR = { INTERRUPTION: "var(--ink-dim)", SUSPICIOUS: "var(--amber)", CONFIRMED_VIOLATION: "var(--rust)" };
const SEVERITY_LABEL = { INTERRUPTION: "Interruption", SUSPICIOUS: "Suspicious", CONFIRMED_VIOLATION: "Confirmed violation" };

function sessionTypeLabel(s) {
  if (!s) return "";
  if (s.isMock) return "Mock Interview";
  if (s.isResumeBased) return "Resume-Based Interview";
  if (s.isCompanyRound) return "Company Round";
  return `${CATEGORY_LABEL[s.category] || s.category} Interview`;
}

export default function InterviewReportDetail() {
  const { sessionId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.get(`/interview/admin/sessions/${sessionId}/report`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load report"));
  }, [sessionId]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const { data: blob } = await api.get(`/interview/admin/sessions/${sessionId}/report/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `interview-report-${data?.student?.name?.replace(/\s+/g, "-") || sessionId}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to download report");
    } finally {
      setDownloading(false);
    }
  }

  if (error) return <div><Navbar /><div style={{ maxWidth: 900, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p></div></div>;
  if (!data) return <div><Navbar /><div style={{ maxWidth: 900, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;

  const { session, student, questions, report, proctoring } = data;

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div><h1>Interview Report</h1><ChalkUnderline /></div>
          <Link to="/staff/interview-reports" className="btn btn-ghost">← Back to Reports</Link>
        </div>

        <div className="card" style={{ padding: 20, marginTop: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10, fontSize: 13 }}>
            <div><div style={{ color: "var(--ink-dim)", fontSize: 11 }}>Student</div><div style={{ fontWeight: 600 }}>{student.name}</div></div>
            <div><div style={{ color: "var(--ink-dim)", fontSize: 11 }}>Roll No.</div><div className="mono">{student.rollNumber || "—"}</div></div>
            <div><div style={{ color: "var(--ink-dim)", fontSize: 11 }}>Institute</div><div>{student.institute?.name || "—"}</div></div>
            <div><div style={{ color: "var(--ink-dim)", fontSize: 11 }}>Group / Batch</div><div>{student.academicGroup ? `${student.academicGroup.department?.name || "—"} - ${student.academicGroup.section}` : (student.class?.name || "—")} {(student.academicGroup?.batch || student.batchYear) ? `(${student.academicGroup?.batch || student.batchYear})` : ""}</div></div>
            <div><div style={{ color: "var(--ink-dim)", fontSize: 11 }}>Department</div><div>{student.department || "—"}</div></div>
            <div><div style={{ color: "var(--ink-dim)", fontSize: 11 }}>Interview Type</div><div>{sessionTypeLabel(session)}{session.config?.company ? ` · ${session.config.company}` : ""}</div></div>
            <div><div style={{ color: "var(--ink-dim)", fontSize: 11 }}>Date</div><div className="mono">{session.submittedAt ? new Date(session.submittedAt).toLocaleString() : "—"}</div></div>
            <div><div style={{ color: "var(--ink-dim)", fontSize: 11 }}>Status</div><div>{session.status === "TERMINATED" ? <span className="badge" style={{ background: "var(--rust)", color: "#fff" }}>Terminated</span> : <span className="badge">Completed</span>}</div></div>
          </div>
        </div>

        {session.status === "TERMINATED" && (
          <div className="card" style={{ padding: 14, marginTop: 16, borderLeft: "4px solid var(--rust)" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rust)" }}>⚠ Terminated early — reason: {session.terminationReason || "proctoring rule violations"}.</span>
          </div>
        )}

        {!report ? (
          <div className="card" style={{ padding: 24, marginTop: 20, textAlign: "center", color: "var(--ink-dim)" }}>This interview hasn't been submitted/scored yet.</div>
        ) : (
          <>
            <div className="card" style={{ padding: 28, marginTop: 20, textAlign: "center" }}>
              <div className="mono" style={{ fontSize: 44, fontWeight: 700, color: "var(--ip-accent, #4F9D6E)" }}>{report.overallScore}%</div>
              <div style={{ opacity: 0.7 }}>Overall Score</div>
            </div>

            {Object.keys(report.scoreBreakdown || {}).length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 16 }}>
                {Object.entries(report.scoreBreakdown).filter(([k]) => SCORE_LABELS[k]).map(([k, v]) => (
                  <div key={k} className="card" style={{ padding: 14 }}>
                    <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{v}%</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{SCORE_LABELS[k]}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ip-accent, #4F9D6E)" }}>Strong Areas</div>
                {report.strongAreas?.length ? <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>{report.strongAreas.map((a, i) => <li key={i}>{a}</li>)}</ul> : <p style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>None identified yet.</p>}
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--rust)" }}>Weak Areas</div>
                {report.weakAreas?.length ? <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>{report.weakAreas.map((a, i) => <li key={i}>{a}</li>)}</ul> : <p style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>None — evenly balanced.</p>}
              </div>
            </div>

            <div className="card" style={{ padding: 16, marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Recommendations</div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>{(report.recommendations || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          </>
        )}

        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Proctoring Report</div>
          <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
            Only <span style={{ color: SEVERITY_COLOR.CONFIRMED_VIOLATION }}>confirmed violations</span> count toward
            "Total Violations" below — <span style={{ color: SEVERITY_COLOR.SUSPICIOUS }}>suspicious</span> events only
            escalate into one after repeating, and <span style={{ color: SEVERITY_COLOR.INTERRUPTION }}>interruptions</span> never
            do. See utils/proctoringSeverity.js for the exact classification.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 10, marginTop: 10, fontSize: 13 }}>
            <div><div style={{ color: "var(--ink-dim)", fontSize: 11 }}>Total Violations</div><div className="mono" style={{ fontWeight: 700 }}>{proctoring.violationCount}</div></div>
            {Object.entries(proctoring.byType).map(([type, count]) => {
              const severity = proctoring.events.find((e) => e.type === type)?.severity;
              return (
                <div key={type}>
                  <div style={{ color: "var(--ink-dim)", fontSize: 11 }}>{type.replace(/_/g, " ")}</div>
                  <div className="mono" style={{ fontWeight: 700, color: SEVERITY_COLOR[severity] || "inherit" }}>{count}</div>
                  {severity && <div style={{ fontSize: 10, color: SEVERITY_COLOR[severity] }}>{SEVERITY_LABEL[severity]}</div>}
                </div>
              );
            })}
          </div>
          {proctoring.events.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>No proctoring events recorded for this session.</p>}
        </div>

        <h3 style={{ fontSize: 16, marginTop: 32 }}>Questions & Answers</h3>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {questions.map((q, i) => (
            <div key={i} className="card" style={{ padding: 14, fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>Q{i + 1}. [{CATEGORY_LABEL[q.category] || q.category}{q.subject ? ` · ${q.subject}` : ""}] {q.prompt}</div>
              <div style={{ marginTop: 8 }}>
                {!q.answer || q.answer.skipped ? (
                  <span style={{ color: "var(--ink-dim)" }}>Skipped</span>
                ) : q.category === "CODING" ? (
                  <>
                    <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>Language: {q.answer.language || "—"}</div>
                    <pre style={{ background: "var(--bg-subtle, #f4f4f4)", padding: 10, borderRadius: 6, overflowX: "auto", fontSize: 12, marginTop: 6 }}>{q.answer.code || "(no code submitted)"}</pre>
                  </>
                ) : q.category === "APTITUDE" ? (
                  <div>Selected answer: {(() => { const idx = q.answer.answerText != null && q.answer.answerText !== "" ? Number(q.answer.answerText) : null; return idx != null && q.options?.[idx] ? q.options[idx] : "—"; })()}</div>
                ) : (
                  <div>{q.answer.answerText || "(no answer)"}</div>
                )}
              </div>
              <div className="mono" style={{ marginTop: 8, fontSize: 12, color: "var(--ink-dim)" }}>Score: {q.answer?.score ?? 0}/100</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
          <button className="btn btn-primary" onClick={downloadPdf} disabled={downloading || !report}>{downloading ? "Preparing…" : "⬇ Download Detailed Report (PDF)"}</button>
        </div>
      </div>
    </div>
  );
}
