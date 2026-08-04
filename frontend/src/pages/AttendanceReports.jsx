import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useAuth } from "../context/AuthContext";
import useIsMobile from "../hooks/useIsMobile";

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };

const STATUS_COLORS = { PRESENT: "var(--mint)", ABSENT: "var(--rust)", LATE: "var(--amber)", LEAVE: "#64748b" };

// Filterable attendance report — STAFF automatically sees only their own assignments (enforced
// server-side; the filter options here are derived from the same scoped my-assignments list the
// landing page uses, so a staff member never even sees a filter option they can't access). ADMIN
// sees everything in their institute scope, including a Faculty filter.
export default function AttendanceReports() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isMobile = useIsMobile();
  const [myAssignments, setMyAssignments] = useState([]);
  const [filters, setFilters] = useState({
    date: "", dateFrom: "", dateTo: "", academicYear: "", departmentId: "", section: "",
    subject: "", semester: "", facultyId: "", lectureType: "", status: "", talentPoolId: "",
  });
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get("/attendance/my-assignments").then((res) => setMyAssignments(res.data)).catch(() => setMyAssignments([]));
  }, []);

  const academicYears = useMemo(() => {
    return [...new Set(myAssignments.map((a) => a.academicGroup?.batch || a.class?.batchYear).filter(Boolean))];
  }, [myAssignments]);

  const departments = useMemo(() => {
    const map = new Map();
    myAssignments.forEach((a) => a.academicGroup?.department && map.set(a.academicGroup.department.id, a.academicGroup.department.name));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [myAssignments]);

  const sections = useMemo(() => {
    const set = new Set();
    myAssignments.forEach((a) => {
      if (a.academicGroup && (!filters.departmentId || a.academicGroup.departmentId === filters.departmentId)) set.add(a.academicGroup.section);
    });
    return [...set];
  }, [myAssignments, filters.departmentId]);

  const semesters = useMemo(() => [...new Set(myAssignments.map((a) => a.semester))], [myAssignments]);
  const talentPools = useMemo(() => {
    const map = new Map();
    myAssignments.forEach((a) => a.talentPoolId && map.set(a.talentPoolId, a.talentPool?.name || "Talent Pool"));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [myAssignments]);
  const faculty = useMemo(() => {
    const map = new Map();
    myAssignments.forEach((a) => map.set(a.staff.id, a.staff.name));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [myAssignments]);

  function set(field, value) {
    setFilters((f) => ({ ...f, [field]: value }));
  }

  function activeParams() {
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    return params;
  }

  async function runReport() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/attendance/reports", { params: activeParams() });
      setRows(data.rows);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  async function exportAs(format) {
    setExporting(format);
    try {
      const { data } = await api.get("/attendance/reports", { params: { ...activeParams(), format }, responseType: "blob" });
      const mime = format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : format === "pdf" ? "application/pdf" : "text/csv";
      const url = URL.createObjectURL(new Blob([data], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-report-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.error || "Export failed");
    } finally {
      setExporting("");
    }
  }

  const columns = ["Roll Number", "Student Name", "Registration Number", "Department", "Section", "Batch", "Subject", "Semester", "Faculty", "Lecture #", "Lecture Type", "Test", "Date"];

  const filteredRows = useMemo(() => {
    if (!rows || !search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (r["Roll Number"] || "").toLowerCase().includes(q) ||
      (r["Registration Number"] || "").toLowerCase().includes(q) ||
      (r["Student Name"] || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1>Attendance Reports</h1>
            <ChalkUnderline />
          </div>
          <Link to="/staff/attendance" className="btn btn-ghost">Mark Attendance</Link>
        </div>

        <div className="card" style={{ padding: 16, marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <div>
            <label style={labelStyle}>Date</label>
            <input type="date" style={inputStyle} value={filters.date} onChange={(e) => set("date", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>From</label>
            <input type="date" style={inputStyle} value={filters.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} disabled={!!filters.date} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input type="date" style={inputStyle} value={filters.dateTo} onChange={(e) => set("dateTo", e.target.value)} disabled={!!filters.date} />
          </div>
          <div>
            <label style={labelStyle}>Batch</label>
            <select style={inputStyle} value={filters.academicYear} onChange={(e) => set("academicYear", e.target.value)}>
              <option value="">All</option>
              {academicYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <select style={inputStyle} value={filters.departmentId} onChange={(e) => { set("departmentId", e.target.value); set("section", ""); }}>
              <option value="">All</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Section</label>
            <select style={inputStyle} value={filters.section} onChange={(e) => set("section", e.target.value)}>
              <option value="">All</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Semester</label>
            <select style={inputStyle} value={filters.semester} onChange={(e) => set("semester", e.target.value)}>
              <option value="">All</option>
              {semesters.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Subject</label>
            <input style={inputStyle} placeholder="e.g. Data Structures" value={filters.subject} onChange={(e) => set("subject", e.target.value)} />
          </div>
          {talentPools.length > 0 && (
            <div>
              <label style={labelStyle}>Talent Pool</label>
              <select style={inputStyle} value={filters.talentPoolId} onChange={(e) => set("talentPoolId", e.target.value)}>
                <option value="">All</option>
                {talentPools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {isAdmin && (
            <div>
              <label style={labelStyle}>Faculty</label>
              <select style={inputStyle} value={filters.facultyId} onChange={(e) => set("facultyId", e.target.value)}>
                <option value="">All</option>
                {faculty.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label style={labelStyle}>Lecture Type</label>
            <select style={inputStyle} value={filters.lectureType} onChange={(e) => set("lectureType", e.target.value)}>
              <option value="">All</option>
              <option value="REGULAR">Regular Class</option>
              <option value="PRACTICE_TEST">Practice Test</option>
              <option value="EXAM">Exam</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Attendance Status</label>
            <select style={inputStyle} value={filters.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">All</option>
              <option value="PRESENT">Present</option>
              <option value="ABSENT">Absent</option>
              <option value="LATE">Late</option>
              <option value="LEAVE">Leave</option>
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={runReport} disabled={loading}>{loading ? "Loading…" : "Run Report"}</button>
          <button className="btn btn-ghost" onClick={() => exportAs("csv")} disabled={!!exporting}>{exporting === "csv" ? "Exporting…" : "Export CSV"}</button>
          <button className="btn btn-ghost" onClick={() => exportAs("xlsx")} disabled={!!exporting}>{exporting === "xlsx" ? "Exporting…" : "Export Excel"}</button>
          <button className="btn btn-ghost" onClick={() => exportAs("pdf")} disabled={!!exporting}>{exporting === "pdf" ? "Exporting…" : "Export PDF"}</button>
        </div>
        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 10 }}>{error}</p>}

        {rows && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>{filteredRows.length} of {rows.length} record(s)</p>
              <input
                style={{ ...inputStyle, maxWidth: 280 }}
                placeholder="Search by roll number, registration number, or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {filteredRows.length === 0 && (
              <p style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No records match these filters.</p>
            )}

            {filteredRows.length > 0 && isMobile && (
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {filteredRows.map((r, i) => (
                  <div key={i} className="card" style={{ padding: 12, fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: 13 }}><span className="mono">{r["Roll Number"]}</span> — {r["Student Name"]}</strong>
                      <span style={{ fontWeight: 700, color: STATUS_COLORS[r.Status] || "var(--ink)" }}>{r.Status}</span>
                    </div>
                    <div style={{ color: "var(--ink-dim)", marginTop: 4 }}>{r.Subject} · Lecture {r["Lecture #"]} · {r.Date}</div>
                    <div style={{ color: "var(--ink-dim)", marginTop: 2 }}>{r.Department} · {r.Section}</div>
                    <div style={{ color: "var(--ink-dim)", marginTop: 2 }}>PRN: {r["Registration Number"]} · Faculty: {r.Faculty}</div>
                  </div>
                ))}
              </div>
            )}

            {filteredRows.length > 0 && !isMobile && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", color: "var(--ink-dim)" }}>
                      {columns.map((h) => <th key={h} style={{ padding: "6px 8px" }}>{h}</th>)}
                      <th style={{ padding: "6px 8px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                        {columns.map((k) => (
                          <td key={k} style={{ padding: "6px 8px" }} className={k === "Roll Number" || k === "Registration Number" ? "mono" : undefined}>{r[k]}</td>
                        ))}
                        <td style={{ padding: "6px 8px", fontWeight: 700, color: STATUS_COLORS[r.Status] || "var(--ink)" }}>{r.Status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
