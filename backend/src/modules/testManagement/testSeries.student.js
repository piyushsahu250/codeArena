// The student's side of Test Series: which series are assigned to me, how far I am, and (enforced on the server, not just shown) whether a test is locked by a sequential series.
// A student only ever gets their own assignments (through their academic group or a Talent Pool they belong to) and their own attempts. Nothing about another student is read here.
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { isTestVisibleToStudent } = require("../../utils/testEligibility");
const { getStudentPoolIds } = require("../../utils/talentPoolEligibility");
const R = require("../../utils/testManagementRules");

async function studentContext(userId) {
  const student = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, academicGroupId: true, classId: true, instituteId: true } });
  if (!student || student.role !== "STUDENT") throw new ServiceError(401, "This account no longer exists. Please log in again.", { authExpired: true });
  const poolIds = [...(await getStudentPoolIds(prisma, userId))];
  return { ...student, poolIds };
}

// The assignments that apply to this student: their academic group's, or one of their Talent Pools'.
const applicable = (ctx) => ({ OR: [...(ctx.academicGroupId ? [{ academicGroupId: ctx.academicGroupId }] : []), ...(ctx.poolIds.length ? [{ poolId: { in: ctx.poolIds } }] : [])] });
const LIVE_SERIES = { status: "PUBLISHED", isActive: true, archivedAt: null }; // a draft, switched-off or archived series does not exist for a student

const TEST_SELECT = {
  id: true, title: true, durationMin: true, startTime: true, endTime: true, passingMarks: true, showResults: true, isPublished: true, isActive: true, archivedAt: true, instituteId: true,
  _count: { select: { questions: true } }, academicGroups: { select: { academicGroupId: true } }, classes: { select: { classId: true } }, talentPools: { select: { poolId: true } },
};

// For a set of series: the tests (with this student's eligibility), and this student's attempts on them. Two queries for any number of series.
async function loadFor(ctx, seriesRows) {
  const testIds = [...new Set(seriesRows.flatMap((s) => s.items.map((i) => i.testId)))];
  if (!testIds.length) return { tests: new Map(), attempts: new Map() };
  const [tests, attempts] = await Promise.all([
    prisma.test.findMany({ where: { id: { in: testIds } }, select: TEST_SELECT }),
    prisma.testAttempt.findMany({ where: { studentId: ctx.id, testId: { in: testIds } }, select: { testId: true, status: true, totalScore: true } }),
  ]);
  const pools = new Set(ctx.poolIds);
  return {
    tests: new Map(tests.map((t) => [t.id, { ...t, eligible: isTestVisibleToStudent(t, ctx.academicGroupId, ctx.classId, pools, ctx.instituteId) }])),
    attempts: new Map(attempts.map((a) => [a.testId, a])),
  };
}

// If a student has the series through both a group and a pool, the assignment that is open now wins; otherwise the one that closes last.
function bestAssignment(series, assignments, now) {
  const scored = assignments.map((a) => ({ a, av: R.seriesAvailability(series, a, now) }));
  const open = scored.find((x) => x.av.available);
  if (open) return open;
  return scored.sort((x, y) => (new Date(y.a.endAt || "9999-12-31") - new Date(x.a.endAt || "9999-12-31")))[0];
}

function card(series, picked, progress) {
  const next = progress.rows.find((r) => r.state === "IN_PROGRESS" || r.state === "AVAILABLE");
  return {
    id: series.id, title: series.title, description: series.description, coverUrl: series.coverUrl, subject: series.subject, difficulty: series.difficulty, accessMode: series.accessMode,
    total: progress.total, completed: progress.completed, pending: progress.pending, percent: progress.percent,
    availability: picked.av, window: { startAt: picked.a.startAt, endAt: picked.a.endAt, noExpiry: picked.a.noExpiry, completionDeadline: picked.a.completionDeadline }, instructions: picked.a.instructions,
    nextTestId: picked.av.available && next ? next.testId : null,
    action: !picked.av.available ? null : progress.completed === 0 && !progress.rows.some((r) => r.state === "IN_PROGRESS") ? "START" : progress.completed === progress.total ? "REVIEW" : "CONTINUE",
  };
}

async function listForStudent(userId) {
  const ctx = await studentContext(userId);
  const where = applicable(ctx);
  if (!where.OR.length) return { series: [] };
  const assignments = await prisma.testSeriesAssignment.findMany({ where: { AND: [where, { isActive: true }, { series: LIVE_SERIES }] }, take: 300, include: { series: { include: { items: { select: { testId: true, position: true } } } } } });
  const bySeries = new Map();
  for (const a of assignments) { if (!bySeries.has(a.seriesId)) bySeries.set(a.seriesId, { series: a.series, list: [] }); bySeries.get(a.seriesId).list.push(a); }
  const seriesRows = [...bySeries.values()].map((x) => x.series);
  const { tests, attempts } = await loadFor(ctx, seriesRows);
  const now = new Date();
  const cards = [...bySeries.values()].map(({ series, list }) => {
    const picked = bestAssignment(series, list, now);
    return card(series, picked, R.seriesProgress({ items: series.items, tests, attempts, mode: series.accessMode, rule: series.unlockRule, now }));
  });
  cards.sort((a, b) => Number(b.availability.available) - Number(a.availability.available) || a.title.localeCompare(b.title));
  return { series: cards };
}

async function detailForStudent(userId, seriesId) {
  const ctx = await studentContext(userId);
  const where = applicable(ctx);
  const assignments = where.OR.length ? await prisma.testSeriesAssignment.findMany({ where: { AND: [where, { isActive: true }, { seriesId: String(seriesId) }, { series: LIVE_SERIES }] }, include: { series: { include: { items: { select: { testId: true, position: true } } } } } }) : [];
  if (!assignments.length) throw new ServiceError(404, "Series not found"); // not assigned to this student: the same answer as "does not exist"
  const series = assignments[0].series;
  const { tests, attempts } = await loadFor(ctx, [series]);
  const now = new Date();
  const picked = bestAssignment(series, assignments, now);
  const progress = R.seriesProgress({ items: series.items, tests, attempts, mode: series.accessMode, rule: series.unlockRule, now });
  return {
    ...card(series, picked, progress),
    unlockRule: series.unlockRule,
    items: progress.rows.map((r) => {
      const t = tests.get(r.testId);
      const a = attempts.get(r.testId);
      const showMarks = !!(t && a && r.completed && t.showResults);
      return {
        testId: r.testId, position: r.position, title: t?.title || "Test", durationMin: t?.durationMin, questions: t?._count.questions, startTime: t?.startTime, endTime: t?.endTime,
        state: r.state, reason: r.reason, canOpen: picked.av.available && (r.state === "AVAILABLE" || r.state === "IN_PROGRESS"),
        score: showMarks ? a.totalScore : null, passingMarks: showMarks ? t.passingMarks : null, resultUrl: r.completed && t?.showResults ? `/test/${r.testId}/result` : null,
      };
    }),
  };
}

// Called when a student starts a test. A test in a SEQUENTIAL series that is assigned to this student and open now is locked until the earlier tests are done; if the test is also in an open
// FLEXIBLE series of theirs it is not locked (they have another way in). The check runs on the server for every start, whichever page the student came from.
async function assertNotLockedBySeries(userId, testId) {
  const ctx = await studentContext(userId);
  const where = applicable(ctx);
  if (!where.OR.length) return;
  const links = await prisma.testSeriesItem.findMany({
    where: { testId, series: { ...LIVE_SERIES, assignments: { some: { AND: [where, { isActive: true }] } } } },
    select: { series: { select: { id: true, title: true, accessMode: true, unlockRule: true, items: { select: { testId: true, position: true } }, assignments: { where: { AND: [where, { isActive: true }] } } } } },
  });
  if (!links.length) return;
  const now = new Date();
  const open = links.filter((l) => l.series.assignments.some((a) => R.seriesAvailability({ ...LIVE_SERIES }, a, now).available));
  if (!open.length) return; // no series of theirs is currently open: the test follows its own rules only
  if (open.some((l) => l.series.accessMode !== "SEQUENTIAL")) return;
  const { tests, attempts } = await loadFor(ctx, open.map((l) => l.series));
  const locked = open.map((l) => ({ l, p: R.seriesProgress({ items: l.series.items, tests, attempts, mode: "SEQUENTIAL", rule: l.series.unlockRule, now }) })).filter((x) => R.isLockedBySeries(x.p, testId));
  if (locked.length === open.length) {
    const reason = locked[0].p.rows.find((r) => r.testId === testId).reason;
    throw new ServiceError(403, `${reason} (Series: ${locked[0].l.series.title})`, { code: "SERIES_LOCKED", seriesId: locked[0].l.series.id });
  }
}

module.exports = { listForStudent, detailForStudent, assertNotLockedBySeries };
