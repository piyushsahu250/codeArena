import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api";
import Navbar from "../../components/Navbar";
import ChalkUnderline from "../../components/ChalkUnderline";
import { examErrorMessage } from "../../utils/examProgress";
import "./exam.css";

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

function statusChip(attempt) {
  if (!attempt) return null;
  const map = { READINESS_CHECK: ["Not started", "warn"], IN_PROGRESS: ["In progress", "warn"], SUBMITTED: ["Submitted", "ok"], EXPIRED: ["Time ended — submitted", "ok"], EVALUATING: ["Being evaluated", "warn"], COMPLETED: ["Completed", "ok"], INVALIDATED: ["Withdrawn", "bad"] };
  const [label, tone] = map[attempt.status] || [attempt.status, ""];
  return <span className={`ex-chip ${tone}`}>{label}</span>;
}

export default function ExamHub() {
  const navigate = useNavigate();
  const [exams, setExams] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let live = true;
    api.get("/exams/available").then((r) => { if (live) setExams(r.data.exams || []); }).catch((e) => { if (live) setError(examErrorMessage(e, "Could not load your examinations.")); });
    return () => { live = false; };
  }, []);

  async function start(exam, mode) {
    setBusy(`${exam.id}:${mode}`); setError(null);
    try {
      const { data } = await api.post(`/exams/${exam.id}/attempts`, { mode });
      navigate(`/exams/attempt/${data.attemptId}`);
    } catch (e) { setError(examErrorMessage(e)); setBusy(null); }
  }

  return (
    <div>
      <Navbar />
      <div className="ex-page">
        <div className="ex-head">
          <div>
            <h1>Examinations</h1>
            <ChalkUnderline />
            <p className="ex-sub">Section-wise examinations: Aptitude, Technical, Coding and AI Mock Interview in one attempt.</p>
          </div>
        </div>
        {error && <div className="ex-notice bad" role="alert">{error}</div>}
        {!exams && !error && <p className="mono">Loading…</p>}
        {exams && exams.length === 0 && <div className="ex-card ex-muted">No examination is available for you right now.</div>}
        <div className="ex-grid">
          {(exams || []).map((e) => {
            const formal = e.formalAttempt;
            const proctored = e.mode === "PROCTORED";
            const formalDone = formal && !["READINESS_CHECK", "IN_PROGRESS"].includes(formal.status);
            return (
              <div key={e.id} className="ex-card">
                <div className="ex-row between">
                  <h3>{e.title}</h3>
                  {proctored ? <span className="ex-chip">Official</span> : <span className="ex-chip">Practice</span>}
                </div>
                {e.description && <p className="ex-sub">{e.description}</p>}
                <p className="ex-sub">{e.durationMin} minutes · {e.totalMarks} marks</p>
                {proctored && <p className="ex-sub">Opens {fmt(e.startAt)} · closes {fmt(e.endAt)}</p>}
                <ul className="ex-list">
                  {e.sections.map((s) => <li key={s.key}>{s.label}: {s.questionCount} {s.key === "CODING" ? "problem(s)" : "question(s)"}, {s.maxMarks} marks{s.durationMin ? `, ${s.durationMin} min` : ""}</li>)}
                </ul>
                <div className="ex-row" style={{ marginTop: 12 }}>
                  {statusChip(formal)}
                  {proctored && formal && !formalDone && (
                    <button className="btn btn-primary" onClick={() => navigate(`/exams/attempt/${formal.id}`)}>Continue</button>
                  )}
                  {proctored && formalDone && (
                    <Link className="btn btn-ghost" to={`/exams/attempt/${formal.id}/report`}>View result</Link>
                  )}
                  {proctored && !formal && (
                    <button className="btn btn-primary" disabled={!e.windowOpen || busy === `${e.id}:PROCTORED`} onClick={() => start(e, "PROCTORED")}>{e.windowOpen ? "Start examination" : "Not open"}</button>
                  )}
                  {e.practiceEnabled && (
                    <button className="btn btn-ghost" disabled={busy === `${e.id}:PRACTICE`} onClick={() => start(e, "PRACTICE")}>Practice</button>
                  )}
                </div>
                {proctored && !formal && <p className="ex-sub" style={{ marginTop: 8 }}>You have one official attempt. It needs camera, microphone and fullscreen, and cannot be restarted.</p>}
                {e.practiceAttempts?.length > 0 && (
                  <p className="ex-sub" style={{ marginTop: 8 }}>
                    Practice attempts: {e.practiceAttempts.map((p, i) => <Link key={p.id} to={`/exams/attempt/${p.id}${["READINESS_CHECK", "IN_PROGRESS"].includes(p.status) ? "" : "/report"}`} style={{ marginRight: 8 }}>#{e.practiceAttempts.length - i}</Link>)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
