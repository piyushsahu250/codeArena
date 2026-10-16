import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

function statusOf(test) {
  if (test.myStatus === "SUBMITTED" || test.myStatus === "AUTO_SUBMITTED") return { label: "Completed", color: "var(--mint)", completed: true };
  const now = new Date(), start = new Date(test.startTime), end = new Date(test.endTime);
  if (now < start) return { label: "Upcoming", color: "var(--ink-dim)" };
  if (now > end) return { label: "Closed", color: "var(--rust)" };
  return { label: "Live now", color: "var(--mint)" };
}

// Browse view for company-tagged Tests (Test.company, added in Phase 2-3) — reuses the exact
// same /api/tests listing, attempt-start, and TestTaking.jsx flow every other formal Test already
// goes through; this page is purely a filtered lens over that same data, grouped by company.
export default function CompanyTests() {
  const navigate = useNavigate();
  const [tests, setTests] = useState(null);
  const [company, setCompany] = useState("");

  useEffect(() => {
    api.get("/tests").then((res) => setTests(res.data.filter((t) => t.company))).catch(() => setTests([]));
  }, []);

  // Open the exam page only. The attempt (and its server-side clock) is created by the Begin button on the exam page, after the student has read the
  // instructions and passed the security check; starting it here consumed time and exposed the questions before that gate.
  function attend(test) {
    navigate(`/test/${test.id}`);
  }

  const companies = [...new Set((tests || []).map((t) => t.company))].sort();
  const filtered = (tests || []).filter((t) => !company || t.company === company);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Company Coding Tests</h1>
        <ChalkUnderline />
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
          Practice with tests modeled on real hiring assessments, tagged by company.
        </p>

        {companies.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button className={`btn ${company === "" ? "btn-primary" : "btn-ghost"}`} onClick={() => setCompany("")}>All</button>
            {companies.map((c) => (
              <button key={c} className={`btn ${company === c ? "btn-primary" : "btn-ghost"}`} onClick={() => setCompany(c)}>{c}</button>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
          {tests === null ? (
            <p style={{ color: "var(--ink-dim)" }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: "center" }}>
              <p style={{ color: "var(--ink-dim)" }}>No company-tagged tests are available yet — check back soon.</p>
            </div>
          ) : (
            filtered.map((test) => {
              const status = statusOf(test);
              return (
                <div key={test.id} className="card" style={{ padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span className="mono" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)" }}>{test.company}</span>
                      <strong>{test.title}</strong>
                      <span className="mono" style={{ fontSize: 12, color: status.color, fontWeight: 700 }}>● {status.label}</span>
                    </div>
                    <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {test._count?.questions || 0} questions · {test.durationMin} min · {new Date(test.startTime).toLocaleString()}
                    </p>
                  </div>
                  <button
                    className="btn btn-dark"
                    disabled={status.label !== "Live now" && !status.completed}
                    style={{ opacity: status.label !== "Live now" && !status.completed ? 0.4 : 1 }}
                    onClick={() => (status.completed ? navigate(`/test/${test.id}/result`) : attend(test))}
                  >
                    {status.label === "Live now" ? (test.myStatus === "IN_PROGRESS" ? "Resume Test →" : "Start Test →") : status.completed ? "View result →" : status.label}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
