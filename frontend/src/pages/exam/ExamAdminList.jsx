import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import api from "../../api";
import Navbar from "../../components/Navbar";
import ChalkUnderline from "../../components/ChalkUnderline";
import { examErrorMessage } from "../../utils/examProgress";
import "./exam.css";

const tone = { PUBLISHED: "ok", DRAFT: "warn", ARCHIVED: "" };

export default function ExamAdminList() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const load = () => api.get("/exams/admin/exams", { params: { page } }).then((r) => setData(r.data)).catch((e) => setError(examErrorMessage(e, "Could not load the examinations.")));
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function archive(id) {
    if (!window.confirm("Archive this examination? Students will no longer see it. Existing results are kept.")) return;
    try { await api.post(`/exams/admin/exams/${id}/archive`); await load(); } catch (e) { setError(examErrorMessage(e)); }
  }

  return (
    <div>
      <Navbar />
      <div className="ex-page">
        <div className="ex-head">
          <div><h1>Section Exams</h1><ChalkUnderline /><p className="ex-sub">Aptitude, Technical, Coding and AI Mock Interview in one proctored attempt, with one consolidated report.</p></div>
          <Link to="/exam-admin/new" className="btn btn-primary"><Plus size={14} aria-hidden="true" /> New section exam</Link>
        </div>
        {error && <div className="ex-notice bad" role="alert">{error}</div>}
        {!data && !error && <p className="mono">Loading…</p>}
        {data && data.exams.length === 0 && <div className="ex-card ex-muted">No section exams yet. Create one to get started.</div>}
        {data && data.exams.length > 0 && (
          <div className="ex-card" style={{ overflowX: "auto" }}>
            <table className="ex-table">
              <thead><tr><th>Title</th><th>Status</th><th>Window</th><th>Marks</th><th>Attempts</th><th /></tr></thead>
              <tbody>{data.exams.map((e) => (
                <tr key={e.id}>
                  <td><Link to={`/exam-admin/${e.id}/edit`}>{e.title}</Link></td>
                  <td><span className={`ex-chip ${tone[e.status] || ""}`}>{e.status}{e.version ? ` v${e.version}` : ""}</span></td>
                  <td>{e.startAt ? `${new Date(e.startAt).toLocaleString()} → ${new Date(e.endAt).toLocaleString()}` : "—"}</td>
                  <td>{e.totalMarks ?? "—"}</td>
                  <td>{e.attempts}</td>
                  <td className="ex-row"><Link className="btn btn-ghost" to={`/exam-admin/${e.id}/results`}>Results</Link><Link className="btn btn-ghost" to={`/exam-admin/${e.id}/edit`}>Edit</Link>{e.status !== "ARCHIVED" && <button className="btn btn-ghost" onClick={() => archive(e.id)}>Archive</button>}</td>
                </tr>
              ))}</tbody>
            </table>
            {data.total > data.pageSize && (
              <div className="ex-row" style={{ marginTop: 10 }}>
                <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="ex-muted">Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
                <button className="btn btn-ghost" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
