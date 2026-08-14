import { useEffect, useMemo, useState } from "react";
import api from "../api";

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };

// Flat multi-select staff picker for "share this test with" — same checkbox-badge visual/
// interaction convention as AcademicGroupPicker.jsx (multi mode), just without the cascading
// Institute -> Batch -> Group hierarchy, since a staff directory at one institute is already a
// flat list. Fetches GET /tests/staff-directory itself (institute-scoped, excludes the caller) —
// no existing STAFF-reachable route lists staff, so this is the one place that call happens.
export default function StaffPicker({ value, onChange, excludeIds = [] }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get("/tests/staff-directory").then((res) => setStaff(res.data)).catch(() => setStaff([])).finally(() => setLoading(false));
  }, []);

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((s) => !excludeSet.has(s.id) && (!q || s.name.toLowerCase().includes(q)));
  }, [staff, excludeSet, search]);

  const selectedSet = useMemo(() => new Set(value || []), [value]);

  function toggle(staffId) {
    const next = selectedSet.has(staffId) ? [...selectedSet].filter((id) => id !== staffId) : [...selectedSet, staffId];
    onChange(next);
  }

  if (loading) return <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading staff…</p>;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div>
        <label style={labelStyle}>Search staff</label>
        <input style={inputStyle} placeholder="Type a name…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {visible.map((s) => (
          <label
            key={s.id}
            className="badge"
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: selectedSet.has(s.id) ? "var(--amber)" : undefined }}
          >
            <input type="checkbox" checked={selectedSet.has(s.id)} onChange={() => toggle(s.id)} />
            {s.name}
          </label>
        ))}
        {visible.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
            {staff.length === 0 ? "No other staff at your institute yet." : "No staff match that search."}
          </span>
        )}
      </div>
    </div>
  );
}
