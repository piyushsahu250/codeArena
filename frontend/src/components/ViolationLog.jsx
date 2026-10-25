import { useMemo } from "react";
import { ENFORCEMENT_LABEL, buildViolationLog, formatEventDateTime, formatEventTime } from "../utils/violationLog";
import "./violationLog.css";

const COUNT_TONE = { strike: "danger", warning: "warning", interruption: "neutral", signal: "neutral" };

function countLabel(row) {
  if (row.outcome.kind === "strike") return `Strike ${row.strikeNumber}`;
  if (row.outcome.kind === "warning") return "Warning";
  return "Not counted";
}

// One attempt's proctoring log: a summary, one plain sentence about what the signals are, a table in time order, and the long rule text folded away until asked for.
// `data` is the server's { events, evidenceNote, ... } (or { error }); `strikeTotal` is the attempt's strike count shown in the results table.
export default function ViolationLog({ studentName, strikeTotal, loading, data }) {
  const log = useMemo(() => (data && !data.error ? buildViolationLog(data.events, strikeTotal) : null), [data, strikeTotal]);

  if (loading) return <p className="vl-status" role="status">Loading the proctoring log…</p>;
  if (data?.error) return <p className="vl-status vl-status-error" role="alert">{data.error}</p>;
  if (!log) return null;
  const { rows, summary } = log;

  return (
    <section className="vl" aria-label={`Proctoring log for ${studentName}`}>
      <div className="vl-head">
        <h3 className="vl-title">Proctoring log</h3>
        <span className="vl-student">{studentName}</span>
      </div>

      <ul className="vl-chips" aria-label="Summary">
        <li className="vl-chip">{summary.events} {summary.events === 1 ? "event" : "events"} recorded</li>
        <li className={`vl-chip ${summary.strikes ? "vl-chip-danger" : ""}`}>{summary.strikes} {summary.strikes === 1 ? "strike" : "strikes"} counted</li>
        {summary.warnings > 0 && <li className="vl-chip vl-chip-warning">{summary.warnings} {summary.warnings === 1 ? "warning" : "warnings"}</li>}
        {summary.prohibited > 0 && <li className="vl-chip vl-chip-danger">{summary.prohibited} prohibited {summary.prohibited === 1 ? "action" : "actions"} observed</li>}
      </ul>

      <p className="vl-note">These are browser signals, not proof of misconduct. Only an authorised reviewer can confirm misconduct.</p>
      <details className="vl-help">
        <summary>How to read this log</summary>
        <p>{data.evidenceNote || "Browser signals are observations, not proof. A page cannot see other apps, devices or assistants."}</p>
        <ul>
          <li><b>Strike</b>: the event was added to the attempt's strike total under the exam's counting rule.</li>
          <li><b>Warning</b>: a restricted action that was not counted on its own. A single occurrence is a soft warning; repeated ones can become strikes.</li>
          <li><b>Not counted</b>: an interruption or signal recorded for review only.</li>
          <li><b>Prohibited action observed</b>: the page saw an action the exam's published rules prohibit. It does not show why, or by whom.</li>
        </ul>
      </details>

      {summary.mismatch && (
        <p className="vl-alert" role="status">
          The attempt's strike total is {summary.strikeTotal}, but the log lists {summary.strikes} counted {summary.strikes === 1 ? "event" : "events"}. The total may include events that are no longer in the log.
        </p>
      )}

      <div className="vl-scroll">
        <table className="vl-table">
          <caption className="ca-sr-only">Proctoring events for {studentName}, oldest first</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Event</th>
              <th scope="col">What was observed</th>
              <th scope="col">Counted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ ev, outcome, observation, label, strikeNumber }, i) => {
              const pol = ev.evidence?.policy;
              const hasDetails = pol && (pol.ruleId || pol.note);
              return (
                <tr key={ev.id ?? i} className={`vl-row vl-row-${outcome.kind}`}>
                  <td className="vl-time"><time dateTime={ev.createdAt} title={formatEventDateTime(ev.createdAt)}>{formatEventTime(ev.createdAt)}</time></td>
                  <td className="vl-event">
                    <div className="vl-event-name">{label}</div>
                    <div className="vl-rule">
                      {pol?.ruleId ? `Exam rule: ${pol.title}, ${ENFORCEMENT_LABEL[pol.enforcement] || "recorded"}` : "No exam rule applies to this event"}
                    </div>
                    {hasDetails && (
                      <details className="vl-details">
                        <summary>What this shows</summary>
                        {pol.ruleId ? (
                          <>
                            <p><b>{pol.description}.</b> Rule {pol.ruleId}, policy {pol.version}.</p>
                            <p><b>Shows:</b> {pol.shows}</p>
                            <p><b>Does not show:</b> {pol.doesNotShow}</p>
                          </>
                        ) : <p>{pol.note}</p>}
                        {ev.evidence?.rationale && <p><b>Classification:</b> {ev.evidence.rationale}{ev.evidence.limits ? ` Limits: ${ev.evidence.limits}` : ""}</p>}
                      </details>
                    )}
                  </td>
                  <td><span className={`vl-pill vl-pill-${observation.tone}`}>{observation.label}</span></td>
                  <td>
                    <span className={`vl-pill vl-pill-${COUNT_TONE[outcome.kind]}`} data-kind={outcome.kind} data-strike={strikeNumber ?? undefined}>{countLabel({ outcome, strikeNumber })}</span>
                    <div className="vl-reason">{outcome.reason}</div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="vl-empty">No events recorded for this attempt.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
