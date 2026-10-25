import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import { downloadFromApi } from "../utils/downloadFile";
import { matchesStudentQuery } from "../utils/studentSearch";

const STATUS_STYLE = {
  SUBMITTED: { bg: "var(--success-bg)", color: "var(--mint)", label: "Submitted" },
  AUTO_SUBMITTED: { bg: "var(--warning-bg)", color: "var(--amber-dark)", label: "Auto-submitted" },
  IN_PROGRESS: { bg: "var(--card-bg)", color: "var(--ink-dim)", label: "In progress" },
};
// States that are not a finished attempt. Time expired is neither live nor finished: the student ran out of time and the server has not closed the attempt yet.
const STATE_STYLE = {
  IN_PROGRESS: { bg: "var(--card-bg)", color: "var(--ink-dim)", label: "In progress" },
  TIME_EXPIRED: { bg: "var(--warning-bg)", color: "var(--amber-dark)", label: "Time expired" },
  UNKNOWN: { bg: "var(--card-bg)", color: "var(--ink-dim)", label: "Unknown" },
};

// The server decides the state (backend/src/modules/tests/attemptLifecycle.js). The fallback only covers a response from an older server that has no lifecycle field.
const stateOf = (a) => a.lifecycle?.state || (a.status === "IN_PROGRESS" ? "IN_PROGRESS" : "COMPLETED");

function StatusBadge({ attempt }) {
  const state = stateOf(attempt);
  const s = state === "COMPLETED" ? (STATUS_STYLE[attempt.status] || STATUS_STYLE.SUBMITTED) : STATE_STYLE[state] || STATE_STYLE.UNKNOWN;
  return <span className="badge" style={{ background: s.bg, color: s.color }} title={attempt.lifecycle?.detail}>{s.label}</span>;
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

// Mirrors backend/src/utils/proctoringSeverity.js's 4-level taxonomy purely for display.
const SEVERITY_COLOR = { INTERRUPTION: "var(--ink-dim)", SUSPICIOUS: "var(--amber)", CONFIRMED_VIOLATION: "var(--rust)" };
// What the server can honestly say about a browser-reported event (utils/evidenceClassification.js). Only a reviewer can confirm misconduct.
// CONFIRMED_POLICY_VIOLATION = the server saw an action the exam's published rules prohibit (utils/proctoringPolicy.js); it says what was observed, not why or by whom.
const EVIDENCE_LABEL = { OBSERVED_EVENT: "Observed (browser signal)", SUSPECTED_ACTIVITY: "Suspected — review needed", INCONCLUSIVE: "Inconclusive", POLICY_VIOLATION: "Policy violation", CONFIRMED_POLICY_VIOLATION: "Prohibited action observed", CONFIRMED_VIOLATION: "Confirmed by reviewer" };
// Plain names for event types whose raw name over-claims.
const EVENT_LABEL = { POSSIBLE_EXTERNAL_ASSISTANT: "Exam page lost focus (cause unknown)", TAB_SWITCH: "Exam page left (tab switch)", TAB_SWITCH_BRIEF: "Exam page briefly hidden", DEVTOOLS: "Window-size change (possible DevTools, unverified)", DRAG_ATTEMPT: "Drag on the exam page", COPILOT_KEY_SIGNAL: "Assistant key pressed", AI_SHORTCUT_DETECTED: "Assistant shortcut pressed", SPLIT_SCREEN_SUSPECTED: "Small window (possible split screen)" };
// What the page could do about it. A web page asks the browser to cancel an event; it cannot confirm the browser did, and cannot stop leaving the page.
const ENFORCEMENT_LABEL = { BLOCK_ATTEMPTED: "cancel requested, not verified", NOT_BLOCKABLE: "cannot be blocked by a web page", OBSERVED_ONLY: "recorded only" };

export default function TestResults() {
  const { id } = useParams();
  const [test, setTest] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  // "Tab switches" was previously just a bare count with nowhere to see what actually happened --
  // GET /tests/admin/attempts/:id/violations (added alongside the exam severity taxonomy) already
  // has the real per-event log; this was the one surface still missing a way to look at it.
  // Lazy-loaded and cached per attempt id so re-expanding a row already viewed doesn't re-fetch.
  const [violationsExpandedId, setViolationsExpandedId] = useState(null);
  const [violationsById, setViolationsById] = useState({});
  const [violationsLoading, setViolationsLoading] = useState(null);

  // Faculty Analytics (platform-maturity spec item #6): per-question attempted/correct-rate
  // breakdown, sorted hardest-first. Lazy-loaded on demand (not fetched alongside the leaderboard
  // above) since it's a second, heavier query over every Submission row for this test -- most
  // visits to this page are "check the leaderboard," not "review question difficulty."
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  function toggleAnalytics() {
    const next = !showAnalytics;
    setShowAnalytics(next);
    if (next && !analytics && !analyticsLoading) {
      setAnalyticsLoading(true);
      api.get(`/tests/${id}/question-analytics`)
        .then(({ data }) => setAnalytics(data))
        .catch((err) => setAnalyticsError(err.response?.data?.error || "Failed to load question analytics"))
        .finally(() => setAnalyticsLoading(false));
    }
  }

  function toggleViolations(attemptId) {
    if (violationsExpandedId === attemptId) {
      setViolationsExpandedId(null);
      return;
    }
    setViolationsExpandedId(attemptId);
    if (!violationsById[attemptId]) {
      setViolationsLoading(attemptId);
      api.get(`/tests/admin/attempts/${attemptId}/violations`)
        .then(({ data }) => setViolationsById((prev) => ({ ...prev, [attemptId]: data })))
        .catch((err) => setViolationsById((prev) => ({ ...prev, [attemptId]: { error: err.response?.data?.error || "Failed to load violation log" } })))
        .finally(() => setViolationsLoading(null));
    }
  }

  useEffect(() => {
    setLoading(true);
    setLoadError("");
    Promise.all([api.get(`/tests/${id}/results`), api.get(`/tests/${id}`)])
      .then(([resultsRes, testRes]) => {
        setAttempts(resultsRes.data);
        setTest(testRes.data);
      })
      .catch((err) => setLoadError(err.response?.status === 404 ? "This test no longer exists." : err.response?.data?.error || "Could not load the results. Check your connection and try again."))
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
  // stays stable regardless of the search below.
  const ranked = attempts.map((a, idx) => ({ ...a, rank: a.lifecycle ? a.rank : stateOf(a) === "COMPLETED" ? idx + 1 : null }));
  const filtered = searchQuery.trim() ? ranked.filter((a) => matchesStudentQuery(a.student, searchQuery)) : ranked;

  const completedCount = attempts.filter((a) => stateOf(a) === "COMPLETED").length;
  const inProgressCount = attempts.filter((a) => stateOf(a) === "IN_PROGRESS").length;
  const expiredCount = attempts.filter((a) => stateOf(a) === "TIME_EXPIRED").length;

  const summary = useMemo(() => {
    const completed = attempts.filter((a) => stateOf(a) === "COMPLETED");
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

  // Real .xlsx built by the server (typed numbers, text roll/PRN, formula-injection guard). The search
  // query is passed through so the file matches what's on screen; clear the search to export everyone.
  const [downloadingResults, setDownloadingResults] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  async function downloadResults(format = "xlsx") {
    setDownloadingResults(true);
    setDownloadError("");
    try {
      await downloadFromApi(`/tests/${id}/results/export`, { params: { format, ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}) }, fallbackName: `test-results.${format}` });
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setDownloadingResults(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 64px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>Leaderboard</h1>
            <p style={{ margin: "4px 0 0", color: "var(--ink-dim)" }}>{test?.title || "Loading test…"}</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link className="btn btn-ghost" to={`/staff/exam-security/test/${id}`}>Security monitor</Link>
            <button className="btn btn-ghost" onClick={toggleAnalytics}>
              📊 {showAnalytics ? "Hide" : "Question Analytics"}
            </button>
            <button className="btn btn-primary" onClick={() => downloadResults("xlsx")} disabled={filtered.length === 0 || downloadingResults}>
              {downloadingResults ? "Preparing…" : "⬇ Download results (Excel)"}
            </button>
            <button className="btn btn-ghost" onClick={() => downloadResults("csv")} disabled={filtered.length === 0 || downloadingResults}>CSV</button>
          </div>
        </div>
        {loadError && <p role="alert" style={{ color: "var(--rust)", marginTop: 16, fontSize: 14 }}>{loadError}</p>}
        {downloadError && <p style={{ color: "var(--rust)", marginTop: 10, fontSize: 13 }}>⚠ {downloadError}</p>}
        {searchQuery.trim() && <p style={{ color: "var(--ink-dim)", marginTop: 6, fontSize: 12 }}>The download only includes rows matching "{searchQuery.trim()}" — clear the search to export everyone.</p>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 20 }}>
          <StatCard label="Completed" value={`${completedCount} / ${attempts.length}`} />
          {inProgressCount > 0 && <StatCard label="In progress" value={inProgressCount} />}
          {expiredCount > 0 && <StatCard label="Time expired, not closed" value={expiredCount} accent="var(--amber-dark)" />}
          <StatCard label="Average Score" value={summary.avg !== null ? `${summary.avg.toFixed(1)}%` : "—"} accent="var(--mint)" />
          {summary.passCount !== null && <StatCard label="Passed" value={`${summary.passCount} / ${completedCount}`} accent="var(--mint)" />}
          <StatCard
            label="Incomplete Attempts"
            value={summary.incompleteCount}
            accent={summary.incompleteCount > 0 ? "var(--rust)" : "var(--ink-dim)"}
          />
        </div>

        {showAnalytics && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <h3 style={{ fontSize: 15, margin: 0 }}>Question Analytics</h3>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
              Sorted hardest-first (lowest correct rate). "Review recommended" is a heuristic (under 20% correct
              with at least 5 attempts) — it flags a question worth a human look, not a claim that it's broken;
              a genuinely hard question and a badly-worded one look identical from this data alone.
            </p>
            {analyticsLoading && <p className="mono" style={{ marginTop: 12, color: "var(--ink-dim)" }}>Loading…</p>}
            {analyticsError && <p style={{ marginTop: 12, color: "var(--rust)" }}>{analyticsError}</p>}
            {analytics && (
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640, fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase" }}>
                      <th style={{ padding: "8px" }}>Question</th>
                      <th style={{ padding: "8px" }}>Type</th>
                      <th style={{ padding: "8px" }}>Attempted</th>
                      <th style={{ padding: "8px" }}>Fully Correct</th>
                      <th style={{ padding: "8px" }}>Correct Rate</th>
                      <th style={{ padding: "8px" }}>Avg Score</th>
                      <th style={{ padding: "8px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.map((q) => (
                      <tr key={q.questionId} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "8px" }}>Q{q.questionNumber}{q.title ? `: ${q.title}` : ""}</td>
                        <td className="mono" style={{ padding: "8px" }}>{q.questionType}</td>
                        <td className="mono" style={{ padding: "8px" }}>{q.attempted}</td>
                        <td className="mono" style={{ padding: "8px" }}>{q.fullyCorrect}</td>
                        <td className="mono" style={{ padding: "8px", color: q.correctRate !== null && q.correctRate < 0.2 ? "var(--rust)" : "inherit", fontWeight: q.reviewRecommended ? 700 : 400 }}>
                          {q.correctRate !== null ? `${Math.round(q.correctRate * 100)}%` : "—"}
                        </td>
                        <td className="mono" style={{ padding: "8px" }}>{q.avgScorePercent !== null ? `${q.avgScorePercent}%` : "—"}</td>
                        <td style={{ padding: "8px" }}>{q.reviewRecommended && <span className="badge" style={{ background: "var(--warning-bg)", color: "var(--amber-dark)" }}>Review recommended</span>}</td>
                      </tr>
                    ))}
                    {analytics.length === 0 && (
                      <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No questions on this test.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 20 }}>
          <input
            type="search"
            aria-label="Search the leaderboard by name, roll number, PRN or e-mail"
            placeholder="Search by name, roll number, PRN or e-mail…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 }}
          />
          {searchQuery && <button type="button" className="btn btn-ghost" onClick={() => setSearchQuery("")}>Clear</button>}
        </div>
        {searchQuery.trim() && !loading && attempts.length > 0 && (
          <p className="mono" style={{ color: "var(--ink-dim)", marginTop: 6, fontSize: 12 }} aria-live="polite">Showing {filtered.length} of {attempts.length} — ranks stay as on the full leaderboard.</p>
        )}

        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <th style={{ padding: "10px 8px" }}>Rank</th>
                <th style={{ padding: "10px 8px" }}>Roll no.</th>
                <th style={{ padding: "10px 8px" }}>Student</th>
                <th style={{ padding: "10px 8px" }} title="Registration No. (PRN)">PRN</th>
                <th style={{ padding: "10px 8px" }}>Score</th>
                <th style={{ padding: "10px 8px" }}>Attempted</th>
                <th style={{ padding: "10px 8px" }}>Status</th>
                <th style={{ padding: "10px 8px" }}>Tab switches</th>
                <th style={{ padding: "10px 8px" }}>Questions</th>
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
                const incomplete = stateOf(a) === "COMPLETED" && attempted < total;
                return (
                  <>
                    <tr key={a.id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td className="mono" style={{ padding: "10px 8px", fontWeight: 700 }}>
                        {a.rank == null ? "—" : RANK_MEDAL[a.rank] ? `${RANK_MEDAL[a.rank]} ${a.rank}` : a.rank}
                      </td>
                      <td className="mono" style={{ padding: "10px 8px" }}>{a.student.rollNumber || "—"}</td>
                      <td style={{ padding: "10px 8px", maxWidth: 170 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.student.name}</div>
                        {/* Full name + email on hover (title) — truncated here so one long address
                            doesn't force the whole table wider than the page (was the direct cause
                            of the results table needing to scroll to see Status/Tab switches/View). */}
                        <div
                          title={`${a.student.name} — ${a.student.email}`}
                          style={{ fontSize: 12, color: "var(--ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          {a.student.email}
                        </div>
                      </td>
                      <td className="mono" style={{ padding: "10px 8px" }}>{a.student.registrationNumber || "—"}</td>
                      <td style={{ padding: "10px 8px" }}>
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
                      <td className="mono" style={{ padding: "10px 8px", fontSize: 13, color: incomplete ? "var(--rust)" : "var(--ink-dim)", fontWeight: incomplete ? 700 : 400 }}>
                        {attempted} / {total || defaultTotalQuestions}
                      </td>
                      <td style={{ padding: "10px 8px" }}><StatusBadge attempt={a} /></td>
                      <td className="mono" style={{ padding: "10px 8px", fontSize: 12 }}>
                        {a.tabSwitchCount > 0 ? (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 12, padding: "2px 6px", color: "var(--rust)", fontWeight: 700 }}
                            onClick={() => toggleViolations(a.id)}
                            title="View the actual proctoring event log for this attempt"
                          >
                            {a.tabSwitchCount} {violationsExpandedId === a.id ? "▲" : "▼"}
                          </button>
                        ) : (
                          <span style={{ color: "var(--ink-dim)" }}>0</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 8px" }}>
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
                    {violationsExpandedId === a.id && (
                      <tr>
                        <td colSpan={9} style={{ padding: "0 10px 16px" }}>
                          <div className="card" style={{ padding: 12, background: "var(--bg-subtle, #FAFAF8)" }}>
                            {violationsLoading === a.id && <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>Loading violation log…</p>}
                            {violationsById[a.id]?.error && <p className="mono" style={{ fontSize: 12, color: "var(--rust)" }}>{violationsById[a.id].error}</p>}
                            {violationsById[a.id] && !violationsById[a.id].error && (
                              <>
                                <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 8 }}>
                                  {violationsById[a.id].evidenceNote || "Browser signals are observations, not proof."} "Counted" means the event
                                  added to the {a.tabSwitchCount} strike(s) in the table under the exam's counting rule — it is not a finding of misconduct.
                                </p>
                                <table style={{ width: "100%", fontSize: 12 }}>
                                  <thead>
                                    <tr style={{ textAlign: "left", color: "var(--ink-dim)" }}>
                                      <th style={{ padding: "2px 8px" }}>Time</th>
                                      <th>Event</th>
                                      <th>Evidence</th>
                                      <th>Exam rule</th>
                                      <th>Counted?</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {violationsById[a.id].events.flatMap((ev) => {
                                      const pol = ev.evidence?.policy;
                                      const confirmed = ev.evidence?.classification === "CONFIRMED_POLICY_VIOLATION";
                                      return [
                                        <tr key={ev.id} className="mono">
                                          <td style={{ padding: "2px 8px" }}>{new Date(ev.createdAt).toLocaleTimeString()}</td>
                                          <td>{EVENT_LABEL[ev.type] || ev.type.replace(/_/g, " ")}</td>
                                          <td title={ev.evidence ? `${ev.evidence.rationale} Limits: ${ev.evidence.limits}` : undefined} style={{ color: confirmed ? SEVERITY_COLOR.CONFIRMED_VIOLATION : ev.evidence?.classification === "SUSPECTED_ACTIVITY" ? SEVERITY_COLOR.SUSPICIOUS : "inherit" }}>
                                            {EVIDENCE_LABEL[ev.evidence?.classification] || "Observed (browser signal)"}
                                          </td>
                                          <td>{pol?.ruleId ? `${pol.title} · ${ENFORCEMENT_LABEL[pol.enforcement] || "Recorded"}` : "No exam rule applies"}</td>
                                          <td>{ev.counted === false ? "Not counted (signal)" : ev.penalized ? "Yes" : "No"}</td>
                                        </tr>,
                                        pol && (pol.ruleId || pol.note) ? (
                                          <tr key={`${ev.id}-rule`}>
                                            <td />
                                            <td colSpan={4} style={{ fontSize: 11, color: "var(--ink-dim)", padding: "0 0 6px" }}>
                                              {pol.ruleId ? (
                                                <>
                                                  <b>{pol.description}.</b> Rule {pol.ruleId}, policy {pol.version}. Shows: {pol.shows} Does not show: {pol.doesNotShow}
                                                </>
                                              ) : pol.note}
                                            </td>
                                          </tr>
                                        ) : null,
                                      ];
                                    })}
                                    {violationsById[a.id].events.length === 0 && (
                                      <tr><td colSpan={5} style={{ padding: "6px 8px", color: "var(--ink-dim)" }}>No events recorded.</td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 32, textAlign: "center", color: "var(--ink-dim)" }}>
                  {attempts.length === 0 ? "No attempts yet." : `No student matches "${searchQuery.trim()}". Try part of a name, roll number, PRN or e-mail.`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
