import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GraduationCap, Lock, CheckCircle2, Clock, ClipboardList, ChevronDown, ChevronRight } from "lucide-react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import Badge from "../components/Badge";

const STATUS_ICON = { COMPLETED: "✓", IN_PROGRESS: "◐", NOT_STARTED: "○" };
const STATUS_COLOR = { COMPLETED: "var(--mint)", IN_PROGRESS: "var(--amber-dark)", NOT_STARTED: "var(--ink-dim)" };

export default function CourseOverview() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const isStudent = user.role === "STUDENT";
  // For students, GET /courses/:slug now returns module metadata + counts only (no `lessons`
  // array) — a course's full lesson list no longer has to be transferred/rendered up front as
  // more courses/modules get authored. Lessons are fetched per module, on first expand, and
  // cached here so re-collapsing/re-expanding the same module doesn't re-fetch. ADMIN/STAFF
  // still get `lessons` inline on the initial response (unchanged), so this cache is unused for
  // them — `moduleLessons[m.id] ?? m.lessons` below picks whichever is actually available.
  const [moduleLessons, setModuleLessons] = useState({});
  const [expanded, setExpanded] = useState({});
  const [loadingModule, setLoadingModule] = useState(null);

  useEffect(() => {
    setData(null);
    setModuleLessons({});
    setExpanded({});
    api.get(`/learning/courses/${slug}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load course"));
  }, [slug]);

  function toggleModule(m) {
    setExpanded((prev) => ({ ...prev, [m.id]: !prev[m.id] }));
    if (!moduleLessons[m.id] && !Array.isArray(m.lessons)) {
      setLoadingModule(m.id);
      api.get(`/learning/courses/${slug}/modules/${m.id}/lessons`)
        .then((res) => setModuleLessons((prev) => ({ ...prev, [m.id]: res.data })))
        .catch(() => setModuleLessons((prev) => ({ ...prev, [m.id]: [] })))
        .finally(() => setLoadingModule(null));
    }
  }

  if (error) return <div><Navbar /><div style={{ maxWidth: 900, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p></div></div>;
  if (!data) return <div><Navbar /><div style={{ maxWidth: 900, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;

  const { course, modules, overall, resumeLessonId } = data;
  const complete = isStudent && overall.percent === 100;
  // "Current" = the first module that's unlocked but not yet finished — highlighted so the
  // sequential path reads clearly at a glance.
  const currentModuleId = isStudent ? modules.find((m) => !m.locked && !m.completed)?.id : null;

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1>{course.name} Learning Path</h1>
            <ChalkUnderline />
          </div>
          <Link to="/learning" className="btn btn-ghost">← All courses</Link>
        </div>
        {course.description && <p style={{ color: "var(--ink-dim)", marginTop: 12 }}>{course.description}</p>}

        {isStudent && (
          <div className="card" style={{ padding: 20, marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--mint)" }}>{overall.percent}%</div>
                <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{overall.completedLessons} / {overall.totalLessons} lessons completed</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {resumeLessonId && !complete && (
                  <Link to={`/learning/${slug}/lesson/${resumeLessonId}`} className="btn btn-primary">▶ Continue</Link>
                )}
                {complete && <Link to={`/learning/${slug}/certificate`} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><GraduationCap size={14} /> View Certificate</Link>}
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "var(--line)", marginTop: 14, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${overall.percent}%`, background: "var(--mint)", transition: "width 0.3s" }} />
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
          {modules.map((m, mi) => {
            const locked = isStudent && m.locked;
            const isCurrent = isStudent && m.id === currentModuleId;
            // ADMIN/STAFF get `lessons` inline on the initial response (unchanged); STUDENT gets
            // it lazily via moduleLessons once expanded (see toggleModule above).
            const lessons = Array.isArray(m.lessons) ? m.lessons : moduleLessons[m.id];
            const isOpen = !isStudent || !!expanded[m.id];
            return (
              <div key={m.id} className="card" style={{ padding: 20, opacity: locked ? 0.6 : 1 }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, cursor: isStudent && !locked ? "pointer" : "default" }}
                  onClick={() => { if (isStudent && !locked) toggleModule(m); }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isStudent && !locked && (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
                    <h3 style={{ fontSize: 16 }}>Module {mi + 1}: {m.title}</h3>
                    {isStudent && m.completed && <Badge tone="success">✓ Completed</Badge>}
                    {isCurrent && <Badge tone="warning">In progress</Badge>}
                    {locked && <Badge style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Lock size={11} /> Locked</Badge>}
                  </div>
                  {isStudent && !locked && (
                    <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{m.completedCount}/{m.totalCount}</span>
                  )}
                </div>

                {locked ? (
                  <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 10 }}>
                    {(() => {
                      // Which specific requirement is actually blocking this module — the previous
                      // module's lesson content, its Coding Assessment (now a real prerequisite,
                      // not just a certificate perk — see learningLock.js), or both — rather than
                      // one generic message regardless of which one it actually is.
                      const prev = modules[mi - 1];
                      const needsLessons = prev && !prev.lessonsComplete;
                      const needsCoding = prev && prev.codingTest?.required && !prev.codingTest?.passed;
                      if (needsLessons && needsCoding) return `Complete Module ${mi}'s lessons and pass its Coding Assessment to unlock this module.`;
                      if (needsCoding) return `Pass the Coding Assessment in Module ${mi} to unlock this module.`;
                      return `Complete the previous module's practice test to unlock this module.`;
                    })()}
                  </p>
                ) : !isOpen ? null : (
                  <>
                    <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
                      {!lessons ? (
                        <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{loadingModule === m.id ? "Loading lessons…" : ""}</p>
                      ) : lessons.map((l) => (
                        <Link
                          key={l.id}
                          to={`/learning/${slug}/lesson/${l.id}`}
                          style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "8px 12px", borderRadius: 8, textDecoration: "none", color: "var(--ink)",
                            border: l.isModuleTest ? "1px solid var(--amber-dark)" : "1px solid var(--line)", fontSize: 13,
                          }}
                        >
                          <span>
                            {isStudent && <span className="mono" style={{ color: STATUS_COLOR[l.status], marginRight: 8 }}>{STATUS_ICON[l.status]}</span>}
                            {l.isModuleTest && <ClipboardList size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />}{l.title}
                            {isStudent && l.bookmarked && <span style={{ marginLeft: 6 }}>★</span>}
                          </span>
                          <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>{l.estimatedMinutes} min</span>
                        </Link>
                      ))}
                    </div>

                    {isStudent && m.codingTest?.required && (
                      <div
                        style={{
                          marginTop: 12, padding: "10px 14px", borderRadius: 8, display: "flex",
                          justifyContent: "space-between", alignItems: "center", fontSize: 13,
                          border: `1px solid ${m.codingTest.passed ? "var(--mint)" : m.lessonsComplete ? "var(--amber-dark)" : "var(--line)"}`,
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {m.codingTest.passed ? <><CheckCircle2 size={14} /> Coding Assessment Passed</> : m.lessonsComplete ? <><Clock size={14} /> Coding Assessment available — required to unlock the next module</> : <><Lock size={14} /> Coding Assessment (complete lessons first)</>}
                        </span>
                        {m.lessonsComplete && (
                          <Link to={`/learning/${slug}/module/${m.id}/coding-assessment`} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}>
                            {m.codingTest.passed ? "View" : "Start →"}
                          </Link>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
