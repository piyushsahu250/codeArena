import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  PlayCircle, Code2, LineChart, Trophy, FileText, Mic, UserCircle,
  ClipboardList, CheckCircle2, Clock, BarChart3, ListChecks, BookOpen, Flame, Award, Lock, Bell, Target,
  Activity, Sparkles,
} from "lucide-react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFeatures } from "../context/FeatureContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { SkeletonGrid } from "../components/Skeleton";
import StatCard from "../components/StatCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import Table from "../components/Table";

// Consistent vertical rhythm for every top-level block on the page — replaces what used to be
// ad hoc 20/24/32px margins picked per-section, which is a big part of why the page read as
// visually noisy: nothing about the spacing itself signaled which gaps mattered more than others.
const SECTION_GAP = 28;

// Split into two priority tiers instead of one flat 10-card wall — the 5 "key" stats get the
// larger, primary treatment; the rest are real numbers a student still wants but shouldn't have
// to weigh equally against rank/average-score/streak on first glance. Every key still maps 1:1 to
// `dash.cards`, nothing here changes what data is fetched or shown, only how it's grouped.
const KEY_CARD_DEFS = [
  { key: "rank", label: "Class Rank", icon: Trophy, color: "var(--amber-dark)" },
  { key: "averageScorePercent", label: "Average Score", icon: BarChart3, color: "var(--mint)", suffix: "%" },
  { key: "learningProgressPercent", label: "Learning Progress", icon: BookOpen, color: "var(--mint)", suffix: "%" },
  { key: "codingStreak", label: "Coding Streak", icon: Flame, color: "var(--rust)", suffix: " days" },
  { key: "testsCompleted", label: "Tests Completed", icon: CheckCircle2, color: "var(--mint)" },
];
const MORE_CARD_DEFS = [
  { key: "testsAssigned", label: "Tests Assigned", icon: ClipboardList },
  { key: "testsPending", label: "Tests Pending", icon: Clock },
  { key: "codingSolved", label: "Coding Solved", icon: Code2 },
  { key: "mcqCorrect", label: "MCQs Correct", icon: ListChecks },
  { key: "certificatesEarned", label: "Certificates", icon: Award },
];

const RECENT_RESULTS_COLUMNS = [
  { key: "testName", header: "Test Name" },
  { key: "score", header: "Score", mono: true, render: (h) => h.resultsPending ? "—" : `${h.score}/${h.maxScore}` },
  { key: "percentage", header: "Percentage", mono: true, render: (h) => h.resultsPending ? "Pending" : `${h.percentage}%` },
  { key: "timeTakenMin", header: "Time Taken", mono: true, render: (h) => h.timeTakenMin != null ? `${h.timeTakenMin} min` : "—" },
  { key: "status", header: "Status", render: (h) => h.status === "AUTO_SUBMITTED" ? "Auto-submitted" : "Completed" },
  {
    key: "actions", header: "", align: "right",
    render: (h) => <Link to={`/test/${h.testId}/result`} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}>View Details</Link>,
  },
];

export default function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [dash, setDash] = useState(null);
  const [tests, setTests] = useState(null);
  const [learning, setLearning] = useState(null);
  const [gami, setGami] = useState(null);
  const [interviewSummary, setInterviewSummary] = useState(null);
  const [resumeCompletion, setResumeCompletion] = useState(null);
  const [results, setResults] = useState(null);
  // Distinct from "still loading" — the summary cards are the one piece of this page with no
  // sane empty-state fallback (every other section already tolerates its own fetch failing
  // silently, per the individual .catch()es below), so a failure here gets its own retry UI
  // instead of leaving the skeleton spinning forever alongside a raw error string.
  const [dashError, setDashError] = useState(false);
  const [dashRetrying, setDashRetrying] = useState(false);
  const autoRetriedRef = useRef(false);

  function loadDashSummary() {
    setDashError(false);
    return api.get("/dashboard/student").then((res) => setDash(res.data)).catch(() => {
      // One silent automatic retry (transient network blips are the common case) before
      // surfacing anything to the student — never the raw backend error message.
      if (!autoRetriedRef.current) {
        autoRetriedRef.current = true;
        return new Promise((resolve) => setTimeout(resolve, 1500))
          .then(() => api.get("/dashboard/student"))
          .then((res) => setDash(res.data))
          .catch(() => setDashError(true));
      }
      setDashError(true);
    });
  }

  useEffect(() => {
    loadDashSummary();
    api.get("/tests").then((res) => setTests(res.data)).catch(() => setTests([]));
    api.get("/learning/courses/java").then((res) => setLearning(res.data)).catch(() => setLearning(null));
    api.get("/gamification/me").then((res) => setGami(res.data)).catch(() => setGami(null));
    api.get("/interview/summary").then((res) => setInterviewSummary(res.data)).catch(() => setInterviewSummary(null));
    api.get("/resume/me").then((res) => setResumeCompletion(res.data.completion?.percent ?? 0)).catch(() => setResumeCompletion(0));
    api.get("/results/me").then((res) => setResults(res.data)).catch(() => setResults([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function retryDashSummary() {
    setDashRetrying(true);
    autoRetriedRef.current = true; // manual retry counts as the one retry too — no auto-retry loop after this
    loadDashSummary().finally(() => setDashRetrying(false));
  }

  // Placement Readiness Score — a genuine composite of real signals already on this page (no
  // separate "AI model," consistent with every other "recommendation"/"score" on this platform):
  // average test score, learning progress, certificates earned, resume completeness, and average
  // mock-interview score. Each missing signal is simply left out of the average rather than
  // counted as 0, so a student who hasn't tried interviews yet isn't penalized for it.
  const readinessInputs = dash && [
    dash.cards.averageScorePercent,
    dash.cards.learningProgressPercent,
    Math.min(100, (dash.cards.certificatesEarned || 0) * 25),
    resumeCompletion,
    interviewSummary?.totalAttempted > 0 ? interviewSummary.averageScore : null,
  ].filter((v) => v != null);
  const readinessScore = readinessInputs?.length ? Math.round(readinessInputs.reduce((a, b) => a + b, 0) / readinessInputs.length) : null;

  const now = new Date();
  function statusOf(test) {
    if (test.myStatus === "SUBMITTED" || test.myStatus === "AUTO_SUBMITTED") return { label: "Completed", color: "var(--mint)", completed: true };
    const start = new Date(test.startTime), end = new Date(test.endTime);
    if (now < start) return { label: "Upcoming", color: "var(--ink-dim)" };
    if (now > end) return { label: "Closed", color: "var(--rust)" };
    return { label: "Live now", color: "var(--mint)" };
  }

  async function attend(test) {
    try {
      await api.post(`/tests/${test.id}/start`);
      navigate(`/test/${test.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not start test");
    }
  }

  const upcomingTests = (tests || [])
    .filter((t) => !statusOf(t).completed)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  const loading = (!dash && !dashError) || tests === null;

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div>
          <h1>Welcome back, {user.name.split(" ")[0]}</h1>
          <ChalkUnderline />
          <p style={{ fontSize: 14, color: "var(--ink-dim)", marginTop: 8 }}>Here's where you stand today.</p>
        </div>

        <QuickActions learningResumeId={learning?.resumeLessonId} style={{ marginTop: 20 }} />

        {/* Hero: Placement Readiness Score + Level/XP side by side — these were two separate
            full-width cards stacked on top of each other before, competing for the same "most
            important thing on the page" attention. Pairing them as one two-column hero block
            establishes a single clear entry point instead of two. */}
        {(readinessScore != null || gami) && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: readinessScore != null && gami ? "1.1fr 1fr" : "1fr",
              gap: 16,
              marginTop: SECTION_GAP,
            }}
          >
            {readinessScore != null && (
              <div className="card" style={{ padding: 24, display: "flex", alignItems: "center", gap: 22 }}>
                <div style={{ position: "relative", width: 92, height: 92, flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
                    <circle cx="18" cy="18" r="16" fill="none" stroke="var(--line)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="16" fill="none" stroke="var(--mint)" strokeWidth="3"
                      strokeDasharray={`${readinessScore} 100`} strokeLinecap="round" />
                  </svg>
                  <div className="mono" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 22 }}>{readinessScore}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--ink-dim)", textTransform: "uppercase" }}>Placement Readiness</div>
                  <div style={{ fontWeight: 700, fontSize: 17, marginTop: 2 }}>{readinessScoreLabel(readinessScore)}</div>
                  <p style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 6, lineHeight: 1.5 }}>
                    From your average score, learning progress, certificates, resume, and mock interviews.
                  </p>
                </div>
              </div>
            )}

            {gami && (
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--ink-dim)", textTransform: "uppercase" }}>Level {gami.level.level} — {gami.level.name}</div>
                    <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: "var(--mint)", marginTop: 4 }}>{gami.level.totalXp} XP</div>
                  </div>
                  <Link to="/achievements" className="btn btn-ghost" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                    <Trophy size={13} /> View
                  </Link>
                </div>
                {gami.level.nextLevelName && (
                  <div style={{ height: 6, borderRadius: 3, background: "var(--line)", marginTop: 12, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${gami.level.progressPercent}%`, background: "var(--mint)" }} />
                  </div>
                )}
                <div style={{ display: "flex", gap: 24, marginTop: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Recent Badge</div>
                    <div style={{ fontSize: 13.5, marginTop: 2 }}>{gami.badges.earned[0] ? `${gami.badges.earned[0].icon} ${gami.badges.earned[0].name}` : "None yet"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Leaderboard Rank</div>
                    <div style={{ fontSize: 13.5, marginTop: 2 }}>{gami.leaderboardRank.rank ? `#${gami.leaderboardRank.rank} / ${gami.leaderboardRank.totalStudents}` : "—"}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Result Management — a compact entry point to /results (the full card list lives there,
            per this platform's established "summary here, detail on its own page" convention
            already used for Certificates/Talent Pools/Placement), shown only once there's
            actually something to see so it doesn't clutter the dashboard for students awaiting
            an offline exam's results. */}
        {results && results.length > 0 && (
          <div className="card" style={{ padding: 20, marginTop: SECTION_GAP, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--ink-dim)", textTransform: "uppercase" }}>My Results</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginTop: 2 }}>
                {results.length} result{results.length === 1 ? "" : "s"} published
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 4 }}>
                Latest: {results[0].title} — {results[0].resultLabel}
              </div>
            </div>
            <Link to="/results" className="btn btn-ghost" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <ClipboardList size={13} /> View All
            </Link>
          </div>
        )}

        {/* Key stats — the 5 numbers a student actually scans for first. Bigger cards, clearer
            number-first hierarchy than the flat 10-card grid this replaces. */}
        {dashError ? (
          <ErrorState title="Unable to load your dashboard right now." message="Please refresh the page or try again in a few moments." onRetry={retryDashSummary} retrying={dashRetrying} style={{ marginTop: SECTION_GAP }} />
        ) : (
          <>
            <div style={{ marginTop: SECTION_GAP }}>
              <div style={{ display: loading ? "block" : "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                {loading
                  ? <SkeletonGrid count={5} minWidth={160} />
                  : KEY_CARD_DEFS.map((c) => (
                      <StatCard
                        key={c.key}
                        icon={c.icon}
                        label={c.label}
                        accent={c.color}
                        value={
                          c.key === "rank"
                            ? dash.cards.rank ? `#${dash.cards.rank}/${dash.cards.totalStudentsInClass}` : "—"
                            : `${dash.cards[c.key] ?? 0}${c.suffix || ""}`
                        }
                      />
                    ))}
              </div>

              {!loading && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 14, padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
                  {MORE_CARD_DEFS.map((c) => (
                    <StatCard key={c.key} icon={c.icon} label={c.label} value={`${dash.cards[c.key] ?? 0}${c.suffix || ""}`} size="compact" />
                  ))}
                </div>
              )}
            </div>

            {/* Recent activity + notifications */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, marginTop: SECTION_GAP }}>
              <Section title="Recent Activity" icon={Activity}>
                {loading ? (
                  <SkeletonLines count={4} />
                ) : dash.recentActivity.length === 0 ? (
                  <EmptyState text="No activity yet — start a test or a lesson to see it here." />
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {dash.recentActivity.map((a, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                        <span>{a.text}</span>
                        <span className="mono" style={{ color: "var(--ink-dim)", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(a.date).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Notifications" icon={Bell}>
                {loading ? (
                  <SkeletonLines count={4} />
                ) : dash.notifications.length === 0 ? (
                  <EmptyState text="You're all caught up — no new notifications." />
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {dash.notifications.map((n, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                        <span><NotificationIcon type={n.type} />{n.text}</span>
                        <span className="mono" style={{ color: "var(--ink-dim)", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(n.date).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>

            {/* Recommended for You — rule-based, from GET /dashboard/student's recommendations field */}
            {!loading && dash.recommendations && dash.recommendations.length > 0 && (
              <Section title="Recommended for You" icon={Sparkles} style={{ marginTop: SECTION_GAP }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                  {dash.recommendations.map((r, i) => (
                    <Link
                      key={i}
                      to={r.actionUrl}
                      style={{
                        display: "block", padding: "14px 16px", borderRadius: 10, border: "1px solid var(--line)",
                        background: "var(--surface)", textDecoration: "none", color: "inherit",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{r.title}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 10 }}>{r.description}</div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mint)" }}>{r.actionLabel} →</span>
                    </Link>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {/* Upcoming tests */}
        <Section title="Upcoming Tests" icon={ClipboardList} style={{ marginTop: SECTION_GAP }}>
          {tests === null ? (
            <SkeletonLines count={3} />
          ) : upcomingTests.length === 0 ? (
            <EmptyState text="No upcoming tests. Check back once your faculty schedules one." />
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {upcomingTests.map((test) => {
                const status = statusOf(test);
                return (
                  <div key={test.id} className="card" style={{ padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <strong>{test.title}</strong>
                        <span className="mono" style={{ fontSize: 12, color: status.color, fontWeight: 700 }}>● {status.label}</span>
                      </div>
                      <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                        {test._count?.questions || 0} questions · {test.durationMin} min · {new Date(test.startTime).toLocaleString()}
                      </p>
                    </div>
                    <button
                      className="btn btn-dark"
                      disabled={status.label !== "Live now"}
                      style={{ opacity: status.label !== "Live now" ? 0.4 : 1 }}
                      onClick={() => attend(test)}
                    >
                      {status.label === "Live now" ? "Start Test →" : status.label}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Learning progress */}
        <Section title="Learning Progress" icon={BookOpen} style={{ marginTop: SECTION_GAP }}>
          {learning === null ? (
            <SkeletonLines count={3} />
          ) : (
            <LearningProgressBlock learning={learning} />
          )}
        </Section>

        {/* Recommended learning — rule-based, built from real signals already on this page (weak
            interview topics, current locked/in-progress module), not a real ML recommender */}
        <Section title="Recommended Learning" icon={Sparkles} style={{ marginTop: SECTION_GAP }}>
          {learning === null ? (
            <SkeletonLines count={2} />
          ) : (
            <RecommendedLearningBlock learning={learning} interviewSummary={interviewSummary} />
          )}
        </Section>

        {/* Performance summary */}
        <Section title="Performance Summary" icon={BarChart3} style={{ marginTop: SECTION_GAP }}>
          {loading ? (
            <SkeletonLines count={2} />
          ) : dashError ? (
            <EmptyState text="Performance summary is unavailable right now." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
              <MiniStat label="Highest Score" value={dash.performanceSummary.highest ? `${dash.performanceSummary.highest.percentage}%` : "—"} />
              <MiniStat label="Lowest Score" value={dash.performanceSummary.lowest ? `${dash.performanceSummary.lowest.percentage}%` : "—"} />
              <MiniStat label="Average Score" value={`${dash.performanceSummary.averageScorePercent}%`} />
              <MiniStat label="Time Spent" value={`${dash.performanceSummary.totalTimeSpentMin} min`} />
              <MiniStat label="Last Attempt" value={dash.performanceSummary.lastAttemptDate ? new Date(dash.performanceSummary.lastAttemptDate).toLocaleDateString() : "—"} />
            </div>
          )}
        </Section>

        {/* Recent test results */}
        <Section title="Recent Test Results" icon={ListChecks} style={{ marginTop: SECTION_GAP }}>
          {loading ? (
            <SkeletonLines count={3} />
          ) : dashError ? (
            <EmptyState text="Recent test results are unavailable right now." />
          ) : dash.recentTestResults.length === 0 ? (
            <EmptyState text="No completed tests yet." />
          ) : (
            <Table columns={RECENT_RESULTS_COLUMNS} data={dash.recentTestResults} getRowKey={(h) => h.testId} dense />
          )}
        </Section>
      </div>
    </div>
  );
}

function readinessScoreLabel(score) {
  if (score >= 80) return "Placement Ready";
  if (score >= 60) return "Almost There";
  if (score >= 35) return "Building Momentum";
  return "Just Getting Started";
}

const NOTIFICATION_ICON = { test_assigned: ClipboardList, test_reminder: Clock, module_unlocked: Lock, certificate: Award };
function NotificationIcon({ type }) {
  const Icon = NOTIFICATION_ICON[type] || Bell;
  return <Icon size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />;
}

function MiniStat({ label, value }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
    </div>
  );
}

function Section({ title, icon: Icon, children, style }) {
  return (
    <div style={style}>
      <h3 style={{ fontSize: 15.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        {Icon && <Icon size={16} style={{ color: "var(--ink-dim)" }} />} {title}
      </h3>
      <div className="card" style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

function SkeletonLines({ count }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => <div key={i} className="skeleton" style={{ height: 16 }} />)}
    </div>
  );
}

// One clear primary CTA ("Continue Learning") plus a row of secondary icon-tiles for everything
// else, replacing what used to be 7 pill buttons of identical visual weight — a student had no
// way to tell at a glance which action mattered most.
function QuickActions({ learningResumeId, style }) {
  const { isFeatureEnabled } = useFeatures();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", ...style }}>
      {isFeatureEnabled("lms") && (
        <Link to={learningResumeId ? `/learning/java/lesson/${learningResumeId}` : "/learning"} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <PlayCircle size={15} /> Continue Learning
        </Link>
      )}
      {isFeatureEnabled("lms") && (
        <Link to="/learning" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Code2 size={15} /> Practice Coding</Link>
      )}
      <Link to="/dashboard/performance" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><LineChart size={15} /> My Performance</Link>
      <Link to="/achievements" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Trophy size={15} /> Achievements</Link>
      {isFeatureEnabled("resume_builder") && (
        <Link to="/resume" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><FileText size={15} /> Resume Builder</Link>
      )}
      {isFeatureEnabled("ai_mock_interview") && (
        <Link to="/interview" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Mic size={15} /> AI Mock Interview</Link>
      )}
      <Link to="/profile" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><UserCircle size={15} /> Profile</Link>
    </div>
  );
}

function RecommendedLearningBlock({ learning, interviewSummary }) {
  const currentModule = learning?.modules?.find((m) => !m.locked && !m.completed);
  const weakAreas = interviewSummary?.weakAreas || [];
  const hasAny = currentModule || weakAreas.length > 0;

  if (!hasAny) return <EmptyState text="Keep going — recommendations show up here as you build a track record." />;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {currentModule && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><BookOpen size={14} /> Continue <strong>{currentModule.title}</strong> to keep your learning streak going.</span>
          <Link to={`/learning/${learning.course.slug}/lesson/${learning.resumeLessonId}`} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}>Go →</Link>
        </div>
      )}
      {weakAreas.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Target size={14} /> Based on your mock interviews, focus on: </span>
          <strong>{weakAreas.join(", ")}</strong>
        </div>
      )}
    </div>
  );
}

const STATUS_ICON = { COMPLETED: "✓", IN_PROGRESS: "◐", NOT_STARTED: "○" };

function LearningProgressBlock({ learning }) {
  const { course, modules, overall, resumeLessonId } = learning;
  const completedModules = modules.filter((m) => m.completed);
  const currentModule = modules.find((m) => !m.locked && !m.completed);
  const lockedModules = modules.filter((m) => m.locked);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <strong>{course.name} Course</strong>
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{overall.completedLessons}/{overall.totalLessons} lessons</div>
        </div>
        {resumeLessonId && (
          <Link to={`/learning/${course.slug}/lesson/${resumeLessonId}`} className="btn btn-primary">Continue Learning →</Link>
        )}
      </div>
      <div style={{ height: 10, borderRadius: 5, background: "var(--line)", marginTop: 12, overflow: "hidden" }}>
        <div className="mono" style={{ height: "100%", width: `${overall.percent}%`, background: "var(--mint)", transition: "width 0.3s" }} />
      </div>
      <div className="mono" style={{ fontSize: 12, color: "var(--mint)", fontWeight: 700, marginTop: 4 }}>{overall.percent}%</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginTop: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginBottom: 6 }}>Completed</div>
          {completedModules.length === 0 ? <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>None yet</span> : completedModules.map((m) => (
            <div key={m.id} style={{ fontSize: 13 }}><span style={{ color: "var(--mint)" }}>{STATUS_ICON.COMPLETED}</span> {m.title}</div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginBottom: 6 }}>Current Module</div>
          {currentModule ? (
            <Link to={`/learning/${course.slug}/lesson/${resumeLessonId}`} style={{ fontSize: 13, color: "var(--amber-dark)" }}>◐ {currentModule.title}</Link>
          ) : <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>Course complete!</span>}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginBottom: 6 }}>Locked</div>
          {lockedModules.length === 0 ? <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>None</span> : lockedModules.map((m) => (
            <div key={m.id} style={{ fontSize: 13, color: "var(--ink-dim)", display: "flex", alignItems: "center", gap: 6 }}><Lock size={13} /> {m.title}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
