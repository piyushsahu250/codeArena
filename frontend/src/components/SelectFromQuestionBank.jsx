import { useEffect, useState } from "react";
import api from "../api";

const TYPE_LABELS = { CODING: "Coding", MCQ: "Multiple Choice", TRUE_FALSE: "True/False", MULTISELECT: "Multiple Select", SQL: "SQL Query" };
const selectStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
const inputStyle = { ...selectStyle, width: "100%" };

// "Select From My Question Bank" picker — reuses the existing GET /questions list (already
// staff-ownership + institute scoped server-side, paginated, filterable) rather than a new
// endpoint. Never loads more than one page of questions at once, per the platform's
// no-unbounded-lists discipline. `excludeIds` hides questions already in the target pool so a
// staff member can't "add" the same question twice from this picker.
export default function SelectFromQuestionBank({ excludeIds = [], onAdd, onClose }) {
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [questionType, setQuestionType] = useState("");
  const [btlLevel, setBtlLevel] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const [totalPages, setTotalPages] = useState(1);
  const [selected, setSelected] = useState([]);
  const [adding, setAdding] = useState(false);

  function load() {
    setRows(null);
    const params = { page, pageSize: 20, questionStatus: undefined };
    if (q) params.q = q;
    if (subject) params.subject = subject;
    if (topic) params.topic = topic;
    if (difficulty) params.difficulty = difficulty;
    if (questionType) params.questionType = questionType;
    if (btlLevel) params.btlLevel = btlLevel;
    api.get("/questions", { params }).then((res) => {
      setRows(res.data.rows.filter((r) => !excludeIds.includes(r.id)));
      setTotalPages(res.data.totalPages);
    });
  }

  useEffect(load, [page, subject, topic, difficulty, questionType, btlLevel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  async function handleAdd() {
    if (!selected.length) return;
    setAdding(true);
    try {
      await onAdd(selected);
      onClose();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="ca-modal-overlay" onClick={onClose}>
      <div className="ca-modal" style={{ maxWidth: 620, maxHeight: "85vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Select From My Question Bank</h3>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input style={{ ...inputStyle, flex: "2 1 160px" }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <input style={{ ...inputStyle, flex: "1 1 100px" }} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <input style={{ ...inputStyle, flex: "1 1 100px" }} placeholder="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <select style={{ ...selectStyle, flex: "1 1 100px" }} value={questionType} onChange={(e) => setQuestionType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select style={{ ...selectStyle, flex: "1 1 90px" }} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">All difficulties</option>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </select>
          <select style={{ ...selectStyle, flex: "1 1 80px" }} value={btlLevel} onChange={(e) => setBtlLevel(e.target.value)}>
            <option value="">All BTL</option>
            {[1, 2, 3, 4, 5, 6].map((l) => <option key={l} value={l}>BTL-{l}</option>)}
          </select>
        </div>

        <div style={{ flex: 1, overflowY: "auto", marginTop: 12, minHeight: 200 }}>
          {rows === null ? (
            <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No questions match — try different filters.</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {rows.map((r) => (
                <label key={r.id} className="card" style={{ padding: 10, display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.title || r.description?.slice(0, 60) || "(untitled)"}
                  </span>
                  <span className="badge" style={{ fontSize: 10 }}>{TYPE_LABELS[r.questionType] || r.questionType}</span>
                  {r.btlLevel && <span className="mono" style={{ fontSize: 10, color: "var(--ink-dim)" }}>BTL-{r.btlLevel}</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 8 }}>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span style={{ fontSize: 12, alignSelf: "center" }}>Page {page} of {totalPages}</span>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        )}

        <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={!selected.length || adding} onClick={handleAdd}>
          {adding ? "Adding…" : `Add Selected (${selected.length})`}
        </button>
      </div>
    </div>
  );
}
