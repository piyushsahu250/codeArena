// All database access for Staff / Clerk analytics. Every query is aggregated in SQL and constrained by the same `scope` object, which the service
// builds from the requester's authority (never from raw query input), so institute isolation is enforced in one place:
//   scope = { roles: ["STAFF","CLERK"], instituteId?: string, department?: string, userId?: string }
// Activity rows are joined to the User table and filtered on the PERSON's institute (not on AuditLog.instituteId, which records the institute of the
// student acted on and is often empty), so a person's events can never appear under another institute.
const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma");
const cache = require("../../utils/cache");
const { ALL_ACTIONS, TZ } = require("./staffAnalytics.domain");

const DIRECTORY_CAP = 5000;
const DAY_SQL = Prisma.sql`to_char(a."createdAt" AT TIME ZONE ${TZ}, 'YYYY-MM-DD')`;

function userWhere(scope) {
  const parts = [Prisma.sql`u."role"::text = ANY(${scope.roles}::text[])`];
  if (scope.instituteId) parts.push(Prisma.sql`u."instituteId" = ${scope.instituteId}`);
  if (scope.department) parts.push(Prisma.sql`u."department" = ${scope.department}`);
  if (scope.userId) parts.push(Prisma.sql`u."id" = ${scope.userId}`);
  return Prisma.join(parts, " AND ");
}

const base = (scope, start, end, actions) => Prisma.sql`
  FROM "AuditLog" a JOIN "User" u ON u."id" = a."adminId"
  WHERE a."createdAt" >= ${start} AND a."createdAt" < ${end} AND a."action" = ANY(${actions}::text[]) AND ${userWhere(scope)}`;

// One row per person x action: { userId, action, n }
function countsByPersonAction(scope, start, end, actions) {
  return prisma.$queryRaw`SELECT a."adminId" AS "userId", a."action", count(*)::int AS n ${base(scope, start, end, actions)} GROUP BY a."adminId", a."action"`;
}

// One row per person: active days, busiest day, total counted events, distinct students named.
function workloadByPerson(scope, start, end, actions) {
  return prisma.$queryRaw`
    WITH d AS (SELECT a."adminId" AS uid, ${DAY_SQL} AS day, count(*)::int AS n ${base(scope, start, end, actions)} GROUP BY 1, 2),
         s AS (SELECT a."adminId" AS uid, count(DISTINCT a."studentId")::int AS students ${base(scope, start, end, actions)} GROUP BY 1)
    SELECT d.uid AS "userId", count(*)::int AS "activeDays", max(d.n)::int AS "peakDayEvents", sum(d.n)::int AS total, coalesce(max(s.students), 0)::int AS "studentsTouched"
    FROM d LEFT JOIN s ON s.uid = d.uid GROUP BY d.uid`;
}

// One row per day x action for the whole scope (the trend chart).
function seriesByDayAction(scope, start, end, actions) {
  return prisma.$queryRaw`SELECT ${DAY_SQL} AS day, a."action", count(*)::int AS n ${base(scope, start, end, actions)} GROUP BY 1, 2 ORDER BY 1`;
}

const GROUP_COLUMNS = { institute: Prisma.sql`u."instituteId"`, department: Prisma.sql`u."department"`, role: Prisma.sql`u."role"::text` };
// One row per group x action, with the number of distinct people who acted.
function countsByGroupAction(scope, start, end, actions, groupBy) {
  const col = GROUP_COLUMNS[groupBy];
  if (!col) throw new Error("unsupported groupBy");
  return prisma.$queryRaw`SELECT ${col} AS "groupKey", a."action", count(*)::int AS n ${base(scope, start, end, actions)} GROUP BY 1, 2`;
}
function peopleByGroup(scope, start, end, actions, groupBy) {
  const col = GROUP_COLUMNS[groupBy];
  return prisma.$queryRaw`SELECT ${col} AS "groupKey", count(DISTINCT a."adminId")::int AS people ${base(scope, start, end, actions)} GROUP BY 1`;
}

// When did the platform first / last record each action? Used only to tell "never recorded" from "recorded zero". Dates only, no row content.
function coverage() {
  return cache.cached("staff-analytics:coverage", 10 * 60 * 1000, async () => {
    const rows = await prisma.$queryRaw`SELECT "action", min("createdAt") AS "firstAt", max("createdAt") AS "lastAt", count(*)::int AS n FROM "AuditLog" WHERE "action" = ANY(${ALL_ACTIONS}::text[]) GROUP BY "action"`;
    const out = {};
    for (const r of rows) out[r.action] = { firstAt: r.firstAt, lastAt: r.lastAt, n: r.n };
    return out;
  });
}

const PERSON_SELECT = {
  id: true, name: true, role: true, department: true, designation: true, employeeId: true, accountStatus: true, lastLoginAt: true, createdAt: true,
  institute: { select: { id: true, name: true } },
};

function directory(scope, q) {
  const where = { role: { in: scope.roles } };
  if (scope.instituteId) where.instituteId = scope.instituteId;
  if (scope.department) where.department = scope.department;
  if (scope.userId) where.id = scope.userId;
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { employeeId: { contains: q, mode: "insensitive" } }];
  return prisma.user.findMany({ where, select: PERSON_SELECT, orderBy: { name: "asc" }, take: DIRECTORY_CAP });
}

function person(id) {
  return prisma.user.findUnique({ where: { id }, select: { ...PERSON_SELECT, instituteId: true } });
}

async function departments(scope) {
  const rows = await prisma.user.findMany({
    where: { role: { in: scope.roles }, ...(scope.instituteId ? { instituteId: scope.instituteId } : {}), department: { not: null } },
    select: { department: true }, distinct: ["department"], orderBy: { department: "asc" }, take: 200,
  });
  return rows.map((r) => r.department).filter(Boolean);
}

function institutes(scope) {
  return prisma.institute.findMany({ where: scope.instituteId ? { id: scope.instituteId } : {}, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 });
}

async function events(userId, start, end, actions, skip, take) {
  const where = { adminId: userId, createdAt: { gte: start, lt: end }, action: { in: actions } };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, select: { id: true, action: true, createdAt: true, details: true } }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total };
}

// Portfolio: records created by these people in the period, from the operational tables (separate from audit-trail activity).
async function portfolio(userIds, start, end) {
  if (userIds.length === 0) return {};
  const range = { gte: start, lt: end };
  const [tests, published, attempts, pools, questions] = await Promise.all([
    prisma.test.groupBy({ by: ["createdById"], where: { createdById: { in: userIds }, createdAt: range }, _count: { _all: true } }),
    prisma.test.groupBy({ by: ["createdById"], where: { createdById: { in: userIds }, createdAt: range, isPublished: true }, _count: { _all: true } }),
    prisma.$queryRaw`
      SELECT t."createdById" AS "userId", count(*)::int AS started, (count(*) FILTER (WHERE a."status" IN ('SUBMITTED', 'AUTO_SUBMITTED')))::int AS completed
      FROM "TestAttempt" a JOIN "Test" t ON t."id" = a."testId"
      WHERE t."createdById" = ANY(${userIds}::text[]) AND t."createdAt" >= ${start} AND t."createdAt" < ${end}
      GROUP BY t."createdById"`,
    prisma.talentPool.groupBy({ by: ["createdById"], where: { createdById: { in: userIds }, createdAt: range }, _count: { _all: true } }),
    prisma.question.groupBy({ by: ["createdById"], where: { createdById: { in: userIds }, createdAt: range }, _count: { _all: true } }),
  ]);
  const out = {};
  const slot = (id) => (out[id] = out[id] || { testsCreated: 0, testsPublished: 0, attemptsStarted: 0, attemptsCompleted: 0, talentPoolsCreated: 0, questionsAuthored: 0 });
  tests.forEach((r) => { slot(r.createdById).testsCreated = r._count._all; });
  published.forEach((r) => { slot(r.createdById).testsPublished = r._count._all; });
  attempts.forEach((r) => { const s = slot(r.userId); s.attemptsStarted = r.started; s.attemptsCompleted = r.completed; });
  pools.forEach((r) => { slot(r.createdById).talentPoolsCreated = r._count._all; });
  questions.filter((r) => r.createdById).forEach((r) => { slot(r.createdById).questionsAuthored = r._count._all; });
  return out;
}

module.exports = { DIRECTORY_CAP, countsByPersonAction, workloadByPerson, seriesByDayAction, countsByGroupAction, peopleByGroup, coverage, directory, person, departments, institutes, events, portfolio };
