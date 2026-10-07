import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LineChart, Rows3 } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import { SectionCard, Empty, CardSkeleton, Skel, SectionError, isErr, track } from "../components/student/sdKit";
import {
  WelcomeSection, ContinueLearningCard, QuickActions, PerformanceOverview, PendingActivities, CodingProgress, Recommendations,
} from "../components/student/LearningSections";
import {
  ReadinessCard, MockInterviewCard, CareerProfileCard, CertificatesSection, RecentActivity, NotificationPanel,
} from "../components/student/CareerSections";

// The chart is the only non-trivial secondary widget, so it's split out of the main bundle.
const PerformanceChart = lazy(() => import("../components/student/PerformanceChart"));

const DENSITY_KEY = "caStudentDashDensity";
const readDensity = () => { try { return localStorage.getItem(DENSITY_KEY) === "compact"; } catch { return false; } };

function TrendCard({ d, onRetry }) {
  const trend = d.trend;
  const results = Array.isArray(d.recentResults) ? d.recentResults : [];
  return (
    <SectionCard id="sd-trend" title="Score trend · last 30 days" icon={LineChart} to="/dashboard/performance" linkLabel="Full performance" error={isErr(trend)} onRetry={onRetry}>
      {!Array.isArray(trend) || trend.length === 0 ? (
        <Empty>No scored tests in the last 30 days. Your trend appears here after your next test.</Empty>
      ) : (
        <Suspense fallback={<Skel h={190} />}><PerformanceChart points={trend} /></Suspense>
      )}
      {results.length > 0 && (
        <ul className="sd-list" style={{ marginTop: 12 }} aria-label="Recent results">
          {results.map((r) => (
            <li key={`${r.testId}-${r.date}`} className="sd-row">
              <Link to={`/test/${r.testId}/result`} className="sd-row-title sd-link">{r.name}</Link>
              <span className="sd-num" style={{ fontWeight: 600 }}>{r.percentage}%</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export default function StudentDashboard() {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [compact, setCompact] = useState(readDensity);
  const reqId = useRef(0);

  const load = useCallback(() => {
    const id = ++reqId.current;
    setFailed(false);
    api.get("/student/dashboard")
      .then((res) => { if (id === reqId.current) setD(res.data); })
      .catch(() => { if (id === reqId.current) setFailed(true); });
  }, []);

  useEffect(() => {
    load();
    track("dashboard_opened");
    document.title = "Dashboard · CodeArena";
  }, [load]);

  function toggleDensity() {
    const next = !compact;
    setCompact(next);
    try { localStorage.setItem(DENSITY_KEY, next ? "compact" : "comfortable"); } catch { /* storage unavailable */ }
  }

  return (
    <>
      <Navbar />
      <main className={`sd ${compact ? "compact" : ""}`} id="main-content">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button type="button" className="sd-btn ghost sm" onClick={toggleDensity} aria-pressed={compact}>
            <Rows3 size={14} aria-hidden="true" /> {compact ? "Comfortable view" : "Compact view"}
          </button>
        </div>

        {failed && !d && (
          <div className="sd-card"><SectionError text="We couldn't load your dashboard. Check your connection and try again." onRetry={load} /></div>
        )}

        {!d && !failed && (
          <div className="sd-stack" aria-busy="true" aria-label="Loading your dashboard">
            <div className="sd-hero"><div style={{ display: "grid", gap: 10 }}><Skel w="60%" h={28} /><Skel w="40%" /></div><Skel h={40} /></div>
            <div className="sd-kpis">{Array.from({ length: 6 }).map((_, i) => <Skel key={i} h={78} />)}</div>
            <div className="sd-grid main-side"><CardSkeleton h={260} /><CardSkeleton h={260} /></div>
          </div>
        )}

        {d && (
          <div className="sd-stack">
            <WelcomeSection d={d} />
            <QuickActions />
            <PerformanceOverview d={d} />
            <div className="sd-grid main-side">
              <div className="sd-stack">
                <ContinueLearningCard d={d} onRetry={load} />
                <PendingActivities d={d} onRetry={load} />
                <TrendCard d={d} onRetry={load} />
                <Recommendations d={d} />
              </div>
              <div className="sd-stack">
                <NotificationPanel d={d} onRetry={load} />
                <ReadinessCard d={d} onRetry={load} />
                <CodingProgress d={d} onRetry={load} />
              </div>
            </div>
            <div className="sd-grid cols-3">
              <MockInterviewCard d={d} onRetry={load} />
              <CareerProfileCard d={d} onRetry={load} />
              <CertificatesSection d={d} onRetry={load} />
            </div>
            <RecentActivity d={d} onRetry={load} />
          </div>
        )}
      </main>
    </>
  );
}
