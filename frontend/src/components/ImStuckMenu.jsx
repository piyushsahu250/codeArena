import { useState } from "react";
import api from "../api";

// LMS master-spec section 18 ("I'm Stuck") + 19-20 (AI Learning Mentor / Debugging Mentor).
// Shared between Practice Coding (LessonView.jsx) and Project Tasks (ProjectView.jsx) — one
// AI-assist UI, backed by one AI-assist mechanism (backend/src/utils/learningMentor.js), not two.
const CATEGORIES = [
  { key: "CONCEPT", label: "I don't understand the concept" },
  { key: "NOT_WORKING", label: "My code isn't working" },
  { key: "REQUIREMENT", label: "I don't understand the requirement" },
  { key: "HINT", label: "I need a hint" },
  { key: "EXAMPLE", label: "I need an example" },
];

export default function ImStuckMenu({ endpoint, code, language, aiAvailable }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState(null); // { category, text }

  async function ask(category) {
    setOpen(false);
    setLoading(true);
    setError("");
    setResponse(null);
    try {
      const { data } = await api.post(endpoint, { category, code, language });
      setResponse(data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to get help");
    } finally {
      setLoading(false);
    }
  }

  if (aiAvailable === false) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ position: "relative", display: "inline-block" }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: "5px 10px" }}
          disabled={loading || aiAvailable !== true}
          onClick={() => setOpen((v) => !v)}
        >
          {loading ? "Thinking…" : "🆘 I'm Stuck"}
        </button>
        {open && (
          <div className="card" style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 10, minWidth: 260, padding: 6 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => ask(c.key)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 13, background: "none", border: "none", cursor: "pointer", borderRadius: 6, color: "var(--ink)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--card-bg, #F7F7F5)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {response && (
        <div className="card" style={{ padding: 10, marginTop: 8, fontSize: 13 }}>
          <strong style={{ fontSize: 11, color: "var(--ink-dim)" }}>
            {(CATEGORIES.find((c) => c.key === response.category)?.label || "MENTOR").toUpperCase()}
          </strong>
          <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{response.text}</p>
        </div>
      )}
      {error && <p style={{ color: "var(--rust)", fontSize: 12, marginTop: 6 }}>{error}</p>}
    </div>
  );
}
