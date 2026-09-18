import { useMemo, useState } from "react";
import { groupAcademicGroupsByBatch } from "../utils/classLabel";

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };

// Shared cascading Institute -> Batch -> Department/Section academic-group picker, used everywhere
// a group is selected (Test Creation, Attendance staff assignment) instead of a flat wall of
// hundreds of groups. Every group already has all 4 keys by construction (auto-derived from
// registered students), so unlike its ClassPicker predecessor there's no "legacy/unassigned"
// fallback bucket to render.
//
// multi=true: `value` is an array of academicGroupIds, checkboxes. multi=false: `value` is a
// single academicGroupId (or ""), radios/select behavior.
export default function AcademicGroupPicker({ groups, value, onChange, multi = false }) {
  const institutes = useMemo(() => {
    const map = new Map();
    groups.forEach((g) => g.institute && map.set(g.institute.id, g.institute.name));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [groups]);

  const [instituteId, setInstituteId] = useState(institutes.length === 1 ? institutes[0].id : "");
  const [batchYear, setBatchYear] = useState("");

  const scopedGroups = useMemo(() => {
    if (institutes.length <= 1) return groups;
    return groups.filter((g) => g.institute?.id === instituteId);
  }, [groups, institutes.length, instituteId]);

  const { batches, byBatch } = useMemo(() => groupAcademicGroupsByBatch(scopedGroups), [scopedGroups]);
  const groupsForBatch = batchYear ? byBatch[batchYear] || [] : [];

  const selectedSet = useMemo(() => new Set(multi ? value || [] : value ? [value] : []), [multi, value]);

  function toggle(groupId) {
    if (multi) {
      const next = selectedSet.has(groupId) ? [...selectedSet].filter((id) => id !== groupId) : [...selectedSet, groupId];
      onChange(next);
    } else {
      onChange(selectedSet.has(groupId) ? "" : groupId);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {institutes.length > 1 && (
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle} htmlFor="agp-institute">Institute</label>
            <select id="agp-institute" style={inputStyle} value={instituteId} onChange={(e) => { setInstituteId(e.target.value); setBatchYear(""); }}>
              <option value="">Select institute…</option>
              {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        )}
        <div style={{ flex: "1 1 160px" }}>
          <label style={labelStyle} htmlFor="agp-batch">Batch</label>
          <select id="agp-batch" style={inputStyle} value={batchYear} onChange={(e) => setBatchYear(e.target.value)} disabled={institutes.length > 1 && !instituteId}>
            <option value="">Select batch…</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {batchYear && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {groupsForBatch.map((g) => (
            <label
              key={g.id}
              className="badge"
              style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: selectedSet.has(g.id) ? "var(--amber)" : undefined }}
            >
              <input type={multi ? "checkbox" : "radio"} checked={selectedSet.has(g.id)} onChange={() => toggle(g.id)} />
              {g.department?.name || "—"} - {g.section}
            </label>
          ))}
          {groupsForBatch.length === 0 && <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>No academic groups for this batch yet.</span>}
        </div>
      )}
    </div>
  );
}
