// Test Series for staff and administrators: build an ordered series from EXISTING tests, publish it, and assign it to academic groups and Talent Pools.
//
// A series owns no questions, no schedule for its tests and no results. Each test keeps its own window, eligibility and attempts; a student's progress is read from the attempts that already
// exist. So a series can never bypass a test's rules: assigning one checks that every test is already open to the group or pool (and, only where it is safe and the person may, adds the group
// to the test), and opening a test is still decided by the existing test engine.
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { AUDIT_ACTIONS } = require("../../utils/auditLog");
const R = require("../../utils/testManagementRules");
const M = require("./testManagement.service");

const MAX_ITEMS = 50;
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const MODES = ["FLEXIBLE", "SEQUENTIAL"];
const RULES = ["ATTEMPTED", "PASSED"];
const { audit, baseWhere, ownsTest, seriesScope, isAdminRole, clampInt, groupLabel } = M;

const text = (v, max) => { const s = String(v ?? "").trim(); return s ? s.slice(0, max) : null; };
function url(v) {
  const s = text(v, 500);
  if (!s) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(s)) throw new ServiceError(400, "The cover image must be a web address starting with http:// or https://.");
  return s;
}

// A series the person may look at / change: staff their own, an administrator the institute's.
async function loadSeries(actor, id, include) {
  const s = await prisma.testSeries.findFirst({ where: { AND: [seriesScope(actor), { id: String(id) }] }, ...(include ? { include } : {}) });
  if (!s) throw new ServiceError(404, "Series not found"); // another person's series is not confirmed to exist
  return s;
}

function lifecycleOfSeries(s) {
  return { status: s.status, published: s.status === "PUBLISHED", active: s.isActive !== false, archived: !!s.archivedAt };
}

async function listSeries(actor, q = {}) {
  const page = clampInt(q.page, 1, 100000, 1);
  const pageSize = clampInt(q.pageSize, 5, 100, 20);
  const and = [seriesScope(actor)];
  const st = String(q.status || "all");
  if (st === "draft") and.push({ status: "DRAFT", archivedAt: null });
  else if (st === "published") and.push({ status: "PUBLISHED", archivedAt: null });
  else if (st === "active") and.push({ status: "PUBLISHED", isActive: true, archivedAt: null });
  else if (st === "inactive") and.push({ isActive: false, archivedAt: null });
  else if (st === "archived") and.push({ archivedAt: { not: null } });
  else and.push({ archivedAt: null });
  const t = String(q.q || "").trim().slice(0, 100);
  if (t) and.push({ OR: [{ title: { contains: t, mode: "insensitive" } }, { subject: { contains: t, mode: "insensitive" } }] });
  const where = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.testSeries.count({ where }),
    prisma.testSeries.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { createdBy: { select: { name: true } }, _count: { select: { items: true, assignments: true } } } }),
  ]);
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), rows: rows.map((s) => ({ id: s.id, title: s.title, description: s.description, subject: s.subject, difficulty: s.difficulty, accessMode: s.accessMode, tests: s._count.items, assignments: s._count.assignments, owner: s.createdBy?.name || null, updatedAt: s.updatedAt, lifecycle: lifecycleOfSeries(s) })) };
}

// ---- items ----------------------------------------------------------------------------------------------------------------------------------------------------------
// The tests must be ones this person can see, must exist exactly once, and must not be archived. Returns them in the order given.
async function resolveItems(actor, testIds) {
  const ids = (Array.isArray(testIds) ? testIds : []).map(String);
  if (new Set(ids).size !== ids.length) throw new ServiceError(400, "A test can be in a series only once.");
  if (ids.length > MAX_ITEMS) throw new ServiceError(400, `A series can hold at most ${MAX_ITEMS} tests.`);
  if (!ids.length) return [];
  const tests = await prisma.test.findMany({ where: { AND: [baseWhere(actor), { id: { in: ids } }] }, select: { id: true, title: true, archivedAt: true } });
  const byId = new Map(tests.map((t) => [t.id, t]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new ServiceError(400, "Some of those tests were not found or are not yours to use.", { missing });
  const archived = tests.filter((t) => t.archivedAt).map((t) => t.title);
  if (archived.length) throw new ServiceError(400, `Archived tests cannot be added: ${archived.join(", ")}. Restore them first.`);
  return ids;
}

function seriesData(body, partial = false) {
  const data = {};
  const has = (k) => !partial || body[k] !== undefined;
  if (has("title")) { data.title = text(body.title, 140); if (!data.title) throw new ServiceError(400, "Enter a series title."); }
  if (has("description")) data.description = text(body.description, 2000);
  if (has("coverUrl")) data.coverUrl = url(body.coverUrl);
  if (has("subject")) data.subject = text(body.subject, 80);
  if (has("difficulty")) { const dif = body.difficulty ? String(body.difficulty).toUpperCase() : null; if (dif && !DIFFICULTIES.includes(dif)) throw new ServiceError(400, "Difficulty must be Easy, Medium or Hard."); data.difficulty = dif; }
  if (has("accessMode")) { const m = String(body.accessMode || "FLEXIBLE").toUpperCase(); if (!MODES.includes(m)) throw new ServiceError(400, "Access must be Flexible or Sequential."); data.accessMode = m; }
  if (has("unlockRule")) { const r = String(body.unlockRule || "ATTEMPTED").toUpperCase(); if (!RULES.includes(r)) throw new ServiceError(400, "The unlock rule must be Attempted or Passed."); data.unlockRule = r; }
  return data;
}

async function createSeries(actor, body) {
  const data = seriesData(body);
  const testIds = await resolveItems(actor, body.testIds);
  const created = await prisma.$transaction(async (tx) => {
    const s = await tx.testSeries.create({ data: { ...data, createdById: actor.user.id, instituteId: actor.requesterInstituteId || null } });
    if (testIds.length) await tx.testSeriesItem.createMany({ data: testIds.map((testId, i) => ({ seriesId: s.id, testId, position: i + 1 })) });
    return s;
  });
  await audit(actor, AUDIT_ACTIONS.TEST_SERIES_CHANGED, { operation: "create", seriesId: created.id, title: created.title, tests: testIds.length });
  return getSeries(actor, created.id);
}

async function updateSeries(actor, id, body) {
  const s = await loadSeries(actor, id);
  if (s.archivedAt) throw new ServiceError(409, "Restore this series before changing it.");
  if (body.version !== undefined && Number(body.version) !== s.version) throw new ServiceError(409, "Someone else changed this series while you were editing. Reload it and try again.", { currentVersion: s.version });
  const data = seriesData(body, true);
  const replace = body.testIds !== undefined;
  const testIds = replace ? await resolveItems(actor, body.testIds) : null;
  if (replace && !testIds.length && s.status === "PUBLISHED") throw new ServiceError(400, "A published series needs at least one test. Unpublish it first.");
  await prisma.$transaction(async (tx) => {
    // The version is part of the condition, so two people saving at the same moment cannot both win.
    const won = await tx.testSeries.updateMany({ where: { id: s.id, version: s.version }, data: { ...data, version: { increment: 1 } } });
    if (!won.count) throw new ServiceError(409, "Someone else changed this series while you were editing. Reload it and try again.");
    if (replace) {
      await tx.testSeriesItem.deleteMany({ where: { seriesId: s.id } }); // removes the links only; the tests, their attempts and results are untouched
      if (testIds.length) await tx.testSeriesItem.createMany({ data: testIds.map((testId, i) => ({ seriesId: s.id, testId, position: i + 1 })) });
    }
  });
  await audit(actor, AUDIT_ACTIONS.TEST_SERIES_CHANGED, { operation: "update", seriesId: s.id, changed: Object.keys(data), testsReplaced: replace ? testIds.length : undefined });
  return getSeries(actor, s.id);
}

async function getSeries(actor, id) {
  const s = await loadSeries(actor, id, {
    createdBy: { select: { name: true } },
    items: { orderBy: { position: "asc" }, include: { test: { select: { id: true, title: true, isPublished: true, isActive: true, archivedAt: true, startTime: true, endTime: true, durationMin: true, passingMarks: true, _count: { select: { questions: true } } } } } },
    assignments: { orderBy: { createdAt: "asc" }, include: { academicGroup: { select: { id: true, batch: true, section: true, department: { select: { name: true } }, _count: { select: { users: { where: { role: "STUDENT" } } } } } }, pool: { select: { id: true, name: true, _count: { select: { members: true } } } } } },
  });
  const now = new Date();
  return {
    id: s.id, title: s.title, description: s.description, coverUrl: s.coverUrl, subject: s.subject, difficulty: s.difficulty, accessMode: s.accessMode, unlockRule: s.unlockRule, version: s.version,
    owner: s.createdBy?.name || null, canManage: true, lifecycle: lifecycleOfSeries(s), updatedAt: s.updatedAt,
    items: s.items.map((i) => ({ testId: i.testId, position: i.position, title: i.test.title, durationMin: i.test.durationMin, questions: i.test._count.questions, passingMarks: i.test.passingMarks, startTime: i.test.startTime, endTime: i.test.endTime, lifecycle: R.lifecycleOf(i.test, now) })),
    assignments: s.assignments.map((a) => ({
      id: a.id, type: a.academicGroupId ? "ACADEMIC_GROUP" : "TALENT_POOL", targetId: a.academicGroupId || a.poolId, label: a.academicGroup ? groupLabel(a.academicGroup) : a.pool?.name,
      students: a.academicGroup ? a.academicGroup._count.users : a.pool?._count.members ?? null,
      startAt: a.startAt, endAt: a.endAt, noExpiry: a.noExpiry, completionDeadline: a.completionDeadline, instructions: a.instructions, isActive: a.isActive,
      availability: R.seriesAvailability(s, a, now),
    })),
  };
}

// publish / unpublish / activate / deactivate / archive / restore. Each is its own decision; none deletes anything.
async function seriesAction(actor, id, action) {
  const s = await loadSeries(actor, id, { _count: { select: { items: true } } });
  const patch = {};
  if (action === "publish") {
    if (s.archivedAt) throw new ServiceError(409, "Restore this series first.");
    if (!s._count.items) throw new ServiceError(400, "Add at least one test before publishing.");
    const unusable = await prisma.testSeriesItem.count({ where: { seriesId: s.id, test: { archivedAt: { not: null } } } });
    if (unusable) throw new ServiceError(400, "The series contains an archived test. Restore it or remove it from the series first.");
    patch.status = "PUBLISHED";
  } else if (action === "unpublish") patch.status = "DRAFT";
  else if (action === "activate") patch.isActive = true;
  else if (action === "deactivate") patch.isActive = false;
  else if (action === "archive") patch.archivedAt = new Date();
  else if (action === "restore") patch.archivedAt = null;
  else throw new ServiceError(400, "Unknown action.");
  await prisma.testSeries.update({ where: { id: s.id }, data: { ...patch, version: { increment: 1 } } });
  await audit(actor, AUDIT_ACTIONS.TEST_SERIES_CHANGED, { operation: action, seriesId: s.id, title: s.title });
  return getSeries(actor, s.id);
}

// ---- assignment ---------------------------------------------------------------------------------------------------------------------------------------------------
// What a person may assign to. Academic groups: those of their own institute (the rule the existing test assignment already uses). Talent Pools: administrators only, and only pools of
// their institute, as with assigning a test to a pool today.
async function assignmentOptions(actor, q = {}) {
  const instituteId = actor.requesterInstituteId || (q.instituteId ? String(q.instituteId) : null);
  const groups = await prisma.academicGroup.findMany({
    where: { ...(instituteId ? { instituteId } : {}), isActive: true }, orderBy: [{ batch: "desc" }, { id: "asc" }], take: 1000,
    select: { id: true, batch: true, section: true, instituteId: true, department: { select: { id: true, name: true } }, _count: { select: { users: { where: { role: "STUDENT" } } } } },
  });
  const pools = isAdminRole(actor) ? await prisma.talentPool.findMany({
    where: { isActive: true, ...(instituteId ? { institutes: { some: { instituteId } } } : {}) }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, _count: { select: { members: true } } },
  }) : [];
  return {
    canAssignPools: isAdminRole(actor),
    groups: groups.map((g) => ({ id: g.id, label: groupLabel(g), department: g.department?.name || null, departmentId: g.department?.id || null, batch: g.batch, section: g.section, students: g._count.users })),
    pools: pools.map((p) => ({ id: p.id, name: p.name, students: p._count.members })),
  };
}

// Is a test already open to this academic group / pool, by the existing eligibility rules? `test` carries its academicGroups, classes, talentPools and instituteId.
function openToGroup(test, group) {
  if (test.talentPools.length) return false; // pool-exclusive: not reachable through an academic group
  if (!test.academicGroups.length && !test.classes.length) return test.instituteId == null || test.instituteId === group.instituteId;
  return test.academicGroups.some((g) => g.academicGroupId === group.id);
}
const openToPool = (test, poolId) => test.talentPools.some((p) => p.poolId === poolId);

async function targetsFor(actor, body) {
  const gIds = [...new Set((Array.isArray(body.academicGroupIds) ? body.academicGroupIds : []).map(String))];
  const pIds = [...new Set((Array.isArray(body.poolIds) ? body.poolIds : []).map(String))];
  if (!gIds.length && !pIds.length) throw new ServiceError(400, "Choose at least one academic group or Talent Pool.");
  if (gIds.length + pIds.length > 50) throw new ServiceError(400, "Choose at most 50 groups and pools at a time.");
  if (pIds.length && !isAdminRole(actor)) throw new ServiceError(403, "Only an administrator can assign a series to a Talent Pool.");
  const groups = gIds.length ? await prisma.academicGroup.findMany({ where: { id: { in: gIds }, ...(actor.requesterInstituteId ? { instituteId: actor.requesterInstituteId } : {}) }, select: { id: true, batch: true, section: true, instituteId: true, department: { select: { name: true } }, _count: { select: { users: { where: { role: "STUDENT" } } } } } }) : [];
  if (groups.length !== gIds.length) throw new ServiceError(403, "You can only assign to academic groups of your own institute.");
  const pools = pIds.length ? await prisma.talentPool.findMany({ where: { id: { in: pIds }, isActive: true, ...(actor.requesterInstituteId ? { institutes: { some: { instituteId: actor.requesterInstituteId } } } : {}) }, select: { id: true, name: true, _count: { select: { members: true } } } }) : [];
  if (pools.length !== pIds.length) throw new ServiceError(403, "You can only assign to Talent Pools of your own institute.");
  return { groups, pools };
}

// Everything the confirmation screen needs, and nothing is written.
async function previewAssignment(actor, seriesId, body) {
  const s = await loadSeries(actor, seriesId);
  const { groups, pools } = await targetsFor(actor, body);
  const items = await prisma.testSeriesItem.findMany({ where: { seriesId: s.id }, orderBy: { position: "asc" }, select: { test: { select: { id: true, title: true, instituteId: true, createdById: true, shares: { select: { staffId: true } }, academicGroups: { select: { academicGroupId: true } }, classes: { select: { classId: true } }, talentPools: { select: { poolId: true } } } } } });
  const tests = items.map((i) => i.test);
  const existing = await prisma.testSeriesAssignment.findMany({ where: { seriesId: s.id, OR: [{ academicGroupId: { in: groups.map((g) => g.id) } }, { poolId: { in: pools.map((p) => p.id) } }] } });
  const targets = [
    ...groups.map((g) => ({ type: "ACADEMIC_GROUP", id: g.id, label: groupLabel(g), students: g._count.users, existing: existing.find((a) => a.academicGroupId === g.id) || null, missing: tests.filter((t) => !openToGroup(t, g)).map((t) => ({ id: t.id, title: t.title, canAutoAssign: !t.talentPools.length && ownsTest(actor, t) && (t.academicGroups.length > 0 || t.classes.length > 0) })) })),
    ...pools.map((p) => ({ type: "TALENT_POOL", id: p.id, label: p.name, students: p._count.members, existing: existing.find((a) => a.poolId === p.id) || null, missing: tests.filter((t) => !openToPool(t, p.id)).map((t) => ({ id: t.id, title: t.title, canAutoAssign: false })) })),
  ];
  return { series: { id: s.id, title: s.title, tests: tests.length }, targets, totalStudents: targets.reduce((a, t) => a + (t.students || 0), 0), note: "A series never opens a test by itself: every test must already be open to the group or pool. Tests listed as missing are shown to those students as unavailable." };
}

async function createAssignments(actor, seriesId, body) {
  if (body.confirm !== true) throw new ServiceError(409, "Please confirm the assignment.", { needsConfirmation: true });
  const s = await loadSeries(actor, seriesId);
  if (s.archivedAt) throw new ServiceError(409, "Restore this series before assigning it.");
  const win = R.validateAssignmentWindow(body);
  if (!win.ok) throw new ServiceError(400, win.errors[0].message, { errors: win.errors });
  const preview = await previewAssignment(actor, seriesId, body);
  const duplicates = preview.targets.filter((t) => t.existing);
  const fresh = preview.targets.filter((t) => !t.existing);
  const alsoAssign = body.alsoAssignTests === true;
  const instructions = text(body.instructions, 2000);
  const testsAssigned = [];
  const created = [];
  await prisma.$transaction(async (tx) => {
    for (const t of fresh) {
      const row = await tx.testSeriesAssignment.create({ data: { seriesId: s.id, academicGroupId: t.type === "ACADEMIC_GROUP" ? t.id : null, poolId: t.type === "TALENT_POOL" ? t.id : null, ...win.value, instructions, createdById: actor.user.id } });
      created.push({ id: row.id, type: t.type, label: t.label });
      // Only when the person asked, only for a test that is ALREADY limited to certain groups (adding a group then widens it), and only if they may change that test. A test that is open
      // to the whole institute needs nothing, and a pool-exclusive test is never touched.
      if (alsoAssign && t.type === "ACADEMIC_GROUP") {
        for (const m of t.missing.filter((x) => x.canAutoAssign)) {
          await tx.testAcademicGroup.createMany({ data: [{ testId: m.id, academicGroupId: t.id }], skipDuplicates: true });
          testsAssigned.push({ testId: m.id, title: m.title, academicGroupId: t.id });
        }
      }
    }
  });
  const stillMissing = fresh.map((t) => ({ target: t.label, tests: t.missing.filter((m) => !(alsoAssign && t.type === "ACADEMIC_GROUP" && m.canAutoAssign)).map((m) => m.title) })).filter((r) => r.tests.length);
  await audit(actor, AUDIT_ACTIONS.TEST_SERIES_ASSIGNMENT_CHANGED, { operation: "assign", seriesId: s.id, created: created.map((c) => c.id), duplicates: duplicates.length, testsAssigned: testsAssigned.length });
  return { created, duplicates: duplicates.map((d) => ({ type: d.type, label: d.label, assignmentId: d.existing.id })), testsAssigned, stillMissing };
}

// A controlled change to an assignment that already exists (window, instructions, on/off). Never touches attempts or results.
async function updateAssignment(actor, seriesId, assignmentId, body) {
  const s = await loadSeries(actor, seriesId);
  const a = await prisma.testSeriesAssignment.findFirst({ where: { id: String(assignmentId), seriesId: s.id } });
  if (!a) throw new ServiceError(404, "Assignment not found");
  const data = {};
  if (body.startAt !== undefined || body.endAt !== undefined || body.noExpiry !== undefined || body.completionDeadline !== undefined) {
    const win = R.validateAssignmentWindow({ startAt: body.startAt ?? a.startAt, endAt: body.noExpiry === true ? null : (body.endAt !== undefined ? body.endAt : a.endAt), noExpiry: body.noExpiry !== undefined ? body.noExpiry : a.noExpiry, completionDeadline: body.completionDeadline !== undefined ? body.completionDeadline : a.completionDeadline });
    if (!win.ok) throw new ServiceError(400, win.errors[0].message, { errors: win.errors });
    Object.assign(data, win.value);
  }
  if (body.instructions !== undefined) data.instructions = text(body.instructions, 2000);
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  const out = await prisma.testSeriesAssignment.update({ where: { id: a.id }, data });
  await audit(actor, AUDIT_ACTIONS.TEST_SERIES_ASSIGNMENT_CHANGED, { operation: "update", seriesId: s.id, assignmentId: a.id, changed: Object.keys(data) });
  return out;
}

async function removeAssignment(actor, seriesId, assignmentId) {
  const s = await loadSeries(actor, seriesId);
  const a = await prisma.testSeriesAssignment.findFirst({ where: { id: String(assignmentId), seriesId: s.id } });
  if (!a) throw new ServiceError(404, "Assignment not found");
  await prisma.testSeriesAssignment.delete({ where: { id: a.id } }); // students' attempts and results are on the tests, so they are unaffected
  await audit(actor, AUDIT_ACTIONS.TEST_SERIES_ASSIGNMENT_CHANGED, { operation: "remove", seriesId: s.id, assignmentId: a.id });
  return { removed: true };
}

// Every assignment of every series this person can see, newest first, for the Assignments screen. Paged on the server.
async function listAssignments(actor, q = {}) {
  const page = clampInt(q.page, 1, 100000, 1);
  const pageSize = clampInt(q.pageSize, 5, 100, 25);
  const where = { series: { AND: [seriesScope(actor), { archivedAt: null }] } };
  const [total, rows] = await Promise.all([
    prisma.testSeriesAssignment.count({ where }),
    prisma.testSeriesAssignment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { series: { select: { id: true, title: true, status: true, isActive: true, archivedAt: true } }, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } }, _count: { select: { users: { where: { role: "STUDENT" } } } } } }, pool: { select: { name: true, _count: { select: { members: true } } } } } }),
  ]);
  const now = new Date();
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), rows: rows.map((a) => ({ id: a.id, seriesId: a.series.id, series: a.series.title, type: a.academicGroupId ? "ACADEMIC_GROUP" : "TALENT_POOL", target: a.academicGroup ? groupLabel(a.academicGroup) : a.pool?.name, students: a.academicGroup ? a.academicGroup._count.users : a.pool?._count.members ?? null, startAt: a.startAt, endAt: a.endAt, noExpiry: a.noExpiry, completionDeadline: a.completionDeadline, isActive: a.isActive, availability: R.seriesAvailability(a.series, a, now) })) };
}

module.exports = { listAssignments, listSeries, createSeries, updateSeries, getSeries, seriesAction, assignmentOptions, previewAssignment, createAssignments, updateAssignment, removeAssignment, loadSeries, MAX_ITEMS };
