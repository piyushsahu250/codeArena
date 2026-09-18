import { useEffect, useMemo, useState } from "react";
import api from "../api";

// Reusable "which question bank does this go in" control. Used by CreateQuestion.jsx (and
// anywhere else that needs to file a question into a possibly-nested folder). Mirrors the
// three-way choice from the spec: pick an existing bank via searchable dropdown, create a new
// one inline (with an optional parent, so nesting like "Fox Solutions > Aptitude > Percentages"
// is built one level at a time), or leave the question uncategorized.
export default function FolderPicker({ value, onChange }) {
  const [folders, setFolders] = useState(null);
  const [mode, setMode] = useState("existing");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function reload() {
    return api.get("/questions/folders").then((res) => {
      setFolders(res.data);
      return res.data;
    });
  }
  useEffect(() => {
    reload();
  }, []);

  // Full "Parent > Child > Grandchild" path labels, built by walking each folder's parent chain.
  const items = useMemo(() => {
    if (!folders) return [];
    const byId = new Map(folders.map((f) => [f.id, f]));
    function pathOf(f) {
      const parts = [f.name];
      let cur = f;
      while (cur.parentId && byId.has(cur.parentId)) {
        cur = byId.get(cur.parentId);
        parts.unshift(cur.name);
      }
      return parts.join(" > ");
    }
    return folders
      .map((f) => ({ id: f.id, label: pathOf(f), questionCount: f._count?.questions ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [folders]);

  const filtered = search.trim()
    ? items.filter((it) => it.label.toLowerCase().includes(search.trim().toLowerCase()))
    : items;

  const selected = items.find((it) => it.id === value);

  async function createFolder(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const { data } = await api.post("/questions/folders", {
        name: newName.trim(),
        category: newCategory.trim() || undefined,
        description: newDescription.trim() || undefined,
        parentId: newParentId || undefined,
      });
      setNewName("");
      setNewCategory("");
      setNewDescription("");
      setNewParentId("");
      await reload();
      onChange(data.id);
      setMode("existing");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create question bank");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        {[
          ["existing", "Choose Existing"],
          ["new", "+ Create New"],
          ["none", "Uncategorized"],
        ].map(([m, label]) => (
          <button
            key={m}
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "6px 10px", background: mode === m ? "var(--amber)" : undefined }}
            onClick={() => {
              setMode(m);
              if (m === "none") onChange("");
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "existing" && (
        <div style={{ position: "relative", marginTop: 10 }}>
          <input
            style={inputStyle}
            placeholder="Search question banks…"
            value={open ? search : selected?.label || ""}
            onFocus={() => {
              setOpen(true);
              setSearch("");
            }}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {open && (
            <div
              style={{
                position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, maxHeight: 220,
                overflowY: "auto", background: "var(--paper)", border: "1px solid var(--line)",
                borderRadius: 8, marginTop: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
              }}
            >
              {folders === null && <div style={{ padding: 10, fontSize: 13, color: "var(--ink-dim)" }}>Loading…</div>}
              {folders !== null && filtered.length === 0 && (
                <div style={{ padding: 10, fontSize: 13, color: "var(--ink-dim)" }}>No matching question banks.</div>
              )}
              {filtered.map((it) => (
                <div
                  key={it.id}
                  onMouseDown={() => {
                    onChange(it.id);
                    setOpen(false);
                  }}
                  style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, background: it.id === value ? "var(--amber)" : undefined }}
                >
                  {it.label} <span className="mono" style={{ color: "var(--ink-dim)", fontSize: 11 }}>({it.questionCount})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "new" && (
        <div className="card" style={{ padding: 14, marginTop: 10 }}>
          <label style={labelStyle} htmlFor="folder-new-name">Name</label>
          <input id="folder-new-name" style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Percentages" />

          <label style={labelStyle} htmlFor="folder-new-parent">Parent bank (optional — leave blank for a top-level bank)</label>
          <select id="folder-new-parent" style={inputStyle} value={newParentId} onChange={(e) => setNewParentId(e.target.value)}>
            <option value="">— None (top-level) —</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>{it.label}</option>
            ))}
          </select>

          <label style={labelStyle} htmlFor="folder-new-category">Category (optional)</label>
          <input id="folder-new-category" style={inputStyle} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Aptitude" />

          <label style={labelStyle} htmlFor="folder-new-description">Description (optional)</label>
          <textarea id="folder-new-description" style={{ ...inputStyle, minHeight: 50 }} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />

          {error && <p style={{ color: "var(--rust)", fontSize: 12, marginTop: 6 }}>{error}</p>}

          <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} disabled={!newName.trim() || creating} onClick={createFolder}>
            {creating ? "Creating…" : "Create & Select"}
          </button>
        </div>
      )}

      {mode === "none" && (
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>This question won't belong to any question bank.</p>
      )}
    </div>
  );
}

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontFamily: "var(--font-body)" };
const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginTop: 10, marginBottom: 4 };
