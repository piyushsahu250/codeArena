import { useEffect, useMemo, useState } from "react";
import api from "../api";

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginTop: 10, marginBottom: 4 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontFamily: "var(--font-body)" };
const NEW = "__new__";

// Cascading Subject -> Unit -> (optional) Topic picker — the server-enforced classification every
// question and test must carry going forward (spec: "Subject and Unit are required... do not
// allow a question to be added without a valid Subject/Course mapping"). GET /subjects already
// returns each Subject's Units (with counts) in one call, so Unit options need no extra fetch;
// Topics are fetched lazily per-Unit since they're the one lightweight, organically-grown level
// (see subjectAccess.js's comment on why Topic has no separate authorization layer).
//
// STAFF only ever sees subjects they're authorized for (server-filtered, not just hidden client-
// side — see routes/subjects.js) — mirrors FolderPicker.jsx's existing/create-new UX convention.
export default function SubjectUnitPicker({ subjectId, unitId, topicId, onChange, showTopic = true }) {
  const [subjects, setSubjects] = useState(null);
  const [topics, setTopics] = useState([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [creatingUnit, setCreatingUnit] = useState(false);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/subjects").then((res) => setSubjects(res.data));
  }, []);

  const selectedSubject = useMemo(() => subjects?.find((s) => s.id === subjectId) || null, [subjects, subjectId]);
  // Numeric-aware compare ("Unit 2" before "Unit 10") as the tiebreaker, not plain alphabetical —
  // `order` alone can't be trusted as the primary key for units created before this field was
  // populated meaningfully, so the fallback needs to already produce the right order on its own.
  const units = useMemo(
    () => [...(selectedSubject?.units || [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })),
    [selectedSubject]
  );
  const selectedUnit = useMemo(() => units.find((u) => u.id === unitId) || null, [units, unitId]);

  useEffect(() => {
    if (!unitId) { setTopics([]); return; }
    setTopicsLoading(true);
    api.get(`/subjects/units/${unitId}/topics`).then((res) => setTopics(res.data)).catch(() => setTopics([])).finally(() => setTopicsLoading(false));
  }, [unitId]);

  // Names are included alongside ids so callers that still populate a legacy free-text display
  // field (e.g. CreateTest.jsx's Test.subject/unit) don't need a second fetch just to resolve them.
  function pickSubject(id) {
    if (id === NEW) { setCreatingSubject(true); setNewName(""); setError(""); return; }
    const s = subjects?.find((x) => x.id === id);
    onChange({ subjectId: id || null, unitId: null, topicId: null, subjectName: s?.name || null, unitName: null });
  }
  function pickUnit(id) {
    if (id === NEW) { setCreatingUnit(true); setNewName(""); setError(""); return; }
    const u = units.find((x) => x.id === id);
    onChange({ subjectId, unitId: id || null, topicId: null, subjectName: selectedSubject?.name || null, unitName: u?.name || null });
  }
  function pickTopic(id) {
    if (id === NEW) { setCreatingTopic(true); setNewName(""); setError(""); return; }
    onChange({ subjectId, unitId, topicId: id || null, subjectName: selectedSubject?.name || null, unitName: selectedUnit?.name || null });
  }

  // None of the three creators below submit a real <form> — this component is routinely embedded
  // inside a caller's own <form> (CreateTest.jsx, CreateQuestion.jsx), and a nested <form> is
  // invalid HTML that React will still literally render: the inner form's submit event bubbles
  // through React's synthetic event system to the outer form's onSubmit, which was firing the
  // whole page's Save/Create handler — with whatever was in the surrounding form at that moment —
  // every time staff clicked "Create Unit". That's the actual root cause of "the page resets and
  // loses my test" (the outer form's own success handler navigates away on completion; it isn't a
  // page reload at all, it's an unintended real submission). type="button" + onClick side-steps
  // native form submission/bubbling entirely instead of patching around it with
  // stopPropagation() (fragile — anyone using this component as a plain, non-nested picker
  // elsewhere would silently lose the safety net the moment they wrapped it in their own form).
  //
  // Local state is patched directly (append the new row into `subjects`) instead of refetching
  // the whole list — a full institute Subject+Unit tree refetch for a one-row change is exactly
  // the kind of unnecessary reload the platform's performance discipline asks this component to
  // avoid, and it also sidesteps any risk of the refetch racing with unrelated state elsewhere.
  async function createSubject() {
    if (!newName.trim()) return;
    setError("");
    try {
      const { data } = await api.post("/subjects", { name: newName.trim() });
      const created = { ...data, units: [] };
      setSubjects((prev) => [...(prev || []), created]);
      onChange({ subjectId: created.id, unitId: null, topicId: null, subjectName: created.name, unitName: null });
      setCreatingSubject(false);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create subject");
    }
  }

  async function createUnit() {
    if (!newName.trim() || !subjectId) return;
    setError("");
    try {
      const { data } = await api.post(`/subjects/${subjectId}/units`, { name: newName.trim() });
      setSubjects((prev) => prev.map((s) => (s.id === subjectId ? { ...s, units: [...(s.units || []), data] } : s)));
      onChange({ subjectId, unitId: data.id, topicId: null, subjectName: selectedSubject?.name || null, unitName: data.name });
      setCreatingUnit(false);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create unit");
    }
  }

  async function createTopic() {
    if (!newName.trim() || !unitId) return;
    setError("");
    try {
      const { data } = await api.post(`/subjects/units/${unitId}/topics`, { name: newName.trim() });
      setTopics((prev) => (prev.some((t) => t.id === data.id) ? prev : [...prev, data]));
      onChange({ subjectId, unitId, topicId: data.id });
      setCreatingTopic(false);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create topic");
    }
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Subject</label>
          <select style={inputStyle} value={subjectId || ""} onChange={(e) => pickSubject(e.target.value)} disabled={!subjects}>
            <option value="">{subjects === null ? "Loading…" : "— Select Subject —"}</option>
            {subjects?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value={NEW}>+ New Subject…</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Unit</label>
          <select style={inputStyle} value={unitId || ""} onChange={(e) => pickUnit(e.target.value)} disabled={!subjectId}>
            <option value="">{subjectId ? "— Select Unit —" : "Select a Subject first"}</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            {subjectId && <option value={NEW}>+ New Unit…</option>}
          </select>
        </div>
      </div>

      {creatingSubject && (
        <div className="card" style={{ padding: 12, marginTop: 8, display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelStyle, marginTop: 0 }}>New Subject name</label>
            <input
              style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Java" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createSubject(); } }}
            />
          </div>
          <button type="button" className="btn btn-primary" disabled={!newName.trim()} onClick={createSubject}>Create</button>
          <button type="button" className="btn btn-ghost" onClick={() => setCreatingSubject(false)}>Cancel</button>
        </div>
      )}
      {creatingUnit && (
        <div className="card" style={{ padding: 12, marginTop: 8, display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ ...labelStyle, marginTop: 0 }}>New Unit name (under {selectedSubject?.name})</label>
            <input
              style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Unit 1" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createUnit(); } }}
            />
          </div>
          <button type="button" className="btn btn-primary" disabled={!newName.trim()} onClick={createUnit}>Create</button>
          <button type="button" className="btn btn-ghost" onClick={() => setCreatingUnit(false)}>Cancel</button>
        </div>
      )}

      {showTopic && (
        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>Topic (optional)</label>
          <select style={inputStyle} value={topicId || ""} onChange={(e) => pickTopic(e.target.value)} disabled={!unitId || topicsLoading}>
            <option value="">{!unitId ? "Select a Unit first" : topicsLoading ? "Loading…" : "— None —"}</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {unitId && <option value={NEW}>+ New Topic…</option>}
          </select>
          {creatingTopic && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. OOP Concepts" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createTopic(); } }}
              />
              <button type="button" className="btn btn-primary" disabled={!newName.trim()} onClick={createTopic}>Add</button>
              <button type="button" className="btn btn-ghost" onClick={() => setCreatingTopic(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: "var(--rust)", fontSize: 12, marginTop: 6 }}>{error}</p>}
      {selectedUnit && (
        <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8 }}>
          {selectedSubject.name} → {selectedUnit.name}{topics.find((t) => t.id === topicId) ? ` → ${topics.find((t) => t.id === topicId).name}` : ""}
        </p>
      )}
    </div>
  );
}
