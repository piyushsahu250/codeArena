import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import Navbar from "../../components/Navbar";
import {
  useDashboard, PageHeader, Panel, Kpi, StatusBadge, RangePicker, DataTable, PercentCell, Empty, FullPageSkeleton, ErrorLine,
  fmt, timeAgo, actionLabel, ExportButton,
} from "../../components/admin/adKit";

function GroupTable({ rows, label, kind, days, instituteId }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("students");
  const view = useMemo(() => {
    const f = rows.filter((r) => !q || r.label.toLowerCase().includes(q.toLowerCase()));
    return [...f].sort((a, b) => (sort === "label" ? a.label.localeCompare(b.label) : (b[sort] ?? -1) - (a[sort] ?? -1)));
  }, [rows, q, sort]);
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input className="ad-input" type="search" placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="ad-input" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="students">Sort: students</option><option value="label">Sort: name</option><option value="attendancePercent">Sort: attendance</option><option value="courseCompletionPercent">Sort: course completion</option><option value="readinessAvg">Sort: readiness</option><option value="activePercent">Sort: active %</option>
        </select>
        <ExportButton path="/command/institute/export" params={{ kind, days, instituteId }} fallbackName={`${kind}.csv`} />
      </div>
      <DataTable caption={`${label} performance`} rows={view} rowKey={(r) => r.key} empty={`No ${label.toLowerCase()} data yet.`}
        columns={[
          { key: "label", header: label, render: (r) => <b>{r.label}</b> },
          { key: "students", header: "Students", right: true, render: (r) => fmt(r.students) },
          { key: "attendancePercent", header: "Attendance", render: (r) => <PercentCell value={r.attendancePercent} /> },
          { key: "courseCompletionPercent", header: "Course completion", render: (r) => <PercentCell value={r.courseCompletionPercent} /> },
          { key: "readinessAvg", header: "Readiness", render: (r) => <PercentCell value={r.readinessAvg} /> },
          { key: "activePercent", header: "Active students", render: (r) => <PercentCell value={r.activePercent} /> },
          { key: "profileCompletionPercent", header: "Profiles complete", render: (r) => <PercentCell value={r.profileCompletionPercent} /> },
        ]} />
    </>
  );
}

// Used for INSTITUTE_ADMIN (own institute) and, with :instituteId, for SUPER_ADMIN drill-down.
export default function InstituteCommand() {
  const { instituteId } = useParams();
  const [days, setDays] = useState(30);
  const { data: d, error, loading, reload } = useDashboard("/command/institute", { days, instituteId: instituteId || undefined });
  useEffect(() => { document.title = d ? `${d.institute.name} · CodeArena` : "Institute dashboard · CodeArena"; }, [d]);
  const c = d?.counts;

  return (
    <>
      <Navbar />
      <main className="ad" id="main-content">
        <div className="ad-stack">
          {instituteId && (
            <nav aria-label="Breadcrumb" className="ad-sub" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Link to="/admin" className="ad-link">Global dashboard</Link><ChevronRight size={14} aria-hidden="true" /><span>{d?.institute.name || "Institute"}</span>
            </nav>
          )}
          <PageHeader
            title={d ? d.institute.name : "Institute dashboard"}
            scope={d ? [{ label: "Institute", value: d.institute.name }, { label: "Academic year", value: d.institute.academicYear }, { label: "Period", value: days === 1 ? "Today" : `Last ${days} days` }] : []}
            right={<RangePicker value={days} onChange={setDays} />}
          />
          {error && !d && <ErrorLine text="The institute dashboard couldn't load." onRetry={reload} />}
          {loading && !d && <FullPageSkeleton />}
          {d && (
            <>
              <Panel id="ih" title="Institute health" actions={<StatusBadge status={d.health.status} />} sub={d.health.reasons.length ? undefined : "No issues found by the health rules."}>
                {d.health.reasons.length > 0 && <ul className="ad-list">{d.health.reasons.map((r) => <li key={r} className="ad-row"><span className="ad-row-main">{r}</span></li>)}</ul>}
                <details style={{ marginTop: 8 }}><summary className="ad-sub" style={{ cursor: "pointer" }}>How health is calculated</summary><ul className="ad-sub">{d.healthRules.map((r) => <li key={r}>{r}</li>)}</ul></details>
              </Panel>

              <div className="ad-kpis" style={{ "--ad-kpi-cols": 6 }} role="group" aria-label="Institute overview">
                <Kpi label="Students" value={fmt(c.students)} to="/admin/students" />
                <Kpi label="Active students" value={d.activity.activeStudentPercent === null ? null : `${d.activity.activeStudentPercent}%`} foot={`${fmt(d.activity.activeStudents)} logged in`} />
                <Kpi label="Staff" value={fmt(c.staff)} to="/admin/staff-clerk" />
                <Kpi label="Clerks" value={fmt(c.clerks)} to="/admin/staff-clerk" />
                <Kpi label="Staff & clerk analytics" value="Open" foot="Activity, workload, comparisons" to="/admin/staff-analytics" />
                <Kpi label="Departments" value={fmt(c.departments)} foot={`${c.sections} sections`} to="/admin/academic-groups" />
                <Kpi label="Courses assigned" value={fmt(c.courses)} to="/admin/course-assignments" />
                <Kpi label="Assessments" value={fmt(c.assessments)} foot={`${c.liveAssessments} live · ${c.upcomingAssessments} upcoming`} to="/staff/tests" />
                <Kpi label="Attendance" value={d.attendancePercent === null ? null : `${d.attendancePercent}%`} to="/staff/attendance/reports" />
                <Kpi label="Course completion" value={d.courseCompletionPercent === null ? null : `${d.courseCompletionPercent}%`} foot="completed ÷ assigned lessons" />
                <Kpi label="Coding runs" value={fmt(d.activity.codingActivity)} foot={`accepted, last ${days} d`} />
                <Kpi label="Certificates" value={fmt(c.certificates)} to="/admin/certificates" />
                <Kpi label="Talent pool" value={fmt(c.talentPoolStudents)} to="/admin/talent-pools" />
                <Kpi label="Last login" value={d.activity.lastLogin ? timeAgo(d.activity.lastLogin) : null} />
              </div>

              <div className="ad-grid main-side">
                <Panel id="dep" title="Department performance" sub="Students → batches → sections are managed under Academic Groups" to="/admin/academic-groups" linkLabel="Academic groups">
                  <GroupTable rows={d.departments} label="Department" kind="departments" days={days} instituteId={instituteId} />
                  <p style={{ margin: "10px 0 0" }}><ExportButton path="/command/institute/export" params={{ kind: "students", days, instituteId }} label="Export student list (CSV)" fallbackName="students.csv" /></p>
                </Panel>
                <Panel id="pend" title="Needs your action">
                  <ul className="ad-list">
                    <li className="ad-row"><span className="ad-row-main">Result examinations not published</span><Link to="/admin/results" className="ad-link">{fmt(d.pending.resultExaminations)}</Link></li>
                    <li className="ad-row"><span className="ad-row-main">Documents awaiting verification</span><Link to="/admin/students" className="ad-link">{fmt(d.pending.documentsToVerify)}</Link></li>
                    <li className="ad-row"><span className="ad-row-main">Offer letters awaiting verification</span><span className="ad-num">{fmt(d.pending.offersToVerify)}</span></li>
                    <li className="ad-row"><span className="ad-row-main">Failed emails ({days} d)</span><Link to="/admin/email-logs" className="ad-link">{fmt(d.pending.failedEmails)}</Link></li>
                  </ul>
                </Panel>
              </div>

              <Panel id="batch" title="Batch performance">
                <GroupTable rows={d.batches} label="Batch" kind="batches" days={days} instituteId={instituteId} />
              </Panel>

              <Panel id="act" title="Recent institute activity" to="/admin/audit-log" linkLabel="Full audit log">
                {d.recentActivity.length === 0 ? <Empty>No recorded activity yet.</Empty> : (
                  <ul className="ad-list">
                    {d.recentActivity.map((a) => <li key={a.id} className="ad-row"><div className="ad-row-main">{actionLabel(a.action)}<span className="ad-reason">{a.adminName}{a.adminRole ? ` · ${a.adminRole.replace(/_/g, " ").toLowerCase()}` : ""}</span></div><span className="ad-sub">{timeAgo(a.createdAt)}</span></li>)}
                  </ul>
                )}
              </Panel>
            </>
          )}
        </div>
      </main>
    </>
  );
}
