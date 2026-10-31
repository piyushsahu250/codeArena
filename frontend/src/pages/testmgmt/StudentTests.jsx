import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import api from "../../api";
import Navbar from "../../components/Navbar";
import ChalkUnderline from "../../components/ChalkUnderline";
import { Notice, fmtDateTime, useLoader } from "./kit";
import "./testmgmt.css";

const STATE = {
  COMPLETED: ["Completed", "ok"], IN_PROGRESS: ["In progress", "warn"], AVAILABLE: ["Available", "ok"], LOCKED: ["Locked", "off"], UNAVAILABLE: ["Not available", "bad"],
};
const REASON = { NOT_STARTED: "Opens later", EXPIRED: "Closed", INACTIVE: "Switched off", UNPUBLISHED: "Not published", ARCHIVED: "Archived", ASSIGNMENT_INACTIVE: "Switched off" };
const ACTION = { START: "Start series", CONTINUE: "Continue", REVIEW: "Review" };

function Shell({ children }) {
  return <div><Navbar /><div className="tm-page" style={{ maxWidth: 980 }}>{children}</div></div>;
}

// The student's Test section: tests assigned to them one by one, and Test Series assigned to them as a guided set. Locking is decided and enforced by the server; this page only shows it.
export function StudentTests() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "series" ? "series" : "individual";
  const tests = useLoader(() => api.get("/tests").then((r) => r.data), []);
  const series = useLoader(() => api.get("/test-management/student/series").then((r) => r.data), []);
  const [filter, setFilter] = useState("all");
  const list = (Array.isArray(tests.data) ? tests.data : tests.data?.tests || []).filter((t) => (filter === "all" ? true : filter === "todo" ? !t.myStatus : t.myStatus));
  const cards = series.data?.series || [];

  return (
    <Shell>
      <h1 style={{ margin: 0 }}>Tests</h1><ChalkUnderline />
      <div className="tm-tools" role="tablist" aria-label="Test section" style={{ marginTop: 14 }}>
        <button role="tab" aria-selected={tab === "individual"} className={`btn ${tab === "individual" ? "btn-primary" : "btn-ghost"}`} onClick={() => setParams({})}>Individual Tests</button>
        <button role="tab" aria-selected={tab === "series"} className={`btn ${tab === "series" ? "btn-primary" : "btn-ghost"}`} onClick={() => setParams({ tab: "series" })}>Test Series{cards.length ? ` (${cards.length})` : ""}</button>
      </div>

      {tab === "individual" && (
        <>
          <div className="tm-tools"><select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tests"><option value="all">All</option><option value="todo">Not attempted</option><option value="done">Attempted</option></select></div>
          {tests.error && <Notice kind="bad">{tests.error}</Notice>}
          <div className="tm-series-grid">
            {list.map((t) => {
              const now = Date.now();
              const open = new Date(t.startTime) <= now && now <= new Date(t.endTime);
              const done = t.myStatus && t.myStatus !== "IN_PROGRESS";
              return (
                <div key={t.id} className="tm-card tm-series">
                  <div className="tm-title">{t.title}</div>
                  <div className="tm-meta">{[t.subject, t.durationMin ? `${t.durationMin} min` : null].filter(Boolean).join(" · ")}</div>
                  <div className="tm-meta">{fmtDateTime(t.startTime)} → {fmtDateTime(t.endTime)}</div>
                  <div><span className={`tm-pill ${done ? "ok" : t.myStatus ? "warn" : open ? "ok" : "off"}`}>{done ? "Completed" : t.myStatus ? "In progress" : open ? "Open now" : now < new Date(t.startTime) ? "Opens later" : "Closed"}</span></div>
                  {done ? <Link className="btn btn-ghost" to={`/test/${t.id}/result`}>View result</Link> : (open || t.myStatus) && <Link className="btn btn-primary" to={`/test/${t.id}`}>{t.myStatus ? "Continue" : "Start"}</Link>}
                </div>
              );
            })}
          </div>
          {!tests.loading && list.length === 0 && <div className="tm-empty">No tests to show.</div>}
        </>
      )}

      {tab === "series" && (
        <>
          {series.error && <Notice kind="bad">{series.error}</Notice>}
          <div className="tm-series-grid" style={{ marginTop: 12 }}>
            {cards.map((s) => (
              <div key={s.id} className="tm-card tm-series">
                {s.coverUrl && <div className="tm-cover" style={{ backgroundImage: `url("${encodeURI(s.coverUrl).replace(/["()']/g, encodeURIComponent)}")` }} role="img" aria-label="" />}
                <div className="tm-title">{s.title}</div>
                <div className="tm-meta">{[s.subject, s.difficulty, s.accessMode === "SEQUENTIAL" ? "In order" : "Any order"].filter(Boolean).join(" · ")}</div>
                <div className="tm-bar" aria-hidden="true"><i style={{ width: `${s.percent}%` }} /></div>
                <div className="tm-meta">{s.completed} of {s.total} completed · {s.pending} pending</div>
                <div className="tm-meta">{s.window.noExpiry ? "No Expiry" : `Closes ${fmtDateTime(s.window.endAt)}`}</div>
                {!s.availability.available && <span className="tm-pill off">{REASON[s.availability.reason] || "Not available"}</span>}
                {s.action ? <Link className="btn btn-primary" to={`/tests/series/${s.id}`}>{ACTION[s.action]}</Link> : <Link className="btn btn-ghost" to={`/tests/series/${s.id}`}>Details</Link>}
              </div>
            ))}
          </div>
          {!series.loading && cards.length === 0 && <div className="tm-empty">No test series have been assigned to you yet.</div>}
        </>
      )}
    </Shell>
  );
}

export function StudentSeries() {
  const { id } = useParams();
  const s = useLoader(() => api.get(`/test-management/student/series/${id}`).then((r) => r.data), [id]);
  const d = s.data;
  return (
    <Shell>
      <p className="tm-meta"><Link to="/tests?tab=series">← Test Series</Link></p>
      {s.error && <Notice kind="bad">{s.error}</Notice>}
      {d && (
        <>
          <h1 style={{ margin: 0 }}>{d.title}</h1><ChalkUnderline />
          {d.description && <p className="tm-sub">{d.description}</p>}
          <div className="tm-card" style={{ margin: "14px 0" }}>
            <div className="tm-bar" aria-hidden="true"><i style={{ width: `${d.percent}%` }} /></div>
            <p className="tm-meta" style={{ marginBottom: 0 }}>{d.completed} of {d.total} completed · {d.accessMode === "SEQUENTIAL" ? `Take them in order${d.unlockRule === "PASSED" ? "; pass each test to unlock the next" : ""}.` : "Take them in any order."} {d.window.noExpiry ? "This series has no expiry." : `Open until ${fmtDateTime(d.window.endAt)}.`}{d.window.completionDeadline ? ` Finish by ${fmtDateTime(d.window.completionDeadline)}.` : ""}</p>
          </div>
          {!d.availability.available && <Notice kind="warn">{d.availability.reason === "NOT_STARTED" ? "This series has not opened yet." : d.availability.reason === "EXPIRED" ? "This series has closed. Your results are kept below." : "This series is not available right now."}</Notice>}
          {d.instructions && <Notice kind="ok">{d.instructions}</Notice>}
          {d.items.map((it) => {
            const [label, kind] = STATE[it.state] || ["", "off"];
            return (
              <div key={it.testId} className={`tm-step ${it.state === "LOCKED" ? "locked" : ""} ${it.state === "COMPLETED" ? "done" : ""}`}>
                <span className="no" aria-hidden="true">{it.state === "COMPLETED" ? "✓" : it.position}</span>
                <div>
                  <div className="tm-title">{it.title}</div>
                  <div className="tm-meta">{[it.questions != null ? `${it.questions} questions` : null, it.durationMin ? `${it.durationMin} min` : null].filter(Boolean).join(" · ")}{it.score != null ? ` · Score ${it.score}${it.passingMarks != null ? ` (pass ${it.passingMarks})` : ""}` : ""}</div>
                  <span className={`tm-pill ${kind}`}>{label}</span>{it.reason && it.state !== "COMPLETED" && <span className="tm-meta"> {it.reason}</span>}
                </div>
                <div>
                  {it.canOpen && <Link className="btn btn-primary" to={`/test/${it.testId}`}>{it.state === "IN_PROGRESS" ? "Continue" : "Start"}</Link>}
                  {it.resultUrl && <Link className="btn btn-ghost" to={it.resultUrl}>Result</Link>}
                </div>
              </div>
            );
          })}
        </>
      )}
      {s.loading && !d && <p className="mono">Loading…</p>}
    </Shell>
  );
}
