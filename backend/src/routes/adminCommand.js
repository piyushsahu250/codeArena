// Role-specific dashboard aggregation for SUPER_ADMIN / INSTITUTE_ADMIN / STAFF / CLERK.
//   GET /api/command/super      platform-level only (SUPER_ADMIN, or legacy ADMIN with no instituteId)
//   GET /api/command/institute  INSTITUTE_ADMIN (own institute) or platform-level (?instituteId=)
//   GET /api/command/staff      STAFF (own institute; own class assignments when they have any)
//   GET /api/command/clerk      CLERK (own institute)
//
// Rules: scope always comes from the authenticated user's row (never trusted from the client; the
// only client-chosen scope is ?instituteId= and only for platform-level callers); everything is
// DB-side aggregation (groupBy / raw GROUP BY) with no per-institute loops; missing data is null,
// never a fabricated number; health statuses come from the documented rules in HEALTH_RULES.
const express = require("express");
const { Prisma } = require("@prisma/client");
const prisma = require("../prisma");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../utils/permissions");
const { attachRequesterInstitute } = require("../middleware/institute");
const { cached } = require("../utils/cache");
const { getQueueStatus } = require("../utils/queue");
const { getSnapshot } = require("../utils/metrics");
const { sendExport } = require("../utils/exportFile");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

const router = express.Router();
const DAY = 24 * 3600 * 1000;

const HEALTH_RULES = [
  "INACTIVE: the institute is deactivated.",
  "CRITICAL: students exist but no user has logged in for 14+ days (or ever).",
  "NEEDS ATTENTION: no login for 7-14 days; or fewer than 10% of students logged in during the selected period; or more than 20% of at least 5 emails failed; or attendance is below 60% across at least 20 records; or no students enrolled yet.",
  "HEALTHY: none of the above.",
];

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
const academicYear = () => { const d = new Date(); const y = d.getFullYear(); return d.getMonth() >= 5 ? `${y}–${String(y + 1).slice(2)}` : `${y - 1}–${String(y).slice(2)}`; };
const rangeDays = (q) => { const n = parseInt(q, 10); return [1, 7, 30, 90].includes(n) ? n : (Number.isFinite(n) && n > 0 && n <= 365 ? n : 30); };
const change = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null); // null => "Trend unavailable"

function healthOf({ isActive, students, activeStudents, lastActivity, emailTotal, emailFailed, attPct, attRecords, days }) {
  if (!isActive) return { status: "INACTIVE", reasons: ["Institute is deactivated"] };
  const reasons = [];
  let status = "HEALTHY";
  const bump = (s) => { if (s === "CRITICAL" || (s === "NEEDS_ATTENTION" && status === "HEALTHY")) status = s; };
  if (students === 0) { bump("NEEDS_ATTENTION"); reasons.push("No students enrolled yet"); }
  else {
    const since = lastActivity ? (Date.now() - new Date(lastActivity).getTime()) / DAY : null;
    if (since === null) { bump("CRITICAL"); reasons.push("No user login recorded"); }
    else if (since > 14) { bump("CRITICAL"); reasons.push(`No user login for ${Math.floor(since)} days`); }
    else if (since > 7) { bump("NEEDS_ATTENTION"); reasons.push(`No user login for ${Math.floor(since)} days`); }
    if (days >= 7 && students > 0 && activeStudents / students < 0.1 && status !== "CRITICAL") { bump("NEEDS_ATTENTION"); reasons.push(`Only ${pct(activeStudents, students)}% of students logged in during the last ${days} days`); }
  }
  if (emailTotal >= 5 && emailFailed / emailTotal > 0.2) { bump("NEEDS_ATTENTION"); reasons.push(`${emailFailed} of ${emailTotal} emails failed`); }
  if (attRecords >= 20 && attPct !== null && attPct < 60) { bump("NEEDS_ATTENTION"); reasons.push(`Attendance is ${attPct}%`); }
  return { status, reasons };
}

const severityOf = (action) => {
  if (/ACCOUNT_LOCKED|UNAUTHORIZED/.test(action)) return "HIGH";
  if (/FAILED|BLOCKED|REVOKED|DELETED/.test(action)) return "WARNING";
  return "INFO";
};

function platformLevel(req, res, next) {
  if (req.requesterInstituteId) return res.status(403).json({ error: "Platform-level access required" });
  next();
}

// ---------------------------------------------------------------- SUPER ADMIN
// Course completion = completed lessons / lessons the students are entitled to. A student is entitled
// to every PUBLISHED course assigned to their institute OR their academic group (same rule as
// utils/courseEligibility.js), counting only live (published, non-archived) modules/chapters/lessons.
// Returns one row per (institute, academic group): { iid, gid, entitled, done }.
async function courseCompletionRows(instituteId) {
  const filter = instituteId ? Prisma.sql`AND u."instituteId" = ${instituteId}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    WITH lc AS (
      SELECT c.id AS course_id, l.id AS lesson_id
      FROM "Course" c
      JOIN "CourseModule" m ON m."courseId" = c.id AND m."isActive" = true AND m."archivedAt" IS NULL
      JOIN "Lesson" l ON l."moduleId" = m.id AND l."isActive" = true AND l."archivedAt" IS NULL
        AND (l."chapterId" IS NULL OR EXISTS (SELECT 1 FROM "Chapter" ch WHERE ch.id = l."chapterId" AND ch."isActive" = true AND ch."archivedAt" IS NULL))
      WHERE c.status::text = 'PUBLISHED'
    ), cnt AS (SELECT course_id, COUNT(*)::int AS n FROM lc GROUP BY course_id),
    sc AS (
      SELECT DISTINCT u.id AS sid, u."instituteId" AS iid, u."academicGroupId" AS gid, x.cid
      FROM "User" u
      JOIN (
        SELECT "courseId" AS cid, "instituteId" AS ii, NULL::text AS gg FROM "CourseInstituteAssignment"
        UNION ALL SELECT "courseId", NULL::text, "academicGroupId" FROM "CourseAcademicGroupAssignment"
      ) x ON x.ii = u."instituteId" OR x.gg = u."academicGroupId"
      WHERE u.role = 'STUDENT' AND u."isActive" = true AND u."instituteId" IS NOT NULL ${filter}
    ), ent AS (SELECT sc.iid, sc.gid, SUM(cnt.n)::int AS entitled FROM sc JOIN cnt ON cnt.course_id = sc.cid GROUP BY sc.iid, sc.gid),
    dn AS (
      SELECT sc.iid, sc.gid, COUNT(*)::int AS done
      FROM sc JOIN lc ON lc.course_id = sc.cid
      JOIN "LessonProgress" lp ON lp."lessonId" = lc.lesson_id AND lp."studentId" = sc.sid AND lp.status = 'COMPLETED'
      GROUP BY sc.iid, sc.gid
    )
    SELECT ent.iid, ent.gid, ent.entitled, COALESCE(dn.done, 0)::int AS done
    FROM ent LEFT JOIN dn ON dn.iid = ent.iid AND dn.gid IS NOT DISTINCT FROM ent.gid`;
  return rows;
}
const completionPct = (done, entitled) => (entitled > 0 ? Math.min(100, Math.round((done / entitled) * 100)) : null);

const loadSuperCore = (days) => cached(`cmd:super:${days}`, 45 * 1000, async () => {
      const since = new Date(Date.now() - days * DAY);
      const prevSince = new Date(Date.now() - 2 * days * DAY);
      const [
        institutes, userGroups, lastLogins, activeRows, attRows, testRows, courseRows, codingRows, readyRows, certRows, emailRows,
        completedNow, completedPrev, certNow, certPrev, newStudentsNow, newStudentsPrev, talentStudents, learners,
      ] = await Promise.all([
        prisma.institute.findMany({ select: { id: true, name: true, code: true, isActive: true, createdAt: true } }),
        prisma.user.groupBy({ by: ["instituteId", "role"], where: { isActive: true }, _count: { _all: true } }),
        prisma.user.groupBy({ by: ["instituteId"], where: { instituteId: { not: null } }, _max: { lastLoginAt: true } }),
        prisma.$queryRaw`SELECT u."instituteId" AS id, COUNT(DISTINCT s."userId")::int AS users, COUNT(DISTINCT s."userId") FILTER (WHERE u.role = 'STUDENT')::int AS students
          FROM "LoginSession" s JOIN "User" u ON u.id = s."userId" WHERE s."loginAt" >= ${since} AND u."instituteId" IS NOT NULL GROUP BY u."instituteId"`,
        prisma.$queryRaw`SELECT u."instituteId" AS id, COUNT(*) FILTER (WHERE r.status IN ('PRESENT','LATE'))::int AS present, COUNT(*) FILTER (WHERE r.status IN ('PRESENT','ABSENT','LATE'))::int AS total
          FROM "AttendanceRecord" r JOIN "User" u ON u.id = r."studentId" WHERE u."instituteId" IS NOT NULL GROUP BY u."instituteId"`,
        prisma.test.groupBy({ by: ["instituteId"], where: { instituteId: { not: null } }, _count: { _all: true } }),
        prisma.courseInstituteAssignment.groupBy({ by: ["instituteId"], _count: { _all: true } }),
        prisma.$queryRaw`SELECT u."instituteId" AS id, COUNT(*)::int AS n FROM "PracticeRunLog" p JOIN "User" u ON u.id = p."studentId" WHERE p."createdAt" >= ${since} AND u."instituteId" IS NOT NULL GROUP BY u."instituteId"`,
        prisma.$queryRaw`SELECT u."instituteId" AS id, ROUND(AVG(r."overallScore"))::int AS avg, COUNT(*)::int AS n FROM "ReadinessReport" r JOIN "User" u ON u.id = r."studentId" WHERE u."instituteId" IS NOT NULL GROUP BY u."instituteId"`,
        prisma.$queryRaw`SELECT u."instituteId" AS id, COUNT(*)::int AS n FROM "Certificate" c JOIN "User" u ON u.id = c."studentId" WHERE c."issuedAt" >= ${since} AND u."instituteId" IS NOT NULL GROUP BY u."instituteId"`,
        prisma.emailLog.groupBy({ by: ["instituteId", "status"], where: { createdAt: { gte: since }, instituteId: { not: null } }, _count: { _all: true } }),
        prisma.testAttempt.count({ where: { status: { not: "IN_PROGRESS" }, submittedAt: { gte: since } } }),
        prisma.testAttempt.count({ where: { status: { not: "IN_PROGRESS" }, submittedAt: { gte: prevSince, lt: since } } }),
        prisma.certificate.count({ where: { issuedAt: { gte: since } } }),
        prisma.certificate.count({ where: { issuedAt: { gte: prevSince, lt: since } } }),
        prisma.user.count({ where: { role: "STUDENT", createdAt: { gte: since } } }),
        prisma.user.count({ where: { role: "STUDENT", createdAt: { gte: prevSince, lt: since } } }),
        prisma.talentPoolMember.groupBy({ by: ["studentId"] }).then((r) => r.length),
        prisma.$queryRaw`SELECT COUNT(DISTINCT "studentId")::int AS n FROM "LessonProgress" WHERE "status" = 'COMPLETED' AND "completedAt" >= ${since}`,
      ]);

      const ccRows = await courseCompletionRows(null);
      const ccBy = new Map();
      for (const r of ccRows) { const c = ccBy.get(r.iid) || { done: 0, entitled: 0 }; c.done += num(r.done); c.entitled += num(r.entitled); ccBy.set(r.iid, c); }
      const idx = (rows, key = "id") => new Map(rows.map((r) => [r[key], r]));
      const active = idx(activeRows), att = idx(attRows), cod = idx(codingRows), rdy = idx(readyRows), cert = idx(certRows);
      const tests = new Map(testRows.map((r) => [r.instituteId, r._count._all]));
      const courses = new Map(courseRows.map((r) => [r.instituteId, r._count._all]));
      const last = new Map(lastLogins.map((r) => [r.instituteId, r._max.lastLoginAt]));
      const roleCount = new Map();
      for (const g of userGroups) roleCount.set(`${g.instituteId}:${g.role}`, g._count._all);
      const emailBy = new Map();
      for (const e of emailRows) {
        const cur = emailBy.get(e.instituteId) || { total: 0, failed: 0 };
        cur.total += e._count._all; if (e.status === "FAILED") cur.failed += e._count._all;
        emailBy.set(e.instituteId, cur);
      }

      const rows = institutes.map((i) => {
        const students = roleCount.get(`${i.id}:STUDENT`) || 0;
        const a = att.get(i.id);
        const attPct = a ? pct(num(a.present), num(a.total)) : null;
        const em = emailBy.get(i.id) || { total: 0, failed: 0 };
        const act = active.get(i.id);
        const h = healthOf({
          isActive: i.isActive, students, activeStudents: num(act?.students), lastActivity: last.get(i.id), emailTotal: em.total, emailFailed: em.failed,
          attPct, attRecords: a ? num(a.total) : 0, days,
        });
        return {
          id: i.id, name: i.name, code: i.code, isActive: i.isActive, createdAt: i.createdAt,
          students, staff: roleCount.get(`${i.id}:STAFF`) || 0, clerks: roleCount.get(`${i.id}:CLERK`) || 0, instituteAdmins: roleCount.get(`${i.id}:INSTITUTE_ADMIN`) || 0,
          activeUsers: num(act?.users), activeStudents: num(act?.students),
          courses: courses.get(i.id) || 0, assessments: tests.get(i.id) || 0,
          courseCompletionPercent: completionPct(ccBy.get(i.id)?.done, ccBy.get(i.id)?.entitled),
          attendancePercent: attPct, codingActivity: num(cod.get(i.id)?.n), readinessAvg: rdy.get(i.id) ? num(rdy.get(i.id).avg) : null,
          certificates: num(cert.get(i.id)?.n), emailFailed: em.failed, emailTotal: em.total,
          lastActivity: last.get(i.id) || null, health: h.status, healthReasons: h.reasons,
        };
      });

      const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
      const totals = {
        institutes: rows.length, activeInstitutes: rows.filter((r) => r.isActive).length, inactiveInstitutes: rows.filter((r) => !r.isActive).length,
        students: sum("students"), staff: sum("staff"), clerks: sum("clerks"), instituteAdmins: sum("instituteAdmins"),
        activeUsers: sum("activeUsers"), certificatesInPeriod: sum("certificates"), codingInPeriod: sum("codingActivity"),
        talentPoolStudents: talentStudents,
        learningStudentsInPeriod: num(learners[0]?.n),
        courseCompletionPercent: completionPct(ccRows.reduce((s, r) => s + num(r.done), 0), ccRows.reduce((s, r) => s + num(r.entitled), 0)),
      };
      const trends = {
        testsCompleted: { value: completedNow, previous: completedPrev, changePercent: change(completedNow, completedPrev) },
        certificates: { value: certNow, previous: certPrev, changePercent: change(certNow, certPrev) },
        newStudents: { value: newStudentsNow, previous: newStudentsPrev, changePercent: change(newStudentsNow, newStudentsPrev) },
      };
      return { rows, totals, trends };
});

const loadInstituteCore = (inst, days) => cached(`cmd:inst:${inst.id}:${days}`, 45 * 1000, async () => {
  const instituteId = inst.id;
      const since = new Date(Date.now() - days * DAY);
      const now = new Date();
      const [roleGroups, lastLogin, activeRow, groups, studentsByGroup, attByGroup, readyByGroup, activeByGroup, profileByGroup, tests, activeTests, upcoming, courses, certs, talent, coding, resultsPending, docsPending, offersPending, emailAgg, att, activity] = await Promise.all([
        prisma.user.groupBy({ by: ["role"], where: { instituteId, isActive: true }, _count: { _all: true } }),
        prisma.user.aggregate({ where: { instituteId }, _max: { lastLoginAt: true } }),
        prisma.$queryRaw`SELECT COUNT(DISTINCT s."userId")::int AS users, COUNT(DISTINCT s."userId") FILTER (WHERE u.role = 'STUDENT')::int AS students FROM "LoginSession" s JOIN "User" u ON u.id = s."userId" WHERE s."loginAt" >= ${since} AND u."instituteId" = ${instituteId}`,
        prisma.academicGroup.findMany({ where: { instituteId }, select: { id: true, batch: true, section: true, isActive: true, department: { select: { id: true, name: true } } } }),
        prisma.user.groupBy({ by: ["academicGroupId"], where: { instituteId, role: "STUDENT", isActive: true }, _count: { _all: true } }),
        prisma.$queryRaw`SELECT u."academicGroupId" AS id, COUNT(*) FILTER (WHERE r.status IN ('PRESENT','LATE'))::int AS present, COUNT(*) FILTER (WHERE r.status IN ('PRESENT','ABSENT','LATE'))::int AS total FROM "AttendanceRecord" r JOIN "User" u ON u.id = r."studentId" WHERE u."instituteId" = ${instituteId} GROUP BY u."academicGroupId"`,
        prisma.$queryRaw`SELECT u."academicGroupId" AS id, ROUND(AVG(r."overallScore"))::int AS avg, COUNT(DISTINCT u.id)::int AS students FROM "ReadinessReport" r JOIN "User" u ON u.id = r."studentId" WHERE u."instituteId" = ${instituteId} GROUP BY u."academicGroupId"`,
        prisma.$queryRaw`SELECT u."academicGroupId" AS id, COUNT(DISTINCT s."userId")::int AS n FROM "LoginSession" s JOIN "User" u ON u.id = s."userId" WHERE s."loginAt" >= ${since} AND u."instituteId" = ${instituteId} AND u.role = 'STUDENT' GROUP BY u."academicGroupId"`,
        prisma.$queryRaw`SELECT u."academicGroupId" AS id, COUNT(*) FILTER (WHERE p."mandatoryStatus" = 'COMPLETED')::int AS done FROM "StudentProfile" p JOIN "User" u ON u.id = p."studentId" WHERE u."instituteId" = ${instituteId} AND u.role = 'STUDENT' AND u."isActive" = true GROUP BY u."academicGroupId"`,
        prisma.test.count({ where: { instituteId } }),
        prisma.test.count({ where: { instituteId, isPublished: true, startTime: { lte: now }, endTime: { gte: now } } }),
        prisma.test.count({ where: { instituteId, isPublished: true, startTime: { gt: now } } }),
        prisma.courseInstituteAssignment.count({ where: { instituteId } }),
        prisma.certificate.count({ where: { student: { instituteId } } }),
        prisma.talentPoolMember.groupBy({ by: ["studentId"], where: { student: { instituteId } } }).then((r) => r.length),
        prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "PracticeRunLog" p JOIN "User" u ON u.id = p."studentId" WHERE p."createdAt" >= ${since} AND u."instituteId" = ${instituteId}`,
        prisma.resultExamination.count({ where: { instituteId, status: { in: ["DRAFT", "IN_REVIEW", "READY_TO_PUBLISH"] } } }),
        prisma.studentDocument.count({ where: { verificationStatus: "PENDING", student: { instituteId } } }),
        prisma.placementOffer.count({ where: { verificationStatus: "PENDING", student: { instituteId } } }),
        prisma.emailLog.groupBy({ by: ["status"], where: { instituteId, createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.$queryRaw`SELECT COUNT(*) FILTER (WHERE r.status IN ('PRESENT','LATE'))::int AS present, COUNT(*) FILTER (WHERE r.status IN ('PRESENT','ABSENT','LATE'))::int AS total FROM "AttendanceRecord" r JOIN "User" u ON u.id = r."studentId" WHERE u."instituteId" = ${instituteId}`,
        prisma.auditLog.findMany({ where: { instituteId, action: { notIn: ["LOGIN", "LOGOUT"] } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, action: true, adminName: true, adminRole: true, createdAt: true } }),
      ]);
      const role = Object.fromEntries(roleGroups.map((g) => [g.role, g._count._all]));
      const students = role.STUDENT || 0;
      const attAll = att[0] ? { present: num(att[0].present), total: num(att[0].total) } : { present: 0, total: 0 };
      const attPct = pct(attAll.present, attAll.total);
      const em = Object.fromEntries(emailAgg.map((e) => [e.status, e._count._all]));
      const emailTotal = Object.values(em).reduce((s, n) => s + n, 0);
      const health = healthOf({ isActive: inst.isActive, students, activeStudents: num(activeRow[0]?.students), lastActivity: lastLogin._max.lastLoginAt, emailTotal, emailFailed: em.FAILED || 0, attPct, attRecords: attAll.total, days });

      const m = (rows) => new Map(rows.map((r) => [r.id, r]));
      const cnt = new Map(studentsByGroup.map((g) => [g.academicGroupId, g._count._all]));
      const attM = m(attByGroup), rdM = m(readyByGroup), actM = m(activeByGroup), prM = m(profileByGroup);
      const ccRows = await courseCompletionRows(instituteId);
      const ccG = new Map(ccRows.map((r) => [r.gid, r]));
      const roll = (keyFn, labelFn) => {
        const acc = new Map();
        for (const g of groups) {
          const k = keyFn(g); const cur = acc.get(k) || { key: k, label: labelFn(g), ccDone: 0, ccEnt: 0, students: 0, present: 0, attTotal: 0, rdSum: 0, rdN: 0, active: 0, profileDone: 0 };
          cur.students += cnt.get(g.id) || 0;
          const a = attM.get(g.id); if (a) { cur.present += num(a.present); cur.attTotal += num(a.total); }
          const r = rdM.get(g.id); if (r) { cur.rdSum += num(r.avg) * num(r.students); cur.rdN += num(r.students); }
          const cg = ccG.get(g.id); if (cg) { cur.ccDone += num(cg.done); cur.ccEnt += num(cg.entitled); }
          cur.active += num(actM.get(g.id)?.n); cur.profileDone += num(prM.get(g.id)?.done);
          acc.set(k, cur);
        }
        return [...acc.values()].map((c) => ({
          key: c.key, label: c.label, students: c.students,
          courseCompletionPercent: completionPct(c.ccDone, c.ccEnt),
          attendancePercent: pct(c.present, c.attTotal), readinessAvg: c.rdN ? Math.round(c.rdSum / c.rdN) : null,
          activeStudents: c.active, activePercent: pct(c.active, c.students), profileCompletionPercent: pct(c.profileDone, c.students),
        })).sort((a, b) => b.students - a.students);
      };
      return {
        counts: { students, staff: role.STAFF || 0, clerks: role.CLERK || 0, instituteAdmins: role.INSTITUTE_ADMIN || 0, departments: new Set(groups.map((g) => g.department.id)).size, sections: groups.length, courses, assessments: tests, liveAssessments: activeTests, upcomingAssessments: upcoming, certificates: certs, talentPoolStudents: talent },
        activity: { activeUsers: num(activeRow[0]?.users), activeStudents: num(activeRow[0]?.students), activeStudentPercent: pct(num(activeRow[0]?.students), students), codingActivity: num(coding[0]?.n), lastLogin: lastLogin._max.lastLoginAt },
        attendancePercent: attPct, health,
        courseCompletionPercent: completionPct(ccRows.reduce((s, r) => s + num(r.done), 0), ccRows.reduce((s, r) => s + num(r.entitled), 0)),
        pending: { resultExaminations: resultsPending, documentsToVerify: docsPending, offersToVerify: offersPending, failedEmails: em.FAILED || 0 },
        departments: roll((g) => g.department.id, (g) => g.department.name),
        batches: roll((g) => g.batch, (g) => g.batch),
        recentActivity: activity,
      };
});

router.get("/super", authenticate, requirePermission("platform.console"), attachRequesterInstitute, platformLevel, async (req, res) => {
  try {
    const days = rangeDays(req.query.days);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(5, parseInt(req.query.pageSize, 10) || 20));
    const q = String(req.query.q || "").trim().toLowerCase();
    const statusFilter = String(req.query.health || "");
    const sortKey = ["name", "students", "activeUsers", "staff", "courses", "courseCompletionPercent", "attendancePercent", "lastActivity", "health"].includes(req.query.sort) ? req.query.sort : "name";
    const dir = req.query.dir === "desc" ? -1 : 1;

    const core = await loadSuperCore(days);

    const filtered = core.rows
      .filter((r) => (!q || r.name.toLowerCase().includes(q) || (r.code || "").toLowerCase().includes(q)) && (!statusFilter || r.health === statusFilter))
      .sort((a, b) => {
        const order = { CRITICAL: 0, NEEDS_ATTENTION: 1, INACTIVE: 2, HEALTHY: 3 };
        const va = sortKey === "health" ? order[a.health] : sortKey === "name" ? a.name.toLowerCase() : (a[sortKey] ?? -1);
        const vb = sortKey === "health" ? order[b.health] : sortKey === "name" ? b.name.toLowerCase() : (b[sortKey] ?? -1);
        return va < vb ? -dir : va > vb ? dir : 0;
      });
    const healthSummary = { HEALTHY: 0, NEEDS_ATTENTION: 0, CRITICAL: 0, INACTIVE: 0 };
    for (const r of core.rows) healthSummary[r.health]++;
    const attention = core.rows.filter((r) => r.health === "CRITICAL" || r.health === "NEEDS_ATTENTION")
      .sort((a, b) => (a.health === "CRITICAL" ? 0 : 1) - (b.health === "CRITICAL" ? 0 : 1)).slice(0, 8)
      .map((r) => ({ id: r.id, name: r.name, health: r.health, reasons: r.healthReasons }));

    // live / short-lived sections are separate, shorter cache
    const live = await cached(`cmd:super:live:${days}`, 20 * 1000, async () => {
      const since = new Date(Date.now() - days * DAY);
      const since24 = new Date(Date.now() - DAY);
      const t0 = process.hrtime.bigint();
      await prisma.$queryRaw`SELECT 1`;
      const dbMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
      const [dau, wau, mau, dailySeries, audit, failedLogins, unauthorized, lockouts, resets, emailAgg, emailFailures, aiToday, liveAttempts] = await Promise.all([
        prisma.$queryRaw`SELECT u.role, COUNT(DISTINCT s."userId")::int AS n FROM "LoginSession" s JOIN "User" u ON u.id = s."userId" WHERE s."loginAt" >= ${new Date(Date.now() - DAY)} GROUP BY u.role`,
        prisma.$queryRaw`SELECT u.role, COUNT(DISTINCT s."userId")::int AS n FROM "LoginSession" s JOIN "User" u ON u.id = s."userId" WHERE s."loginAt" >= ${new Date(Date.now() - 7 * DAY)} GROUP BY u.role`,
        prisma.$queryRaw`SELECT u.role, COUNT(DISTINCT s."userId")::int AS n FROM "LoginSession" s JOIN "User" u ON u.id = s."userId" WHERE s."loginAt" >= ${new Date(Date.now() - 30 * DAY)} GROUP BY u.role`,
        prisma.$queryRaw`SELECT to_char(date_trunc('day', s."loginAt"), 'YYYY-MM-DD') AS day, COUNT(DISTINCT s."userId")::int AS users, COUNT(DISTINCT s."userId") FILTER (WHERE u.role = 'STUDENT')::int AS students
          FROM "LoginSession" s JOIN "User" u ON u.id = s."userId" WHERE s."loginAt" >= ${since} GROUP BY 1 ORDER BY 1`,
        prisma.auditLog.findMany({
          where: { action: { notIn: ["LOGIN", "LOGOUT"] } }, orderBy: { createdAt: "desc" }, take: 20,
          select: { id: true, action: true, adminName: true, adminRole: true, instituteId: true, createdAt: true },
        }),
        prisma.auditLog.count({ where: { action: "LOGIN_FAILED", createdAt: { gte: since24 } } }),
        prisma.auditLog.count({ where: { action: "UNAUTHORIZED_ACCESS_ATTEMPT", createdAt: { gte: since24 } } }),
        prisma.auditLog.count({ where: { action: "ACCOUNT_LOCKED", createdAt: { gte: since24 } } }),
        prisma.auditLog.count({ where: { action: "PASSWORD_RESET_REQUESTED", createdAt: { gte: since24 } } }),
        prisma.emailLog.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.emailLog.findMany({ where: { status: "FAILED", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, emailType: true, errorMessage: true, createdAt: true, instituteId: true, recipientEmail: true } }),
        prisma.aiUsageLog.groupBy({ by: ["success"], where: { createdAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } }, _count: { _all: true } }),
        prisma.testAttempt.count({ where: { status: "IN_PROGRESS" } }),
      ]);
      const byRole = (rows) => Object.fromEntries(rows.map((r) => [r.role, r.n]));
      const mask = (e) => { const [u, d] = String(e || "").split("@"); return d ? `${u.slice(0, 2)}***@${d}` : "***"; };
      const em = Object.fromEntries(emailAgg.map((e) => [e.status, e._count._all]));
      const q = getQueueStatus(); const snap = getSnapshot();
      const aiTotal = aiToday.reduce((s, g) => s + g._count._all, 0); const aiFailed = aiToday.find((g) => g.success === false)?._count._all || 0;
      const secSev = unauthorized >= 20 ? "CRITICAL" : unauthorized >= 1 || lockouts >= 5 ? "HIGH" : failedLogins >= 50 ? "WARNING" : "INFO";
      return {
        dau: byRole(dau), wau: byRole(wau), mau: byRole(mau), dailySeries,
        audit: audit.map((a) => ({ ...a, severity: severityOf(a.action) })),
        security: { failedLogins24h: failedLogins, unauthorized24h: unauthorized, lockouts24h: lockouts, passwordResets24h: resets, severity: secSev,
          severityRule: "CRITICAL: 20+ unauthorized-access attempts in 24h. HIGH: any unauthorized attempt or 5+ lockouts. WARNING: 50+ failed logins. Otherwise INFO." },
        email: { total: Object.values(em).reduce((s, n) => s + n, 0), sent: em.SENT || 0, failed: em.FAILED || 0, pending: em.PENDING || 0, byStatus: em,
          recentFailures: emailFailures.map((f) => ({ id: f.id, type: f.emailType, reason: (f.errorMessage || "").slice(0, 120), at: f.createdAt, instituteId: f.instituteId, recipient: mask(f.recipientEmail) })) },
        system: [
          { key: "api", label: "API", status: "OK", detail: `Uptime ${Math.round(process.uptime() / 3600)} h, event-loop lag ${snap.eventLoopLagMs ?? "n/a"} ms` },
          { key: "db", label: "Database", status: dbMs > 1000 ? "WARNING" : "OK", detail: `Ping ${dbMs} ms` },
          { key: "judge", label: "Compiler queue", status: q.waiting > q.maxQueueSize * 0.5 ? "WARNING" : "OK", detail: `${q.active}/${q.maxConcurrent} running, ${q.waiting} waiting` },
          { key: "ai", label: "AI service", status: aiTotal >= 5 && aiFailed / aiTotal > 0.5 ? "WARNING" : aiTotal ? "OK" : "UNKNOWN", detail: aiTotal ? `${aiFailed} of ${aiTotal} calls failed today` : "No AI calls today" },
          { key: "email", label: "Email", status: (em.FAILED || 0) > 5 && (em.FAILED || 0) / Math.max(1, Object.values(em).reduce((s, n) => s + n, 0)) > 0.2 ? "WARNING" : "OK", detail: `${em.FAILED || 0} failed of ${Object.values(em).reduce((s, n) => s + n, 0)} in period` },
        ],
        notMonitored: ["Object storage", "Background job queue (beyond compiler)"],
        liveTestAttempts: liveAttempts,
      };
    });

    const names = new Map(core.rows.map((r) => [r.id, r.name]));
    res.json({
      generatedAt: new Date().toISOString(), days, healthRules: HEALTH_RULES,
      totals: core.totals, trends: core.trends, healthSummary, attention,
      institutes: { total: filtered.length, page, pageSize, rows: filtered.slice((page - 1) * pageSize, page * pageSize) },
      activity: live.audit.map((a) => ({ ...a, institute: names.get(a.instituteId) || null })),
      users: { dau: live.dau, wau: live.wau, mau: live.mau, dailySeries: live.dailySeries },
      security: live.security,
      email: { ...live.email, recentFailures: live.email.recentFailures.map((f) => ({ ...f, institute: names.get(f.instituteId) || null })) },
      system: live.system, notMonitored: live.notMonitored, liveTestAttempts: live.liveTestAttempts,
    });
  } catch (err) {
    console.error("[command/super] failed", err);
    res.status(500).json({ error: "Failed to load the global dashboard" });
  }
});

// ---------------------------------------------------------------- INSTITUTE ADMIN
router.get("/institute", authenticate, requirePermission("institute.console"), attachRequesterInstitute, async (req, res) => {
  try {
    // Institute-scoped callers are pinned to their own institute; ?instituteId= is honoured only for platform-level callers.
    const instituteId = req.requesterInstituteId || String(req.query.instituteId || "");
    if (!instituteId) return res.status(400).json({ error: "instituteId is required" });
    const inst = await prisma.institute.findUnique({ where: { id: instituteId }, select: { id: true, name: true, code: true, isActive: true, attendanceMinPercent: true } });
    if (!inst) return res.status(404).json({ error: "Institute not found" });
    const days = rangeDays(req.query.days);

    const data = await loadInstituteCore(inst, days);

    res.json({
      generatedAt: new Date().toISOString(), days, healthRules: HEALTH_RULES,
      institute: { id: inst.id, name: inst.name, code: inst.code, isActive: inst.isActive, academicYear: academicYear() },
      ...data,
    });
  } catch (err) {
    console.error("[command/institute] failed", err);
    res.status(500).json({ error: "Failed to load the institute dashboard" });
  }
});

// ---------------------------------------------------------------- STAFF
router.get("/staff", authenticate, requirePermission("staff.workspace"), attachRequesterInstitute, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, department: true, instituteId: true, institute: { select: { name: true, attendanceMinPercent: true } } } });
    if (!me?.instituteId) return res.status(403).json({ error: "Staff account has no institute" });
    const instituteId = me.instituteId;
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + DAY);

    const assignments = await prisma.staffClassAssignment.findMany({
      where: { staffId: me.id }, select: { id: true, subject: true, academicGroupId: true, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } } },
    });
    const groupIds = [...new Set(assignments.map((a) => a.academicGroupId).filter(Boolean))];
    const scoped = groupIds.length > 0;
    const studentWhere = { role: "STUDENT", isActive: true, instituteId, ...(scoped ? { academicGroupId: { in: groupIds } } : {}) };

    const students = await prisma.user.findMany({ where: studentWhere, select: { id: true, name: true, rollNumber: true, lastLoginAt: true, studentProfile: { select: { mandatoryStatus: true } } }, take: 5000 });
    const ids = students.map((s) => s.id);
    const idList = ids.length ? Prisma.join(ids) : Prisma.sql`NULL`;
    const min = me.institute.attendanceMinPercent;

    const [attRows, failed, plansToday, absentToday, upcoming, resultsPending, live, unread] = await Promise.all([
      ids.length ? prisma.$queryRaw`SELECT r."studentId" AS id, COUNT(*) FILTER (WHERE r.status IN ('PRESENT','LATE'))::int AS present, COUNT(*) FILTER (WHERE r.status IN ('PRESENT','ABSENT','LATE'))::int AS total FROM "AttendanceRecord" r WHERE r."studentId" IN (${idList}) GROUP BY r."studentId"` : [],
      ids.length ? prisma.resultEntry.groupBy({ by: ["studentId"], where: { studentId: { in: ids }, passed: false, status: "PRESENT", examination: { status: "PUBLISHED" } }, _count: { _all: true } }) : [],
      scoped || assignments.length ? prisma.lecturePlan.findMany({ where: { assignment: { staffId: me.id }, scheduleDate: { gte: dayStart, lt: dayEnd } }, select: { id: true, topic: true, startTime: true, slotLabel: true, session: { select: { id: true } } } }) : [],
      ids.length ? prisma.attendanceRecord.count({ where: { status: "ABSENT", studentId: { in: ids }, session: { markedAt: { gte: dayStart, lt: dayEnd } } } }) : 0,
      prisma.test.findMany({ where: { instituteId, isPublished: true, startTime: { gt: now, lt: new Date(now.getTime() + 7 * DAY) } }, orderBy: { startTime: "asc" }, take: 5, select: { id: true, title: true, startTime: true } }),
      prisma.resultExamination.count({ where: { instituteId, status: { in: ["DRAFT", "IN_REVIEW", "READY_TO_PUBLISH"] } } }),
      prisma.testAttempt.count({ where: { status: "IN_PROGRESS", studentId: { in: ids } } }),
      prisma.notification.count({ where: { recipientId: me.id, read: false } }),
    ]);

    const att = new Map(attRows.map((r) => [r.id, r])); const fail = new Map(failed.map((r) => [r.studentId, r._count._all]));
    const stale = new Date(now.getTime() - 14 * DAY);
    const flagged = [];
    for (const s of students) {
      const reasons = [];
      const a = att.get(s.id);
      if (min && a && num(a.total) >= 5 && pct(num(a.present), num(a.total)) < min) reasons.push({ code: "LOW_ATTENDANCE", text: `Attendance ${pct(num(a.present), num(a.total))}% (minimum ${min}%)` });
      if (fail.get(s.id)) reasons.push({ code: "FAILED_ASSESSMENT", text: `${fail.get(s.id)} failed published result${fail.get(s.id) > 1 ? "s" : ""}` });
      if (!s.lastLoginAt || s.lastLoginAt < stale) reasons.push({ code: "INACTIVE", text: s.lastLoginAt ? "No login for 14+ days" : "Has never logged in" });
      if ((s.studentProfile?.mandatoryStatus || "NOT_STARTED") !== "COMPLETED") reasons.push({ code: "PROFILE_INCOMPLETE", text: "Profile incomplete" });
      if (reasons.length) flagged.push({ id: s.id, name: s.name, rollNumber: s.rollNumber, reasons });
    }
    flagged.sort((a, b) => b.reasons.length - a.reasons.length);
    const countCode = (c) => flagged.filter((f) => f.reasons.some((r) => r.code === c)).length;
    const atRisk = flagged.filter((f) => f.reasons.some((r) => ["LOW_ATTENDANCE", "FAILED_ASSESSMENT"].includes(r.code))).length;

    const planned = plansToday.length; const marked = plansToday.filter((p) => p.session).length;
    res.json({
      generatedAt: now.toISOString(),
      profile: { name: me.name, department: me.department || null, institute: me.institute.name, academicYear: academicYear() },
      scope: scoped ? { type: "ASSIGNED", label: `${groupIds.length} assigned class${groupIds.length > 1 ? "es" : ""}`, groups: assignments.filter((a) => a.academicGroup).map((a) => `${a.academicGroup.department.name} · ${a.academicGroup.batch} · ${a.academicGroup.section}${a.subject ? ` · ${a.subject}` : ""}`) }
        : { type: "INSTITUTE", label: "No class assignment yet — showing your whole institute", groups: [] },
      metrics: {
        students: students.length, atRisk, todayAttendancePlanned: planned, todayAttendanceMarked: marked, absentToday,
        upcomingAssessments: upcoming.length, resultsAwaitingAction: resultsPending, liveAttempts: live, unreadNotifications: unread,
        attendanceThresholdConfigured: !!min,
      },
      today: [
        planned > marked && { code: "ATTENDANCE", text: `${planned - marked} of ${planned} lecture${planned > 1 ? "s" : ""} today still need attendance`, to: "/staff/attendance" },
        absentToday > 0 && { code: "ABSENT", text: `${absentToday} student${absentToday > 1 ? "s" : ""} marked absent today`, to: "/staff/attendance/reports" },
        resultsPending > 0 && { code: "RESULTS", text: `${resultsPending} result examination${resultsPending > 1 ? "s" : ""} not yet published`, to: "/admin/results" },
        live > 0 && { code: "LIVE", text: `${live} student${live > 1 ? "s are" : " is"} taking a test right now`, to: "/staff/tests" },
      ].filter(Boolean),
      attention: { total: flagged.length, byReason: { lowAttendance: countCode("LOW_ATTENDANCE"), failedAssessment: countCode("FAILED_ASSESSMENT"), inactive: countCode("INACTIVE"), profileIncomplete: countCode("PROFILE_INCOMPLETE") }, students: flagged.slice(0, 8) },
      upcoming: upcoming,
      lecturesToday: plansToday.map((p) => ({ id: p.id, topic: p.topic, slot: p.slotLabel, start: p.startTime, marked: !!p.session })),
      notTracked: ["Pending manual evaluations (the platform auto-grades; there is no manual-evaluation queue)"],
    });
  } catch (err) {
    console.error("[command/staff] failed", err);
    res.status(500).json({ error: "Failed to load the staff dashboard" });
  }
});

// ---------------------------------------------------------------- CLERK
router.get("/clerk", authenticate, requirePermission("clerk.workspace"), attachRequesterInstitute, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, instituteId: true, institute: { select: { name: true } } } });
    if (!me?.instituteId) return res.status(403).json({ error: "Clerk account has no institute" });
    const instituteId = me.instituteId;
    const now = Date.now();
    const sIn = { instituteId, role: "STUDENT", isActive: true };
    const [students, newStudents, profilesDone, interestSet, docGroups, offerGroups, recentDocs, recentOffers, unread] = await Promise.all([
      prisma.user.count({ where: sIn }),
      prisma.user.count({ where: { ...sIn, createdAt: { gte: new Date(now - 30 * DAY) } } }),
      prisma.studentProfile.count({ where: { student: sIn, mandatoryStatus: "COMPLETED" } }),
      prisma.studentProfile.count({ where: { student: sIn, placementParticipation: { not: null } } }),
      prisma.studentDocument.groupBy({ by: ["verificationStatus"], where: { student: { instituteId } }, _count: { _all: true } }),
      prisma.placementOffer.groupBy({ by: ["verificationStatus"], where: { student: { instituteId } }, _count: { _all: true } }),
      prisma.studentDocument.findMany({ where: { student: { instituteId } }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, documentType: true, verificationStatus: true, updatedAt: true, student: { select: { id: true, name: true } } } }),
      prisma.placementOffer.findMany({ where: { student: { instituteId } }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, companyName: true, verificationStatus: true, updatedAt: true, student: { select: { id: true, name: true } } } }),
      prisma.notification.count({ where: { recipientId: req.user.id, read: false } }),
    ]);
    const doc = Object.fromEntries(docGroups.map((g) => [g.verificationStatus, g._count._all]));
    const off = Object.fromEntries(offerGroups.map((g) => [g.verificationStatus, g._count._all]));
    const incomplete = Math.max(0, students - profilesDone);
    const interestPending = Math.max(0, students - interestSet);
    const recent = [
      ...recentDocs.map((d) => ({ kind: "Document", text: `${d.student.name} — ${d.documentType}`, status: d.verificationStatus, at: d.updatedAt, studentId: d.student.id })),
      ...recentOffers.map((o) => ({ kind: "Offer", text: `${o.student.name} — ${o.companyName}`, status: o.verificationStatus, at: o.updatedAt, studentId: o.student.id })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
    res.json({
      generatedAt: new Date().toISOString(),
      profile: { name: me.name, institute: me.institute.name, academicYear: academicYear() },
      metrics: {
        students, newStudents30d: newStudents, incompleteProfiles: incomplete, documentsPending: doc.PENDING || 0, documentsVerified: doc.VERIFIED || 0,
        documentsReupload: doc.REUPLOAD_REQUIRED || 0, placementInterestPending: interestPending, offersPending: off.PENDING || 0, offersVerified: off.VERIFIED || 0, unreadNotifications: unread,
      },
      tasks: [
        (doc.PENDING || 0) > 0 && { code: "DOCS", count: doc.PENDING, text: "documents awaiting verification", to: "/clerk/students?documentVerificationStatus=PENDING" },
        incomplete > 0 && { code: "PROFILES", count: incomplete, text: "student profiles incomplete", to: "/clerk/students" },
        interestPending > 0 && { code: "INTEREST", count: interestPending, text: "students have not set placement interest", to: "/clerk/students" },
        (off.PENDING || 0) > 0 && { code: "OFFERS", count: off.PENDING, text: "offer letters awaiting verification", to: "/clerk/placement-analytics" },
        (doc.REUPLOAD_REQUIRED || 0) > 0 && { code: "REUPLOAD", count: doc.REUPLOAD_REQUIRED, text: "documents waiting on a student re-upload", to: "/clerk/students" },
      ].filter(Boolean),
      recent,
    });
  } catch (err) {
    console.error("[command/clerk] failed", err);
    res.status(500).json({ error: "Failed to load the clerk dashboard" });
  }
});

// ---------------------------------------------------------------- EXPORTS
// Server-side CSV/XLSX of exactly what the dashboard tables show (same scope, filters and
// numbers). Spreadsheet-injection safe (sendExport -> safeRow). Every export is audit-logged.
// Bounded: tables are aggregates (one row per institute / department / batch); the student list is
// capped so a single request can never load an unbounded result set.
const STUDENT_EXPORT_CAP = 20000;

router.get("/super/export", authenticate, requirePermission("platform.console"), attachRequesterInstitute, platformLevel, async (req, res) => {
  try {
    const days = rangeDays(req.query.days);
    const q = String(req.query.q || "").trim().toLowerCase();
    const statusFilter = String(req.query.health || "");
    const core = await loadSuperCore(days);
    const rows = core.rows
      .filter((r) => (!q || r.name.toLowerCase().includes(q) || (r.code || "").toLowerCase().includes(q)) && (!statusFilter || r.health === statusFilter))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({
        Institute: r.name, Code: r.code || "", Status: r.isActive ? "Active" : "Inactive", Health: r.health.replace(/_/g, " "), "Health reasons": r.healthReasons.join("; "),
        Students: r.students, Staff: r.staff, Clerks: r.clerks, "Institute admins": r.instituteAdmins, [`Active users (${days}d)`]: r.activeUsers,
        "Courses assigned": r.courses, Assessments: r.assessments, "Attendance %": r.attendancePercent ?? "", "Course completion %": r.courseCompletionPercent ?? "",
        [`Coding runs (${days}d)`]: r.codingActivity, "Readiness avg %": r.readinessAvg ?? "", [`Certificates (${days}d)`]: r.certificates,
        "Last login": r.lastActivity ? new Date(r.lastActivity).toISOString() : "",
      }));
    await logAudit({ req, action: AUDIT_ACTIONS.DATA_EXPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId: null, details: { entity: "command-institute-overview", format: req.query.format || "csv", days, rowCount: rows.length } });
    if (rows.length === 0) return res.status(204).end();
    sendExport(res, { rows, filenameBase: `codearena-institute-overview-${new Date().toISOString().slice(0, 10)}`, format: req.query.format });
  } catch (err) {
    console.error("[command/super/export] failed", err);
    res.status(500).json({ error: "Export failed" });
  }
});

router.get("/institute/export", authenticate, requirePermission("institute.console"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId || String(req.query.instituteId || "");
    if (!instituteId) return res.status(400).json({ error: "instituteId is required" });
    const inst = await prisma.institute.findUnique({ where: { id: instituteId }, select: { id: true, name: true, isActive: true, attendanceMinPercent: true } });
    if (!inst) return res.status(404).json({ error: "Institute not found" });
    const days = rangeDays(req.query.days);
    const kind = ["departments", "batches", "students"].includes(req.query.kind) ? req.query.kind : "departments";
    let rows;
    if (kind === "students") {
      const students = await prisma.user.findMany({
        where: { instituteId, role: "STUDENT" }, orderBy: { name: "asc" }, take: STUDENT_EXPORT_CAP,
        select: { name: true, rollNumber: true, registrationNumber: true, isActive: true, lastLoginAt: true, createdAt: true, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } }, studentProfile: { select: { mandatoryStatus: true } } },
      });
      rows = students.map((s) => ({
        Name: s.name, "Roll number": s.rollNumber || "", "Registration number": s.registrationNumber || "", Department: s.academicGroup?.department.name || "", Batch: s.academicGroup?.batch || "", Section: s.academicGroup?.section || "",
        Active: s.isActive ? "Yes" : "No", "Profile status": s.studentProfile?.mandatoryStatus || "NOT_STARTED", "Last login": s.lastLoginAt ? s.lastLoginAt.toISOString() : "", "Created": s.createdAt.toISOString(),
      }));
    } else {
      const data = await loadInstituteCore(inst, days);
      const label = kind === "departments" ? "Department" : "Batch";
      rows = data[kind].map((r) => ({
        [label]: r.label, Students: r.students, "Attendance %": r.attendancePercent ?? "", "Course completion %": r.courseCompletionPercent ?? "", "Readiness avg %": r.readinessAvg ?? "",
        [`Active students (${days}d)`]: r.activeStudents, "Active %": r.activePercent ?? "", "Profiles complete %": r.profileCompletionPercent ?? "",
      }));
    }
    await logAudit({ req, action: AUDIT_ACTIONS.DATA_EXPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId, details: { entity: `command-institute-${kind}`, format: req.query.format || "csv", rowCount: rows.length } });
    if (rows.length === 0) return res.status(204).end();
    sendExport(res, { rows, filenameBase: `codearena-${inst.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${kind}-${new Date().toISOString().slice(0, 10)}`, format: req.query.format });
  } catch (err) {
    console.error("[command/institute/export] failed", err);
    res.status(500).json({ error: "Export failed" });
  }
});

module.exports = router;
