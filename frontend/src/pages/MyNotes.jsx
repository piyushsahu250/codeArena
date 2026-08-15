import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

// Search/browse across every private note the student has written, across every course/module/
// chapter. Server-side search + pagination (same {rows,page,pageSize,total,totalPages} shape
// GET /learning/notes returns, copied from the Question Bank's own list route) — never loads
// more than one page of notes at once, however many the student accumulates over a course.
export default function MyNotes() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [q, setQ] = useState("");
  const [courseId, setCourseId] = useState("");
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/learning/courses").then((res) => setCourses(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = { page, pageSize: 20 };
    if (q.trim()) params.q = q.trim();
    if (courseId) params.courseId = courseId;
    api.get("/learning/notes", { params })
      .then(({ data }) => { setRows(data.rows); setTotal(data.total); setTotalPages(data.totalPages); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, q, courseId]);

  // Reset to page 1 whenever a filter actually changes (not on every page click).
  useEffect(() => { setPage(1); }, [q, courseId]);

  async function remove(note) {
    if (!confirm("Delete this note?")) return;
    try {
      await api.delete(`/learning/notes/${note.id}`);
      setRows((r) => r.filter((n) => n.id !== note.id));
      setTotal((t) => t - 1);
    } catch {
      alert("Failed to delete note");
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px" }}>
        <h1>My Notes</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12 }}>Private notes you've written while learning — only you can see these.</p>

        <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Search notes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">All courses</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {loading ? (
          <p className="mono" style={{ marginTop: 20, color: "var(--ink-dim)" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ marginTop: 24, color: "var(--ink-dim)" }}>
            {q || courseId ? "No notes match your filters." : "You haven't written any notes yet — open a lesson and use the Notes panel."}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
            {rows.map((note) => (
              <div key={note.id} className="card" style={{ padding: 16 }}>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                  {note.course?.name}
                  {note.module?.title ? ` · ${note.module.title}` : ""}
                  {note.chapter?.title ? ` · ${note.chapter.title}` : ""}
                  {note.lesson?.title ? ` · ${note.lesson.title}` : ""}
                  {" · "}
                  {new Date(note.updatedAt).toLocaleDateString()}
                </div>
                <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{note.content}</p>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  {note.lesson?.id && note.course?.slug && (
                    <Link className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} to={`/learning/${note.course.slug}/lesson/${note.lesson.id}`}>
                      Open lesson →
                    </Link>
                  )}
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => remove(note)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 24, alignItems: "center" }}>
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>Page {page} of {totalPages} ({total} notes)</span>
            <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
