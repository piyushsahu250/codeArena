// Series reports for staff: who has completed what, per assigned academic group and Talent Pool, with a CSV export. It reads the attempts that already exist and writes nothing: the attempt
// is the source of truth for every mark, and no aggregate score is shown because a series has no configured scoring rule (each test keeps its own marks and passing marks).
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { AUDIT_ACTIONS } = require("../../utils/auditLog");
const M = require("./testManagement.service");
const S = require("./testSeries.service");

const DONE = ["SUBMITTED", "AUTO_SUBMITTED"];
const PAGE_MAX = 100;
const EXPORT_LIMIT = 20000;
const cell = (v) => { const s = v == null ? "" : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };

async function cohort(actor, seriesId, q) {
  const s = await S.loadSeries(actor, seriesId, { items: { orderBy: { position: "asc" }, select: { testId: true, position: true, test: { select: { title: true, passingMarks: true } } } }, assignments: { select: { academicGroupId: true, poolId: true, isActive: true } } });
  const groupIds = [...new Set(s.assignments.filter((a) => a.academicGroupId).map((a) => a.academicGroupId))];
  const poolIds = [...new Set(s.assignments.filter((a) => a.poolId).map((a) => a.poolId))];
  const wantGroup = q.academicGroupId ? String(q.academicGroupId) : null;
  const wantPool = q.poolId ? String(q.poolId) : null;
  if (wantGroup && !groupIds.includes(wantGroup)) throw new ServiceError(404, "That group is not assigned to this series.");
  if (wantPool && !poolIds.includes(wantPool)) throw new ServiceError(404, "That Talent Pool is not assigned to this series.");
  const ors = wantGroup ? [{ academicGroupId: wantGroup }] : wantPool ? [{ talentPoolMemberships: { some: { poolId: wantPool } } }] : [...(groupIds.length ? [{ academicGroupId: { in: groupIds } }] : []), ...(poolIds.length ? [{ talentPoolMemberships: { some: { poolId: { in: poolIds } } } }] : [])];
  const t = String(q.q || "").trim().slice(0, 80);
  const and = [{ role: "STUDENT" }, { OR: ors.length ? ors : [{ id: "none" }] }];
  if (t) and.push({ OR: ["name", "rollNumber", "registrationNumber", "email"].map((f) => ({ [f]: { contains: t, mode: "insensitive" } })) });
  return { series: s, items: s.items, where: { AND: and }, groupIds, poolIds };
}

const studentSelect = { id: true, name: true, rollNumber: true, registrationNumber: true, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } } };
const groupText = (g) => (g ? `${g.department?.name || "—"} · ${g.batch} · ${g.section}` : "—");

function rowFor(student, items, attemptsByStudent) {
  const mine = attemptsByStudent.get(student.id) || new Map();
  const tests = items.map((it) => {
    const a = mine.get(it.testId);
    const done = !!a && DONE.includes(a.status);
    return { testId: it.testId, state: done ? "COMPLETED" : a ? "IN_PROGRESS" : "PENDING", score: done ? a.totalScore : null, passed: done && it.test.passingMarks != null ? a.totalScore >= it.test.passingMarks : null };
  });
  const completed = tests.filter((t) => t.state === "COMPLETED").length;
  return { studentId: student.id, name: student.name, rollNumber: student.rollNumber, prn: student.registrationNumber, group: groupText(student.academicGroup), tests, completed, pending: items.length - completed, percent: items.length ? Math.round((completed / items.length) * 100) : 0 };
}

async function attemptsFor(studentIds, items) {
  if (!studentIds.length || !items.length) return new Map();
  const rows = await prisma.testAttempt.findMany({ where: { studentId: { in: studentIds }, testId: { in: items.map((i) => i.testId) } }, select: { studentId: true, testId: true, status: true, totalScore: true } });
  const by = new Map();
  for (const r of rows) { if (!by.has(r.studentId)) by.set(r.studentId, new Map()); by.get(r.studentId).set(r.testId, r); }
  return by;
}

async function seriesReport(actor, seriesId, q = {}) {
  const c = await cohort(actor, seriesId, q);
  const page = M.clampInt(q.page, 1, 100000, 1);
  const pageSize = M.clampInt(q.pageSize, 5, PAGE_MAX, 25);
  const total = await prisma.user.count({ where: c.where });
  const students = await prisma.user.findMany({ where: c.where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: studentSelect });
  const attempts = await attemptsFor(students.map((s) => s.id), c.items);

  // Series-level figures over the whole cohort (not just this page): one grouped query on attempts, then the cohort's ids and groups only.
  const cohortStudents = await prisma.user.findMany({ where: c.where, select: { id: true, academicGroupId: true }, take: EXPORT_LIMIT });
  const ids = cohortStudents.map((s) => s.id);
  const perStudent = ids.length && c.items.length ? await prisma.testAttempt.groupBy({ by: ["studentId"], where: { studentId: { in: ids }, testId: { in: c.items.map((i) => i.testId) }, status: { in: DONE } }, _count: { _all: true } }) : [];
  const doneCount = new Map(perStudent.map((r) => [r.studentId, r._count._all]));
  const needed = c.items.length;
  const completedAll = cohortStudents.filter((s) => needed > 0 && (doneCount.get(s.id) || 0) >= needed).length;
  const started = cohortStudents.filter((s) => (doneCount.get(s.id) || 0) > 0).length;
  const groupIds = [...new Set(cohortStudents.map((s) => s.academicGroupId).filter(Boolean))];
  const groups = groupIds.length ? await prisma.academicGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, batch: true, section: true, department: { select: { name: true } } } }) : [];
  const byGroup = groups.map((g) => {
    const members = cohortStudents.filter((s) => s.academicGroupId === g.id);
    return { academicGroupId: g.id, label: groupText(g), students: members.length, started: members.filter((s) => (doneCount.get(s.id) || 0) > 0).length, completedAll: members.filter((s) => needed > 0 && (doneCount.get(s.id) || 0) >= needed).length };
  }).sort((a, b) => a.label.localeCompare(b.label));
  const perTest = c.items.length && ids.length ? await prisma.testAttempt.groupBy({ by: ["testId"], where: { studentId: { in: ids }, testId: { in: c.items.map((i) => i.testId) }, status: { in: DONE } }, _count: { _all: true } }) : [];
  const perTestBy = new Map(perTest.map((r) => [r.testId, r._count._all]));

  return {
    series: { id: c.series.id, title: c.series.title, tests: c.items.map((i) => ({ testId: i.testId, position: i.position, title: i.test.title, passingMarks: i.test.passingMarks })) },
    summary: { students: cohortStudents.length, started, completedAll, notStarted: cohortStudents.length - started, completionRate: cohortStudents.length ? Math.round((completedAll / cohortStudents.length) * 1000) / 10 : 0, perTest: c.items.map((i) => ({ testId: i.testId, title: i.test.title, completed: perTestBy.get(i.testId) || 0 })), truncated: cohortStudents.length >= EXPORT_LIMIT },
    byGroup, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: students.map((s) => rowFor(s, c.items, attempts)),
    note: "Marks are read from each student's submitted attempt, unchanged. A series has no combined score because no scoring rule is configured for it.",
  };
}

async function seriesCsv(actor, seriesId, q = {}) {
  const c = await cohort(actor, seriesId, q);
  const students = await prisma.user.findMany({ where: c.where, orderBy: [{ name: "asc" }, { id: "asc" }], take: EXPORT_LIMIT, select: studentSelect });
  const attempts = await attemptsFor(students.map((s) => s.id), c.items);
  const head = ["Student", "Roll number", "PRN", "Department · batch · section", ...c.items.map((i) => `${i.position}. ${i.test.title}`), "Completed", "Pending", "Completion %"];
  const lines = [head.map(cell).join(",")];
  for (const s of students) {
    const r = rowFor(s, c.items, attempts);
    lines.push([r.name, r.rollNumber, r.prn, r.group, ...r.tests.map((t) => (t.state === "COMPLETED" ? `${t.score}${t.passed === true ? " (pass)" : t.passed === false ? " (below pass)" : ""}` : t.state === "IN_PROGRESS" ? "In progress" : "Pending")), r.completed, r.pending, r.percent].map(cell).join(","));
  }
  await M.audit(actor, AUDIT_ACTIONS.TEST_RESULTS_EXPORTED, { kind: "series", seriesId: c.series.id, rows: students.length, filters: { academicGroupId: q.academicGroupId || null, poolId: q.poolId || null } });
  return { filename: `series-${c.series.id}-progress.csv`, body: `﻿${lines.join("\r\n")}\r\n`, truncated: students.length >= EXPORT_LIMIT };
}

module.exports = { seriesReport, seriesCsv };
