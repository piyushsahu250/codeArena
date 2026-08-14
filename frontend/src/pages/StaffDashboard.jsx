import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { PlusCircle, BookOpen, Trophy, FileText, Mic, Users as UsersIcon, Upload, Download, School, GraduationCap, ClipboardList, BarChart3 } from "lucide-react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { SkeletonGrid } from "../components/Skeleton";

function statusOf(test) {
  const now = new Date();
  const start = new Date(test.startTime);
  const end = new Date(test.endTime);
  if (!test.isPublished) return { label: "Draft", color: "var(--ink-dim)" };
  if (now < start) return { label: "Scheduled", color: "var(--amber-dark)" };
  if (now > end) return { label: "Completed", color: "var(--ink-dim)" };
  return { label: "Active", color: "var(--mint)" };
}

export default function StaffDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const manageTestsRef = useRef(null);
  const [tests, setTests] = useState([]);
  const [groups, setGroups] = useState(null);
  const [gamiStats, setGamiStats] = useState(null);
  const [interviewStats, setInterviewStats] = useState(null);
  const [resumeStats, setResumeStats] = useState(null);
  const [courseCount, setCourseCount] = useState(null);

  const [nameFilter, setNameFilter] = useState("");
  const [instituteFilter, setInstituteFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    refresh();
    api.get("/academic-groups").then((res) => setGroups(res.data)).catch(() => setGroups([]));
    api.get("/gamification/admin/stats").then((res) => setGamiStats(res.data)).catch(() => setGamiStats(null));
    api.get("/interview/admin/stats").then((res) => setInterviewStats(res.data)).catch(() => setInterviewStats(null));
    api.get("/resume/admin/stats").then((res) => setResumeStats(res.data)).catch(() => setResumeStats(null));
    api.get("/learning/courses").then((res) => setCourseCount(res.data.length)).catch(() => setCourseCount(null));
  }, []);

  function refresh() {
    api.get("/tests").then((res) => setTests(res.data));
  }

  async function togglePublish(test) {
    await api.patch(`/tests/${test.id}/publish`, { isPublished: !test.isPublished });
    refresh();
  }

  async function deleteTest(test) {
    await api.delete(`/tests/${test.id}`);
    refresh();
  }

  async function duplicateTest(test) {
    await api.post(`/tests/${test.id}/duplicate`);
    refresh();
  }

  // The Active/Total Tests stat cards point at the Manage Tests table already on this same page
  // rather than a separate route — jumping to a second page just to see the number you clicked
  // would be redundant when the underlying list lives a few hundred pixels down.
  function goToManageTests(status) {
    setNameFilter("");
    setInstituteFilter("");
    setGroupFilter("");
    setBatchFilter("");
    setStatusFilter(status);
    manageTestsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // A test's institute is now determined by Test.instituteId (see backend/src/routes/tests.js)
  // first, falling back to whatever its academicGroups/classes carry — a platform-level creator
  // can scope a test to one institute directly, with zero group assignments, so the institute
  // can no longer be read off academicGroups[]/classes[] alone.
  function testInstitute(t) {
    if (t.institute) return t.institute;
    for (const tg of t.academicGroups) if (tg.academicGroup?.institute) return tg.academicGroup.institute;
    for (const tc of t.classes) if (tc.class?.institute) return tc.class.institute;
    return null;
  }

  // Cascading filter options: Institute narrows Group, Institute+Group narrows Batch — so a
  // platform-level Admin picking "Sanjivani University" never sees another institute's groups or
  // batches offered as if they applied, which was the exact source of confusing "no results"
  // combinations before this fix.
  const instituteOptions = useMemo(() => {
    const institutes = new Map();
    for (const t of tests) {
      const inst = testInstitute(t);
      if (inst) institutes.set(inst.id, inst.name);
    }
    return [...institutes.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tests]);

  const groupOptions = useMemo(() => {
    const groups = new Map();
    for (const t of tests) {
      const inst = testInstitute(t);
      if (instituteFilter && inst?.id !== instituteFilter) continue;
      for (const tg of t.academicGroups) {
        const g = tg.academicGroup;
        if (g) groups.set(g.id, `${g.department?.name || "—"} - ${g.section}`);
      }
      for (const tc of t.classes) {
        if (tc.class) groups.set(tc.class.id, tc.class.name);
      }
    }
    return [...groups.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tests, instituteFilter]);

  const batchOptions = useMemo(() => {
    const batches = new Set();
    for (const t of tests) {
      const inst = testInstitute(t);
      if (instituteFilter && inst?.id !== instituteFilter) continue;
      if (groupFilter) {
        const inGroup = t.academicGroups.some((tg) => tg.academicGroup?.id === groupFilter)
          || t.classes.some((tc) => tc.class?.id === groupFilter);
        if (!inGroup) continue;
      }
      for (const tg of t.academicGroups) if (tg.academicGroup?.batch) batches.add(tg.academicGroup.batch);
      for (const tc of t.classes) if (tc.class?.batchYear) batches.add(tc.class.batchYear);
    }
    return [...batches].sort();
  }, [tests, instituteFilter, groupFilter]);

  const filtered = tests.filter((t) => {
    if (nameFilter && !t.title.toLowerCase().includes(nameFilter.toLowerCase())) return false;
    if (instituteFilter && testInstitute(t)?.id !== instituteFilter) return false;
    if (groupFilter) {
      const match = t.academicGroups.some((tg) => tg.academicGroup?.id === groupFilter)
        || t.classes.some((tc) => tc.class?.id === groupFilter);
      if (!match) return false;
    }
    if (batchFilter) {
      const match = t.academicGroups.some((tg) => tg.academicGroup?.batch === batchFilter)
        || t.classes.some((tc) => tc.class?.batchYear === batchFilter);
      if (!match) return false;
    }
    if (statusFilter && statusOf(t).label !== statusFilter) return false;
    return true;
  });

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Staff control room</h1>
            <ChalkUnderline />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link to="/staff/tests/new" className="btn btn-primary"><PlusCircle size={15} /> Create Test</Link>
            <Link to="/staff/learning" className="btn btn-ghost"><BookOpen size={15} /> Learning Management</Link>
            <Link to="/staff/students" className="btn btn-ghost"><Download size={15} /> Download Reports</Link>
            <Link to="/staff/students" className="btn btn-ghost"><UsersIcon size={15} /> Student Performance</Link>
            <Link to="/staff/questions" className="btn btn-ghost"><Upload size={15} /> Upload Questions</Link>
            <Link to="/staff/gamification" className="btn btn-ghost"><Trophy size={15} /> Gamification</Link>
            <Link to="/staff/resumes" className="btn btn-ghost"><FileText size={15} /> Resumes</Link>
            <Link to="/staff/interviews" className="btn btn-ghost"><Mic size={15} /> Mock Interviews</Link>
          </div>
        </div>

        {/* Summary cards */}
        {groups === null ? (
          <div style={{ marginTop: 24 }}><SkeletonGrid count={7} minWidth={150} /></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 24 }}>
            <StatCard
              icon={School}
              label="Academic Groups"
              value={groups.length}
              onClick={user.role === "ADMIN" ? () => navigate("/admin/academic-groups") : undefined}
            />
            <StatCard icon={GraduationCap} label="Total Students" value={groups.reduce((s, g) => s + (g._count?.users || 0), 0)} onClick={() => navigate("/staff/students")} />
            <StatCard icon={ClipboardList} label="Active Tests" value={tests.filter((t) => statusOf(t).label === "Active").length} onClick={() => goToManageTests("Active")} />
            <StatCard icon={BarChart3} label="Total Tests" value={tests.length} onClick={() => goToManageTests("")} />
            <StatCard icon={BookOpen} label="Learning Courses" value={courseCount ?? "—"} onClick={() => navigate("/staff/learning")} />
            <StatCard icon={FileText} label="Resumes In Progress" value={resumeStats ? resumeStats.resumesStarted : "—"} onClick={() => navigate("/staff/resumes")} />
            <StatCard icon={Mic} label="Avg. Interview Score" value={interviewStats ? `${interviewStats.averageScore}%` : "—"} onClick={() => navigate("/staff/interviews")} />
          </div>
        )}

        {/* Student analytics */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginTop: 24 }}>
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Test Status Overview</h3>
            <div className="card" style={{ padding: 20, height: 220 }}>
              {tests.length === 0 ? (
                <p style={{ color: "var(--ink-dim)", fontSize: 13, textAlign: "center", paddingTop: 60 }}>No tests yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={testStatusChartData(tests)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="var(--mint)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Top Students (XP)</h3>
            <div className="card" style={{ padding: 20, height: 220, overflowY: "auto" }}>
              {!gamiStats || gamiStats.topStudents.length === 0 ? (
                <p style={{ color: "var(--ink-dim)", fontSize: 13, textAlign: "center", paddingTop: 60 }}>Not enough activity yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {gamiStats.topStudents.slice(0, 6).map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span>#{i + 1} {s.name}</span>
                      <span className="mono" style={{ color: "var(--mint)", fontWeight: 700 }}>{s.xp} XP</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <h3 ref={manageTestsRef} style={{ fontSize: 16, marginTop: 32, marginBottom: 4, scrollMarginTop: 24 }}>Manage Tests</h3>

        <div className="card" style={{ padding: 16, marginTop: 24, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            style={{ ...inputStyle, flex: "2 1 200px" }}
            placeholder="Search by test name…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
          <select
            style={{ ...inputStyle, flex: "1 1 160px" }}
            value={instituteFilter}
            onChange={(e) => { setInstituteFilter(e.target.value); setGroupFilter(""); setBatchFilter(""); }}
          >
            <option value="">All institutes</option>
            {instituteOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select
            style={{ ...inputStyle, flex: "1 1 140px" }}
            value={groupFilter}
            onChange={(e) => { setGroupFilter(e.target.value); setBatchFilter(""); }}
          >
            <option value="">All groups</option>
            {groupOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select style={{ ...inputStyle, flex: "1 1 120px" }} value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
            <option value="">All batches</option>
            {batchOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select style={{ ...inputStyle, flex: "1 1 130px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="Draft">Draft</option>
            <option value="Scheduled">Scheduled</option>
            <option value="Active">Active</option>
            <option value="Completed">Completed</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
          {filtered.map((test) => {
            const status = statusOf(test);
            const hasAssignment = test.academicGroups.length > 0 || test.classes.length > 0;
            const studentCount = hasAssignment
              ? test.academicGroups.reduce((sum, tg) => sum + (tg.academicGroup?._count?.users || 0), 0)
                + test.classes.reduce((sum, tc) => sum + (tc.class?._count?.users || 0), 0)
              : null;
            return (
              <div key={test.id} className="card" style={{ padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <h3 style={{ fontSize: 18 }}>{test.title}</h3>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: status.color }}>● {status.label}</span>
                    </div>
                    <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {test._count?.questions || 0} questions · {test._count?.attempts || 0} attempts
                      {studentCount !== null && ` · ${studentCount} assigned student${studentCount === 1 ? "" : "s"}`}
                    </p>
                    <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                      Created by {test.createdBy?.name || "—"} · {new Date(test.createdAt).toLocaleDateString()}
                    </p>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {!hasAssignment ? (
                        <span className="badge">
                          {test.institute ? `All groups at ${test.institute.name}` : "All groups (platform-wide)"}
                        </span>
                      ) : (
                        <>
                          {test.academicGroups.map((tg) => (
                            <span key={tg.id} className="badge">
                              {tg.academicGroup?.institute?.name || "—"} · {tg.academicGroup?.department?.name || "—"} - {tg.academicGroup?.section}
                              {tg.academicGroup?.batch ? ` (${tg.academicGroup.batch})` : ""}
                            </span>
                          ))}
                          {test.classes.map((tc) => (
                            <span key={tc.id} className="badge">
                              {tc.class?.institute?.name || "—"} · {tc.class?.name || "—"}
                              {tc.class?.batchYear ? ` (${tc.class.batchYear})` : ""}
                            </span>
                          ))}
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Link to={`/staff/tests/${test.id}/preview`} className="btn btn-ghost">Preview</Link>
                    <Link to={`/staff/tests/${test.id}/edit`} className="btn btn-ghost">Edit</Link>
                    <button className="btn btn-ghost" onClick={() => duplicateTest(test)}>Duplicate</button>
                    <Link to={`/staff/tests/${test.id}/results`} className="btn btn-ghost">Results</Link>
                    <button className="btn btn-dark" onClick={() => togglePublish(test)}>
                      {test.isPublished ? "Unpublish" : "Publish"}
                    </button>
                    {user.role === "ADMIN" && (
                      <button className="btn btn-ghost" style={{ color: "var(--rust)", borderColor: "var(--rust)" }} onClick={() => deleteTest(test)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--ink-dim)" }}>
              {tests.length === 0 ? "No tests yet. Create a question bank first, then assemble a test." : "No tests match these filters."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };

function StatCard({ icon: Icon, label, value, onClick }) {
  return (
    <div
      className="card"
      style={{ padding: "14px 16px", cursor: onClick ? "pointer" : "default", transition: "transform 0.1s, box-shadow 0.1s" }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08))"; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; } : undefined}
    >
      <Icon size={20} />
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function testStatusChartData(tests) {
  const counts = { Draft: 0, Scheduled: 0, Active: 0, Completed: 0 };
  for (const t of tests) counts[statusOf(t).label] = (counts[statusOf(t).label] || 0) + 1;
  return Object.entries(counts).map(([name, count]) => ({ name, count }));
}
