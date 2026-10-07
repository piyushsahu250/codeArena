import { Link } from "react-router-dom";
import {
  PlayCircle, BookOpen, Code2, ClipboardList, BarChart3, Mic, FileText, Award, Target, Flame, Sparkles, Trophy, Clock,
} from "lucide-react";
import { useFeatures } from "../../context/FeatureContext";
import { SectionCard, Empty, Bar, toneFor, isErr, track, dueLabel } from "./sdKit";

// Welcome + the single most useful next step. Never prints "undefined"/"null": every value has an
// explicit fallback, and the headline is plain text — no invented quotes or motivational filler.
export function WelcomeSection({ d }) {
  const first = d.profile?.firstName;
  const hr = new Date().getHours();
  const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const learn = d.learning?.course;
  const streak = d.kpis?.streak;
  const sub = [d.profile?.program, d.profile?.institute].filter(Boolean).join(" · ");
  let next = null;
  if (learn && !learn.completed && learn.nextLesson) next = { label: `Continue "${learn.nextLesson.title}"`, to: learn.resumeUrl };
  else if (Array.isArray(d.tasks?.items) && d.tasks.items[0]) next = { label: `${d.tasks.items[0].cta}: ${d.tasks.items[0].title}`, to: d.tasks.items[0].url };

  return (
    <header className="sd-hero">
      <div style={{ minWidth: 0 }}>
        <h1>{first ? `${greet}, ${first}` : "Welcome back"}</h1>
        {sub && <p className="sd-muted" style={{ margin: "6px 0 0" }}>{sub}</p>}
        {typeof streak === "number" && streak > 0 && (
          <p className="sd-chip good" style={{ marginTop: 12 }}><Flame size={13} aria-hidden="true" /> {streak}-day learning streak</p>
        )}
        {next && (
          <p style={{ margin: "14px 0 0" }}>
            <Link to={next.to} className="sd-btn" onClick={() => track("next_action_clicked", { kind: "hero" })}>{next.label}</Link>
          </p>
        )}
      </div>
      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }} className="sd-muted">
          <span>{learn ? learn.name : "Learning progress"}</span>
          <span className="sd-num">{typeof learn?.percent === "number" ? `${learn.percent}%` : "—"}</span>
        </div>
        {typeof learn?.percent === "number" ? <Bar value={learn.percent} tone={toneFor(learn.percent)} /> : <Empty>No course assigned yet. Your institute will assign one soon.</Empty>}
      </div>
    </header>
  );
}

export function ContinueLearningCard({ d, onRetry }) {
  const l = d.learning;
  const c = l?.course;
  return (
    <SectionCard id="sd-learn" title="Continue learning" icon={PlayCircle} to="/learning" linkLabel="All courses" error={isErr(l)} onRetry={onRetry}>
      {!c ? <Empty>No course has been assigned to you yet.</Empty> : (
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 18 }}>{c.name}</div>
            <div className="sd-muted">
              {c.completed ? "Course completed" : c.currentModule ? `Current module: ${c.currentModule.title}` : "Ready to start"}
              {c.nextLesson && <> · Next: {c.nextLesson.title}</>}
            </div>
          </div>
          {typeof c.percent === "number" ? (
            <div style={{ display: "grid", gap: 6 }}>
              <Bar value={c.percent} tone={toneFor(c.percent)} />
              <span className="sd-muted sd-num">{c.completedLessons} of {c.totalLessons} lessons · {c.percent}%{c.remainingMinutes ? ` · about ${c.remainingMinutes} min left in this module` : ""}</span>
            </div>
          ) : <Empty>This course has no published lessons yet.</Empty>}
          <div><Link to={c.resumeUrl} className="sd-btn" onClick={() => track("continue_learning_clicked", { course: c.slug })}>{c.completed ? "Review course" : c.completedLessons ? "Resume" : "Start learning"}</Link></div>
        </div>
      )}
    </SectionCard>
  );
}

const ACTIONS = [
  { label: "Learning", to: "/learning", icon: BookOpen, feature: "lms" },
  { label: "My tests", to: "/results", icon: ClipboardList },
  { label: "Coding practice", to: "/challenges/daily", icon: Code2, feature: "coding_challenge" },
  { label: "Mock interview", to: "/interview", icon: Mic, feature: "ai_mock_interview" },
  { label: "Resume", to: "/resume", icon: FileText, feature: "resume_builder" },
  { label: "Readiness", to: "/readiness", icon: Target, feature: "readiness_test" },
  { label: "Certificates", to: "/certificates", icon: Award, feature: "certificates" },
  { label: "Performance", to: "/dashboard/performance", icon: BarChart3 },
];

export function QuickActions() {
  const { isFeatureEnabled } = useFeatures();
  const items = ACTIONS.filter((a) => !a.feature || isFeatureEnabled(a.feature)).slice(0, 6);
  return (
    <nav aria-label="Quick actions" className="sd-actions">
      {items.map((a) => (
        <Link key={a.to} to={a.to} className="sd-action" onClick={() => track("quick_action_clicked", { to: a.to })}>
          <a.icon size={20} aria-hidden="true" />{a.label}
        </Link>
      ))}
    </nav>
  );
}

function Kpi({ label, value, sub }) {
  const na = value === null || value === undefined;
  return (
    <div className="sd-kpi">
      <span className="sd-kpi-label">{label}</span>
      {na ? <span className="sd-kpi-value na">Not available yet</span> : <span className="sd-kpi-value">{value}</span>}
      {sub && !na && <span className="sd-kpi-sub">{sub}</span>}
    </div>
  );
}

export function PerformanceOverview({ d }) {
  const k = d.kpis;
  if (isErr(k)) return <SectionCard title="Performance" icon={BarChart3} error />;
  return (
    <div className="sd-kpis" role="list" aria-label="Performance overview">
      <Kpi label="Average score" value={k.averageScorePercent === null ? null : `${k.averageScorePercent}%`} sub="across completed tests" />
      <Kpi label="Tests done" value={k.testsAssigned ? `${k.testsCompleted}/${k.testsAssigned}` : null} sub={k.testsPending ? `${k.testsPending} not started` : undefined} />
      <Kpi label="Class rank" value={k.rank ? `#${k.rank}` : null} sub={k.totalInGroup ? `of ${k.totalInGroup}` : undefined} />
      <Kpi label="Attendance" value={k.attendancePercent === null ? null : `${k.attendancePercent}%`} />
      <Kpi label="Streak" value={typeof k.streak === "number" ? `${k.streak} day${k.streak === 1 ? "" : "s"}` : null} sub={k.longestStreak ? `best ${k.longestStreak}` : undefined} />
      <Kpi label="Coding solved" value={typeof k.codingSolved === "number" ? k.codingSolved : null} />
    </div>
  );
}

const TASK_TONE = { IN_PROGRESS: "warn", OPEN: "good", UPCOMING: "" };
const TASK_LABEL = { IN_PROGRESS: "In progress", OPEN: "Open now", UPCOMING: "Upcoming" };

export function PendingActivities({ d, onRetry }) {
  const t = d.tasks;
  return (
    <SectionCard id="sd-tasks" title="Your next tasks" icon={ClipboardList} to="/results" error={isErr(t)} onRetry={onRetry}>
      {!t?.items?.length ? <Empty>You're all caught up. New tests will show up here with their deadline.</Empty> : (
        <ul className="sd-list">
          {t.items.map((x) => (
            <li key={x.id} className="sd-row">
              <div className="sd-row-main">
                <div className="sd-row-title">{x.title}</div>
                <div className="sd-muted" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
                  <span className={`sd-chip ${TASK_TONE[x.status]}`}>{TASK_LABEL[x.status]}</span>
                  <span><Clock size={12} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {dueLabel(x.due)}</span>
                </div>
              </div>
              <Link to={x.url} className="sd-btn sm" onClick={() => track("task_clicked", { kind: x.kind })}>{x.cta}</Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function CodingProgress({ d, onRetry }) {
  const c = d.coding;
  const by = c?.byDifficulty;
  return (
    <SectionCard id="sd-code" title="Coding practice" icon={Code2} to="/challenges/daily" linkLabel="Practice" error={isErr(c)} onRetry={onRetry}>
      {!c?.solved ? <Empty>You haven't solved a practice problem yet. Start with an Easy one to build momentum.</Empty> : (
        <div style={{ display: "grid", gap: 12 }}>
          <div><span className="sd-kpi-value sd-num">{c.solved}</span> <span className="sd-muted">problems solved</span></div>
          {[["Easy", by.EASY, "good"], ["Medium", by.MEDIUM, "warn"], ["Hard", by.HARD, "bad"]].map(([label, n, tone]) => (
            <div key={label} style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>{label}</span><span className="sd-num">{n}</span></div>
              <Bar value={c.solved ? (n / c.solved) * 100 : 0} tone={tone === "good" ? "" : tone} />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function Recommendations({ d }) {
  const r = d.recommendations;
  if (isErr(r) || !Array.isArray(r) || !r.length) return null;
  return (
    <SectionCard id="sd-recs" title="Recommended for you" icon={Sparkles}>
      <div className="sd-grid cols-3">
        {r.slice(0, 3).map((x, i) => (
          <Link key={i} to={x.actionUrl} className="sd-action" style={{ minHeight: 0 }} onClick={() => track("recommendation_clicked", { type: x.type })}>
            <span style={{ fontWeight: 600 }}>{x.title}</span>
            <span className="sd-muted" style={{ fontWeight: 400 }}>{x.description}</span>
            <span style={{ color: "var(--sd-info)" }}>{x.actionLabel} →</span>
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}

export { Trophy };
