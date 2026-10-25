import { useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api";

// A small floating button available on every non-fullscreen authenticated page (App.jsx renders
// this next to Sidebar inside Protected — skipped on noChrome routes like a live proctored exam,
// same as Sidebar). Submits to POST /api/issue-reports — a real backend row, not a fake toast.
export default function ReportProblemWidget() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // "ok" | "error" | null

  async function handleSubmit(e) {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      await api.post("/issue-reports", {
        page: location.pathname,
        description,
        browserInfo: navigator.userAgent,
      });
      setResult("ok");
      setDescription("");
    } catch {
      setResult("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setResult(null); }}
        title="Report a problem"
        style={{
          position: "fixed", right: 20, bottom: 20, zIndex: 500,
          width: 44, height: 44, borderRadius: "50%",
          background: "var(--ink)", color: "var(--paper, #fff)", border: "none",
          fontSize: 18, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
        }}
      >
        ?
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setOpen(false)}
        >
          <div className="card" style={{ maxWidth: 420, width: "100%", padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Report a problem</h3>
            {result === "ok" ? (
              <div>
                <p style={{ color: "var(--mint)", fontWeight: 600 }}>Thanks — your report was submitted.</p>
                <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>An admin will review it. This isn't an instant fix — it goes into a manual review queue.</p>
                <button className="btn btn-primary" onClick={() => setOpen(false)}>Close</button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: -8 }}>
                  Describe what went wrong on this page ({location.pathname}). No need to include passwords or personal data.
                </p>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  rows={5}
                  maxLength={4000}
                  placeholder="What happened, and what did you expect instead?"
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontFamily: "var(--font-body)", fontSize: 14, resize: "vertical" }}
                />
                {result === "error" && <p style={{ color: "var(--rust)", fontSize: 13 }}>Failed to submit — please try again.</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={submitting || !description.trim()}>
                    {submitting ? "Submitting…" : "Submit"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
