import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";

const STATUS_STYLE = {
  SUBMITTED: { bg: "var(--success-bg)", color: "var(--mint)", label: "Submitted" },
  AUTO_SUBMITTED: { bg: "var(--warning-bg)", color: "var(--amber-dark)", label: "Auto-submitted" },
  IN_PROGRESS: { bg: "var(--card-bg)", color: "var(--ink-dim)", label: "In progress" },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || { bg: "var(--card-bg)", color: "var(--ink-dim)", label: status };
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function StatCard({ label, value, accent }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: accent || "inherit" }}>{value}</div>
    </div>
  );
}

const RANK_MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function TestResults() {
  const { id } = useParams();
  const [test, setTest] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rollFilter, setRollFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.get(`/tests/${id}/results`), api.get(`/tests/${id}`)])
      .then(([resultsRes, testRes]) => {
        setAttempts(resultsRes.data);
        setTest(testRes.data);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Q{questionNumber} is the question's real, stable bank id — unlike a position number, it
  // still means something when a RANDOM-mode test only draws a subset of the bank per student
  // (see Test.questionSelectionMode), not just when a FIXED-mode test's order is shuffled.
  const questionLabelById = {};
  const pointsByQuestionId = {};
  for (const tq of test?.questions || []) {
    questionLabelById[tq.questionId] = `Q${tq.question.questionNumber}${tq.question.title ? `: ${tq.question.title}` : ""}`;
    pointsByQuestionId[tq.questionId] = tq.question.points || 0;
  }
  const defaultTotalQuestions = test?.questions?.length || 0;

  // Each attempt carries its own assigned-question list (questionOrder) once shuffle/RANDOM mode
  // is in play, so "how many questions" and "max possible score" are computed per-attempt rather
  // than assumed to match the test's full bank — a RANDOM-mode test can legitimately assign a
  // different subset (and therefore a different max score) to each student.
  function assignedIds(a) {
    return Array.isArray(a.questionOrder) && a.questionOrder.length > 0
      ? a.questionOrder
      : (test?.questions || []).map((tq) => tq.questionId);
  }
  function maxScoreOf(a) {
    return assignedIds(a).reduce((s, qId) => s + (pointsByQuestionId[qId] || 0), 0);
  }
  // A saved Submission row (any verdict, including a still-PENDING coding draft) counts as
  // "attempted" — this is the number staff actually need to confirm nothing was silently lost
  // between the student answering and the server recording it.
  function attemptedCountOf(a) {
    return new Set((a.submissions || []).map((s) => s.questionId)).size;
  }

  // Rank reflects position in the full (already score-sorted) list, so it
  // stays stable regardless of the roll-number filter below.
  const ranked = attempts.map((a, idx) => ({ ...a, rank: idx + 1 }));
  const filtered = rollFilter.trim()
    ? ranked.filter((a) => (a.student.rollNumber || "").toLowerCase().includes(rollFilter.trim().toLowerCase()))
    : ranked;

  const completedCount = attempts.filter((a) => a.status !== "IN_PROGRESS").length;

  const summary = useMemo(() => {
    const completed = attempts.filter((a) => a.status !== "IN_PROGRESS");
    const percentages = completed
      .map((a) => {
        const max = maxScoreOf(a);
        return max > 0 ? (a.totalScore / max) * 100 : null;
      })
      .filter((p) => p !== null);
    const avg = percentages.length ? percentages.reduce((s, p) => s + p, 0) / percentages.length : null;
    const passCount = test?.passingMarks != null ? completed.filter((a) => a.totalScore >= test.passingMarks).length : null;
    const incompleteCount = completed.filter((a) => attemptedCountOf(a) < assignedIds(a).length).length;
    return { avg, passCount, incompleteCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts, test]);

  function downloadCsv() {
    const header = ["Rank", "Roll no.", "Student", "Registration No. (PRN)", "Email", "Score", "Max Score", "Attempted", "Total Questions", "Status", "Tab switches"];
    const rows = filtered.map((a) => [
      a.rank,
      a.student.rollNumber || "",
      a.student.name,
      a.student.registrationNumber || "",
      a.student.email,
      a.totalScore,
      maxScoreOf(a),
      attemptedCountOf(a),
      assignedIds(a).length,
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
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px 64px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>Leaderboard</h1>
            <p style={{ margin: "4px 0 0", color: "var(--ink-dim)" }}>{test?.title || "Loading test…"}</p>
          </div>
          <button className="btn btn-primary" onClick={downloadCsv} disabled={filtered.length === 0}>
            ⬇ Download results (Excel/CSV)
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 20 }}>
          <StatCard label="Completed" value={`${completedCount} / ${attempts.length}`} />
          <StatCard label="Average Score" value={summary.avg !== null ? `${summary.avg.toFixed(1)}%` : "—"} accent="var(--mint)" />
          {summary.passCount !== null && <StatCard label="Passed" value={`${summary.passCount} / ${completedCount}`} accent="var(--mint)" />}
          <StatCard
            label="Incomplete Attempts"
            value={summary.incompleteCount}
            accent={summary.incompleteCount > 0 ? "var(--rust)" : "var(--ink-dim)"}
          />
        </div>

        <input
          type="text"
          placeholder="Filter by roll number…"
          value={rollFilter}
          onChange={(e) => setRollFilter(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, marginTop: 20 }}
        />

        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <th style={{ padding: "12px 10px" }}>Rank</th>
                <th style={{ padding: "12px 10px" }}>Roll no.</th>
                <th style={{ padding: "12px 10px" }}>Student</th>
                <th style={{ padding: "12px 10px" }}>Registration No. (PRN)</th>
                <th style={{ padding: "12px 10px" }}>Score</th>
                <th style={{ padding: "12px 10px" }}>Attempted</th>
                <th style={{ padding: "12px 10px" }}>Status</th>
                <th style={{ padding: "12px 10px" }}>Tab switches</th>
                <th style={{ padding: "12px 10px" }}>Questions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} style={{ padding: 32, textAlign: "center", color: "var(--ink-dim)" }}>Loading results…</td></tr>
              )}
              {!loading && filtered.map((a) => {
                const maxScore = maxScoreOf(a);
                const percent = maxScore > 0 ? Math.round((a.totalScore / maxScore) * 100) : null;
                const total = assignedIds(a).length;
                const attempted = attemptedCountOf(a);
                const incomplete = a.status !== "IN_PROGRESS" && attempted < total;
                return (
                  <>
                    <tr key={a.id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td className="mono" style={{ padding: "12px 10px", fontWeight: 700 }}>
                        {RANK_MEDAL[a.rank] ? `${RANK_MEDAL[a.rank]} ${a.rank}` : a.rank}
                      </td>
                      <td className="mono" style={{ padding: "12px 10px" }}>{a.student.rollNumber || "—"}</td>
                      <td style={{ padding: "12px 10px" }}>
                        {a.student.name}
                        <br /><span style={{ fontSize: 12, color: "var(--ink-dim)" }}>{a.student.email}</span>
                      </td>
                      <td className="mono" style={{ padding: "12px 10px" }}>{a.student.registrationNumber || "—"}</td>
                      <td style={{ padding: "12px 10px" }}>
                        <div className="mono" style={{ fontWeight: 700 }}>
                          {a.totalScore}{maxScore > 0 ? ` / ${maxScore}` : ""}
                        </div>
                        {percent !== null && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                            <div style={{ width: 60, height: 5, borderRadius: 3, background: "var(--line)", overflow: "hidden" }}>
                              <div style={{ width: `${percent}%`, height: "100%", background: percent >= 50 ? "var(--mint)" : "var(--rust)" }} />
                            </div>
                            <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>{percent}%</span>
                          </div>
                        )}
                      </td>
                      <td className="mono" style={{ padding: "12px 10px", fontSize: 13, color: incomplete ? "var(--rust)" : "var(--ink-dim)", fontWeight: incomplete ? 700 : 400 }}>
                        {attempted} / {total || defaultTotalQuestions}
                      </td>
                      <td style={{ padding: "12px 10px" }}><StatusBadge status={a.status} /></td>
                      <td className="mono" style={{ padding: "12px 10px", fontSize: 12, color: a.tabSwitchCount > 0 ? "var(--rust)" : "var(--ink-dim)" }}>{a.tabSwitchCount ?? 0}</td>
                      <td style={{ padding: "12px 10px" }}>
                        {Array.isArray(a.questionOrder) && a.questionOrder.length > 0 ? (
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}>
                            {expandedId === a.id ? "Hide" : "View"}
                          </button>
                        ) : <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>—</span>}
                      </td>
                    </tr>
                    {expandedId === a.id && Array.isArray(a.questionOrder) && (
                      <tr>
                        <td colSpan={9} style={{ padding: "0 10px 16px" }}>
                          <div className="card" style={{ padding: 12, background: "var(--bg-subtle, #FAFAF8)" }}>
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
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 32, textAlign: "center", color: "var(--ink-dim)" }}>
                  {attempts.length === 0 ? "No attempts yet." : "No student matches that roll number."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
