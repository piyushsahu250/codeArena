import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";

export default function TestResults() {
  const { id } = useParams();
  const [test, setTest] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [rollFilter, setRollFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    api.get(`/tests/${id}/results`).then((res) => setAttempts(res.data));
    api.get(`/tests/${id}`).then((res) => setTest(res.data));
  }, [id]);

  // Q{questionNumber} is the question's real, stable bank id — unlike a position number, it
  // still means something when a RANDOM-mode test only draws a subset of the bank per student
  // (see Test.questionSelectionMode), not just when a FIXED-mode test's order is shuffled.
  const questionLabelById = {};
  for (const tq of test?.questions || []) {
    questionLabelById[tq.questionId] = `Q${tq.question.questionNumber}${tq.question.title ? `: ${tq.question.title}` : ""}`;
  }

  // Rank reflects position in the full (already score-sorted) list, so it
  // stays stable regardless of the roll-number filter below.
  const ranked = attempts.map((a, idx) => ({ ...a, rank: idx + 1 }));
  const filtered = rollFilter.trim()
    ? ranked.filter((a) => (a.student.rollNumber || "").toLowerCase().includes(rollFilter.trim().toLowerCase()))
    : ranked;

  const completedCount = attempts.filter((a) => a.status !== "IN_PROGRESS").length;

  function downloadCsv() {
    const header = ["Rank", "Roll no.", "Student", "Registration No. (PRN)", "Email", "Score", "Status", "Tab switches"];
    const rows = filtered.map((a) => [
      a.rank,
      a.student.rollNumber || "",
      a.student.name,
      a.student.registrationNumber || "",
      a.student.email,
      a.totalScore,
      a.status,
      a.tabSwitchCount ?? 0,
    ]);
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(test?.title || "test-results").replace(/[^a-z0-9]+/gi, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>Leaderboard</h1>
          <button className="btn btn-primary" onClick={downloadCsv} disabled={filtered.length === 0}>
            ⬇ Download results (Excel/CSV)
          </button>
        </div>
        <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
          {completedCount} of {attempts.length} completed
        </p>

        <input
          type="text"
          placeholder="Filter by roll number…"
          value={rollFilter}
          onChange={(e) => setRollFilter(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, marginTop: 16 }}
        />

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 13, color: "var(--ink-dim)" }}>
              <th style={{ padding: "8px 4px" }}>Rank</th>
              <th>Roll no.</th>
              <th>Student</th>
              <th>Registration No. (PRN)</th>
              <th>Score</th>
              <th>Status</th>
              <th>Tab switches</th>
              <th>Assigned Questions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <>
                <tr key={a.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td className="mono" style={{ padding: "10px 4px" }}>{a.rank}</td>
                  <td className="mono">{a.student.rollNumber || "—"}</td>
                  <td>{a.student.name}<br /><span style={{ fontSize: 12, color: "var(--ink-dim)" }}>{a.student.email}</span></td>
                  <td className="mono">{a.student.registrationNumber || "—"}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{a.totalScore}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{a.status}</td>
                  <td className="mono" style={{ fontSize: 12, color: a.tabSwitchCount > 0 ? "var(--rust)" : "var(--ink-dim)" }}>{a.tabSwitchCount ?? 0}</td>
                  <td>
                    {Array.isArray(a.questionOrder) && a.questionOrder.length > 0 ? (
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}>
                        {expandedId === a.id ? "Hide" : "View"}
                      </button>
                    ) : <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>—</span>}
                  </td>
                </tr>
                {expandedId === a.id && Array.isArray(a.questionOrder) && (
                  <tr>
                    <td colSpan={7} style={{ padding: "0 4px 16px" }}>
                      <div className="card" style={{ padding: 12 }}>
                        <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 8 }}>
                          Exactly which questions this student saw, and in what order — the same underlying
                          question bank id (Q#) as everyone else's evaluation/audit records.
                        </p>
                        <table style={{ width: "100%", fontSize: 12 }}>
                          <thead>
                            <tr style={{ textAlign: "left", color: "var(--ink-dim)" }}>
                              <th style={{ padding: "2px 8px" }}>Student view</th>
                              <th>Question</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.questionOrder.map((qId, i) => (
                              <tr key={qId} className="mono">
                                <td style={{ padding: "2px 8px" }}>Question {i + 1}</td>
                                <td>{questionLabelById[qId] ?? qId}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>
                {attempts.length === 0 ? "No attempts yet." : "No student matches that roll number."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
