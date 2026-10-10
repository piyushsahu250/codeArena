import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import Navbar from "../../components/Navbar";
import { useDashboard, PageHeader, Panel, Kpi, DataTable, SeriesChart, Empty, ErrorLine, FullPageSkeleton, Skel, actionLabel } from "../../components/admin/adKit";
import { presetRange, fmtDate, fmtDateTime, num, StatusBadge, CategoryCell, Change, ExportMenu, DateFilters, Pager, Definitions } from "./staffAnalyticsKit";

function RatioCard({ r }) {
  return (
    <div className="sa-card">
      <h3>{r.label}</h3>
      {r.status === "OK" && <div className="sa-ratio-value">{r.value}%</div>}
      {r.status === "INSUFFICIENT_DATA" && <div className="sa-muted">Not enough data <span className="ad-sub">({r.denominator} of at least 10 events)</span></div>}
      {r.status === "NOT_APPLICABLE" && <div className="sa-na">N/A for this role</div>}
      {r.status !== "NOT_APPLICABLE" && <div className="ad-sub">{r.numerator} of {r.denominator} events</div>}
      <details style={{ marginTop: 6 }}><summary className="ad-sub" style={{ cursor: "pointer" }}>Formula and meaning</summary><div className="ad-sub"><code>{r.formula}</code></div><div className="ad-sub">{r.meaning}</div></details>
    </div>
  );
}

function Events({ base, params, categories, exportable, userId }) {
  const [page, setPage] = useState(1);
  const [cat, setCat] = useState("");
  const ev = useDashboard(`${base}/events`, { ...params, ...(cat ? { category: cat } : {}), page, pageSize: 25 });
  const labelOf = Object.fromEntries(categories.map((c) => [c.key, c.label]));
  const e = ev.data;
  return (
    <Panel id="ev" title="Activity log" sub="Each counted audit event. Names, emails and student identifiers are never shown here."
      actions={<span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label className="sa-field"><span className="ad-sub">Type</span>
          <select className="ad-input" value={cat} onChange={(x) => { setCat(x.target.value); setPage(1); }}>
            <option value="">All types</option>{categories.filter((c) => c.status !== "NOT_APPLICABLE").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        {exportable && <ExportMenu path="/staff-analytics/export" params={{ ...params, kind: "events", userId, ...(cat ? { category: cat } : {}) }} label="Export log" baseName="staff-activity-log" />}
      </span>}>
      {ev.error && !e && <ErrorLine text="The activity log couldn't load." onRetry={ev.reload} />}
      {ev.loading && !e && <Skel h={180} />}
      {e && (
        <div aria-busy={ev.loading}>
          <DataTable caption="Activity log" rows={e.rows} rowKey={(r) => r.id} empty="No counted events in this period."
            columns={[
              { key: "at", header: "When (IST)", render: (r) => fmtDateTime(r.at) },
              { key: "category", header: "Type", render: (r) => labelOf[r.category] || r.category },
              { key: "action", header: "Action", render: (r) => actionLabel(r.action) },
              { key: "details", header: "Detail", render: (r) => <span className="ad-sub">{Object.entries(r.details).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}</span> },
            ]} />
          <Pager page={e.page} pageSize={e.pageSize} total={e.total} onPage={setPage} />
        </div>
      )}
    </Panel>
  );
}

// Admin view of one person (/admin/staff-analytics/:id) and, with `self`, the member's own page (/my-activity).
export default function StaffAnalyticsPerson({ self = false }) {
  const { id } = useParams();
  const [range, setRange] = useState(presetRange(30));
  const base = self ? "/staff-analytics/me" : `/staff-analytics/people/${id}`;
  const det = useDashboard(base, range);
  const d = det.data;
  useEffect(() => { document.title = d ? `${self ? "My activity" : d.profile.name} · CodeArena` : "Activity analytics · CodeArena"; }, [d, self]);
  const points = useMemo(() => (d ? d.series.filter((x) => x.total !== null) : []), [d]);
  const gap = d && d.series.length && d.series[0].total === null ? d.series.find((x) => x.total !== null) : null;
  const w = d?.workload;

  return (
    <>
      <Navbar />
      <main className="ad" id="main-content">
        <div className="ad-stack">
          {!self && (
            <nav aria-label="Breadcrumb" className="ad-sub" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Link to="/admin/staff-analytics" className="ad-link">Staff & clerk analytics</Link><ChevronRight size={14} aria-hidden="true" /><span>{d?.profile.name || "Person"}</span>
            </nav>
          )}
          <PageHeader
            title={self ? "My activity" : d ? d.profile.name : "Activity analytics"}
            scope={d ? [
              { label: "Role", value: d.profile.role === "CLERK" ? "Clerk" : "Staff" },
              { label: "College", value: d.profile.institute?.name },
              { label: "Department", value: d.profile.department },
              { label: "Designation", value: d.profile.designation },
              { label: "Period", value: `${fmtDate(d.range.from)} – ${fmtDate(d.range.to)}` },
              { label: "Calculated", value: fmtDateTime(d.generatedAt) },
            ] : []}
            right={d && <StatusBadge status={d.status} />}
          />
          <Panel id="flt" title="Period"><DateFilters range={range} onChange={setRange} /></Panel>

          {det.error && !d && <ErrorLine text={self ? "Your activity couldn't load." : "This person's analytics couldn't load. They may be outside your college."} onRetry={det.reload} />}
          {det.loading && !d && <FullPageSkeleton />}
          {d && (
            <>
              {self && <p className="ad-sub">This page shows only your own recorded activity. It is built from the audit trail and is not a performance rating.</p>}
              <div className="ad-kpis" style={{ "--ad-kpi-cols": 6 }}>
                <Kpi label="Counted events" value={num(d.totals.events)} foot={d.totals.changePercent === null ? "No earlier period to compare" : <Change value={d.totals.changePercent} />} />
                <Kpi label="Active days" value={`${w.activeDays} of ${w.periodDays}`} foot="Days with a counted event" />
                <Kpi label="Events per active day" value={num(w.eventsPerActiveDay)} foot="Counted events ÷ active days" />
                <Kpi label="Busiest day" value={num(w.peakDayEvents)} foot="Most events in one day" />
                <Kpi label="Students touched" value={num(w.studentsTouched)} foot="Distinct students named on events" />
                <Kpi label="Previous period" value={num(d.totals.previousEvents)} foot={`${fmtDate(presetPrev(d.range).from)} – ${fmtDate(presetPrev(d.range).to)}`} />
              </div>
              {d.status === "TELEMETRY_UNAVAILABLE" && <p className="ad-sub" role="note">None of this role's activity types are recorded by the platform yet, so there is nothing to count. That is missing data, not inactivity.</p>}

              <div className="ad-grid c2">
                <Panel id="trend" title="Activity over time" sub="Counted audit events per day">
                  <SeriesChart points={points} keys={["total"]} labels={["Counted events"]} />
                  {gap && <p className="ad-sub">No data before {fmtDate(gap.day)}: recording had not started, which is not zero activity.</p>}
                </Panel>
                <Panel id="cats" title="By activity type" sub="Expand a type to see the exact actions">
                  <ul className="ad-list">
                    {d.categories.map((c) => (
                      <li key={c.key} className="ad-row" style={{ display: "block" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{c.label}</b><CategoryCell cell={c} /></div>
                        {c.actions.length > 0 && <details><summary className="ad-sub" style={{ cursor: "pointer" }}>Actions</summary><ul className="ad-sub">{c.actions.map((a) => <li key={a.action}>{actionLabel(a.action)}: {a.count}</li>)}</ul></details>}
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>

              <Panel id="ratios" title="Ratios with published formulas" sub="Withheld until there are at least 10 events. These describe patterns of work; they are not a quality grade and there is no combined score.">
                <div className="sa-cmp">{d.ratios.map((r) => <RatioCard key={r.key} r={r} />)}</div>
              </Panel>

              <Panel id="port" title="Portfolio (records created in the period)" sub="From the tests, talent pools and question records themselves. Shown separately and never added to the activity counts above.">
                <div className="ad-kpis" style={{ "--ad-kpi-cols": 6 }}>
                  <Kpi label="Tests created" value={num(d.portfolio.testsCreated)} foot={d.portfolio.testsCreated === null ? "Not applicable to this role" : "Tests still existing"} />
                  <Kpi label="Tests published" value={num(d.portfolio.testsPublished)} foot="Of those, currently published" />
                  <Kpi label="Attempts on those tests" value={num(d.portfolio.attemptsStarted)} foot="All student attempts" />
                  <Kpi label="Attempt completion" value={d.portfolio.attemptCompletionRate.status === "OK" ? `${d.portfolio.attemptCompletionRate.value}%` : "—"} foot={d.portfolio.attemptCompletionRate.status === "OK" ? "Submitted ÷ started" : d.portfolio.attemptCompletionRate.status === "NOT_APPLICABLE" ? "Not applicable" : "Needs 10+ attempts"} />
                  <Kpi label="Talent pools created" value={num(d.portfolio.talentPoolsCreated)} foot="Created by this person" />
                  <Kpi label="Questions authored" value={num(d.portfolio.questionsAuthored)} foot={d.portfolio.questionsAuthored === null ? "Not applicable to this role" : "Created in the period"} />
                </div>
              </Panel>

              <Events base={base} params={range} categories={d.categories} exportable={!self} userId={d.profile.id} />
              {!self && <DefinitionsLoader />}
            </>
          )}
          {d && d.categories.every((c) => c.status === "NOT_APPLICABLE") && <Empty>No activity types apply to this role.</Empty>}
        </div>
      </main>
    </>
  );
}

function presetPrev(range) {
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1;
  const shift = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  return { from: shift(range.from, -days), to: shift(range.from, -1) };
}

// Admin-only: loaded separately so a member's own page never calls an endpoint they are not allowed to use.
function DefinitionsLoader() {
  const meta = useDashboard("/staff-analytics/meta", {});
  return <Definitions meta={meta.data} />;
}
