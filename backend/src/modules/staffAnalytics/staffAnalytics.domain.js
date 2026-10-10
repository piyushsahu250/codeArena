// Pure rules for Staff / Clerk performance analytics: the activity catalogue, metric definitions, date ranges and privacy redaction.
// No database access here, so every formula is unit-testable and the definitions shown in the UI come from the same objects the calculations use.
//
// Principles (they are also shown to users in the UI):
//  * Every activity count comes from ONE source, the audit trail (AuditLog rows written when the action happened). Each audit action belongs to exactly
//    one category, so nothing is counted twice. Rows in operational tables (tests, pools, questions) are shown separately as "portfolio" figures and are
//    never added to the activity counts.
//  * Missing telemetry is not zero. A category that this platform has never recorded is NOT_TRACKED; one whose recording began after the period started is
//    PARTIAL; a category that does not apply to the person's role is NOT_APPLICABLE. Only a tracked category with no events is a genuine zero.
//  * There is no composite "performance score". Ratios have a published formula and are withheld below a minimum sample (MIN_SAMPLE).

const MIN_SAMPLE = 10;
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const STAFF_ROLES = ["STAFF", "CLERK"];
const TZ = "Asia/Kolkata";

const A = (category, label, actions, roles) => ({ category, label, actions, roles });

// category key -> definition. `roles` = roles that can perform the work at all (others get NOT_APPLICABLE, never a fake zero).
const CATEGORIES = [
  A("TEST_MANAGEMENT", "Test creation & scheduling", ["TEST_CREATED", "TEST_UPDATED", "TEST_PUBLISHED", "TEST_UNPUBLISHED", "TEST_DUPLICATED", "TEST_DELETED", "TEST_ASSIGNED", "READINESS_TEST_ASSIGNED"], ["STAFF"]),
  A("TEST_CONDUCT", "Test conduct support", ["TEST_NOTIFICATION_SENT", "REATTEMPT_GRANTED"], ["STAFF"]),
  A("QUESTION_BANK", "Question bank", ["QUESTION_CREATED", "QUESTION_UPDATED", "QUESTION_DELETED", "QUESTION_IMPORTED", "QUESTION_EXPORTED", "QUESTION_BANK_CHANGED", "QUESTION_BANK_SHARED"], ["STAFF"]),
  A("TALENT_POOL", "Talent Pool management", ["TALENT_POOL_CREATED", "TALENT_POOL_UPDATED", "TALENT_POOL_DELETED", "TALENT_POOL_MEMBERS_CHANGED", "TALENT_POOL_ASSESSMENT_ASSIGNED", "TALENT_POOL_ATTENDANCE_OWNER_ASSIGNED", "TALENT_POOL_ATTENDANCE_OWNER_REMOVED", "TALENT_POOL_BULK_IMPORT", "TALENT_POOL_MEMBERS_TRANSFERRED"], ["STAFF", "CLERK"]),
  A("RESULTS_PROCESSING", "Results processing", ["RESULT_MODIFIED", "RESULT_EXAMINATION_CREATED", "RESULT_EXAMINATION_EDITED", "RESULT_EXAMINATION_PUBLISHED", "RESULT_EXAMINATION_UNPUBLISHED", "RESULT_EXAMINATION_DELETED", "RESULT_EXAMINATION_ARCHIVED", "RESULT_EXAMINATION_SUBMITTED_FOR_REVIEW", "RESULT_EXAMINATION_MARKED_READY", "RESULT_EXAMINATION_SENT_BACK_TO_DRAFT", "RESULT_ENTRIES_BULK_IMPORTED", "RESULT_ENTRY_CREATED", "RESULT_ENTRY_EDITED", "RESULT_ENTRY_DELETED", "RESULT_ENTRY_CORRECTED", "RESULT_GRADE_SCALE_UPDATED", "RESULT_MARKS_FROZEN", "RESULT_MARKS_UNFROZEN", "RESULT_REMARK_BANDS_UPDATED", "RESULT_TALENT_POOLS_ASSIGNED", "RESULT_EXPORTED"], ["STAFF", "CLERK"]),
  A("ATTENDANCE", "Attendance", ["ATTENDANCE_MARKED"], ["STAFF"]),
  A("PLACEMENT_OPERATIONS", "Placement operations", ["PLACEMENT_OFFER_VERIFIED", "PLACEMENT_ELIGIBILITY_CHANGED", "DOCUMENT_VERIFIED", "DOCUMENT_UPLOADED", "DOCUMENT_UPDATED", "DOCUMENT_DELETED", "COMPANY_MASTER_CHANGED", "CERTIFICATE_ISSUED", "CERTIFICATE_REVOKED"], ["STAFF", "CLERK"]),
  A("LEARNING_CONTENT", "Learning content", ["COURSE_MANAGEMENT_CHANGED", "CONTENT_VERSION_CREATED", "CONTENT_VERSION_PUBLISHED", "CONTENT_VERSION_RESTORED"], ["STAFF"]),
  A("DATA_EXPORTS", "Data exports", ["DATA_EXPORTED"], ["STAFF", "CLERK"]),
];

const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.category, c]));
const CATEGORY_OF_ACTION = {};
for (const c of CATEGORIES) for (const a of c.actions) {
  if (CATEGORY_OF_ACTION[a]) throw new Error(`audit action ${a} is in two categories (${CATEGORY_OF_ACTION[a]}, ${c.category}): would double count`);
  CATEGORY_OF_ACTION[a] = c.category;
}
const ALL_ACTIONS = Object.keys(CATEGORY_OF_ACTION);

function actionsFor(categoryKeys) {
  const keys = categoryKeys && categoryKeys.length ? categoryKeys : CATEGORIES.map((c) => c.category);
  return keys.flatMap((k) => (CATEGORY_BY_KEY[k] ? CATEGORY_BY_KEY[k].actions : []));
}

// ---------- ratios (published formulas) ----------
const sum = (counts, actions) => actions.reduce((t, a) => t + (counts[a] || 0), 0);

const RATIOS = [
  {
    key: "TEST_REWORK_SHARE", label: "Test rework share", category: "TEST_MANAGEMENT",
    formula: "(TEST_UPDATED + TEST_UNPUBLISHED + TEST_DELETED) ÷ all test-management events",
    meaning: "How much of a person's test-management work changed or withdrew an existing test. A neutral workload indicator, not a quality grade: editing a published test is often legitimate.",
    compute: (c) => ({ numerator: sum(c, ["TEST_UPDATED", "TEST_UNPUBLISHED", "TEST_DELETED"]), denominator: sum(c, CATEGORY_BY_KEY.TEST_MANAGEMENT.actions) }),
  },
  {
    key: "RESULT_CORRECTION_SHARE", label: "Result correction share", category: "RESULTS_PROCESSING",
    formula: "(RESULT_ENTRY_EDITED + RESULT_ENTRY_CORRECTED) ÷ (RESULT_ENTRY_CREATED + RESULT_ENTRIES_BULK_IMPORTED + RESULT_ENTRY_EDITED + RESULT_ENTRY_CORRECTED)",
    meaning: "Share of result-entry actions that revised an earlier entry. A bulk import counts as one event however many rows it holds, so read this as a pattern, not a per-student error rate.",
    compute: (c) => ({ numerator: sum(c, ["RESULT_ENTRY_EDITED", "RESULT_ENTRY_CORRECTED"]), denominator: sum(c, ["RESULT_ENTRY_CREATED", "RESULT_ENTRIES_BULK_IMPORTED", "RESULT_ENTRY_EDITED", "RESULT_ENTRY_CORRECTED"]) }),
  },
];

// Returns { key, label, formula, meaning, value, numerator, denominator, status } where status is OK | INSUFFICIENT_DATA | NOT_APPLICABLE.
function evaluateRatios(counts, role) {
  return RATIOS.map((r) => {
    const base = { key: r.key, label: r.label, formula: r.formula, meaning: r.meaning };
    if (!CATEGORY_BY_KEY[r.category].roles.includes(role)) return { ...base, value: null, numerator: null, denominator: null, status: "NOT_APPLICABLE" };
    const { numerator, denominator } = r.compute(counts);
    if (denominator < MIN_SAMPLE) return { ...base, value: null, numerator, denominator, status: "INSUFFICIENT_DATA" };
    return { ...base, value: Math.round((numerator / denominator) * 1000) / 10, numerator, denominator, status: "OK" };
  });
}

// ---------- category cells: real zero vs missing telemetry ----------
// coverage: { [action]: { firstAt: Date|null } } across the whole platform (when did the platform first record this action?)
// Returns for one person: { [category]: { status, count } } with status TRACKED | PARTIAL | NOT_TRACKED | NOT_APPLICABLE; count is null unless TRACKED/PARTIAL.
function categoryCells(counts, role, coverage, rangeFrom) {
  const cells = {};
  for (const c of CATEGORIES) {
    if (!c.roles.includes(role)) { cells[c.category] = { status: "NOT_APPLICABLE", count: null }; continue; }
    const firsts = c.actions.map((a) => coverage[a] && coverage[a].firstAt).filter(Boolean).map((d) => new Date(d).getTime());
    if (firsts.length === 0) { cells[c.category] = { status: "NOT_TRACKED", count: null }; continue; }
    const earliest = Math.min(...firsts);
    const count = sum(counts, c.actions);
    cells[c.category] = { status: earliest > rangeFrom.getTime() ? "PARTIAL" : "TRACKED", count, trackedSince: new Date(earliest).toISOString() };
  }
  return cells;
}

function totalOf(cells) {
  let t = 0;
  for (const v of Object.values(cells)) if (v.count !== null && v.count !== undefined) t += v.count;
  return t;
}

// ---------- date ranges ----------
// from/to are calendar dates (YYYY-MM-DD) in the platform's local time (Asia/Kolkata); `to` is inclusive. Returned as UTC instants [from, toExclusive).
const IST_OFFSET_MIN = 330;
function istDayStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MIN * 60000);
}
const ymdOf = (date) => new Date(date.getTime() + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

function parseRange({ from, to }, now = new Date()) {
  const todayYmd = ymdOf(now);
  let toYmd = to ? String(to) : todayYmd;
  if (!isYmd(toYmd)) return { error: "to must be a date in YYYY-MM-DD form" };
  if (toYmd > todayYmd) toYmd = todayYmd;
  let fromYmd;
  if (from) {
    fromYmd = String(from);
    if (!isYmd(fromYmd)) return { error: "from must be a date in YYYY-MM-DD form" };
  } else {
    fromYmd = ymdOf(new Date(istDayStart(toYmd).getTime() - (DEFAULT_RANGE_DAYS - 1) * 86400000));
  }
  if (fromYmd > toYmd) return { error: "from must not be after to" };
  const days = Math.round((istDayStart(toYmd).getTime() - istDayStart(fromYmd).getTime()) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) return { error: `The period can be at most ${MAX_RANGE_DAYS} days` };
  const start = istDayStart(fromYmd);
  const endExclusive = new Date(istDayStart(toYmd).getTime() + 86400000);
  return { from: fromYmd, to: toYmd, days, start, endExclusive };
}

// The period of equal length immediately before `range`, for change-vs-previous comparisons.
function previousRange(range) {
  const start = new Date(range.start.getTime() - range.days * 86400000);
  return { start, endExclusive: range.start, days: range.days, from: ymdOf(start), to: ymdOf(new Date(range.start.getTime() - 86400000)) };
}

function enumerateDays(range) {
  const out = [];
  for (let i = 0; i < range.days; i++) out.push(ymdOf(new Date(range.start.getTime() + i * 86400000)));
  return out;
}

// ---------- privacy ----------
// Audit `details` can carry student names, emails or roll numbers. Event drill-downs expose only whitelisted, non-personal keys.
const SAFE_DETAIL_KEYS = ["entity", "operation", "format", "count", "rows", "rowCount", "kind", "status", "title", "testTitle", "poolName", "examTitle", "field", "fields", "published", "isPublished"];
function redactDetails(details) {
  if (!details || typeof details !== "object") return {};
  const out = {};
  for (const k of SAFE_DETAIL_KEYS) {
    const v = details[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v) && v.length <= 10 && v.every((x) => typeof x === "string" || typeof x === "number")) out[k] = v.map((x) => (typeof x === "string" ? x.slice(0, 60) : x));
  }
  return out;
}

function pageParams(query, { defaultSize = 25, maxSize = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

// Public definitions (shown in the UI and attached to exports).
function definitions() {
  return {
    minimumSample: MIN_SAMPLE,
    timezone: TZ,
    principles: [
      "Activity counts come only from the audit trail, one source, one category per action: nothing is counted twice.",
      "Not tracked, partial and not applicable are shown as such. Only a tracked category with no events is shown as 0.",
      "There is no composite performance score. Every ratio below has a published formula and is withheld under the minimum sample.",
      "Portfolio figures come from the records people created (tests, pools, questions) and are shown separately; they are never added to activity counts.",
    ],
    categories: CATEGORIES.map((c) => ({ key: c.category, label: c.label, roles: c.roles, actions: c.actions })),
    ratios: RATIOS.map((r) => ({ key: r.key, label: r.label, category: r.category, formula: r.formula, meaning: r.meaning })),
    workload: [
      { key: "activeDays", label: "Active days", formula: "Distinct calendar days (Asia/Kolkata) on which the person has at least one counted audit event" },
      { key: "eventsPerActiveDay", label: "Events per active day", formula: "Counted audit events ÷ active days" },
      { key: "peakDayEvents", label: "Busiest day", formula: "Largest number of counted audit events on a single day" },
      { key: "studentsTouched", label: "Students touched", formula: "Distinct students named on the person's counted audit events (only events that name a student)" },
    ],
    portfolio: [
      { key: "testsCreated", label: "Tests created", formula: "Tests whose creator is this person and whose creation date falls in the period (deleted tests are gone)" },
      { key: "testsPublished", label: "Tests published", formula: "Of those tests, how many are currently published" },
      { key: "attemptsStarted", label: "Attempts on those tests", formula: "All student attempts on the tests counted above" },
      { key: "attemptCompletionRate", label: "Attempt completion rate", formula: "Submitted or auto-submitted attempts ÷ attempts on those tests; withheld below the minimum sample" },
      { key: "talentPoolsCreated", label: "Talent pools created", formula: "Talent pools created by this person in the period" },
      { key: "questionsAuthored", label: "Questions authored", formula: "Questions whose author is this person, created in the period" },
    ],
  };
}

module.exports = {
  MIN_SAMPLE, MAX_RANGE_DAYS, STAFF_ROLES, TZ, CATEGORIES, CATEGORY_BY_KEY, CATEGORY_OF_ACTION, ALL_ACTIONS, RATIOS,
  actionsFor, evaluateRatios, categoryCells, totalOf, parseRange, previousRange, enumerateDays, ymdOf, redactDetails, pageParams, definitions,
};
