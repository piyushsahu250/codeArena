import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import {
  useDashboard, PageHeader, Panel, Kpi, Delta, StatusBadge, RangePicker, DataTable, PercentCell, SeriesChart, Empty, FullPageSkeleton, ErrorLine,
  fmt, timeAgo, actionLabel, ExportButton,
} from "../../components/admin/adKit";

const ROLE_ROWS = [["STUDENT", "Students"], ["STAFF", "Staff"], ["CLERK", "Clerks"], ["INSTITUTE_ADMIN", "Institute admins"]];

function SecureAssessmentsPanel() {
  const { data: o, error, loading, reload } = useDashboard("/exam-security/overview", { hours: 24 });
  return (
    <Panel id="secure" title="Secure assessments (last 24 h)" sub="Evidence signals for human review, not findings of malpractice" loading={loading && !o} error={error && !o} onRetry={reload}>
      {o && (
        <div className="ad-kpis" style={{ "--ad-kpi-cols": 4 }}>
          <Kpi label="Students testing now" value={fmt(o.live.studentsTesting)} foot={`${o.live.testAttempts} tests · ${o.live.codingAttempts} coding · ${o.live.readinessAttempts} readiness · ${o.live.interviewSessions} interviews`} />
          <Kpi label="Attempts with strikes" value={fmt(o.last.attemptsWithStrikes)} />
          <Kpi label="Fullscreen exits" value={fmt(o.last.fullscreenExits)} />
          <Kpi label="Tab switches" value={fmt(o.last.tabSwitches)} />
          <Kpi label="Possible external activity" value={fmt(o.last.possibleExternalActivity)} foot="focus lost / split screen" />
          <Kpi label="Clipboard attempts" value={fmt(o.last.clipboardAttempts)} />
          <Kpi label="Session conflicts" value={fmt(o.last.sessionConflicts)} />
          <Kpi label="Secure-client failures" value={fmt(o.last.secureClientFailures)} />
        </div>
      )}
      {o?.topInstitutes?.length > 0 && <p className="ad-sub" style={{ margin: "10px 0 0" }}>Most events: {o.topInstitutes.map((i) => `${i.name} (${i.events})`).join(" · ")}</p>}
    </Panel>
  );
}

export default function SuperAdminCommand() {
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [health, setHealth] = useState("");
  const [sort, setSort] = useState("health");
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data: d, error, loading, reload } = useDashboard("/command/super", { days, q: dq || undefined, health: health || undefined, sort, dir: sort === "name" || sort === "health" ? "asc" : "desc", page, pageSize: 15 });
  useEffect(() => { document.title = "Global Command Center · CodeArena"; }, []);

  const t = d?.totals;
  const cols = [
    { key: "name", header: "Institute", render: (r) => <Link to={`/admin/institutes/${r.id}/overview`} className="ad-link" style={{ fontWeight: 600 }}>{r.name}</Link> },
    { key: "health", header: "Health", render: (r) => <><StatusBadge status={r.health} />{r.healthReasons.length > 0 && <span className="ad-reason">{r.healthReasons.join(" · ")}</span>}</> },
    { key: "students", header: "Students", right: true, render: (r) => fmt(r.students) },
    { key: "activeUsers", header: `Active (${days}d)`, right: true, render: (r) => fmt(r.activeUsers) },
    { key: "staff", header: "Staff", right: true, render: (r) => fmt(r.staff) },
    { key: "courses", header: "Courses", right: true, render: (r) => fmt(r.courses) },
    { key: "assessments", header: "Tests", right: true, render: (r) => fmt(r.assessments) },
    { key: "attendancePercent", header: "Attendance", render: (r) => <PercentCell value={r.attendancePercent} /> },
    { key: "courseCompletionPercent", header: "Course completion", render: (r) => <PercentCell value={r.courseCompletionPercent} /> },
    { key: "codingActivity", header: "Coding runs", right: true, render: (r) => fmt(r.codingActivity) },
    { key: "readinessAvg", header: "Readiness", render: (r) => <PercentCell value={r.readinessAvg} /> },
    { key: "lastActivity", header: "Last login", render: (r) => timeAgo(r.lastActivity) },
  ];

  return (
    <>
      <Navbar />
      <main className="ad" id="main-content">
        <div className="ad-stack">
          <PageHeader
            title="Global Command Center"
            scope={[{ label: "Scope", value: "All institutes" }, { label: "Period", value: days === 1 ? "Today" : `Last ${days} days` }]}
            right={<RangePicker value={days} onChange={(v) => { setDays(v); setPage(1); }} />}
          />
          {error && !d && <ErrorLine text="The global dashboard couldn't load." onRetry={reload} />}
          {loading && !d && <FullPageSkeleton />}
          {d && (
            <>
              <div className="ad-kpis" style={{ "--ad-kpi-cols": 5 }} role="list" aria-label="Platform totals">
                <Kpi label="Institutes" value={fmt(t.institutes)} foot={`${t.activeInstitutes} active · ${t.inactiveInstitutes} inactive`} to="/admin/institutes" />
                <Kpi label="Students" value={fmt(t.students)} foot={<>{fmt(d.trends.newStudents.value)} new <Delta t={d.trends.newStudents} /></>} />
                <Kpi label="Active users" value={fmt(t.activeUsers)} foot={`logged in, last ${days} d`} />
                <Kpi label="Staff · Clerks · Admins" value={`${fmt(t.staff)} · ${fmt(t.clerks)} · ${fmt(t.instituteAdmins)}`} to="/admin/staff-clerk" />
                <Kpi label="Tests completed" value={fmt(d.trends.testsCompleted.value)} foot={<Delta t={d.trends.testsCompleted} />} />
                <Kpi label="Coding runs" value={fmt(t.codingInPeriod)} foot="accepted practice runs" />
                <Kpi label="Students learning" value={fmt(t.learningStudentsInPeriod)} foot="completed a lesson" />
                <Kpi label="Course completion" value={t.courseCompletionPercent === null ? null : `${t.courseCompletionPercent}%`} foot="completed ÷ assigned lessons" />
                <Kpi label="Certificates" value={fmt(d.trends.certificates.value)} foot={<Delta t={d.trends.certificates} />} to="/admin/certificates" />
                <Kpi label="Talent pool students" value={fmt(t.talentPoolStudents)} to="/admin/talent-pools" />
                <Kpi label="Live test attempts" value={fmt(d.liveTestAttempts)} foot="in progress right now" />
              </div>

              <div className="ad-grid main-side">
                <Panel id="health" title="Institutes needing attention" sub={`${d.healthSummary.CRITICAL} critical · ${d.healthSummary.NEEDS_ATTENTION} need attention · ${d.healthSummary.HEALTHY} healthy · ${d.healthSummary.INACTIVE} inactive`}>
                  {d.attention.length === 0 ? <Empty>Every active institute is healthy for this period.</Empty> : (
                    <ul className="ad-list">
                      {d.attention.map((a) => (
                        <li key={a.id} className="ad-row">
                          <div className="ad-row-main"><b>{a.name}</b><span className="ad-reason">{a.reasons.join(" · ")}</span></div>
                          <StatusBadge status={a.health} />
                          <Link to={`/admin/institutes/${a.id}/overview`} className="ad-link">View institute</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <details style={{ marginTop: 10 }}><summary className="ad-sub" style={{ cursor: "pointer" }}>How health is calculated</summary><ul className="ad-sub">{d.healthRules.map((r) => <li key={r}>{r}</li>)}</ul></details>
                </Panel>
                <Panel id="sys" title="System health" sub="From live checks, not assumptions">
                  <ul className="ad-list">
                    {d.system.map((s) => <li key={s.key} className="ad-row"><div className="ad-row-main"><b>{s.label}</b><span className="ad-reason">{s.detail}</span></div><StatusBadge status={s.status} /></li>)}
                  </ul>
                  <p className="ad-sub" style={{ margin: "8px 0 0" }}>Not monitored yet: {d.notMonitored.join(", ")}.</p>
                </Panel>
              </div>

              <Panel
                id="inst" title="Institute overview" sub={`${fmt(d.institutes.total)} institute${d.institutes.total === 1 ? "" : "s"}`}
                actions={
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <ExportButton path="/command/super/export" params={{ days, q: dq || undefined, health: health || undefined }} fallbackName="institute-overview.csv" />
                    <input className="ad-input" type="search" placeholder="Search institute" aria-label="Search institutes" value={q} onChange={(e) => setQ(e.target.value)} />
                    <select className="ad-input" aria-label="Filter by health" value={health} onChange={(e) => { setHealth(e.target.value); setPage(1); }}>
                      <option value="">All health states</option><option value="CRITICAL">Critical</option><option value="NEEDS_ATTENTION">Needs attention</option><option value="HEALTHY">Healthy</option><option value="INACTIVE">Inactive</option>
                    </select>
                    <select className="ad-input" aria-label="Sort by" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                      <option value="health">Sort: worst health first</option><option value="name">Sort: name</option><option value="students">Sort: students</option><option value="activeUsers">Sort: active users</option><option value="attendancePercent">Sort: attendance</option><option value="courseCompletionPercent">Sort: course completion</option><option value="lastActivity">Sort: last login</option>
                    </select>
                  </div>
                }
              >
                <DataTable caption="Institute overview" columns={cols} rows={d.institutes.rows} rowKey={(r) => r.id} empty="No institutes match these filters." />
                <div className="ad-pager">
                  <span>Page {d.institutes.page} of {Math.max(1, Math.ceil(d.institutes.total / d.institutes.pageSize))}</span>
                  <span style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="ad-btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                    <button type="button" className="ad-btn ghost sm" disabled={page * d.institutes.pageSize >= d.institutes.total} onClick={() => setPage(page + 1)}>Next</button>
                  </span>
                </div>
              </Panel>

              <div className="ad-grid c2">
                <Panel id="eng" title="User activity" sub="Distinct users who logged in">
                  <SeriesChart points={d.users.dailySeries} keys={["users", "students"]} labels={["All users", "Students"]} />
                  <div style={{ marginTop: 12 }}>
                    <DataTable caption="Daily, weekly and monthly active users by role" rows={ROLE_ROWS} rowKey={(r) => r[0]}
                      columns={[{ key: "l", header: "Role", render: (r) => r[1] }, { key: "d", header: "Daily", right: true, render: (r) => fmt(d.users.dau[r[0]] || 0) }, { key: "w", header: "Weekly", right: true, render: (r) => fmt(d.users.wau[r[0]] || 0) }, { key: "m", header: "Monthly", right: true, render: (r) => fmt(d.users.mau[r[0]] || 0) }]} />
                  </div>
                </Panel>
                <div className="ad-stack">
                  <Panel id="sec" title="Security (last 24 h)" to="/admin/security-dashboard" linkLabel="Open monitor" actions={<StatusBadge status={d.security.severity} />}>
                    <div className="ad-kpis" style={{ "--ad-kpi-cols": 2 }}>
                      <Kpi label="Failed logins" value={fmt(d.security.failedLogins24h)} />
                      <Kpi label="Unauthorized attempts" value={fmt(d.security.unauthorized24h)} />
                      <Kpi label="Account lockouts" value={fmt(d.security.lockouts24h)} />
                      <Kpi label="Password resets" value={fmt(d.security.passwordResets24h)} />
                    </div>
                    <details style={{ marginTop: 8 }}><summary className="ad-sub" style={{ cursor: "pointer" }}>Severity rule</summary><p className="ad-sub">{d.security.severityRule}</p></details>
                  </Panel>
                  <Panel id="mail" title="Email delivery" sub={`Last ${days} days`} to="/admin/email-logs">
                    <div className="ad-kpis" style={{ "--ad-kpi-cols": 3 }}>
                      <Kpi label="Sent" value={fmt(d.email.sent)} /><Kpi label="Failed" value={fmt(d.email.failed)} /><Kpi label="Queued" value={fmt(d.email.pending)} />
                    </div>
                    {d.email.recentFailures.length > 0 && (
                      <ul className="ad-list" style={{ marginTop: 10 }}>
                        {d.email.recentFailures.map((f) => <li key={f.id} className="ad-row"><div className="ad-row-main">{actionLabel(f.type)} → {f.recipient}<span className="ad-reason">{f.institute || "Platform"} · {f.reason || "No reason recorded"}</span></div><span className="ad-sub">{timeAgo(f.at)}</span></li>)}
                      </ul>
                    )}
                  </Panel>
                </div>
              </div>

              <SecureAssessmentsPanel />
              <Panel id="feed" title="Recent platform activity" to="/admin/audit-log" linkLabel="Full audit log">
                {d.activity.length === 0 ? <Empty>No recorded activity yet.</Empty> : (
                  <DataTable caption="Recent platform activity" rows={d.activity} rowKey={(r) => r.id}
                    columns={[
                      { key: "at", header: "When", render: (r) => timeAgo(r.createdAt) },
                      { key: "institute", header: "Institute", render: (r) => r.institute || "Platform" },
                      { key: "actor", header: "Actor", render: (r) => <>{r.adminName}{r.adminRole && <span className="ad-reason">{r.adminRole.replace(/_/g, " ").toLowerCase()}</span>}</> },
                      { key: "action", header: "Action", render: (r) => actionLabel(r.action) },
                      { key: "sev", header: "Severity", render: (r) => <StatusBadge status={r.severity} /> },
                    ]} />
                )}
              </Panel>
            </>
          )}
        </div>
      </main>
    </>
  );
}
