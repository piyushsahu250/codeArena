import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import api from "../../api";
import Navbar from "../../components/Navbar";
import ExamReportView from "../../components/exam/ExamReportView";
import { examErrorMessage } from "../../utils/examProgress";
import "./exam.css";

// The report for one attempt. Students see their own result once it is published; administrators open the same report for any attempt of their institute, with the answer review,
// the proctoring timeline and the actions that belong to a reviewer: confirm or dismiss an event, publish the result, retry a pending evaluation, withdraw the attempt.
export default function ExamReport({ admin = false }) {
  const { attemptId } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const base = admin ? `/exams/admin/attempts/${attemptId}` : `/exams/attempts/${attemptId}`;

  const load = useCallback(() => api.get(`${base}/report`).then((r) => { setReport(r.data); setError(null); }).catch((e) => setError(examErrorMessage(e, "Could not load the report."))), [base]);
  useEffect(() => { load(); }, [load]);

  // A result still being evaluated refreshes itself, so a student does not have to keep reloading.
  useEffect(() => {
    if (!report?.released || !report.pending?.length) return undefined;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [report, load]);

  async function act(path, body, okText) {
    setBusy(true); setMsg(null);
    try { await api.post(`/exams/admin/attempts/${attemptId}/${path}`, body || {}); setMsg({ ok: true, text: okText }); await load(); }
    catch (e) { setMsg({ ok: false, text: examErrorMessage(e) }); } finally { setBusy(false); }
  }
  function invalidate() {
    const reason = window.prompt("Why is this attempt being withdrawn? (at least 5 characters; this is recorded in the audit log)");
    if (reason && reason.trim().length >= 5) act("invalidate", { reason: reason.trim() }, "The attempt was withdrawn.");
  }
  function review(eventId, status) {
    const note = window.prompt(status === "CONFIRMED" ? "Note for confirming this event as a violation (optional):" : "Note for dismissing this event (optional):") ?? "";
    act(`events/${eventId}/review`, { status, note }, status === "CONFIRMED" ? "Event confirmed." : "Event dismissed.");
  }

  const pendingReview = (report?.proctoring?.timeline || []).filter((e) => e.requiresReview && e.reviewStatus === "PENDING");
  const result = report?.result;
  const canPublish = admin && result && result.final && result.status !== "PUBLISHED" && report.header.official;

  return (
    <div>
      <Navbar />
      <div className="ex-page">
        <div className="ex-row between no-print" style={{ marginBottom: 12 }}>
          <Link to={admin ? "/exam-admin" : "/exams"} className="btn btn-ghost">← {admin ? "Section exams" : "Examinations"}</Link>
          <button className="btn btn-ghost" onClick={() => window.print()}><Printer size={14} aria-hidden="true" /> Print / save as PDF</button>
        </div>
        {error && <div className="ex-notice bad" role="alert">{error}</div>}
        {!report && !error && <p className="mono">Loading…</p>}
        {msg && <div className={`ex-notice ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
        {report && <ExamReportView report={report} admin={admin} />}

        {admin && report?.released && (
          <div className="ex-card no-print">
            <h3>Reviewer actions</h3>
            <div className="ex-row">
              {canPublish && <button className="btn btn-primary" disabled={busy} onClick={() => act("publish-result", {}, "The result was published to the student.")}>Publish result</button>}
              {result && !result.final && <button className="btn btn-ghost" disabled={busy} onClick={() => act("retry-evaluation", {}, "Evaluation was queued again.")}>Retry pending evaluations</button>}
              {report.header.status !== "INVALIDATED" && <button className="btn btn-ghost" disabled={busy} onClick={invalidate}>Withdraw attempt</button>}
            </div>
            {result && !result.final && <p className="ex-sub">The result cannot be published while a section is still pending.</p>}
            {pendingReview.length > 0 && (
              <>
                <h4 style={{ marginTop: 14 }}>Events waiting for your decision ({pendingReview.length})</h4>
                <table className="ex-table">
                  <thead><tr><th>Time</th><th>Event</th><th>Section</th><th /></tr></thead>
                  <tbody>{pendingReview.map((e) => (
                    <tr key={e.id}><td>{new Date(e.at).toLocaleString()}</td><td>{e.type}</td><td>{e.section || "—"}</td>
                      <td className="ex-row"><button className="btn btn-ghost" disabled={busy} onClick={() => review(e.id, "DISMISSED")}>Dismiss</button><button className="btn btn-ghost" disabled={busy} onClick={() => review(e.id, "CONFIRMED")}>Confirm violation</button></td></tr>
                  ))}</tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
