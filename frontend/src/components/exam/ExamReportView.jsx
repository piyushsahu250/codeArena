// The consolidated report for one attempt: header, per-section results, strengths and weaknesses, coding test-case results, interview feedback, proctoring summary, anything still
// pending, and recommendations. Used for the student's own result and for the administrator's view of any attempt (which also shows the answer review and the event timeline).
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
const fmtDur = (s) => (s == null ? "—" : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`);
const pct = (n) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);
const num = (n) => (n == null ? "—" : Number(n).toFixed(2).replace(/\.?0+$/, ""));

function Bar({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return <div className="ex-bar-track" aria-hidden="true"><div className="ex-bar-fill" style={{ width: `${v}%` }} /></div>;
}

function Pending({ items }) {
  if (!items?.length) return null;
  return (
    <div className="ex-notice warn" role="status">
      <strong>Some results are still being finalised.</strong> The total is provisional until they finish; nothing pending has been counted as wrong.
      <ul className="ex-list">{items.map((p, i) => <li key={i}>{p.section || p.label}: {p.message || p.reason || `${p.count ?? ""} item(s) pending`}</li>)}</ul>
    </div>
  );
}

function TopicList({ title, rows }) {
  if (!rows?.length) return null;
  return <div><strong>{title}</strong><ul className="ex-list">{rows.map((r, i) => <li key={i}>{r.name || r.topic}: {pct(r.percent)} ({r.correct ?? r.obtained}/{r.total ?? r.max})</li>)}</ul></div>;
}

function ObjectiveSection({ s, admin }) {
  return (
    <>
      <div className="ex-score">
        <div><div className="n">{s.correct ?? "—"}</div><div className="ex-muted">Correct</div></div>
        <div><div className="n">{s.incorrect ?? "—"}</div><div className="ex-muted">Incorrect</div></div>
        <div><div className="n">{s.unanswered ?? "—"}</div><div className="ex-muted">Unanswered</div></div>
      </div>
      {s.keyMissing > 0 && <div className="ex-notice warn">{s.keyMissing} question(s) had no valid answer key and were not marked.</div>}
      <div className="ex-two">
        <TopicList title="Strengths" rows={s.strengths} />
        <TopicList title="Needs practice" rows={s.weaknesses} />
      </div>
      {admin && s.review?.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary>Answer review ({s.review.length})</summary>
          {s.review.map((q, i) => (
            <div key={q.id || i} className="ex-card">
              <div className="ex-row between"><strong>Q{i + 1}</strong><span className={`ex-chip ${q.isCorrect ? "ok" : "bad"}`}>{q.unavailable ? "Unavailable" : q.isCorrect ? "Correct" : "Not correct"}</span></div>
              <p style={{ whiteSpace: "pre-wrap" }}>{q.text}</p>
              {q.options && <ol type="A" className="ex-list">{q.options.map((o, oi) => <li key={oi} style={{ fontWeight: q.correct?.includes(oi) ? 700 : 400 }}>{String(o)}{q.selected?.includes(oi) ? "  ← chosen" : ""}{q.correct?.includes(oi) ? "  ✓ key" : ""}</li>)}</ol>}
              {q.explanation && <p className="ex-sub">{q.explanation}</p>}
            </div>
          ))}
        </details>
      )}
    </>
  );
}

function CodingSection({ s, admin }) {
  return (
    <>
      <div className="ex-score">
        <div><div className="n">{s.solved ?? 0}/{s.problems ?? 0}</div><div className="ex-muted">Problems solved</div></div>
        <div><div className="n">{s.testsPassed ?? 0}</div><div className="ex-muted">Tests passed</div></div>
        <div><div className="n">{s.testsFailed ?? 0}</div><div className="ex-muted">Tests failed</div></div>
      </div>
      {s.pendingItems > 0 && <div className="ex-notice warn">{s.pendingItems} solution(s) could not be graded yet (the code runner was unavailable). They are not counted as wrong and will be graded again.</div>}
      <table className="ex-table">
        <thead><tr><th>Problem</th><th>Result</th><th>Tests</th><th>Language</th><th>Submissions</th></tr></thead>
        <tbody>
          {(s.perProblem || []).map((p) => (
            <tr key={p.id}>
              <td>{p.title}</td>
              <td>{{ SOLVED: "Solved", PARTIAL: "Partly correct", NOT_ATTEMPTED: "Not attempted", JUDGE_PENDING: "Waiting for the code runner" }[p.status] || p.verdict || p.status}{p.errorSummary?.type ? ` (${p.errorSummary.type})` : ""}</td>
              <td>{p.testsTotal != null ? `${p.testsPassed}/${p.testsTotal}` : "—"}</td>
              <td>{p.language || "—"}</td>
              <td>{p.submissions || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {admin && (s.perProblem || []).some((p) => p.code) && (
        <details style={{ marginTop: 10 }}><summary>Submitted code</summary>
          {s.perProblem.filter((p) => p.code).map((p) => <div key={p.id}><strong>{p.title}</strong><pre className="ex-sample">{p.code}</pre></div>)}
        </details>
      )}
    </>
  );
}

function InterviewSection({ s }) {
  return (
    <>
      <div className="ex-score">
        <div><div className="n">{s.answered ?? 0}/{s.questions ?? 0}</div><div className="ex-muted">Answered</div></div>
        <div><div className="n">{s.skipped ?? 0}</div><div className="ex-muted">Skipped</div></div>
      </div>
      {(s.pendingItems > 0 || s.failedItems > 0) && <div className="ex-notice warn">{s.pendingItems || 0} answer(s) awaiting evaluation, {s.failedItems || 0} could not be evaluated. These are not scored as zero.</div>}
      {s.dimensions && Object.keys(s.dimensions).length > 0 && (
        <table className="ex-table"><thead><tr><th>Skill</th><th>Average</th></tr></thead>
          <tbody>{Object.entries(s.dimensions).map(([k, v]) => <tr key={k}><td>{k}</td><td>{typeof v === "object" ? num(v.average ?? v.avg ?? v.percent) : num(v)}</td></tr>)}</tbody>
        </table>
      )}
      <div className="ex-two">
        {s.strengths?.length > 0 && <div><strong>Strengths</strong><ul className="ex-list">{s.strengths.map((x, i) => <li key={i}>{x.name} ({num(x.value)})</li>)}</ul></div>}
        {s.weaknesses?.length > 0 && <div><strong>To improve</strong><ul className="ex-list">{s.weaknesses.map((x, i) => <li key={i}>{x.name} ({num(x.value)})</li>)}</ul></div>}
      </div>
      {(s.perQuestion || []).map((q, i) => (
        <details key={q.id || i} style={{ marginTop: 8 }}>
          <summary>Q{i + 1}: {q.question || "Question"} — {{ SKIPPED: "not answered", EVALUATION_PENDING: "awaiting evaluation", EVALUATION_FAILED: "could not be evaluated" }[q.status] || `${num(q.obtained)}/${num(q.maxMarks)}`}</summary>
          {q.answer && <p style={{ whiteSpace: "pre-wrap" }}><em>Your answer:</em> {q.answer}</p>}
          {q.strengths?.length > 0 && <p className="ex-sub">Good: {q.strengths.join("; ")}</p>}
          {q.missingConcepts?.length > 0 && <p className="ex-sub">Missing: {q.missingConcepts.join("; ")}</p>}
          {q.suggestions?.length > 0 && <p className="ex-sub">Suggestions: {q.suggestions.join("; ")}</p>}
        </details>
      ))}
      {s.limitations && <p className="ex-sub" style={{ marginTop: 8 }}>{s.limitations}</p>}
    </>
  );
}

export default function ExamReportView({ report, admin = false }) {
  if (!report) return null;
  const h = report.header;
  if (!report.released) {
    return (
      <div className="ex-card">
        <h2>{h?.examTitle}</h2>
        <p className="ex-sub">{h?.official ? "Official examination" : "Practice attempt"} · {h?.student?.name}</p>
        <div className="ex-notice warn" role="status">{report.message || "The result is not available yet."}</div>
      </div>
    );
  }
  const r = report.result;
  return (
    <div>
      <div className="ex-card">
        <div className="ex-row between">
          <div><h1 style={{ margin: 0 }}>{h.examTitle}</h1><p className="ex-sub">{h.official ? "Official examination" : "Practice attempt (unofficial)"} · Attempt {h.attemptId}</p></div>
          {r && <span className={`ex-chip ${r.passed === true ? "ok" : r.passed === false ? "bad" : "warn"}`}>{r.passed === true ? "Pass" : r.passed === false ? "Fail" : "Result pending"}</span>}
        </div>
        <table className="ex-table" style={{ marginTop: 10 }}>
          <tbody>
            <tr><th>Student</th><td>{h.student?.name}</td><th>PRN</th><td>{h.student?.prn || "—"}</td></tr>
            <tr><th>Institute</th><td>{h.institute || "—"}</td><th>Department / batch</th><td>{[h.department, h.batch, h.section].filter(Boolean).join(" · ") || "—"}</td></tr>
            <tr><th>Started</th><td>{fmtDate(h.startTime)}</td><th>Ended</th><td>{fmtDate(h.endTime)}</td></tr>
            <tr><th>Duration taken</th><td>{fmtDur(h.durationSeconds)}</td><th>Status</th><td>{h.status}</td></tr>
          </tbody>
        </table>
      </div>

      {r && (
        <div className="ex-card">
          <div className="ex-score">
            <div><div className="n">{num(r.obtained)}/{num(r.totalMarks)}</div><div className="ex-muted">Total marks{r.provisional ? " (provisional)" : ""}</div></div>
            <div><div className="n">{pct(r.percent)}</div><div className="ex-muted">Percentage</div></div>
            <div><div className="n">{r.strongestSection || "—"}</div><div className="ex-muted">Strongest section</div></div>
            <div><div className="n">{r.weakestSection || "—"}</div><div className="ex-muted">Needs most work</div></div>
          </div>
          <p className="ex-sub">Passing: {r.passingCriteria?.passingMarks != null ? `${r.passingCriteria.passingMarks} marks` : r.passingCriteria?.passingPercent != null ? `${r.passingCriteria.passingPercent}%` : "not set"}</p>
          <Pending items={report.pending} />
        </div>
      )}

      {report.sections.map((s) => (
        <div key={s.key} className="ex-card">
          <div className="ex-row between"><h3>{s.label}</h3><span className="ex-chip">{s.final ? "Final" : "Provisional"}</span></div>
          <div className="ex-row between"><span><strong>{num(s.final ? s.obtained : s.provisionalObtained)}</strong> / {num(s.maxMarks)} marks · {pct(s.percent)}</span><span className="ex-muted">Time: {fmtDur(s.timeTakenSeconds)}{s.completedBy === "SECTION_TIMER" ? " (closed by the timer)" : ""}</span></div>
          <Bar value={s.percent} />
          <div style={{ marginTop: 10 }}>
            {(s.key === "APTITUDE" || s.key === "TECHNICAL") && <ObjectiveSection s={s} admin={admin} />}
            {s.key === "CODING" && <CodingSection s={s} admin={admin} />}
            {s.key === "AI_INTERVIEW" && <InterviewSection s={s} />}
          </div>
        </div>
      ))}

      {report.proctoring && h.official && (
        <div className="ex-card">
          <h3>Proctoring</h3>
          <p className="ex-sub">{report.proctoring.note}</p>
          <p>Events recorded: {report.proctoring.total ?? 0} · Warnings: {report.proctoring.warningCount ?? 0} · Confirmed by a reviewer: {report.proctoring.confirmedViolations ?? 0} · Dismissed: {report.proctoring.dismissed ?? 0} · Awaiting review: {report.proctoring.reviewRequiredPending ?? 0}</p>
          {admin && report.proctoring.timeline?.length > 0 && (
            <details><summary>Event timeline ({report.proctoring.timeline.length})</summary>
              <table className="ex-table"><thead><tr><th>Time</th><th>Event</th><th>Section</th><th>Severity</th><th>Review</th></tr></thead>
                <tbody>{report.proctoring.timeline.map((e) => <tr key={e.id}><td>{fmtDate(e.at)}</td><td>{e.type}</td><td>{e.section || "—"}</td><td>{e.severity}</td><td>{e.reviewStatus}{e.note ? ` — ${e.note}` : ""}</td></tr>)}</tbody>
              </table>
            </details>
          )}
        </div>
      )}

      {report.recommendations?.length > 0 && (
        <div className="ex-card"><h3>Recommendations</h3><ul className="ex-list">{report.recommendations.map((x, i) => <li key={i}>{typeof x === "string" ? x : <><strong>{x.area}.</strong> {x.reason} {x.action}</>}</li>)}</ul></div>
      )}
      {admin && report.invalidatedReason && <div className="ex-notice bad">Withdrawn: {report.invalidatedReason}</div>}
    </div>
  );
}
