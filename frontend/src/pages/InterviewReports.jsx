import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useAuth } from "../context/AuthContext";

const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--ink-dim)", display: "block", marginBottom: 4 };
const PIE_COLORS = ["#4F9D6E", "#C7852A", "#B0473F"];
const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "MOCK", label: "Mock Interview" },
  { value: "COMPANY_ROUND", label: "Company Round" },
  { value: "RESUME_BASED", label: "Resume-Based" },
  { value: "HR", label: "HR" },
  { value: "TECHNICAL", label: "Technical" },
  { value: "CODING", label: "Coding" },
  { value: "APTITUDE", label: "Aptitude" },
  { value: "SYSTEM_DESIGN", label: "System Design" },
  { value: "BEHAVIORAL", label: "Behavioral" },
  { value: "MANAGERIAL", label: "Managerial" },
];
const EMPTY_FILTERS = { search: "", academicGroupId: "", batchYear: "", department: "", company: "", type: "", status: "", dateFrom: "", dateTo: "", scoreMin: "", scoreMax: "" };

export default function InterviewReports() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [groups, setGroups] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(1);
  const [pageMeta, setPageMeta] = useState({ totalPages: 1, total: 0 });
  const [exporting, setExporting] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);
  const [rowsError, setRowsError] = useState(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const platformWide = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN"; // everyone else sees their own institute only

  useEffect(() => {
    api.get("/academic-groups").then((res) => setGroups(res.data)).catch(() => {});
    api.get("/interview/companies").then((res) => setCompanies(res.data)).catch(() => {});
  }, []);

  const queryParams = useMemo(() => {
    const p = {};
    for (const [k, v] of Object.entries(applied)) if (v) p[k] = v;
    return p;
  }, [applied]);

  // Each request is ignored if the filters changed again before it answered, so a slow older answer can never overwrite a newer one (the cards and the table must describe the same filters).
  useEffect(() => {
    let current = true;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    api.get("/interview/admin/analytics", { params: queryParams })
      .then((res) => { if (current) setAnalytics(res.data); })
      .catch((err) => { if (current) { setAnalytics(null); setAnalyticsError(err.response?.data?.error || "Could not load the summary and charts."); } })
      .finally(() => { if (current) setAnalyticsLoading(false); });
    return () => { current = false; };
  }, [queryParams, reloadKey]);

  useEffect(() => {
    let current = true;
    setRowsLoading(true);
    setRowsError(null);
    api.get("/interview/admin/sessions", { params: { ...queryParams, page, pageSize: 20 } }).then((res) => {
      if (!current) return;
      setRows(res.data.rows);
      setPageMeta({ totalPages: res.data.totalPages, total: res.data.total });
    }).catch((err) => { if (current) { setRows([]); setPageMeta({ totalPages: 1, total: 0 }); setRowsError(err.response?.data?.error || "Could not load the interview results."); } })
      .finally(() => { if (current) setRowsLoading(false); });
    return () => { current = false; };
  }, [queryParams, page, reloadKey]);

  // The same checks the server makes, so a mistake is shown beside the form at once instead of as an empty page.
  function filterProblem(f) {
    if (f.dateFrom && f.dateTo && f.dateFrom > f.dateTo) return "Date From cannot be after Date To.";
    const lo = f.scoreMin === "" ? null : Number(f.scoreMin), hi = f.scoreMax === "" ? null : Number(f.scoreMax);
    if ((lo !== null && (!Number.isFinite(lo) || lo < 0 || lo > 100)) || (hi !== null && (!Number.isFinite(hi) || hi < 0 || hi > 100))) return "Scores must be numbers from 0 to 100.";
    if (lo !== null && hi !== null && lo > hi) return "Min Score cannot be above Max Score.";
    return null;
  }
  function applyFilters(e) {
    e.preventDefault();
    const problem = filterProblem(filters);
    setFormError(problem);
    if (problem) return;
    setNotice(null);
    setPage(1);
    setApplied(filters);
  }
  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setFormError(null);
    setNotice(null);
    setPage(1);
  }

  async function exportExcel() {
    setExporting(true);
    setNotice(null);
    try {
      const res = await api.get("/interview/admin/sessions/export", { params: queryParams, responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = "interview-reports.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const rowsInFile = res.headers?.["x-export-rows"], totalMatching = res.headers?.["x-export-total"];
      if (res.headers?.["x-export-truncated"] === "true") setNotice({ warn: true, text: `The file holds the ${rowsInFile} most recent of ${totalMatching} matching interviews. Narrow the filters (for example by date) and export again to get the rest.` });
      else if (rowsInFile) setNotice({ text: `Exported ${rowsInFile} interview${rowsInFile === "1" ? "" : "s"}.` });
    } catch (err) {
      let reason = "";
      try { reason = JSON.parse(await err.response?.data?.text?.())?.error || ""; } catch { /* the body was not JSON */ }
      setNotice({ warn: true, text: `Failed to export the report${reason ? `: ${reason}` : "."}` });
    } finally {
      setExporting(false);
    }
  }

  async function downloadPdf(sessionId, studentName) {
    try {
      const { data } = await api.get(`/interview/admin/sessions/${sessionId}/report/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `interview-report-${studentName.replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download report");
    }
  }

  const placementData = analytics ? [
    { name: "Ready", value: analytics.placementReadiness.ready },
    { name: "Needs Improvement", value: analytics.placementReadiness.needsImprovement },
    { name: "Not Ready", value: analytics.placementReadiness.notReady },
  ].filter((d) => d.value > 0) : [];

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div><h1>AI Mock Interview — Reports & Analytics</h1><ChalkUnderline /></div>
          <button className="btn btn-primary" onClick={exportExcel} disabled={exporting}>{exporting ? "Preparing…" : "⬇ Export Excel"}</button>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>
          {platformWide ? "Cross-institute view — all institutes." : "Scoped to your institute — view, search, filter, and download only."}
        </p>
        {notice && <p role="status" style={{ fontSize: 13, marginTop: 8, color: notice.warn ? "var(--rust)" : "var(--ip-accent, #4F9D6E)" }}>{notice.text}</p>}
        {analyticsError && (
          <p role="alert" style={{ fontSize: 13, marginTop: 8, color: "var(--rust)" }}>{analyticsError} <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setReloadKey((k) => k + 1)}>Try again</button></p>
        )}
        {analytics?.defaultDateRangeApplied && (
          <p style={{ fontSize: 12, color: "var(--amber-dark, #a06a1a)", marginTop: 4 }}>
            Showing interviews since {analytics.defaultDateRangeApplied} (last 90 days) — set a Date From below to see earlier data across all institutes.
          </p>
        )}

        {/* Reserve the stat cards' height while they load, otherwise they pop in later and push the filter form down by ~170px (layout shift, UX-8). */}
        {!analytics && analyticsLoading && <div aria-hidden="true" style={{ marginTop: 20, minHeight: 148 }} />}
        {analytics && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 20 }}>
            <StatCard label="Total Interviews" value={analytics.totalInterviews} />
            <StatCard label="Completed" value={analytics.completedCount} />
            <StatCard label="Terminated" value={analytics.terminatedCount ?? 0} />
            {/* A score card with nothing scored shows a dash, not "0%": zero is a real score and must not be confused with "no data". */}
            <StatCard label={analytics.scoredCount ? `Average of ${analytics.scoredCount} scored` : "Average Score"} value={analytics.scoredCount ? `${analytics.averageScore}%` : "—"} />
            <StatCard label="Highest Score" value={analytics.scoredCount ? `${analytics.highestScore}%` : "—"} />
            <StatCard label="Lowest Score" value={analytics.scoredCount ? `${analytics.lowestScore}%` : "—"} />
            <StatCard label="Last 7 days" value={analytics.thisWeekCount} />
            <StatCard label="Last 30 days" value={analytics.thisMonthCount} />
            <StatCard label="Top Company" value={analytics.companyWise[0]?.key || "—"} />
          </div>
        )}

        <form onSubmit={applyFilters} className="card" style={{ padding: 16, marginTop: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 10 }}>
            <div><label style={labelStyle} htmlFor="interview-reports-search">Search (name, roll, PRN, email)</label><input id="interview-reports-search" style={inputStyle} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></div>
            <div><label style={labelStyle} htmlFor="interview-reports-academic-group">Academic Group</label>
              <select id="interview-reports-academic-group" style={inputStyle} value={filters.academicGroupId} onChange={(e) => setFilters({ ...filters, academicGroupId: e.target.value })}>
                <option value="">All groups</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.department.name} - {g.section} ({g.batch})</option>)}
              </select>
            </div>
            <div><label style={labelStyle} htmlFor="interview-reports-batch-year">Batch Year</label><input id="interview-reports-batch-year" style={inputStyle} value={filters.batchYear} onChange={(e) => setFilters({ ...filters, batchYear: e.target.value })} placeholder="e.g. 2025" /></div>
            <div><label style={labelStyle} htmlFor="interview-reports-department">Department</label><input id="interview-reports-department" style={inputStyle} value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })} /></div>
            <div><label style={labelStyle} htmlFor="interview-reports-company">Company</label>
              <select id="interview-reports-company" style={inputStyle} value={filters.company} onChange={(e) => setFilters({ ...filters, company: e.target.value })}>
                <option value="">All companies</option>
                {companies.map((c) => <option key={c.company} value={c.company}>{c.company}</option>)}
              </select>
            </div>
            <div><label style={labelStyle} htmlFor="interview-reports-type">Interview Type</label>
              <select id="interview-reports-type" style={inputStyle} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
                {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><label style={labelStyle} htmlFor="interview-reports-status">Status</label>
              <select id="interview-reports-status" style={inputStyle} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">All statuses</option><option value="COMPLETED">Completed</option><option value="TERMINATED">Terminated</option>
              </select>
            </div>
            <div><label style={labelStyle} htmlFor="interview-reports-date-from">Date From</label><input id="interview-reports-date-from" type="date" style={inputStyle} value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} /></div>
            <div><label style={labelStyle} htmlFor="interview-reports-date-to">Date To</label><input id="interview-reports-date-to" type="date" style={inputStyle} value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} /></div>
            <div><label style={labelStyle} htmlFor="interview-reports-score-min">Min Score</label><input id="interview-reports-score-min" type="number" min="0" max="100" style={inputStyle} value={filters.scoreMin} onChange={(e) => setFilters({ ...filters, scoreMin: e.target.value })} /></div>
            <div><label style={labelStyle} htmlFor="interview-reports-score-max">Max Score</label><input id="interview-reports-score-max" type="number" min="0" max="100" style={inputStyle} value={filters.scoreMax} onChange={(e) => setFilters({ ...filters, scoreMax: e.target.value })} /></div>
          </div>
          {formError && <p role="alert" style={{ fontSize: 13, color: "var(--rust)", marginTop: 10 }}>{formError}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" type="submit">Apply Filters</button>
            <button className="btn btn-ghost" type="button" onClick={clearFilters}>Clear</button>
          </div>
        </form>

        {analytics && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 24 }}>
            <ChartCard title="Weekly Trend">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={analytics.weeklyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Line type="monotone" dataKey="averageScore" stroke="#4F9D6E" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Monthly Trend">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={analytics.monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Line type="monotone" dataKey="averageScore" stroke="#C7852A" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Average Score by Group">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={analytics.byGroup}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="averageScore" fill="#4F9D6E" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Company-wise Performance">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={analytics.companyWise}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="averageScore" fill="#C7852A" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Interview Type Comparison">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={analytics.byType}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="averageScore" fill="#5B7DB1" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Placement Readiness">
              {placementData.length === 0 ? <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Not enough report data yet.</p> : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={placementData} dataKey="value" nameKey="name" outerRadius={80} label>
                      {placementData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        )}

        <h3 style={{ fontSize: 16, marginTop: 32 }}>Interview Results ({pageMeta.total})</h3>
        <div className="card" style={{ marginTop: 12, overflowX: "auto", opacity: rowsLoading && rows ? 0.55 : 1, transition: "opacity .15s" }} aria-busy={rowsLoading}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, opacity: 0.7 }}>
                <th style={{ padding: 10 }}>Roll No.</th><th style={{ padding: 10 }}>Student</th>
                <th style={{ padding: 10 }}>Registration No. (PRN)</th>
                {platformWide && <th style={{ padding: 10 }}>Institute</th>}
                <th style={{ padding: 10 }}>Group</th><th style={{ padding: 10 }}>Batch</th>
                <th style={{ padding: 10 }}>Type</th><th style={{ padding: 10 }}>Company</th>
                <th style={{ padding: 10 }}>Date</th><th style={{ padding: 10 }}>Score</th>
                <th style={{ padding: 10 }}>Status</th><th style={{ padding: 10 }}></th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.sessionId} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="mono" style={{ padding: 10 }}>{r.rollNumber || "—"}</td>
                  <td style={{ padding: 10, fontWeight: 600 }}>{r.studentName}</td>
                  <td className="mono" style={{ padding: 10 }}>{r.registrationNumber || "—"}</td>
                  {platformWide && <td style={{ padding: 10 }}>{r.institute || "—"}</td>}
                  <td style={{ padding: 10 }}>{r.groupLabel || "—"}</td>
                  <td style={{ padding: 10 }}>{r.batchYear || "—"}</td>
                  <td style={{ padding: 10 }}>{r.type}</td>
                  <td style={{ padding: 10 }}>{r.company || "—"}</td>
                  <td className="mono" style={{ padding: 10 }}>{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
                  <td className="mono" style={{ padding: 10, fontWeight: 700, color: r.status === "TERMINATED" ? "var(--rust)" : "var(--ip-accent, #4F9D6E)" }}>{r.score ?? "—"}{r.score != null ? "%" : ""}</td>
                  <td style={{ padding: 10 }}>{r.status === "TERMINATED" ? <span className="badge" style={{ background: "var(--rust)", color: "#fff" }}>Terminated</span> : <span className="badge">Completed</span>}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                    <Link to={`/staff/interview-reports/${r.sessionId}`} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }}>View</Link>{" "}
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => downloadPdf(r.sessionId, r.studentName)}>PDF</button>
                  </td>
                </tr>
              ))}
              {rowsError && (
                <tr><td colSpan={platformWide ? 12 : 11} role="alert" style={{ padding: 20, textAlign: "center", color: "var(--rust)" }}>{rowsError}{" "}<button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setReloadKey((k) => k + 1)}>Try again</button></td></tr>
              )}
              {!rowsError && !rowsLoading && rows && rows.length === 0 && (
                <tr><td colSpan={platformWide ? 12 : 11} style={{ padding: 20, textAlign: "center", color: "var(--ink-dim)" }}>No interviews match these filters.</td></tr>
              )}
              {!rows && rowsLoading && (
                <tr><td colSpan={platformWide ? 12 : 11} className="mono" style={{ padding: 20, textAlign: "center", color: "var(--ink-dim)" }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pageMeta.totalPages > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span className="mono" style={{ alignSelf: "center", fontSize: 13 }}>Page {page} / {pageMeta.totalPages}</span>
            <button className="btn btn-ghost" disabled={page >= pageMeta.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <h4 style={{ fontSize: 13, marginBottom: 8 }}>{title}</h4>
      {children}
    </div>
  );
}
