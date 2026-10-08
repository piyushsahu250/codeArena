import { useEffect } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { useDashboard, PageHeader, Panel, Kpi, Empty, FullPageSkeleton, ErrorLine, fmt, timeAgo } from "../../components/admin/adKit";

const STATUS_TONE = { PENDING: "warn", VERIFIED: "good", REJECTED: "bad", REUPLOAD_REQUIRED: "warn" };

export default function ClerkHome() {
  const { data: d, error, loading, reload } = useDashboard("/command/clerk");
  useEffect(() => { document.title = "Clerk dashboard · CodeArena"; }, []);
  const m = d?.metrics;
  return (
    <>
      <Navbar />
      <main className="ad" id="main-content">
        <div className="ad-stack">
          <PageHeader title={d ? `Welcome, ${d.profile.name.split(" ")[0]}` : "Clerk dashboard"} scope={d ? [{ label: "Institute", value: d.profile.institute }, { label: "Academic year", value: d.profile.academicYear }] : []} />
          {error && !d && <ErrorLine text="Your dashboard couldn't load." onRetry={reload} />}
          {loading && !d && <FullPageSkeleton />}
          {d && (
            <>
              <Panel id="tasks" title="Task center">
                {d.tasks.length === 0 ? <Empty>No pending verification or data-entry work. New items appear here as students submit them.</Empty> : (
                  <ul className="ad-list">{d.tasks.map((t) => <li key={t.code} className="ad-row"><span className="ad-row-main"><b className="ad-num">{fmt(t.count)}</b> {t.text}</span><Link to={t.to} className="ad-link">Open</Link></li>)}</ul>
                )}
              </Panel>
              <div className="ad-kpis" style={{ "--ad-kpi-cols": 4 }} role="group" aria-label="Key numbers">
                <Kpi label="Students" value={fmt(m.students)} to="/clerk/students" />
                <Kpi label="New (30 days)" value={fmt(m.newStudents30d)} />
                <Kpi label="Incomplete profiles" value={fmt(m.incompleteProfiles)} to="/clerk/students" />
                <Kpi label="Documents pending" value={fmt(m.documentsPending)} to="/clerk/students?documentVerificationStatus=PENDING" />
                <Kpi label="Documents verified" value={fmt(m.documentsVerified)} />
                <Kpi label="Placement interest not set" value={fmt(m.placementInterestPending)} />
                <Kpi label="Offers pending" value={fmt(m.offersPending)} to="/clerk/placement-analytics" />
                <Kpi label="Offers verified" value={fmt(m.offersVerified)} />
              </div>
              <div className="ad-grid main-side">
                <Panel id="recent" title="Recent student updates">
                  {d.recent.length === 0 ? <Empty>No documents or offers have been submitted yet.</Empty> : (
                    <ul className="ad-list">
                      {d.recent.map((r, i) => (
                        <li key={i} className="ad-row">
                          <div className="ad-row-main"><Link to={`/clerk/students/${r.studentId}`} className="ad-link">{r.text}</Link><span className="ad-reason">{r.kind} · {timeAgo(r.at)}</span></div>
                          <span className={`ad-badge ${STATUS_TONE[r.status] || "mute"}`}>{r.status.replace(/_/g, " ").toLowerCase()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel id="qa" title="Quick access">
                  <div style={{ display: "grid", gap: 8 }}>
                    <Link to="/clerk/students" className="ad-btn ghost" style={{ justifyContent: "flex-start" }}>Search students</Link>
                    <Link to="/clerk/students?documentVerificationStatus=PENDING" className="ad-btn ghost" style={{ justifyContent: "flex-start" }}>Verify documents</Link>
                    <Link to="/clerk/placement-analytics" className="ad-btn ghost" style={{ justifyContent: "flex-start" }}>Placement analytics & offers</Link>
                    <Link to="/clerk/companies" className="ad-btn ghost" style={{ justifyContent: "flex-start" }}>Company master</Link>
                    <Link to="/clerk/results" className="ad-btn ghost" style={{ justifyContent: "flex-start" }}>Results</Link>
                  </div>
                </Panel>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
