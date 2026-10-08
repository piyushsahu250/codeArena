import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useFeatures } from "../../context/FeatureContext";
import Navbar from "../../components/Navbar";
import { lazy, Suspense } from "react";
const StaffDashboardLegacy = lazy(() => import("../StaffDashboard"));
import { useDashboard, PageHeader, Panel, Kpi, Empty, FullPageSkeleton, ErrorLine, fmt } from "../../components/admin/adKit";

const REASON_TONE = { LOW_ATTENDANCE: "bad", FAILED_ASSESSMENT: "bad", INACTIVE: "warn", PROFILE_INCOMPLETE: "mute" };

function StaffCommand() {
  const { data: d, error, loading, reload } = useDashboard("/command/staff");
  const { isFeatureEnabled } = useFeatures();
  useEffect(() => { document.title = "Staff dashboard · CodeArena"; }, []);
  const hr = new Date().getHours();
  const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const m = d?.metrics;
  const actions = [
    { label: "Mark attendance", to: "/staff/attendance", feature: "attendance" },
    { label: "Create assessment", to: "/staff/tests/new" },
    { label: "Enter marks / results", to: "/admin/results" },
    { label: "View students", to: "/staff/students" },
    { label: "Talent pools", to: "/admin/talent-pools", feature: "talent_pool" },
    { label: "Tests & analytics", to: "/staff/tests" },
  ].filter((a) => !a.feature || isFeatureEnabled(a.feature));

  return (
    <>
      <Navbar />
      <main className="ad" id="main-content">
        <div className="ad-stack">
          <PageHeader
            title={d ? `${greet}, ${d.profile.name.split(" ")[0]}` : "Staff dashboard"}
            scope={d ? [{ label: "Department", value: d.profile.department }, { label: "Institute", value: d.profile.institute }, { label: "Academic year", value: d.profile.academicYear }, { label: "Scope", value: d.scope.label }] : []}
          />
          {error && !d && <ErrorLine text="Your dashboard couldn't load." onRetry={reload} />}
          {loading && !d && <FullPageSkeleton />}
          {d && (
            <>
              <div className="ad-kpis" style={{ "--ad-kpi-cols": 4 }} role="list" aria-label="Key numbers">
                <Kpi label="Students in scope" value={fmt(m.students)} to="/staff/students" />
                <Kpi label="At risk" value={fmt(m.atRisk)} foot="low attendance or failed result" />
                <Kpi label="Today's attendance" value={m.todayAttendancePlanned ? `${m.todayAttendanceMarked}/${m.todayAttendancePlanned}` : null} foot={m.todayAttendancePlanned ? "lectures marked" : undefined} to="/staff/attendance" />
                <Kpi label="Absent today" value={fmt(m.absentToday)} to="/staff/attendance/reports" />
                <Kpi label="Upcoming assessments" value={fmt(m.upcomingAssessments)} foot="next 7 days" to="/staff/tests" />
                <Kpi label="Results awaiting action" value={fmt(m.resultsAwaitingAction)} foot="draft / in review / ready" to="/admin/results" />
                <Kpi label="Taking a test now" value={fmt(m.liveAttempts)} />
                <Kpi label="Unread notifications" value={fmt(m.unreadNotifications)} />
              </div>

              <div className="ad-grid main-side">
                <div className="ad-stack">
                  <Panel id="today" title="Today's work">
                    {d.today.length === 0 && d.lecturesToday.length === 0 ? <Empty>Nothing needs your attention right now.</Empty> : (
                      <ul className="ad-list">
                        {d.today.map((t) => <li key={t.code} className="ad-row"><span className="ad-row-main">{t.text}</span><Link to={t.to} className="ad-link">Open</Link></li>)}
                        {d.lecturesToday.map((l) => <li key={l.id} className="ad-row"><span className="ad-row-main">{l.start} · {l.topic}</span><span className={`ad-badge ${l.marked ? "good" : "warn"}`}>{l.marked ? "Attendance marked" : "Attendance pending"}</span></li>)}
                      </ul>
                    )}
                  </Panel>

                  <Panel id="attn" title="Students requiring attention" sub={`${fmt(d.attention.total)} flagged · ${d.attention.byReason.lowAttendance} low attendance · ${d.attention.byReason.failedAssessment} failed result · ${d.attention.byReason.inactive} inactive · ${d.attention.byReason.profileIncomplete} profile incomplete`} to="/staff/students" linkLabel="All students">
                    {!m.attendanceThresholdConfigured && <p className="ad-sub" style={{ margin: "0 0 8px" }}>Low-attendance flags are off: your institute has no minimum attendance % configured.</p>}
                    {d.attention.students.length === 0 ? <Empty>No student is flagged. Flags are based on attendance, published results, last login and profile completion.</Empty> : (
                      <ul className="ad-list">
                        {d.attention.students.map((s) => (
                          <li key={s.id} className="ad-row">
                            <div className="ad-row-main"><b>{s.name}</b>{s.rollNumber && <span className="ad-sub"> · {s.rollNumber}</span>}
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>{s.reasons.map((r) => <span key={r.code} className={`ad-badge ${REASON_TONE[r.code]}`}>{r.text}</span>)}</div></div>
                            <Link to={`/staff/students/${s.id}`} className="ad-link">View student</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                </div>

                <div className="ad-stack">
                  <Panel id="qa" title="Quick actions">
                    <div style={{ display: "grid", gap: 8 }}>{actions.map((a) => <Link key={a.to} to={a.to} className="ad-btn ghost" style={{ justifyContent: "flex-start" }}>{a.label}</Link>)}</div>
                  </Panel>
                  <Panel id="up" title="Upcoming assessments" to="/staff/tests">
                    {d.upcoming.length === 0 ? <Empty>No published assessments start in the next 7 days.</Empty> : (
                      <ul className="ad-list">{d.upcoming.map((t) => <li key={t.id} className="ad-row"><span className="ad-row-main">{t.title}</span><span className="ad-sub">{new Date(t.startTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span></li>)}</ul>
                    )}
                  </Panel>
                  {d.scope.groups.length > 0 && (
                    <Panel id="cls" title="Your classes"><ul className="ad-list">{d.scope.groups.map((g) => <li key={g} className="ad-row"><span className="ad-row-main">{g}</span></li>)}</ul></Panel>
                  )}
                </div>
              </div>
              <p className="ad-sub">Not tracked: {d.notTracked.join("; ")}.</p>
            </>
          )}
        </div>
      </main>
    </>
  );
}

// /staff is shared with legacy platform-admin access; the task-first dashboard is for STAFF accounts.
export default function StaffHome() {
  const { user } = useAuth();
  return user?.role === "STAFF" ? <StaffCommand /> : <Suspense fallback={null}><StaffDashboardLegacy /></Suspense>;
}
