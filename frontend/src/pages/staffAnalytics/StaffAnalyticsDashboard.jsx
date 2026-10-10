import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api";
import Navbar from "../../components/Navbar";
import {
  useDashboard, PageHeader, Panel, Kpi, DataTable, SeriesChart, Empty, ErrorLine, FullPageSkeleton, Skel, fmt,
} from "../../components/admin/adKit";
import {
  presetRange, fmtDate, fmtDateTime, num, StatusBadge, CategoryCell, Change, ExportMenu, DateFilters, Pager, Definitions,
} from "./staffAnalyticsKit";

const GROUP_LABEL = { institute: "Institute", department: "Department", role: "Role" };

function SortHead({ label, field, sort, dir, onSort, right }) {
  const active = sort === field;
  return (
    <button type="button" className="sa-th-btn" onClick={() => onSort(field)} aria-label={`Sort by ${label}${active ? (dir === "asc" ? ", currently ascending" : ", currently descending") : ""}`} style={right ? { justifyContent: "flex-end", width: "100%" } : undefined}>
      {label}<span aria-hidden="true">{active ? (dir === "asc" ? "▲" : "▼") : ""}</span>
    </button>
  );
}

function ComparePanel({ ids, params, onClose }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  useEffect(() => {
    let live = true;
    setState({ loading: true, error: "", data: null });
    api.get("/staff-analytics/compare", { params: { ...params, ids: ids.join(",") } })
      .then((r) => live && setState({ loading: false, error: "", data: r.data }))
      .catch((e) => live && setState({ loading: false, error: e?.response?.data?.error || "The comparison couldn't load.", data: null }));
    return () => { live = false; };
  }, [ids.join(","), JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps
  const { loading, error, data } = state;
  return (
    <Panel id="cmp" title="Comparison" sub="Same period, same definitions. Different roles do different work, so compare like with like." actions={<button type="button" className="ad-btn ghost sm" onClick={onClose}>Close</button>}>
      {loading && <Skel h={160} />}
      {error && <ErrorLine text={error} />}
      {data && (
        <div className="ad-tablewrap" tabIndex={0} role="region" aria-label="Comparison table">
          <table className="ad-table">
            <thead><tr><th scope="col">Measure</th>{data.people.map((p) => <th key={p.profile.id} scope="col"><Link className="ad-link" to={`/admin/staff-analytics/${p.profile.id}`}>{p.profile.name}</Link><div className="ad-sub">{p.profile.role}</div></th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">Counted events</th>{data.people.map((p) => <td key={p.profile.id} className="ad-num">{num(p.totals.events)} <Change value={p.totals.changePercent} /></td>)}</tr>
              <tr><th scope="row">Active days</th>{data.people.map((p) => <td key={p.profile.id} className="ad-num">{p.workload.activeDays} of {p.workload.periodDays}</td>)}</tr>
              <tr><th scope="row">Events per active day</th>{data.people.map((p) => <td key={p.profile.id} className="ad-num">{num(p.workload.eventsPerActiveDay)}</td>)}</tr>
              {data.categories.map((c) => (
                <tr key={c.key}><th scope="row">{c.label}</th>{data.people.map((p) => <td key={p.profile.id} className="ad-num"><CategoryCell cell={p.categories.find((x) => x.key === c.key)} /></td>)}</tr>
              ))}
              {data.people[0].ratios.map((r, i) => (
                <tr key={r.key}><th scope="row">{r.label}</th>{data.people.map((p) => { const x = p.ratios[i]; return <td key={p.profile.id} className="ad-num">{x.status === "OK" ? `${x.value}%` : x.status === "NOT_APPLICABLE" ? <span className="sa-na">N/A</span> : <span className="sa-muted" title="Fewer events than the minimum sample">Not enough data</span>}</td>; })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default function StaffAnalyticsDashboard() {
  const [range, setRange] = useState(presetRange(30));
  const [instituteId, setInstituteId] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [category, setCategory] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [activity, setActivity] = useState("all");
  const [sort, setSort] = useState("total");
  const [dir, setDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => { document.title = "Staff & clerk analytics · CodeArena"; }, []);
  useEffect(() => { const t = setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [qInput]);

  const meta = useDashboard("/staff-analytics/meta", {});
  const filters = useMemo(() => {
    const f = { from: range.from, to: range.to };
    if (instituteId) f.instituteId = instituteId;
    if (department) f.department = department;
    if (role) f.role = role;
    if (category) f.category = category;
    return f;
  }, [range, instituteId, department, role, category]);
  const sum = useDashboard("/staff-analytics/summary", { ...filters, ...(groupBy ? { groupBy } : {}) });
  const list = useDashboard("/staff-analytics/people", { ...filters, q: q || undefined, activity, sort, dir, page, pageSize: 25 });

  const m = meta.data, s = sum.data, p = list.data;
  const platform = m?.level === "PLATFORM";
  const resetPage = (fn) => (v) => { fn(v); setPage(1); setSelected([]); setComparing(false); };
  const onSort = (field) => { if (sort === field) setDir((d) => (d === "asc" ? "desc" : "asc")); else { setSort(field); setDir(field === "name" ? "asc" : "desc"); } setPage(1); };
  const toggle = (id) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 6 ? cur : [...cur, id]));
  const points = s ? s.series.filter((x) => x.total !== null) : [];
  const leadingGap = s && s.series.length && s.series[0].total === null ? s.series.find((x) => x.total !== null) : null;
  const catCols = m ? m.filters.categories : [];

  const peopleCols = [
    { key: "pick", header: <span className="ad-sub">Compare</span>, render: (r) => <input type="checkbox" aria-label={`Select ${r.name} for comparison`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} disabled={!selected.includes(r.id) && selected.length >= 6} /> },
    { key: "name", header: <SortHead label="Name" field="name" sort={sort} dir={dir} onSort={onSort} />, render: (r) => <div className="sa-name"><Link className="ad-link" to={`/admin/staff-analytics/${r.id}`}>{r.name}</Link><div className="ad-sub">{r.role === "CLERK" ? "Clerk" : "Staff"}{r.designation ? ` · ${r.designation}` : ""}{r.department ? ` · ${r.department}` : ""}</div></div> },
    ...(platform ? [{ key: "institute", header: "Institute", render: (r) => r.institute?.name || <span className="sa-muted">—</span> }] : []),
    { key: "total", header: <SortHead label="Events" field="total" sort={sort} dir={dir} onSort={onSort} right />, right: true, render: (r) => num(r.total) },
    { key: "change", header: <SortHead label="vs previous" field="change" sort={sort} dir={dir} onSort={onSort} right />, right: true, render: (r) => <Change value={r.changePercent} /> },
    { key: "activeDays", header: <SortHead label="Active days" field="activeDays" sort={sort} dir={dir} onSort={onSort} right />, right: true, render: (r) => num(r.activeDays) },
    { key: "eventsPerActiveDay", header: <SortHead label="Per active day" field="eventsPerActiveDay" sort={sort} dir={dir} onSort={onSort} right />, right: true, render: (r) => num(r.eventsPerActiveDay) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    ...catCols.map((c) => ({ key: c.key, header: c.label, right: true, render: (r) => <CategoryCell cell={r.categories[c.key]} compact /> })),
  ];

  const scopeChips = [
    { label: "Level", value: m ? (platform ? "All colleges" : "Your college") : "" },
    { label: "Period", value: `${fmtDate(range.from)} – ${fmtDate(range.to)}` },
    { label: "Latest recorded event", value: s?.latestRecordedEventAt ? fmtDateTime(s.latestRecordedEventAt) : "" },
    { label: "Calculated", value: s?.generatedAt ? fmtDateTime(s.generatedAt) : "" },
  ];

  return (
    <>
      <Navbar />
      <main className="ad" id="main-content">
        <div className="ad-stack">
          <PageHeader title="Staff & clerk analytics" scope={scopeChips} right={<ExportMenu path="/staff-analytics/export" params={{ ...filters, kind: "people", q: q || undefined }} label="Export people" baseName="staff-analytics-people" />} />

          <Panel id="flt" title="Filters">
            <div className="sa-filters">
              <DateFilters range={range} onChange={resetPage(setRange)} />
              {platform && (
                <label className="sa-field"><span>College</span>
                  <select className="ad-input" value={instituteId} onChange={(e) => resetPage(setInstituteId)(e.target.value)}>
                    <option value="">All colleges</option>
                    {m.filters.institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </label>
              )}
              <label className="sa-field"><span>Department</span>
                <select className="ad-input" value={department} onChange={(e) => resetPage(setDepartment)(e.target.value)}>
                  <option value="">All departments</option>
                  {(m?.filters.departments || []).map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <label className="sa-field"><span>Role</span>
                <select className="ad-input" value={role} onChange={(e) => resetPage(setRole)(e.target.value)}>
                  <option value="">Staff and clerks</option><option value="STAFF">Staff</option><option value="CLERK">Clerks</option>
                </select>
              </label>
              <label className="sa-field"><span>Activity type</span>
                <select className="ad-input" value={category} onChange={(e) => resetPage(setCategory)(e.target.value)}>
                  <option value="">All activity</option>
                  {catCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
            </div>
          </Panel>

          {(sum.error || meta.error) && !s && <ErrorLine text="The analytics couldn't load." onRetry={() => { sum.reload(); meta.reload(); list.reload(); }} />}
          {sum.loading && !s && <FullPageSkeleton />}
          {s && (
            <>
              <div className="ad-kpis" style={{ "--ad-kpi-cols": 6 }}>
                <Kpi label="People in scope" value={fmt(s.kpis.people)} foot={s.truncated ? "List capped at 5,000" : "Staff and clerk accounts"} />
                <Kpi label="Active in period" value={fmt(s.kpis.activePeople)} foot="At least one counted event" />
                <Kpi label="No activity recorded" value={fmt(s.kpis.noActivityRecorded)} foot="Tracked work, zero events" />
                <Kpi label="Not tracked" value={fmt(s.kpis.telemetryUnavailable)} foot="No tracked work for the role" />
                <Kpi label="Counted events" value={fmt(s.kpis.totalEvents)} foot={s.kpis.changePercent === null ? "No earlier period to compare" : `${s.kpis.changePercent > 0 ? "+" : ""}${s.kpis.changePercent}% vs previous ${s.range.days} days`} />
                <Kpi label="Events per active person" value={s.kpis.eventsPerActivePerson === null ? "—" : fmt(s.kpis.eventsPerActivePerson)} foot="Counted events ÷ active people" />
              </div>
              <Definitions meta={m} />

              <div className="ad-grid c2">
                <Panel id="trend" title="Activity over time" sub="Counted audit events per day (Asia/Kolkata)">
                  <SeriesChart points={points} keys={["total"]} labels={["Counted events"]} />
                  {leadingGap && <p className="ad-sub">No data is shown before {fmtDate(leadingGap.day)}: the platform had not started recording these activities, which is not the same as zero activity.</p>}
                </Panel>
                <Panel id="cats" title="Activity by type" sub="Where the work happened in this scope">
                  <DataTable caption="Activity by type" rows={s.categories} rowKey={(r) => r.key} empty="No activity types apply."
                    columns={[
                      { key: "label", header: "Type", render: (r) => <b>{r.label}</b> },
                      { key: "count", header: "Events", right: true, render: (r) => <CategoryCell cell={{ status: r.status, count: r.count, trackedSince: r.trackedSince }} /> },
                      { key: "status", header: "Recording", render: (r) => (r.status === "TRACKED" ? <span className="ad-badge good">Recorded</span> : r.status === "PARTIAL" ? <span className="ad-badge warn">From {fmtDate(String(r.trackedSince).slice(0, 10))}</span> : <span className="ad-badge mute">Not recorded</span>) },
                    ]} />
                </Panel>
              </div>

              <Panel id="grp" title={`By ${GROUP_LABEL[s.groupBy].toLowerCase()}`} sub="Events and people who acted. Compare groups of similar size and role mix."
                actions={<span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                  <label className="sa-field"><span className="ad-sub">Group by</span>
                    <select className="ad-input" value={s.groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                      {platform && <option value="institute">College</option>}<option value="department">Department</option><option value="role">Role</option>
                    </select>
                  </label>
                  <ExportMenu path="/staff-analytics/export" params={{ ...filters, kind: "summary", groupBy: s.groupBy }} label="Export" baseName="staff-analytics-summary" />
                </span>}>
                <DataTable caption="Activity by group" rows={s.groups} rowKey={(r) => r.key} empty="No recorded activity in this period for these filters."
                  columns={[
                    { key: "label", header: GROUP_LABEL[s.groupBy], render: (r) => <b>{r.label}</b> },
                    { key: "people", header: "People who acted", right: true, render: (r) => num(r.people) },
                    { key: "events", header: "Events", right: true, render: (r) => num(r.events) },
                    { key: "eventsPerPerson", header: "Per person", right: true, render: (r) => num(r.eventsPerPerson) },
                  ]} />
              </Panel>
            </>
          )}

          <Panel id="ppl" title="People" sub="Select two to six people to compare. Counts exclude work that does not apply to a role." actions={selected.length >= 2 ? <button type="button" className="ad-btn sm" onClick={() => setComparing(true)}>Compare {selected.length} selected</button> : undefined}>
            <div className="sa-filters" style={{ marginBottom: 10 }}>
              <label className="sa-field" style={{ flex: "1 1 220px" }}><span>Search</span><input className="ad-input" type="search" placeholder="Name or employee ID" value={qInput} onChange={(e) => setQInput(e.target.value)} /></label>
              <label className="sa-field"><span>Show</span>
                <select className="ad-input" value={activity} onChange={(e) => resetPage(setActivity)(e.target.value)}>
                  <option value="all">Everyone</option><option value="active">Active</option><option value="inactive">No activity recorded</option><option value="unavailable">Not tracked for the role</option>
                </select>
              </label>
            </div>
            {list.error && !p && <ErrorLine text="The people list couldn't load." onRetry={list.reload} />}
            {list.loading && !p && <Skel h={220} />}
            {p && (
              <div aria-busy={list.loading}>
                <DataTable caption="Staff and clerk activity" rows={p.rows} rowKey={(r) => r.id} empty="No staff or clerk accounts match these filters." columns={peopleCols} />
                <Pager page={p.page} pageSize={p.pageSize} total={p.total} onPage={(n) => setPage(n)} />
                <p className="ad-sub">* partial: recording of that activity began part-way through the period. N/A: the work does not apply to the role. Not tracked: never recorded.</p>
              </div>
            )}
          </Panel>

          {comparing && selected.length >= 2 && <ComparePanel ids={selected} params={filters} onClose={() => setComparing(false)} />}
          {!platform && m && <p className="ad-sub">Showing your college only.</p>}
          {m && !meta.error && sum.data && s.kpis.people === 0 && <Empty>No staff or clerk accounts exist for these filters.</Empty>}
        </div>
      </main>
    </>
  );
}
