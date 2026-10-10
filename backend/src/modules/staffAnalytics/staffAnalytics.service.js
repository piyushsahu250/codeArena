// Staff / Clerk analytics rules: who may see what, how the numbers are assembled, what is audited. No req/res here.
//
// Access model (decided on the server from the authenticated user, never from query input):
//   * SUPER_ADMIN and platform-level ADMIN (no institute): every institute, optional instituteId filter.
//   * INSTITUTE_ADMIN and institute-bound ADMIN: their own institute only; asking for another institute is refused.
//   * STAFF / CLERK: only their own record (the /me routes); never a peer's, never a ranking.
// A person outside the requester's scope is reported as "not found" (404), so the existence of other institutes' staff is not revealed.
const { ServiceError } = require("../../utils/serviceError");
const { logAudit } = require("../../utils/auditLog");
const d = require("./staffAnalytics.domain");
const repo = require("./staffAnalytics.repository");

const MAX_COMPARE = 6;
const MAX_EXPORT_ROWS = 20000;
const SORT_FIELDS = ["name", "total", "activeDays", "eventsPerActiveDay", "lastLoginAt", "change"];

const pct = (n, base) => (base > 0 ? Math.round(((n - base) / base) * 1000) / 10 : null);
const actorOf = (user, requesterInstituteId, req) => ({ id: user.id, name: user.name, role: user.role, instituteId: requesterInstituteId || null, req });

// ---------- scope ----------
function scopeFor(actor, filters = {}) {
  const roles = d.STAFF_ROLES.includes(filters.role) ? [filters.role] : d.STAFF_ROLES;
  let instituteId;
  if (actor.instituteId) {
    if (filters.instituteId && filters.instituteId !== actor.instituteId) throw new ServiceError(403, "You can only view analytics for your own institute");
    instituteId = actor.instituteId;
  } else if (filters.instituteId) {
    instituteId = String(filters.instituteId);
  }
  const department = filters.department ? String(filters.department).slice(0, 100) : undefined;
  return { roles, instituteId, department };
}

function rangeOf(query) {
  const r = d.parseRange({ from: query.from, to: query.to });
  if (r.error) throw new ServiceError(400, r.error);
  return r;
}

function categoriesOf(query) {
  const raw = query.category ? String(query.category).split(",").filter(Boolean) : [];
  for (const c of raw) if (!d.CATEGORY_BY_KEY[c]) throw new ServiceError(400, `Unknown category "${c}"`);
  return raw;
}

async function loadPerson(actor, id) {
  const p = await repo.person(String(id));
  if (!p || !d.STAFF_ROLES.includes(p.role)) throw new ServiceError(404, "Staff or clerk account not found");
  if (actor.instituteId && p.instituteId !== actor.instituteId) throw new ServiceError(404, "Staff or clerk account not found");
  return p;
}

function publicProfile(p, { includeEmployeeId }) {
  return {
    id: p.id, name: p.name, role: p.role, department: p.department || null, designation: p.designation || null,
    institute: p.institute ? { id: p.institute.id, name: p.institute.name } : null,
    employeeId: includeEmployeeId ? p.employeeId || null : undefined,
    accountStatus: p.accountStatus, lastLoginAt: p.lastLoginAt || null, joinedAt: p.createdAt,
  };
}

// ---------- assembly ----------
function countsMap(rows) {
  const out = {};
  for (const r of rows) { (out[r.userId] = out[r.userId] || {})[r.action] = r.n; }
  return out;
}

function activityStatus(cells, total) {
  const trackedAny = Object.values(cells).some((c) => c.status === "TRACKED" || c.status === "PARTIAL");
  if (!trackedAny) return "TELEMETRY_UNAVAILABLE";
  return total > 0 ? "ACTIVE" : "NO_ACTIVITY_RECORDED";
}

// One entry per person in scope: cells, totals, workload, previous-period total.
async function peopleMetrics(scope, range, actions, { q } = {}) {
  const prev = d.previousRange(range);
  const [people, cov, rows, load, prevRows] = await Promise.all([
    repo.directory(scope, q),
    repo.coverage(),
    repo.countsByPersonAction(scope, range.start, range.endExclusive, actions),
    repo.workloadByPerson(scope, range.start, range.endExclusive, actions),
    repo.countsByPersonAction(scope, prev.start, prev.endExclusive, actions),
  ]);
  const counts = countsMap(rows);
  const prevCounts = countsMap(prevRows);
  const loadBy = Object.fromEntries(load.map((l) => [l.userId, l]));
  const list = people.map((p) => {
    const c = counts[p.id] || {};
    const cells = d.categoryCells(c, p.role, cov, range.start);
    const total = d.totalOf(cells);
    const w = loadBy[p.id];
    const prevTotal = Object.values(prevCounts[p.id] || {}).reduce((t, n) => t + n, 0);
    return {
      person: p, counts: c, cells, total, prevTotal,
      activeDays: w ? w.activeDays : 0,
      eventsPerActiveDay: w && w.activeDays ? Math.round((w.total / w.activeDays) * 10) / 10 : null,
      peakDayEvents: w ? w.peakDayEvents : 0,
      studentsTouched: w ? w.studentsTouched : 0,
      status: activityStatus(cells, total),
    };
  });
  return { list, coverage: cov, truncated: people.length >= repo.DIRECTORY_CAP };
}

function seriesFor(rows, range, cov) {
  const earliest = Object.values(cov).map((c) => c.firstAt).filter(Boolean).map((x) => new Date(x).getTime());
  const firstTracked = earliest.length ? d.ymdOf(new Date(Math.min(...earliest))) : null;
  const byDay = {};
  for (const r of rows) {
    const cat = d.CATEGORY_OF_ACTION[r.action];
    const slot = (byDay[r.day] = byDay[r.day] || { total: 0 });
    slot.total += r.n;
    slot[cat] = (slot[cat] || 0) + r.n;
  }
  return d.enumerateDays(range).map((day) => {
    // Before the platform ever recorded these actions, a day is "no data", not zero.
    if (!firstTracked || day < firstTracked) return { day, total: null };
    return { day, ...(byDay[day] || { total: 0 }) };
  });
}

function categoryTotals(list, cov, range, roles) {
  return d.CATEGORIES.filter((c) => c.roles.some((r) => roles.includes(r))).map((c) => {
    const firsts = c.actions.map((a) => cov[a] && cov[a].firstAt).filter(Boolean).map((x) => new Date(x).getTime());
    const status = firsts.length === 0 ? "NOT_TRACKED" : Math.min(...firsts) > range.start.getTime() ? "PARTIAL" : "TRACKED";
    const count = status === "NOT_TRACKED" ? null : list.reduce((t, p) => t + ((p.cells[c.category] && p.cells[c.category].count) || 0), 0);
    return { key: c.category, label: c.label, status, count, trackedSince: firsts.length ? new Date(Math.min(...firsts)).toISOString() : null };
  });
}

async function levelInfo(actor) {
  return { level: actor.instituteId ? "INSTITUTE" : "PLATFORM", instituteId: actor.instituteId };
}

// ---------- public API ----------
async function meta(actor) {
  const scope = scopeFor(actor);
  const [cov, institutes, departments] = await Promise.all([repo.coverage(), repo.institutes(scope), repo.departments(scope)]);
  const lasts = Object.values(cov).map((c) => c.lastAt).filter(Boolean).map((x) => new Date(x).getTime());
  return {
    ...(await levelInfo(actor)),
    definitions: d.definitions(),
    filters: { institutes, departments, roles: d.STAFF_ROLES, categories: d.CATEGORIES.map((c) => ({ key: c.category, label: c.label })) },
    telemetry: d.CATEGORIES.map((c) => {
      const firsts = c.actions.map((a) => cov[a] && cov[a].firstAt).filter(Boolean).map((x) => new Date(x).getTime());
      return { key: c.category, label: c.label, trackedSince: firsts.length ? new Date(Math.min(...firsts)).toISOString() : null, tracked: firsts.length > 0 };
    }),
    latestRecordedEventAt: lasts.length ? new Date(Math.max(...lasts)).toISOString() : null,
    generatedAt: new Date().toISOString(),
  };
}

async function summary(actor, query) {
  const scope = scopeFor(actor, query);
  const range = rangeOf(query);
  const cats = categoriesOf(query);
  const actions = d.actionsFor(cats);
  const groupBy = ["institute", "department", "role"].includes(query.groupBy) ? query.groupBy : (actor.instituteId ? "department" : "institute");
  const [metrics, seriesRows, groupRows, groupPeople, institutes] = await Promise.all([
    peopleMetrics(scope, range, actions),
    repo.seriesByDayAction(scope, range.start, range.endExclusive, actions),
    repo.countsByGroupAction(scope, range.start, range.endExclusive, actions, groupBy),
    repo.peopleByGroup(scope, range.start, range.endExclusive, actions, groupBy),
    repo.institutes(scope),
  ]);
  const { list, coverage } = metrics;
  const totalPeople = list.length;
  const active = list.filter((p) => p.total > 0).length;
  const total = list.reduce((t, p) => t + p.total, 0);
  const prevTotal = list.reduce((t, p) => t + p.prevTotal, 0);
  const instituteName = Object.fromEntries(institutes.map((i) => [i.id, i.name]));

  const groups = {};
  for (const r of groupRows) { const g = (groups[r.groupKey || "—"] = groups[r.groupKey || "—"] || { total: 0, byCategory: {} }); g.total += r.n; const cat = d.CATEGORY_OF_ACTION[r.action]; g.byCategory[cat] = (g.byCategory[cat] || 0) + r.n; }
  const peopleIn = Object.fromEntries(groupPeople.map((r) => [r.groupKey || "—", r.people]));
  const groupList = Object.entries(groups).map(([key, g]) => ({
    key, label: groupBy === "institute" ? instituteName[key] || "Unknown institute" : key, events: g.total, people: peopleIn[key] || 0,
    eventsPerPerson: peopleIn[key] ? Math.round((g.total / peopleIn[key]) * 10) / 10 : null, byCategory: g.byCategory,
  })).sort((a, b) => b.events - a.events);

  const withTelemetry = list.filter((p) => p.status !== "TELEMETRY_UNAVAILABLE");
  const lasts = Object.values(coverage).map((c) => c.lastAt).filter(Boolean).map((x) => new Date(x).getTime());
  return {
    ...(await levelInfo(actor)),
    range: { from: range.from, to: range.to, days: range.days },
    filters: { instituteId: scope.instituteId || null, department: scope.department || null, role: query.role || null, categories: cats },
    kpis: {
      people: totalPeople, activePeople: active, noActivityRecorded: withTelemetry.length - active, telemetryUnavailable: totalPeople - withTelemetry.length,
      totalEvents: total, previousTotalEvents: prevTotal, changePercent: pct(total, prevTotal),
      eventsPerActivePerson: active ? Math.round((total / active) * 10) / 10 : null,
    },
    categories: categoryTotals(list, coverage, range, scope.roles),
    series: seriesFor(seriesRows, range, coverage),
    groupBy, groups: groupList,
    truncated: metrics.truncated,
    latestRecordedEventAt: lasts.length ? new Date(Math.max(...lasts)).toISOString() : null,
    generatedAt: new Date().toISOString(),
  };
}

async function people(actor, query, pg) {
  const scope = scopeFor(actor, query);
  const range = rangeOf(query);
  const actions = d.actionsFor(categoriesOf(query));
  const q = query.q ? String(query.q).trim().slice(0, 80) : undefined;
  const { list, truncated } = await peopleMetrics(scope, range, actions, { q });
  const filter = ["active", "inactive", "unavailable"].includes(query.activity) ? query.activity : "all";
  let rows = list.filter((p) => filter === "all" || (filter === "active" && p.status === "ACTIVE") || (filter === "inactive" && p.status === "NO_ACTIVITY_RECORDED") || (filter === "unavailable" && p.status === "TELEMETRY_UNAVAILABLE"));
  const sort = SORT_FIELDS.includes(query.sort) ? query.sort : "total";
  const dir = query.dir === "asc" ? 1 : -1;
  const keyOf = (p) => (sort === "name" ? p.person.name.toLowerCase() : sort === "lastLoginAt" ? (p.person.lastLoginAt ? new Date(p.person.lastLoginAt).getTime() : -1) : sort === "change" ? (pct(p.total, p.prevTotal) ?? -Infinity) : p[sort] ?? -1);
  rows = [...rows].sort((a, b) => { const x = keyOf(a), y = keyOf(b); return (x < y ? -1 : x > y ? 1 : a.person.name.localeCompare(b.person.name)) * dir; });
  const pageRows = rows.slice(pg.skip, pg.skip + pg.pageSize).map((p) => ({
    ...publicProfile(p.person, { includeEmployeeId: true }), total: p.total, previousTotal: p.prevTotal, changePercent: pct(p.total, p.prevTotal),
    activeDays: p.activeDays, eventsPerActiveDay: p.eventsPerActiveDay, status: p.status, categories: p.cells,
  }));
  return { range: { from: range.from, to: range.to, days: range.days }, page: pg.page, pageSize: pg.pageSize, total: rows.length, rows: pageRows, truncated, generatedAt: new Date().toISOString() };
}

async function detailFor(actor, person, query, { includeEmployeeId }) {
  const range = rangeOf(query);
  const actions = d.ALL_ACTIONS;
  const scope = { roles: [person.role], instituteId: person.instituteId || undefined, userId: person.id };
  const prev = d.previousRange(range);
  const [cov, rows, load, series, prevRows, port] = await Promise.all([
    repo.coverage(),
    repo.countsByPersonAction(scope, range.start, range.endExclusive, actions),
    repo.workloadByPerson(scope, range.start, range.endExclusive, actions),
    repo.seriesByDayAction(scope, range.start, range.endExclusive, actions),
    repo.countsByPersonAction(scope, prev.start, prev.endExclusive, actions),
    repo.portfolio([person.id], range.start, range.endExclusive),
  ]);
  const counts = countsMap(rows)[person.id] || {};
  const cells = d.categoryCells(counts, person.role, cov, range.start);
  const total = d.totalOf(cells);
  const prevTotal = Object.values(countsMap(prevRows)[person.id] || {}).reduce((t, n) => t + n, 0);
  const w = load[0];
  const p = port[person.id] || { testsCreated: 0, testsPublished: 0, attemptsStarted: 0, attemptsCompleted: 0, talentPoolsCreated: 0, questionsAuthored: 0 };
  const completion = p.attemptsStarted >= d.MIN_SAMPLE
    ? { value: Math.round((p.attemptsCompleted / p.attemptsStarted) * 1000) / 10, status: "OK" }
    : { value: null, status: "INSUFFICIENT_DATA" };
  const roleApplies = (cat) => d.CATEGORY_BY_KEY[cat].roles.includes(person.role);
  return {
    profile: publicProfile(person, { includeEmployeeId }),
    range: { from: range.from, to: range.to, days: range.days },
    status: activityStatus(cells, total),
    totals: { events: total, previousEvents: prevTotal, changePercent: pct(total, prevTotal) },
    categories: d.CATEGORIES.map((c) => ({
      key: c.category, label: c.label, ...cells[c.category],
      actions: cells[c.category].status === "NOT_APPLICABLE" ? [] : c.actions.map((a) => ({ action: a, count: counts[a] || 0 })).filter((x) => x.count > 0),
    })),
    ratios: d.evaluateRatios(counts, person.role),
    workload: {
      activeDays: w ? w.activeDays : 0, periodDays: range.days,
      eventsPerActiveDay: w && w.activeDays ? Math.round((w.total / w.activeDays) * 10) / 10 : null,
      peakDayEvents: w ? w.peakDayEvents : 0, studentsTouched: w ? w.studentsTouched : 0,
    },
    series: seriesFor(series, range, cov),
    portfolio: {
      testsCreated: roleApplies("TEST_MANAGEMENT") ? p.testsCreated : null,
      testsPublished: roleApplies("TEST_MANAGEMENT") ? p.testsPublished : null,
      attemptsStarted: roleApplies("TEST_MANAGEMENT") ? p.attemptsStarted : null,
      attemptCompletionRate: roleApplies("TEST_MANAGEMENT") ? completion : { value: null, status: "NOT_APPLICABLE" },
      talentPoolsCreated: p.talentPoolsCreated,
      questionsAuthored: roleApplies("QUESTION_BANK") ? p.questionsAuthored : null,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function personDetail(actor, id, query) {
  const person = await loadPerson(actor, id);
  const detail = await detailFor(actor, person, query, { includeEmployeeId: true });
  await logAudit({ req: actor.req, action: "STAFF_ANALYTICS_VIEWED", actorId: actor.id, actorName: actor.name, actorRole: actor.role, instituteId: person.instituteId, details: { view: "person", subjectId: person.id, subjectRole: person.role, from: detail.range.from, to: detail.range.to } });
  return detail;
}

async function me(actor, query) {
  const person = await loadPerson({ ...actor, instituteId: null }, actor.id); // own record; the role check still applies
  if (!d.STAFF_ROLES.includes(actor.role)) throw new ServiceError(403, "Only staff and clerk accounts have a personal activity view");
  return detailFor(actor, person, query, { includeEmployeeId: true });
}

async function personEvents(actor, id, query, pg, { self = false } = {}) {
  const person = self ? await loadPerson({ ...actor, instituteId: null }, actor.id) : await loadPerson(actor, id);
  const range = rangeOf(query);
  const cats = categoriesOf(query);
  const { rows, total } = await repo.events(person.id, range.start, range.endExclusive, d.actionsFor(cats), pg.skip, pg.pageSize);
  if (!self) await logAudit({ req: actor.req, action: "STAFF_ANALYTICS_VIEWED", actorId: actor.id, actorName: actor.name, actorRole: actor.role, instituteId: person.instituteId, details: { view: "events", subjectId: person.id, subjectRole: person.role, from: range.from, to: range.to, page: pg.page } });
  return {
    profile: { id: person.id, name: person.name, role: person.role }, range: { from: range.from, to: range.to, days: range.days }, page: pg.page, pageSize: pg.pageSize, total,
    rows: rows.map((r) => ({ id: r.id, at: r.createdAt, action: r.action, category: d.CATEGORY_OF_ACTION[r.action] || null, details: d.redactDetails(r.details) })),
    note: "Names, emails and student identifiers are not shown in event details.",
  };
}

async function compare(actor, idsRaw, query) {
  const ids = [...new Set(String(idsRaw || "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length < 2) throw new ServiceError(400, "Choose at least two people to compare");
  if (ids.length > MAX_COMPARE) throw new ServiceError(400, `You can compare at most ${MAX_COMPARE} people at once`);
  const out = [];
  for (const id of ids) {
    const person = await loadPerson(actor, id);
    const det = await detailFor(actor, person, query, { includeEmployeeId: false });
    out.push({ profile: det.profile, status: det.status, totals: det.totals, categories: det.categories.map((c) => ({ key: c.key, label: c.label, status: c.status, count: c.count })), workload: det.workload, ratios: det.ratios.map((r) => ({ key: r.key, label: r.label, value: r.value, status: r.status })) });
  }
  const first = out[0];
  await logAudit({ req: actor.req, action: "STAFF_ANALYTICS_VIEWED", actorId: actor.id, actorName: actor.name, actorRole: actor.role, instituteId: actor.instituteId, details: { view: "compare", count: out.length, from: query.from || null, to: query.to || null } });
  const r = rangeOf(query);
  return { range: { from: r.from, to: r.to, days: r.days }, people: out, categories: first.categories.map((c) => ({ key: c.key, label: c.label })) };
}

// ---------- exports ----------
const CAT_COLUMN = (c) => `${c.label}`;
function cellText(c) { return c.status === "NOT_APPLICABLE" ? "N/A" : c.status === "NOT_TRACKED" ? "Not tracked" : c.status === "PARTIAL" ? `${c.count} (partial: tracked since ${String(c.trackedSince || "").slice(0, 10)})` : c.count; }

async function exportData(actor, query) {
  const range = rangeOf(query);
  const kind = ["people", "summary", "events"].includes(query.kind) ? query.kind : "people";
  const stamp = new Date().toISOString().slice(0, 10);
  let rows = []; let title; let entity;
  if (kind === "events") {
    if (!query.userId) throw new ServiceError(400, "userId is required for an events export");
    const person = await loadPerson(actor, query.userId);
    const { rows: ev } = await repo.events(person.id, range.start, range.endExclusive, d.actionsFor(categoriesOf(query)), 0, MAX_EXPORT_ROWS);
    rows = ev.map((r) => ({ "Date/time (IST)": new Date(r.createdAt).toLocaleString("en-GB", { timeZone: d.TZ }), Category: (d.CATEGORY_BY_KEY[d.CATEGORY_OF_ACTION[r.action]] || {}).label || "", Action: r.action, Detail: Object.entries(d.redactDetails(r.details)).map(([k, v]) => `${k}: ${v}`).join("; ") }));
    title = `Activity log: ${person.name}`; entity = `events:${person.id}`;
  } else if (kind === "summary") {
    const s = await summary(actor, query);
    rows = s.groups.map((g) => ({ [s.groupBy[0].toUpperCase() + s.groupBy.slice(1)]: g.label, People: g.people, Events: g.events, "Events per person": g.eventsPerPerson ?? "" }));
    title = `Staff and clerk activity by ${s.groupBy}`; entity = `summary:${s.groupBy}`;
  } else {
    const scope = scopeFor(actor, query);
    const { list } = await peopleMetrics(scope, range, d.actionsFor(categoriesOf(query)), { q: query.q ? String(query.q).slice(0, 80) : undefined });
    rows = list.sort((a, b) => b.total - a.total || a.person.name.localeCompare(b.person.name)).slice(0, MAX_EXPORT_ROWS).map((p) => {
      const row = { Name: p.person.name, Role: p.person.role, Institute: p.person.institute ? p.person.institute.name : "", Department: p.person.department || "", Designation: p.person.designation || "", "Employee ID": p.person.employeeId || "", "Counted events": p.total, "Previous period": p.prevTotal, "Active days": p.activeDays, "Events per active day": p.eventsPerActiveDay ?? "", Status: p.status.replace(/_/g, " ").toLowerCase() };
      for (const c of d.CATEGORIES) row[CAT_COLUMN(c)] = cellText(p.cells[c.category]);
      return row;
    });
    title = "Staff and clerk activity"; entity = "people";
  }
  await logAudit({ req: actor.req, action: "STAFF_ANALYTICS_EXPORTED", actorId: actor.id, actorName: actor.name, actorRole: actor.role, instituteId: actor.instituteId, details: { entity, kind, format: String(query.format || "csv"), rows: rows.length, from: range.from, to: range.to, instituteFilter: query.instituteId || null } });
  const meta = [`Period: ${range.from} to ${range.to} (Asia/Kolkata)`, `Generated: ${new Date().toISOString()}`, "Counts come from the audit trail only. N/A = does not apply to the role; Not tracked = never recorded; Partial = recording began mid-period."];
  return { rows, title, meta, filenameBase: `codearena-staff-analytics-${kind}-${range.from}_${range.to}-${stamp}` };
}

module.exports = { actorOf, scopeFor, meta, summary, people, personDetail, personEvents, me, compare, exportData, MAX_COMPARE, MAX_EXPORT_ROWS };
