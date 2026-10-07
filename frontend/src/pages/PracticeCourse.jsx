import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Lock, CheckCircle2, Clock, PlayCircle, ChevronRight, RotateCcw } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import Badge from "../components/Badge";
import { useAuth } from "../context/AuthContext";

// Level-based practice track (Course.kind === "PRACTICE"): Course > Section > Topic > Level. Every list is fetched
// lazily from /api/practice, one level of the tree per screen; locks, progress and "Continue" targets all come from the
// server (utils/practiceProgress.js) -- this page only renders them.

const STAFF_ROLES = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"];
const LEVEL_UI = {
  PASSED: { label: "Passed", tone: "success", icon: CheckCircle2 },
  IN_PROGRESS: { label: "In progress", tone: "warning", icon: PlayCircle },
  AVAILABLE: { label: "Available", tone: "default", icon: PlayCircle },
  RETAKE_AVAILABLE: { label: "Retake available", tone: "warning", icon: RotateCcw },
  FAILED: { label: "Not passed — no attempts left", tone: "default", icon: Lock },
  LOCKED: { label: "Locked", tone: "default", icon: Lock },
  COMING_SOON: { label: "Coming soon", tone: "default", icon: Clock },
};
const STATE_LABEL = { LOCKED: "Locked", NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed" };

function Crumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 13, marginBottom: 18 }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <ChevronRight size={14} aria-hidden="true" />}
          {it.to ? <Link to={it.to} style={{ color: "var(--ink-dim)" }}>{it.label}</Link> : <strong>{it.label}</strong>}
        </span>
      ))}
    </nav>
  );
}

function ProgressBar({ value }) {
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 3, background: "var(--line)", overflow: "hidden" }}>
      <div style={{ width: `${value}%`, height: "100%", background: "var(--mint)" }} />
    </div>
  );
}

function Shell({ children }) {
  return (
    <div>
      <Navbar />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 64px" }}>{children}</main>
    </div>
  );
}

function useLoad(path, deps) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const load = useCallback(() => {
    setState({ loading: true, error: null, data: null });
    api.get(path)
      .then((r) => setState({ loading: false, error: null, data: r.data }))
      .catch((e) => setState({ loading: false, error: e.response?.data?.error || (e.response ? "Something went wrong" : "You appear to be offline — check your connection"), data: null }));
  }, [path]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, deps);
  return { ...state, reload: load };
}

function Status({ loading, error, reload, children }) {
  if (loading) return <p className="mono" role="status">Loading…</p>;
  if (error) {
    return (
      <div role="alert" className="card" style={{ padding: 20 }}>
        <p style={{ color: "var(--rust)" }}>{error}</p>
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={reload}>Retry</button>
      </div>
    );
  }
  return children;
}

// A card in the style of the reference: heading band, description, one clear action.
function TrackCard({ title, meta, children, locked, lockReason, progress, action, to, state }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", opacity: locked ? 0.7 : 1, display: "flex", flexDirection: "column" }}>
      <div style={{ background: "var(--slate-900, #1c2b24)", color: "var(--chalk, #fff)", padding: "12px 16px", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>{title}</h3>
        {meta && <span className="mono" style={{ fontSize: 12, opacity: 0.8, whiteSpace: "nowrap" }}>{meta}</span>}
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {state && <div><Badge tone={state === "COMPLETED" ? "success" : state === "IN_PROGRESS" ? "warning" : "default"}>{STATE_LABEL[state]}</Badge></div>}
        {children}
        {progress != null && <div><div className="mono" style={{ fontSize: 12, marginBottom: 4 }}>Progress: {progress}%</div><ProgressBar value={progress} /></div>}
        {locked && lockReason && <p style={{ fontSize: 13, color: "var(--ink-dim)", display: "flex", gap: 6, alignItems: "center" }}><Lock size={14} aria-hidden="true" /> {lockReason}</p>}
        <div style={{ marginTop: "auto" }}>
          {locked ? (
            <button className="btn btn-ghost" disabled style={{ width: "100%" }}>Locked</button>
          ) : (
            <Link to={to} className="btn btn-primary" style={{ width: "100%", textAlign: "center", display: "block" }}>{action}</Link>
          )}
        </div>
      </div>
    </div>
  );
}

const grid = { display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" };

function CourseHome({ slug }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const { loading, error, data, reload } = useLoad(`/practice/${slug}`, [slug]);
  const isStaff = STAFF_ROLES.includes(user?.role);
  const goContinue = () => {
    const r = data?.resume;
    if (!r) return;
    if (r.levelId) nav(`/learning/${slug}/level/${r.levelId}/coding-assessment`);
    else if (r.topicId) nav(`/learning/${slug}/practice/topic/${r.topicId}`);
  };
  return (
    <Shell>
      <Crumbs items={[{ label: "Academy", to: "/learning" }, { label: "Courses", to: "/learning" }, { label: data?.course?.name || "Practice" }]} />
      <Status loading={loading} error={error} reload={reload}>
        {data && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 20 }}>
              <div style={{ maxWidth: 640 }}>
                <h1 style={{ fontSize: 28 }}>{data.course.name}</h1>
                {data.course.description && <p style={{ color: "var(--ink-dim)", marginTop: 6 }}>{data.course.description}</p>}
                <div style={{ marginTop: 14, maxWidth: 360 }}>
                  <div className="mono" style={{ fontSize: 13, marginBottom: 4 }}>Overall progress: {data.overall.progress}% ({data.overall.passedCount}/{data.overall.levelCount} levels passed)</div>
                  <ProgressBar value={data.overall.progress} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {isStaff && <Link to={`/learning/${slug}/practice/analytics`} className="btn btn-ghost">Analytics</Link>}
                {!isStaff && data.resume && (
                  <button className="btn btn-primary" onClick={goContinue}>
                    {data.resume.reason === "IN_PROGRESS" ? "Resume →" : data.overall.passedCount === 0 ? "Start →" : "Continue →"}
                  </button>
                )}
              </div>
            </div>
            {data.sections.length === 0 ? (
              <p>No sections have been published for this course yet.</p>
            ) : (
              <div style={grid}>
                {data.sections.map((s) => (
                  <TrackCard
                    key={s.id} title={s.title} state={s.status} locked={s.locked} lockReason={s.lockReason} progress={s.progress}
                    meta={`${s.topicCount} topic${s.topicCount === 1 ? "" : "s"}`} to={`/learning/${slug}/practice/section/${s.id}`}
                    action={s.status === "NOT_STARTED" ? "Start →" : s.status === "COMPLETED" ? "Review →" : "Continue →"}
                  >
                    {s.description && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>{s.description}</p>}
                    <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{s.levelCount} level{s.levelCount === 1 ? "" : "s"}{s.topicCount === 0 ? " — topics coming soon" : ""}</p>
                  </TrackCard>
                ))}
              </div>
            )}
          </>
        )}
      </Status>
    </Shell>
  );
}

function SectionPage({ slug, sectionId }) {
  const { loading, error, data, reload } = useLoad(`/practice/${slug}/sections/${sectionId}`, [slug, sectionId]);
  return (
    <Shell>
      <Crumbs items={[{ label: "Academy", to: "/learning" }, { label: data?.course?.name || "Practice", to: `/learning/${slug}/practice` }, { label: data?.section?.title || "Section" }]} />
      <Status loading={loading} error={error} reload={reload}>
        {data && (
          <>
            <h1 style={{ fontSize: 26 }}>{data.section.title}</h1>
            <div style={{ margin: "10px 0 20px", maxWidth: 360 }}>
              <div className="mono" style={{ fontSize: 13, marginBottom: 4 }}>Progress: {data.section.progress}%</div>
              <ProgressBar value={data.section.progress} />
            </div>
            {data.section.locked ? (
              <div className="card" style={{ padding: 20 }}><Lock size={16} aria-hidden="true" /> {data.section.lockReason}</div>
            ) : data.topics.length === 0 ? (
              <p>Topics for this section are coming soon.</p>
            ) : (
              <div style={grid}>
                {data.topics.map((t) => (
                  <TrackCard
                    key={t.id} title={t.title} state={t.status} locked={t.locked} lockReason={t.lockReason} progress={t.progress}
                    meta={t.durationLabel || null} to={`/learning/${slug}/practice/topic/${t.id}`}
                    action={t.status === "NOT_STARTED" ? "Start →" : t.status === "COMPLETED" ? "Review →" : "Continue →"}
                  >
                    {t.outline.length > 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>{t.outline.join(" · ")}</p>}
                    <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{t.levelCount} level{t.levelCount === 1 ? "" : "s"}{t.levelCount ? ` · ${t.passedCount} passed` : " — coming soon"}</p>
                  </TrackCard>
                ))}
              </div>
            )}
          </>
        )}
      </Status>
    </Shell>
  );
}

function levelAction(l) {
  if (l.locked) return null;
  switch (l.status) {
    case "PASSED": return "View / review";
    case "IN_PROGRESS": return "Continue";
    case "RETAKE_AVAILABLE": return "Retry";
    case "AVAILABLE": return "Start Level";
    default: return null;
  }
}

function TopicPage({ slug, topicId }) {
  const [sp] = useSearchParams();
  const after = sp.get("after") || "";
  const { loading, error, data, reload } = useLoad(`/practice/${slug}/topics/${topicId}${after ? `?after=${after}` : ""}`, [slug, topicId, after]);
  const t = data?.topic;
  return (
    <Shell>
      <Crumbs items={[
        { label: "Academy", to: "/learning" }, { label: data?.course?.name || "Practice", to: `/learning/${slug}/practice` },
        { label: data?.section?.title || "Section", to: data ? `/learning/${slug}/practice/section/${data.section.id}` : undefined }, { label: t?.title || "Topic" },
      ]} />
      <Status loading={loading} error={error} reload={reload}>
        {t && (
          <>
            <h1 style={{ fontSize: 26 }}>{t.title}</h1>
            {t.durationLabel && <p className="mono" style={{ color: "var(--ink-dim)", marginTop: 4 }}>{t.durationLabel}</p>}
            {t.outline.length > 0 && (
              <ul style={{ margin: "12px 0", paddingLeft: 20, color: "var(--ink-dim)" }}>{t.outline.map((o) => <li key={o}>{o}</li>)}</ul>
            )}
            <div style={{ margin: "10px 0 20px", maxWidth: 360 }}>
              <div className="mono" style={{ fontSize: 13, marginBottom: 4 }}>Progress: {t.progress}%</div>
              <ProgressBar value={t.progress} />
            </div>
            {after && data.next && (
              <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span>Up next: <strong>{data.next.title}</strong></span>
                <Link to={`/learning/${slug}/level/${data.next.levelId}/coding-assessment`} className="btn btn-primary">Continue to next level →</Link>
              </div>
            )}
            {t.locked ? (
              <div className="card" style={{ padding: 20 }}><Lock size={16} aria-hidden="true" /> {t.lockReason}</div>
            ) : t.levels.length === 0 ? (
              <p>Levels for this topic are coming soon.</p>
            ) : (
              <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
                {t.levels.map((l, i) => {
                  const ui = LEVEL_UI[l.status] || LEVEL_UI.AVAILABLE;
                  const Icon = ui.icon;
                  const action = levelAction(l);
                  return (
                    <li key={l.id} className="card" style={{ padding: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", opacity: l.locked ? 0.7 : 1 }}>
                      <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", background: l.status === "PASSED" ? "var(--mint)" : "var(--line)", color: "var(--ink)", fontWeight: 700 }}>{i}</span>
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{l.title}</div>
                        <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                          {l.difficulty ? `${l.difficulty} · ` : ""}{l.questionCount} question{l.questionCount === 1 ? "" : "s"} · {l.timeLimitMin} min · pass {l.passingPercent}%
                          {l.maxAttempts != null ? ` · ${l.attemptsUsed}/${l.maxAttempts} attempts used` : ""}{l.bestScore != null ? ` · best ${l.bestScore}%` : ""}
                        </div>
                        {l.description && <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>{l.description}</div>}
                        {l.locked && l.lockReason && <div style={{ fontSize: 13, marginTop: 4 }}>{l.lockReason}</div>}
                      </div>
                      <Badge tone={ui.tone}><Icon size={12} aria-hidden="true" style={{ verticalAlign: "-1px", marginRight: 4 }} />{ui.label}</Badge>
                      {action ? (
                        <Link to={`/learning/${slug}/level/${l.id}/coding-assessment`} className="btn btn-primary">{action}</Link>
                      ) : (
                        <button className="btn btn-ghost" disabled>{l.locked ? "Locked" : ui.label}</button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </Status>
    </Shell>
  );
}

function AnalyticsPage({ slug }) {
  const { loading, error, data, reload } = useLoad(`/practice/${slug}/analytics`, [slug]);
  return (
    <Shell>
      <Crumbs items={[{ label: "Academy", to: "/learning" }, { label: data?.course?.name || "Practice", to: `/learning/${slug}/practice` }, { label: "Analytics" }]} />
      <Status loading={loading} error={error} reload={reload}>
        {data && (
          <>
            <h1 style={{ fontSize: 26 }}>Practice analytics</h1>
            <p className="mono" style={{ margin: "8px 0 18px", color: "var(--ink-dim)" }}>
              {data.enrolled} enrolled · {data.summary.studentsStarted} started
              {data.summary.overallPassRate != null ? ` · average pass rate ${data.summary.overallPassRate}%` : ""}
              {data.summary.mostFailedLevel ? ` · hardest level: ${data.summary.mostFailedLevel}` : ""}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                    {["Section", "Topic", "Level", "Started", "Passed", "Failed", "Pass rate", "Avg score", "Avg time (min)", "Attempts"].map((h) => <th key={h} style={{ padding: "8px 10px" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.levels.map((r) => (
                    <tr key={r.levelId} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 10px" }}>{r.section}</td><td style={{ padding: "8px 10px" }}>{r.topic}</td><td style={{ padding: "8px 10px" }}>{r.level}</td>
                      <td style={{ padding: "8px 10px" }}>{r.started}</td><td style={{ padding: "8px 10px" }}>{r.passed}</td><td style={{ padding: "8px 10px" }}>{r.failed}</td>
                      <td style={{ padding: "8px 10px" }}>{r.passRate == null ? "—" : `${r.passRate}%`}</td><td style={{ padding: "8px 10px" }}>{r.avgScore ?? "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{r.avgTimeMin ?? "—"}</td><td style={{ padding: "8px 10px" }}>{r.attempts}</td>
                    </tr>
                  ))}
                  {data.levels.length === 0 && <tr><td colSpan={10} style={{ padding: 16 }}>No levels yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Status>
    </Shell>
  );
}

export default function PracticeCourse({ view }) {
  const { slug, sectionId, topicId } = useParams();
  if (view === "section") return <SectionPage slug={slug} sectionId={sectionId} />;
  if (view === "topic") return <TopicPage slug={slug} topicId={topicId} />;
  if (view === "analytics") return <AnalyticsPage slug={slug} />;
  return <CourseHome slug={slug} />;
}
