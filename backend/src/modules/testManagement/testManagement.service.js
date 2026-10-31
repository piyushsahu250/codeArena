// Test Management for staff and administrators: the organised list of tests (views, folders, search, filters, paging), the person's own star / hide / folder marks, archiving, switching a
// test on or off, and bulk actions with a per-test result. No req/res here: the routes next to this file only translate HTTP.
//
// What is reused, not rebuilt: the existing test ownership and institute scoping (utils/testOwnership.js, tests.domain.js), and the existing publish path (tests.service.setPublished, which
// validates the test, writes the audit entry and sends the in-app notification). Nothing here touches questions, attempts, submissions, marks or a student's assignment, so moving, hiding,
// starring, archiving or deactivating a test can never change a result.
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { staffTestAccessWhere, canStaffAccessTest } = require("../../utils/testOwnership");
const d = require("../tests/tests.domain");
const testsService = require("../tests/tests.service");
const R = require("../../utils/testManagementRules");

const audit = (actor, action, details) => logAudit({ req: actor.req, action, actorId: actor.user.id, actorName: actor.user.name, actorRole: actor.user.role, instituteId: actor.requesterInstituteId || null, details });
const isAdminRole = (actor) => actor.user.role !== "STAFF";
const MAX_BULK = 100;
const clampInt = (v, lo, hi, dflt) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

// Every test this person is allowed to see at all: their institute, and (for staff) the ones they created or that were shared with them. This is the existing rule, unchanged.
const baseWhere = (actor) => d.staffListWhere(actor.requesterInstituteId, staffTestAccessWhere(actor));
// May this person CHANGE the test itself (not just their own marks on it)?
const ownsTest = (actor, test) => !d.outsideInstitute(actor, test, false) && canStaffAccessTest(actor, test);

// ---- overview -----------------------------------------------------------------------------------------------------------------------------------------------------
async function overview(actor) {
  const userId = actor.user.id;
  const base = baseWhere(actor);
  const count = (view) => prisma.test.count({ where: { AND: [base, R.viewWhere(view, userId)] } });
  const seriesWhere = seriesScope(actor);
  const [all, active, inactive, published, unpublished, starred, hidden, archived, folders, seriesDraft, seriesPublished, seriesTotal] = await Promise.all([
    ...R.TEST_VIEWS.map(count),
    prisma.testFolder.count({ where: { ownerId: userId } }),
    prisma.testSeries.count({ where: { AND: [seriesWhere, { archivedAt: null, status: "DRAFT" }] } }),
    prisma.testSeries.count({ where: { AND: [seriesWhere, { archivedAt: null, status: "PUBLISHED" }] } }),
    prisma.testSeries.count({ where: { AND: [seriesWhere, { archivedAt: null }] } }),
  ]);
  return { tests: { all, active, inactive, published, unpublished, starred, hidden, archived }, folders, series: { total: seriesTotal, draft: seriesDraft, published: seriesPublished } };
}

// Series scope: staff see the series they created; an administrator sees every series of their institute (a platform administrator, all of them).
function seriesScope(actor) {
  if (actor.user.role === "STAFF") return { createdById: actor.user.id };
  return actor.requesterInstituteId ? { OR: [{ instituteId: actor.requesterInstituteId }, { instituteId: null }] } : {};
}

// ---- the list -----------------------------------------------------------------------------------------------------------------------------------------------------
const groupLabel = (g) => `${g.department?.name || "—"} · ${g.batch} · ${g.section}`;

async function listTests(actor, q = {}) {
  const userId = actor.user.id;
  const view = R.TEST_VIEWS.includes(q.view) ? q.view : "all";
  const page = clampInt(q.page, 1, 100000, 1);
  const pageSize = clampInt(q.pageSize, 5, 100, 25);
  const sort = R.SORTS[q.sort] ? q.sort : "updated";
  const and = [baseWhere(actor), R.viewWhere(view, userId)];

  if (q.folderId === "none") and.push({ NOT: { userStates: { some: { userId, folderId: { not: null } } } } });
  else if (q.folderId) {
    const folder = await prisma.testFolder.findFirst({ where: { id: String(q.folderId), ownerId: userId }, select: { id: true } }); // only the person's own folders
    if (!folder) throw new ServiceError(404, "Folder not found");
    and.push({ userStates: { some: { userId, folderId: folder.id } } });
  }
  const text = String(q.q || "").trim().slice(0, 100);
  if (text) and.push({ OR: ["title", "code", "subject", "unit"].map((f) => ({ [f]: { contains: text, mode: "insensitive" } })) });
  if (q.academicGroupId) and.push({ academicGroups: { some: { academicGroupId: String(q.academicGroupId) } } });
  if (q.departmentId) and.push({ academicGroups: { some: { academicGroup: { departmentId: String(q.departmentId) } } } });
  if (q.hasAttempts === "1") and.push({ attempts: { some: {} } }); // Results & Analytics: only tests somebody has attempted
  if (q.subject) and.push({ subject: { contains: String(q.subject).slice(0, 80), mode: "insensitive" } });
  const now = new Date();
  if (q.window === "OPEN") and.push({ startTime: { lte: now }, endTime: { gte: now } });
  else if (q.window === "UPCOMING") and.push({ startTime: { gt: now } });
  else if (q.window === "CLOSED") and.push({ endTime: { lt: now } });

  const where = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.test.count({ where }),
    prisma.test.findMany({
      where, orderBy: R.SORTS[sort], skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, title: true, code: true, subject: true, unit: true, company: true, startTime: true, endTime: true, durationMin: true, isPublished: true, isActive: true, archivedAt: true, updatedAt: true,
        createdById: true, instituteId: true, createdBy: { select: { name: true } }, shares: { select: { staffId: true } },
        _count: { select: { questions: true, attempts: true, academicGroups: true, talentPools: true, seriesItems: true } },
        academicGroups: { take: 4, select: { academicGroup: { select: { id: true, batch: true, section: true, department: { select: { name: true } } } } } },
        userStates: { where: { userId }, select: { starred: true, hidden: true, folderId: true, folder: { select: { name: true } } } },
      },
    }),
  ]);
  return {
    view, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((t) => {
      const mine = t.userStates[0] || {};
      return {
        id: t.id, title: t.title, code: t.code, subject: t.subject, unit: t.unit, company: t.company, startTime: t.startTime, endTime: t.endTime, durationMin: t.durationMin, updatedAt: t.updatedAt,
        owner: t.createdBy?.name || null, ownedByMe: t.createdById === userId, canManage: ownsTest(actor, t),
        lifecycle: R.lifecycleOf(t, now), questions: t._count.questions, attempts: t._count.attempts, inSeries: t._count.seriesItems,
        assignedTo: { groups: t._count.academicGroups, pools: t._count.talentPools, labels: t.academicGroups.map((g) => groupLabel(g.academicGroup)) },
        starred: !!mine.starred, hidden: !!mine.hidden, folderId: mine.folderId || null, folderName: mine.folder?.name || null,
      };
    }),
  };
}

// ---- folders ------------------------------------------------------------------------------------------------------------------------------------------------------
const cleanName = (v) => { const s = String(v ?? "").trim().replace(/\s+/g, " "); if (!s) throw new ServiceError(400, "Enter a folder name."); if (s.length > 60) throw new ServiceError(400, "A folder name can have at most 60 characters."); return s; };
const optLabel = (v) => { const s = String(v ?? "").trim().slice(0, 80); return s || null; };

async function listFolders(actor, q = {}) {
  const userId = actor.user.id;
  const instituteWide = q.scope === "institute" && isAdminRole(actor); // an administrator can look at every folder of the institute (view only)
  const where = { AND: [instituteWide ? (actor.requesterInstituteId ? { instituteId: actor.requesterInstituteId } : {}) : { ownerId: userId }] };
  const text = String(q.q || "").trim().slice(0, 60);
  if (text) where.AND.push({ name: { contains: text, mode: "insensitive" } });
  for (const f of ["academicYear", "department", "subject"]) if (q[f]) where.AND.push({ [f]: { contains: String(q[f]).slice(0, 80), mode: "insensitive" } });
  const folders = await prisma.testFolder.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], take: 500, include: { owner: { select: { name: true } } } });
  const ids = folders.map((f) => f.id);
  // One grouped query for every folder's count, not one query per folder. Archived tests are counted separately so a folder's number matches what its list shows.
  const [live, archived] = ids.length ? await Promise.all([
    prisma.testUserState.groupBy({ by: ["folderId"], where: { folderId: { in: ids }, test: { archivedAt: null } }, _count: { _all: true } }),
    prisma.testUserState.groupBy({ by: ["folderId"], where: { folderId: { in: ids }, test: { archivedAt: { not: null } } }, _count: { _all: true } }),
  ]) : [[], []];
  const liveBy = new Map(live.map((r) => [r.folderId, r._count._all]));
  const archBy = new Map(archived.map((r) => [r.folderId, r._count._all]));
  const none = instituteWide ? null : await prisma.test.count({ where: { AND: [baseWhere(actor), R.viewWhere("all", userId), { NOT: { userStates: { some: { userId, folderId: { not: null } } } } }] } });
  return {
    withoutFolder: none,
    folders: folders.map((f) => ({ id: f.id, name: f.name, academicYear: f.academicYear, department: f.department, subject: f.subject, isArchive: f.isArchive, owner: f.owner?.name || null, mine: f.ownerId === userId, tests: liveBy.get(f.id) || 0, archivedTests: archBy.get(f.id) || 0, createdAt: f.createdAt })),
  };
}

async function createFolder(actor, body) {
  const data = { name: cleanName(body.name), ownerId: actor.user.id, instituteId: actor.requesterInstituteId || null, academicYear: optLabel(body.academicYear), department: optLabel(body.department), subject: optLabel(body.subject), isArchive: !!body.isArchive };
  try {
    const f = await prisma.testFolder.create({ data });
    await audit(actor, AUDIT_ACTIONS.TEST_FOLDER_CHANGED, { operation: "create", folderId: f.id, name: f.name });
    return f;
  } catch (e) {
    if (e.code === "P2002") throw new ServiceError(409, "You already have a folder with that name.");
    throw e;
  }
}

async function ownFolder(actor, id) {
  const f = await prisma.testFolder.findFirst({ where: { id: String(id), ownerId: actor.user.id } });
  if (!f) throw new ServiceError(404, "Folder not found"); // another person's folder is not confirmed to exist
  return f;
}

async function updateFolder(actor, id, body) {
  const f = await ownFolder(actor, id);
  const data = {};
  if (body.name !== undefined) data.name = cleanName(body.name);
  for (const k of ["academicYear", "department", "subject"]) if (body[k] !== undefined) data[k] = optLabel(body[k]);
  if (body.isArchive !== undefined) data.isArchive = !!body.isArchive;
  try {
    const out = await prisma.testFolder.update({ where: { id: f.id }, data });
    await audit(actor, AUDIT_ACTIONS.TEST_FOLDER_CHANGED, { operation: "update", folderId: f.id, changed: Object.keys(data) });
    return out;
  } catch (e) {
    if (e.code === "P2002") throw new ServiceError(409, "You already have a folder with that name.");
    throw e;
  }
}

// Deleting a folder deletes the folder only. The placements fall back to "no folder" (onDelete: SetNull); the tests, their assignments and their results are not touched.
async function deleteFolder(actor, id) {
  const f = await ownFolder(actor, id);
  const placed = await prisma.testUserState.count({ where: { folderId: f.id } });
  await prisma.testFolder.delete({ where: { id: f.id } });
  await audit(actor, AUDIT_ACTIONS.TEST_FOLDER_CHANGED, { operation: "delete", folderId: f.id, name: f.name, testsReleased: placed });
  return { deleted: true, testsReleased: placed };
}

// ---- bulk ---------------------------------------------------------------------------------------------------------------------------------------------------------
async function bulk(actor, body) {
  const action = String(body.action || "");
  if (!R.BULK_ACTIONS.includes(action)) throw new ServiceError(400, "Unknown action.");
  const ids = [...new Set((Array.isArray(body.testIds) ? body.testIds : []).map(String))];
  if (!ids.length) throw new ServiceError(400, "Select at least one test.");
  if (ids.length > MAX_BULK) throw new ServiceError(400, `You can change at most ${MAX_BULK} tests at once.`);
  if (R.bulkNeedsConfirmation(action) && body.confirm !== true) {
    throw new ServiceError(409, `Please confirm: ${action} ${ids.length} test${ids.length === 1 ? "" : "s"}.`, { needsConfirmation: true, action, count: ids.length });
  }
  let folderId = null;
  if (action === "move") {
    if (body.folderId) folderId = (await ownFolder(actor, body.folderId)).id; // folderId null/absent = take it out of any folder
  }
  const userId = actor.user.id;
  // Only tests this person can see at all. An id that is not in the list gets the same answer whether it does not exist or belongs to someone else.
  const found = await prisma.test.findMany({ where: { AND: [baseWhere(actor), { id: { in: ids } }] }, select: { id: true, title: true, isPublished: true, isActive: true, archivedAt: true, createdById: true, instituteId: true, shares: { select: { staffId: true } } } });
  const byId = new Map(found.map((t) => [t.id, t]));
  const ctx = { owns: (t) => ownsTest(actor, t) };
  const results = [];
  const ops = []; // database writes that are applied together in one transaction
  const archiveFolder = action === "move" && folderId ? (await prisma.testFolder.findUnique({ where: { id: folderId }, select: { isArchive: true } }))?.isArchive : false;

  for (const id of ids) {
    const t = byId.get(id);
    if (!t) { results.push({ id, ok: false, message: "Test not found." }); continue; }
    const why = R.bulkBlockReason(action, t, ctx);
    if (why) { results.push({ id, title: t.title, ok: false, message: why }); continue; }
    if (action === "publish" || action === "unpublish") {
      try { await testsService.setPublished(actor, id, action === "publish"); results.push({ id, title: t.title, ok: true }); }
      catch (e) { results.push({ id, title: t.title, ok: false, message: e.extra?.problems?.length ? `${e.message} ${e.extra.problems.join("; ")}` : e.message || "Could not change this test." }); }
      continue;
    }
    if (["star", "unstar", "hide", "unhide", "move"].includes(action)) {
      const patch = action === "star" ? { starred: true } : action === "unstar" ? { starred: false } : action === "hide" ? { hidden: true } : action === "unhide" ? { hidden: false } : { folderId };
      ops.push(prisma.testUserState.upsert({ where: { userId_testId: { userId, testId: id } }, create: { userId, testId: id, ...patch }, update: patch }));
      // filing a test into an archive folder also archives it, when the person is allowed to (otherwise it is only filed)
      if (archiveFolder && !t.archivedAt && ctx.owns(t)) ops.push(prisma.test.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } }));
    } else if (action === "archive") ops.push(prisma.test.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } }));
    else if (action === "restore") ops.push(prisma.test.updateMany({ where: { id, archivedAt: { not: null } }, data: { archivedAt: null } }));
    else if (action === "activate") ops.push(prisma.test.updateMany({ where: { id }, data: { isActive: true } }));
    else if (action === "deactivate") ops.push(prisma.test.updateMany({ where: { id }, data: { isActive: false } }));
    results.push({ id, title: t.title, ok: true });
  }
  if (ops.length) await prisma.$transaction(ops);
  const okIds = results.filter((r) => r.ok).map((r) => r.id);
  const changesTests = !["star", "unstar", "hide", "unhide", "move"].includes(action);
  if (okIds.length) await audit(actor, changesTests ? AUDIT_ACTIONS.TEST_STATE_CHANGED : AUDIT_ACTIONS.TEST_FOLDER_CHANGED, { operation: `bulk_${action}`, testIds: okIds, folderId: action === "move" ? folderId : undefined });
  return { action, requested: ids.length, succeeded: okIds.length, failed: results.length - okIds.length, results };
}

// One test's results per academic group, kept apart: a row names its department, batch and section and is never merged with another group's row. Reads the existing attempts; writes nothing.
async function testResultsByGroup(actor, testId) {
  const test = await prisma.test.findFirst({ where: { AND: [baseWhere(actor), { id: String(testId) }] }, select: { id: true, title: true, passingMarks: true, createdById: true, instituteId: true, shares: { select: { staffId: true } } } });
  if (!test) throw new ServiceError(404, "Test not found");
  const attempts = await prisma.testAttempt.findMany({ where: { testId: test.id, status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } }, select: { totalScore: true, student: { select: { academicGroupId: true } } } });
  const assigned = await prisma.testAcademicGroup.findMany({ where: { testId: test.id }, select: { academicGroupId: true } });
  const groupIds = [...new Set([...attempts.map((a) => a.student.academicGroupId).filter(Boolean), ...assigned.map((a) => a.academicGroupId)])];
  const groups = groupIds.length ? await prisma.academicGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, batch: true, section: true, department: { select: { id: true, name: true } }, _count: { select: { users: { where: { role: "STUDENT" } } } } } }) : [];
  const by = new Map(groups.map((g) => [g.id, { group: { id: g.id, department: g.department?.name || null, departmentId: g.department?.id || null, batch: g.batch, section: g.section, label: groupLabel(g) }, students: g._count.users, attempted: 0, sum: 0, best: null, passed: 0 }]));
  const unassigned = { group: { id: null, label: "Not in an academic group" }, students: null, attempted: 0, sum: 0, best: null, passed: 0 };
  for (const a of attempts) {
    const row = (a.student.academicGroupId && by.get(a.student.academicGroupId)) || unassigned;
    row.attempted++; row.sum += a.totalScore; row.best = row.best === null ? a.totalScore : Math.max(row.best, a.totalScore);
    if (test.passingMarks != null && a.totalScore >= test.passingMarks) row.passed++;
  }
  const fmt = (r) => ({ ...r.group, students: r.students, attempted: r.attempted, averageScore: r.attempted ? Math.round((r.sum / r.attempted) * 100) / 100 : null, bestScore: r.best, passed: test.passingMarks != null ? r.passed : null, passRate: test.passingMarks != null && r.attempted ? Math.round((r.passed / r.attempted) * 1000) / 10 : null });
  const rows = [...by.values()].map(fmt).sort((a, b) => a.label.localeCompare(b.label));
  if (unassigned.attempted) rows.push(fmt(unassigned));
  return { test: { id: test.id, title: test.title, passingMarks: test.passingMarks }, groups: rows, note: "Scores are the scores stored on each submitted attempt, unchanged. Each row is one academic group; rows are never combined." };
}

module.exports = { overview, listTests, listFolders, createFolder, updateFolder, deleteFolder, bulk, testResultsByGroup, baseWhere, ownsTest, seriesScope, isAdminRole, audit, clampInt, groupLabel };
