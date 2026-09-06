import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GitBranch, Lock, CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

// LMS master-spec section 33 ("Skill Graph"). Built on the real Course -> Module -> Lesson tree
// (see backend/src/utils/skillGraph.js's own header comment for why — an invented tag taxonomy
// like the spec's own "OOP -> Classes, Objects, Inheritance" example would need curated data this
// platform doesn't have; fabricating it would be exactly the misleading-analytics the spec itself
// warns against elsewhere).
const STATUS_CONFIG = {
  MASTERED: { label: "Mastered", color: "var(--mint)", icon: CheckCircle2 },
  NEEDS_PRACTICE: { label: "Needs Practice", color: "var(--rust)", icon: AlertTriangle },
  LEARNING: { label: "Learning", color: "var(--amber-dark)", icon: Circle },
  NOT_STARTED: { label: "Not Started", color: "var(--ink-dim)", icon: Circle },
  LOCKED: { label: "Locked", color: "var(--ink-dim)", icon: Lock },
};

export default function SkillGraph() {
  const { slug } = useParams();
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setGraph(null);
    setError("");
    api.get(`/learning/courses/${slug}/skill-graph`)
      .then((res) => setGraph(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load skill graph"));
  }, [slug]);

  if (error) return <div><Navbar /><div style={{ maxWidth: 800, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p></div></div>;
  if (!graph) return <div><Navbar /><div style={{ maxWidth: 800, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;

  const allLessons = graph.modules.flatMap((m) => m.lessons);
  const counts = Object.keys(STATUS_CONFIG).reduce((acc, k) => ({ ...acc, [k]: allLessons.filter((l) => l.status === k).length }), {});

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <Link to={`/learning/${slug}`} className="btn btn-ghost" style={{ fontSize: 12 }}>← Back to course</Link>
        <div style={{ marginTop: 8 }}>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}><GitBranch size={22} /> {graph.course.name} Skill Map</h1>
          <ChalkUnderline />
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 16 }}>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink-dim)" }}>
              <cfg.icon size={13} color={cfg.color} /> {cfg.label} ({counts[key]})
            </span>
          ))}
        </div>

        <div style={{ marginTop: 28 }}>
          {/* Root node */}
          <div className="card" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", fontWeight: 700 }}>
            <GitBranch size={16} /> {graph.course.name}
          </div>

          <div style={{ marginLeft: 14, borderLeft: "2px solid var(--line)", paddingLeft: 24, marginTop: 4 }}>
            {graph.modules.map((mod, mi) => (
              <div key={mod.id} style={{ position: "relative", marginTop: 22 }}>
                <div style={{ position: "absolute", left: -25, top: 14, width: 20, height: 2, background: "var(--line)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14, opacity: mod.locked ? 0.55 : 1 }}>
                  {mod.locked && <Lock size={13} />} Module {mi + 1}: {mod.title}
                </div>
                <div style={{ marginLeft: 14, borderLeft: "1px dashed var(--line)", paddingLeft: 20, marginTop: 10, display: "grid", gap: 8 }}>
                  {mod.lessons.map((lesson) => {
                    const cfg = STATUS_CONFIG[lesson.status] || STATUS_CONFIG.NOT_STARTED;
                    const Icon = cfg.icon;
                    return (
                      <div key={lesson.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <div style={{ position: "absolute", left: -21, top: "50%", width: 16, height: 1, background: "var(--line)" }} />
                        <Icon size={14} color={cfg.color} style={{ flexShrink: 0 }} />
                        <span style={{ opacity: mod.locked ? 0.55 : 1 }}>{lesson.title}</span>
                        <span className="mono" style={{ fontSize: 10, color: cfg.color, marginLeft: "auto" }}>{cfg.label}</span>
                      </div>
                    );
                  })}
                  {mod.lessons.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>No lessons in this module yet.</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
