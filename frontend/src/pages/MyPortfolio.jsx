import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, CheckCircle2, PlusCircle } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

// LMS master-spec section 34 ("Project Portfolio") + 35 ("Resume Integration"): every course
// project this student has genuinely finished (every task COMPLETED — verified server-side, never
// self-reported), with an explicit per-project "Add to Resume" action. Nothing here is invented —
// title/technologies/description all come straight from the project's own authored fields (see
// backend/src/utils/resumeAutofill.js's getCompletedProjects).
export default function MyPortfolio() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState("");
  const [addingTitle, setAddingTitle] = useState(null);

  function load() {
    api.get("/resume/me/portfolio").then((res) => setProjects(res.data.projects)).catch((err) => setError(err.response?.data?.error || "Failed to load portfolio"));
  }
  useEffect(load, []);

  async function addToResume(title) {
    setAddingTitle(title);
    try {
      await api.post("/resume/me/portfolio/add", { projectTitle: title });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add to resume");
    } finally {
      setAddingTitle(null);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}><Briefcase size={24} /> My Portfolio</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12 }}>
          Every project you've fully completed on CodeArena, verified automatically — no self-reported claims. Add any of these straight to your Resume.
        </p>

        {error && <p style={{ color: "var(--rust)", marginTop: 20 }}>{error}</p>}
        {!error && !projects && <p className="mono" style={{ marginTop: 20 }}>Loading…</p>}
        {!error && projects && projects.length === 0 && (
          <div className="card" style={{ padding: 24, marginTop: 20, textAlign: "center" }}>
            <p style={{ color: "var(--ink-dim)" }}>No completed projects yet — finish every task in a Course Project to see it here.</p>
            <Link to="/learning" className="btn btn-primary" style={{ marginTop: 12, display: "inline-block" }}>Go to Learning →</Link>
          </div>
        )}

        <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
          {projects?.map((p) => (
            <div key={p.title} className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>{p.title}</h3>
                  {p.description && <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 6 }}>{p.description}</p>}
                  {p.technologies && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                      {p.technologies.split(",").map((t) => t.trim()).filter(Boolean).map((t, i) => (
                        <span key={i} className="mono" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)" }}>{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                {p.addedToResume ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--mint)", whiteSpace: "nowrap" }}>
                    <CheckCircle2 size={16} /> Added to Resume
                  </span>
                ) : (
                  <button
                    className="btn btn-primary"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
                    disabled={addingTitle === p.title}
                    onClick={() => addToResume(p.title)}
                  >
                    <PlusCircle size={15} /> {addingTitle === p.title ? "Adding…" : "Add to Resume"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
