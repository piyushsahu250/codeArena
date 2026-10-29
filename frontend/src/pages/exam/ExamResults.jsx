import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download } from "lucide-react";
import api from "../../api";
import Navbar from "../../components/Navbar";
import { examErrorMessage } from "../../utils/examProgress";
import "./exam.css";

const LABELS = { APTITUDE: "Aptitude", TECHNICAL: "Technical", CODING: "Coding", AI_INTERVIEW: "AI Interview" };
const pct = (n) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

// Results for one examination: participation, pass rate, the average of each section, what still needs a person (flagged events, failed or pending evaluations) and every attempt.
export default function ExamResults() {
  const { examId } = useParams();
  const [exam, setExam] = useState(null);
  const [stats, setStats] = useState(null);
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState({ status: "", needsReview: false, resultStatus: "" });
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => api.get(`/exams/admin/exams/${examId}/attempts`, { params: { page, ...(filter.status ? { status: filter.status } : {}), ...(filter.resultStatus ? { resultStatus: filter.resultStatus } : {}), ...(filter.needsReview ? { needsReview: "true" } : {}) } }).then((r) => setList(r.data)).catch((e) => setMsg({ ok: false, text: examErrorMessage(e) })), [examId, page, filter]);
  const loadStats = useCallback(() => api.get(`/exams/admin/exams/${examId}/analytics`).then((r) => setStats(r.data)).catch(() => {}), [examId]);
  useEffect(() => { api.get(`/exams/admin/exams/${examId}`).then((r) => setExam(r.data.exam)).catch((e) => setMsg({ ok: false, text: examErrorMessage(e) })); loadStats(); }, [examId, loadStats]);
  useEffect(() => { loadList(); }, [loadList]);

  async function publishAll() {
    if (!window.confirm("Publish every final result of this examination to its students now? Results that are still pending or under review are skipped.")) return;
    setBusy(true); setMsg(null);
    try { const { data } = await api.post(`/exams/admin/exams/${examId}/publish-results`, {}); setMsg({ ok: true, text: `Published ${data.published} result(s). ${data.skipped} skipped because they are not final yet.` }); await Promise.all([loadList(), loadStats()]); }
    catch (e) { setMsg({ ok: false, text: examErrorMessage(e) }); } finally { setBusy(false); }
  }
  async function exportCsv() {
    try {
      const res = await api.get(`/exams/admin/exams/${examId}/export.csv`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a"); a.href = url; a.download = `exam-${examId}-results.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setMsg({ ok: false, text: examErrorMessage(e, "Could not export the results.") }); }
  }

  return (
    <div>
      <Navbar />
      <div className="ex-page wide">
        <div className="ex-head">
          <div><h1>{exam?.title || "Results"}</h1><p className="ex-sub">Official (proctored) attempts only. Practice attempts are never included.</p></div>
          <div className="ex-row"><Link to="/exam-admin" className="btn btn-ghost">← All section exams</Link><Link to={`/exam-admin/${examId}/edit`} className="btn btn-ghost">Edit</Link><button className="btn btn-ghost" onClick={exportCsv}><Download size={14} aria-hidden="true" /> Export CSV</button><button className="btn btn-primary" disabled={busy} onClick={publishAll}>Publish final results</button></div>
        </div>
        {msg && <div className={`ex-notice ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}

        {stats && (
          <div className="ex-card">
            <div className="ex-score">
              <div><div className="n">{stats.started}{stats.eligibleStudents != null ? ` / ${stats.eligibleStudents}` : ""}</div><div className="ex-muted">Started / eligible</div></div>
              <div><div className="n">{pct(stats.completionRate)}</div><div className="ex-muted">Completed</div></div>
              <div><div className="n">{pct(stats.averagePercent)}</div><div className="ex-muted">Average (final results)</div></div>
              <div><div className="n">{pct(stats.passRate)}</div><div className="ex-muted">Pass rate</div></div>
              <div><div className="n">{stats.proctoringEventsAwaitingReview}</div><div className="ex-muted">Events awaiting review</div></div>
              <div><div className="n">{stats.evaluationsPending + stats.evaluationsFailed}</div><div className="ex-muted">Evaluations pending / failed</div></div>
            </div>
            <table className="ex-table"><thead><tr><th>Section</th><th>Average score</th></tr></thead>
              <tbody>{Object.entries(stats.sectionAveragePercent || {}).map(([k, v]) => <tr key={k}><td>{LABELS[k] || k}</td><td>{pct(v)}</td></tr>)}</tbody>
            </table>
          </div>
        )}

        <div className="ex-card" style={{ overflowX: "auto" }}>
          <div className="ex-row" style={{ marginBottom: 10 }}>
            <select value={filter.status} onChange={(e) => { setPage(1); setFilter({ ...filter, status: e.target.value }); }} aria-label="Status"><option value="">Any status</option>{["READINESS_CHECK", "IN_PROGRESS", "SUBMITTED", "EXPIRED", "EVALUATING", "COMPLETED", "INVALIDATED"].map((s) => <option key={s}>{s}</option>)}</select>
            <select value={filter.resultStatus} onChange={(e) => { setPage(1); setFilter({ ...filter, resultStatus: e.target.value }); }} aria-label="Result"><option value="">Any result</option>{["EVALUATION_PENDING", "UNDER_REVIEW", "COMPLETED", "PUBLISHED", "INVALIDATED"].map((s) => <option key={s}>{s}</option>)}</select>
            <label style={{ fontWeight: 400 }}><input type="checkbox" checked={filter.needsReview} onChange={(e) => { setPage(1); setFilter({ ...filter, needsReview: e.target.checked }); }} /> Needs review</label>
          </div>
          {!list && <p className="mono">Loading…</p>}
          {list && list.attempts.length === 0 && <p className="ex-muted">No attempts match.</p>}
          {list && list.attempts.length > 0 && (
            <table className="ex-table">
              <thead><tr><th>Student</th><th>PRN</th><th>Status</th><th>Result</th><th>Marks</th><th>%</th><th>Pass</th><th>Warnings</th><th /></tr></thead>
              <tbody>{list.attempts.map((a) => (
                <tr key={a.id}>
                  <td>{a.student?.name}</td><td>{a.student?.registrationNumber || "—"}</td>
                  <td>{a.status}</td><td>{a.resultStatus}{a.final === false ? " (provisional)" : ""}</td>
                  <td>{a.obtained ?? "—"}</td><td>{pct(a.percent)}</td><td>{a.passed == null ? "—" : a.passed ? "Pass" : "Fail"}</td>
                  <td>{a.warningCount}{a.needsReview ? " ⚑" : ""}</td>
                  <td><Link className="btn btn-ghost" to={`/exam-admin/attempt/${a.id}`}>Open report</Link></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {list && list.total > list.pageSize && (
            <div className="ex-row" style={{ marginTop: 10 }}>
              <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="ex-muted">Page {page} of {Math.ceil(list.total / list.pageSize)}</span>
              <button className="btn btn-ghost" disabled={page * list.pageSize >= list.total} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
