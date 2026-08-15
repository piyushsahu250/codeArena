import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import AcademicGroupPicker from "../components/AcademicGroupPicker";
import api from "../api";

const inputStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--ink-dim)", display: "block", marginBottom: 4 };
const LEVEL_COLORS = {
  EXCELLENTLY_READY: "#16a34a", JOB_READY: "#22c55e", NEARLY_READY: "#84cc16",
  DEVELOPING: "#f59e0b", NEEDS_IMPROVEMENT: "#f97316", FOUNDATION_REQUIRED: "#dc2626",
};
const BTL_LABELS = { 1: "BTL1 Remember", 2: "BTL2 Understand", 3: "BTL3 Apply", 4: "BTL4 Analyze", 5: "BTL5 Evaluate", 6: "BTL6 Create" };

function KpiCard({ label, value }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-dim)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}

// Admin/Staff readiness analytics — institute-wide (or filtered) view over the Employability &
// Readiness module's ReadinessReport rows, sourced entirely from the RA4 admin/analytics route
// (already institute-scoped + 60s cached server-side). This page renders only; every number is
// something the backend already computed, per the module's "one centralized scoring engine, UI
// must never disagree" rule.
export default function ReadinessAnalytics() {
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [assessmentMode, setAssessmentMode] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  // Academic-context filters (spec section 13/14) — narrows the dashboard to a Batch/Department/
  // Section, same data source (GET /academic-groups) the assignment picker uses. Compare mode is a
  // separate, explicit opt-in (section 15) — never blends automatically with the normal filtered view.
  const [academicGroups, setAcademicGroups] = useState([]);
  const [filterBatch, setFilterBatch] = useState("");
  const [filterDepartmentId, setFilterDepartmentId] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [compareGroupIds, setCompareGroupIds] = useState([]);
  const [activeCompareIds, setActiveCompareIds] = useState([]); // only set once "Compare Selected Groups" is clicked

  // Institute filter — harmless no-op for a scoped Admin (backend ignores this param and always
  // uses their own institute); the only way an unscoped Platform Admin can narrow this dashboard
  // to one institute instead of a blended cross-institute view. Same pattern as AcademicGroups.jsx.
  const [institutes, setInstitutes] = useState([]);
  const [filterInstituteId, setFilterInstituteId] = useState("");

  useEffect(() => {
    api.get("/readiness/admin/subjects").then((res) => setSubjects(res.data)).catch(() => {});
    api.get("/academic-groups").then((res) => setAcademicGroups(res.data)).catch(() => {});
    api.get("/institutes").then((res) => setInstitutes(res.data)).catch(() => {});
  }, []);

  const departmentOptions = useMemo(() => {
    const map = new Map();
    academicGroups.forEach((g) => g.department && map.set(g.department.id, g.department.name));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [academicGroups]);
  const batchOptions = useMemo(() => [...new Set(academicGroups.map((g) => g.batch))].sort().reverse(), [academicGroups]);
  const sectionOptions = useMemo(() => [...new Set(academicGroups.map((g) => g.section))].sort(), [academicGroups]);

  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const modeOptions = Array.isArray(selectedSubject?.assessmentModes) ? selectedSubject.assessmentModes : [];

  const queryParams = useMemo(() => {
    const p = {};
    if (subjectId) p.subjectId = subjectId;
    if (assessmentMode) p.assessmentMode = assessmentMode;
    if (filterInstituteId) p.instituteId = filterInstituteId;
    if (activeCompareIds.length) {
      p.compareGroupIds = activeCompareIds.join(",");
      return p; // compare mode overrides the single-scope batch/department/section filter
    }
    if (filterBatch) p.batch = filterBatch;
    if (filterDepartmentId) p.departmentId = filterDepartmentId;
    if (filterSection) p.section = filterSection;
    return p;
  }, [subjectId, assessmentMode, filterBatch, filterDepartmentId, filterSection, filterInstituteId, activeCompareIds]);

  useEffect(() => {
    api.get("/readiness/admin/analytics", { params: queryParams })
      .then((res) => setAnalytics(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load analytics"));
  }, [queryParams]);

  const contextBreadcrumb = activeCompareIds.length
    ? null
    : [filterBatch ? `Batch ${filterBatch}` : null, departmentOptions.find((d) => d.id === filterDepartmentId)?.name, filterSection ? `Section ${filterSection}` : null, selectedSubject?.name]
        .filter(Boolean).join(" · ") || "All academic groups";

  async function exportExcel() {
    setExporting(true);
    try {
      const res = await api.get("/readiness/admin/analytics/export", { params: queryParams, responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = "readiness-analytics.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export analytics");
    } finally {
      setExporting(false);
    }
  }

  const levelData = analytics && !analytics.groups ? Object.entries(analytics.readinessLevelDistribution).map(([level, count]) => ({ level: level.replace(/_/g, " "), count, color: LEVEL_COLORS[level] || "#6b7280" })) : [];
  const btlData = analytics && !analytics.groups ? [1, 2, 3, 4, 5, 6].filter((l) => analytics.btlAverages[l] != null).map((l) => ({ level: BTL_LABELS[l], average: analytics.btlAverages[l] })) : [];

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Readiness Analytics</h1>
        <ChalkUnderline />
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
          Institute-wide Employability &amp; Readiness Assessment performance — topic weaknesses, BTL distribution, and students needing intervention.
        </p>

        <div className="card" style={{ padding: 16, marginTop: 24, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={labelStyle}>Institute</label>
            <select style={inputStyle} value={filterInstituteId} onChange={(e) => setFilterInstituteId(e.target.value)} disabled={compareMode}>
              <option value="">All institutes</option>
              {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Subject</label>
            <select style={inputStyle} value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setAssessmentMode(""); }} disabled={compareMode}>
              <option value="">All subjects</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Assessment Mode</label>
            <select style={inputStyle} value={assessmentMode} onChange={(e) => setAssessmentMode(e.target.value)} disabled={!subjectId || compareMode}>
              <option value="">All modes</option>
              {modeOptions.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Batch</label>
            <select style={inputStyle} value={filterBatch} onChange={(e) => setFilterBatch(e.target.value)} disabled={compareMode}>
              <option value="">All batches</option>
              {batchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <select style={inputStyle} value={filterDepartmentId} onChange={(e) => setFilterDepartmentId(e.target.value)} disabled={compareMode}>
              <option value="">All departments</option>
              {departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Section</label>
            <select style={inputStyle} value={filterSection} onChange={(e) => setFilterSection(e.target.value)} disabled={compareMode}>
              <option value="">All sections</option>
              {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-ghost" disabled={exporting || compareMode || !analytics?.totalAssessments} onClick={exportExcel}>
            {exporting ? "Exporting…" : "⬇ Export Excel"}
          </button>
          <button
            type="button" className="btn btn-ghost"
            onClick={() => { setCompareMode((v) => !v); setActiveCompareIds([]); setCompareGroupIds([]); }}
          >
            {compareMode ? "✕ Exit Compare" : "⇄ Compare Academic Groups"}
          </button>
        </div>

        {compareMode && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Compare Academic Groups</div>
            <p style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
              Pick 2 or more Institute/Batch/Department/Section groups to see them side by side. This never happens automatically — the normal dashboard above stays scoped to one context at a time.
            </p>
            <div style={{ marginTop: 10 }}>
              <AcademicGroupPicker multi groups={academicGroups} value={compareGroupIds} onChange={setCompareGroupIds} />
            </div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={compareGroupIds.length < 2} onClick={() => setActiveCompareIds(compareGroupIds)}>
              Compare {compareGroupIds.length || ""} Selected Group(s)
            </button>
          </div>
        )}

        {!compareMode && (
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 12 }}>
            Showing: <strong>{contextBreadcrumb}</strong>
          </p>
        )}

        {error && <p style={{ color: "var(--rust)", marginTop: 16 }}>{error}</p>}
        {!analytics && !error && <p style={{ color: "var(--ink-dim)", marginTop: 24 }}>Loading…</p>}

        {analytics?.groups && (
          <div style={{ overflowX: "auto", marginTop: 24 }}>
            <div style={{ display: "flex", gap: 16, minWidth: "fit-content" }}>
              {analytics.groups.map((g) => (
                <div key={g.academicGroupId} className="card" style={{ padding: 16, minWidth: 240, flex: "0 0 auto" }}>
                  <h3 style={{ fontSize: 13 }}>{g.label}</h3>
                  {g.totalAssessments === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>No completed assessments yet.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <KpiCard label="Total Assessments" value={g.totalAssessments} />
                      <KpiCard label="Students Assessed" value={g.studentsAssessed} />
                      <KpiCard label="Average Readiness" value={`${g.averageReadiness}%`} />
                      <KpiCard label="At-Risk Students" value={g.atRiskStudents.length} />
                      <KpiCard label="Top Performers" value={g.topPerformers.length} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {analytics && !analytics.groups && analytics.totalAssessments === 0 && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center", color: "var(--ink-dim)" }}>
            No completed assessments match these filters yet.
          </div>
        )}

        {analytics && !analytics.groups && analytics.totalAssessments > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 24 }}>
              <KpiCard label="Total Assessments" value={analytics.totalAssessments} />
              <KpiCard label="Students Assessed" value={analytics.studentsAssessed} />
              <KpiCard label="Average Readiness" value={`${analytics.averageReadiness}%`} />
              <KpiCard label="At-Risk Students" value={analytics.atRiskStudents.length} />
              <KpiCard label="Top Performers" value={analytics.topPerformers.length} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 32 }}>
              <div className="card" style={{ padding: 16 }}>
                <h3 style={{ fontSize: 14 }}>Readiness Level Distribution</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={levelData} dataKey="count" nameKey="level" cx="50%" cy="50%" outerRadius={90} label>
                      {levelData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <h3 style={{ fontSize: 14 }}>Average BTL Performance</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={btlData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="level" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="average" fill="var(--mint)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                {btlData.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-dim)", textAlign: "center", marginTop: 8 }}>No BTL data yet.</p>}
              </div>
            </div>

            {analytics.topicWeaknesses.length > 0 && (
              <>
                <h2 style={{ marginTop: 40 }}>Weakest Topics</h2>
                <ChalkUnderline />
                <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
                  {analytics.topicWeaknesses.map((t, i) => (
                    <div key={i} className="card" style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{t.topic}</span>
                      <span style={{ fontSize: 13 }}>{t.averageAccuracy}% avg · {t.studentsAssessed} student(s)</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {["departmentWise", "batchWise", "sectionWise", "subjectWise"].some((k) => analytics[k]?.length > 0) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginTop: 40 }}>
                {[["departmentWise", "By Department"], ["batchWise", "By Batch"], ["sectionWise", "By Section"], ["subjectWise", "By Subject"]].map(([key, label]) => (
                  analytics[key]?.length > 0 && (
                    <div key={key} className="card" style={{ padding: 16 }}>
                      <h3 style={{ fontSize: 14 }}>{label}</h3>
                      <div style={{ marginTop: 10 }}>
                        {analytics[key].map((row, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < analytics[key].length - 1 ? "1px solid var(--line)" : "none", fontSize: 13 }}>
                            <span>{row.key}</span>
                            <span style={{ fontWeight: 700 }}>{row.averageScore}% <span style={{ fontWeight: 400, color: "var(--ink-dim)" }}>({row.count})</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}

            {analytics.atRiskStudents.length > 0 && (
              <>
                <h2 style={{ marginTop: 40 }}>Students Needing Intervention</h2>
                <ChalkUnderline />
                <div style={{ overflowX: "auto", marginTop: 16 }}>
                  <table className="mono" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                        <th style={{ padding: 8 }}>Name</th>
                        <th style={{ padding: 8 }}>Reg. No.</th>
                        <th style={{ padding: 8 }}>Subject</th>
                        <th style={{ padding: 8 }}>Score</th>
                        <th style={{ padding: 8 }}>Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.atRiskStudents.map((s) => (
                        <tr key={`${s.studentId}-${s.subject}`} style={{ borderBottom: "1px solid var(--line)" }}>
                          <td style={{ padding: 8 }}>{s.name}</td>
                          <td style={{ padding: 8 }}>{s.registrationNumber}</td>
                          <td style={{ padding: 8 }}>{s.subject}</td>
                          <td style={{ padding: 8 }}>{s.overallScore}%</td>
                          <td style={{ padding: 8 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: "#fff", background: LEVEL_COLORS[s.readinessLevel] || "#6b7280" }}>
                              {s.readinessLevel.replace(/_/g, " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {analytics.topPerformers.length > 0 && (
              <>
                <h2 style={{ marginTop: 40 }}>Top Performers</h2>
                <ChalkUnderline />
                <div style={{ overflowX: "auto", marginTop: 16 }}>
                  <table className="mono" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                        <th style={{ padding: 8 }}>Name</th>
                        <th style={{ padding: 8 }}>Reg. No.</th>
                        <th style={{ padding: 8 }}>Subject</th>
                        <th style={{ padding: 8 }}>Score</th>
                        <th style={{ padding: 8 }}>Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.topPerformers.map((s) => (
                        <tr key={`${s.studentId}-${s.subject}`} style={{ borderBottom: "1px solid var(--line)" }}>
                          <td style={{ padding: 8 }}>{s.name}</td>
                          <td style={{ padding: 8 }}>{s.registrationNumber}</td>
                          <td style={{ padding: 8 }}>{s.subject}</td>
                          <td style={{ padding: 8 }}>{s.overallScore}%</td>
                          <td style={{ padding: 8 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: "#fff", background: LEVEL_COLORS[s.readinessLevel] || "#6b7280" }}>
                              {s.readinessLevel.replace(/_/g, " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
