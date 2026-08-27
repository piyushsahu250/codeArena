const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { cached, invalidate } = require("../utils/cache");
const { isStudentTalentPoolMember } = require("../utils/talentPoolEligibility");
const { canStaffAccessTest } = require("../utils/testOwnership");
const { computeTalentPoolRank, computeTalentPoolInterviewRank } = require("../utils/talentPoolRank");
const { previewAutoSelection, runAutoSelection } = require("../utils/talentPoolAutoSelect");
const { notifyPoolAdded, notifyPoolRemoved, notifyAssessmentAssigned } = require("../utils/notifications");
const { generateTalentPoolPdf } = require("../utils/talentPoolPdf");
const { spreadsheetFileFilter } = require("../utils/uploadFilters");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });

const MEMBER_SELECT = { id: true, name: true, email: true, rollNumber: true, registrationNumber: true };
const INSTITUTES_INCLUDE = { institutes: { include: { institute: { select: { id: true, name: true } } } } };

// A pool can span multiple institutes (TalentPoolInstitute join table) — this helper loads a pool
// with that list and enforces the same institute-boundary rule everywhere: an institute-scoped
// requester (STAFF, or an ADMIN whose own account is pinned to one institute) may only reach a
// pool if their institute is one of its configured institutes, OR the pool has no institutes
// configured at all (a platform-level pool, same permissiveness the old single-instituteId design
// had for instituteId === null).
async function loadPoolScoped(req, res, poolId) {
  const pool = await prisma.talentPool.findUnique({ where: { id: poolId }, include: INSTITUTES_INCLUDE });
  if (!pool) { res.status(404).json({ error: "Talent Pool not found" }); return null; }
  const instituteIds = pool.institutes.map((i) => i.instituteId);
  if (req.requesterInstituteId && instituteIds.length && !instituteIds.includes(req.requesterInstituteId)) {
    res.status(403).json({ error: "You can only manage Talent Pools under your own institute" });
    return null;
  }
  return pool;
}

function poolInstituteIds(pool) {
  return pool.institutes.map((i) => i.instituteId);
}

// =========================== Pool CRUD ===========================

router.get("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const { status, search } = req.query;
  const where = {};
  const effectiveInstituteId = req.requesterInstituteId || req.query.instituteId;
  if (effectiveInstituteId) where.institutes = { some: { instituteId: effectiveInstituteId } };
  // STAFF may only ever see active pools — an inactive/archived pool is an admin-management
  // concern, not something Staff should browse or be tempted to add students into (spec: "Staff
  // should NOT see all Talent Pools ... only Active"). Unlike ADMIN/SUPER_ADMIN/INSTITUTE_ADMIN,
  // this is a hard floor Staff can't lift via the status query param, not just a default.
  if (req.user.role === "STAFF") where.isActive = true;
  else if (status === "active") where.isActive = true;
  else if (status === "inactive") where.isActive = false;
  if (search && search.trim()) where.name = { contains: search.trim(), mode: "insensitive" };

  const pools = await prisma.talentPool.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { ...INSTITUTES_INCLUDE, _count: { select: { members: true, testAssignments: true, interviewConfigs: true } } },
  });
  res.json(pools);
});

router.post("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Pool name is required" });

    // An institute-scoped admin can only ever create a pool covering their own institute; an
    // unscoped (platform) admin may pick any set, including none (platform-level pool).
    let instituteIds = req.requesterInstituteId
      ? [req.requesterInstituteId]
      : [...new Set((Array.isArray(req.body.instituteIds) ? req.body.instituteIds : []).filter(Boolean))];

    if (instituteIds.length) {
      const validCount = await prisma.institute.count({ where: { id: { in: instituteIds } } });
      if (validCount !== instituteIds.length) return res.status(400).json({ error: "One or more selected institutes were not found" });
    }

    const pool = await prisma.talentPool.create({
      data: {
        name: name.trim(),
        description: description || null,
        createdById: req.user.id,
        institutes: { create: instituteIds.map((instituteId) => ({ instituteId })) },
      },
      include: INSTITUTES_INCLUDE,
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: instituteIds[0] || null, details: { poolId: pool.id, name: pool.name, instituteIds },
    });
    res.json(pool);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create Talent Pool" });
  }
});

// Registered BEFORE the generic GET /:id below — Express matches routes in registration order,
// and single-segment paths like "/my-pools" or "/analytics" would otherwise be swallowed by
// "/:id" (with id="my-pools"/"analytics").
router.get("/my-pools", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("talent_pool"), async (req, res) => {
  // pool: { isActive: true } — a student must never see membership/exclusive-assessment detail for
  // a pool an admin has deactivated (spec: "Do not expose ... Inactive Talent Pools"). Previously
  // this route showed every membership regardless of the pool's current active state.
  const memberships = await prisma.talentPoolMember.findMany({
    where: { studentId: req.user.id, pool: { isActive: true } },
    include: {
      pool: {
        include: {
          testAssignments: {
            include: {
              test: {
                select: { id: true, title: true, startTime: true, endTime: true, isPublished: true, durationMin: true, _count: { select: { questions: true } } },
              },
            },
          },
          interviewConfigs: { where: { isActive: true }, select: { id: true, label: true } },
        },
      },
    },
  });

  // Batched (one query for every exclusive test across every pool this student belongs to), not
  // per-test — same "myStatus" shape GET /tests already gives students, so the frontend can tell
  // Completed apart from Upcoming/Live/Closed instead of guessing from isPublished alone.
  const allTestIds = memberships.flatMap((m) => m.pool.testAssignments.map((t) => t.testId));
  const myAttempts = allTestIds.length
    ? await prisma.testAttempt.findMany({ where: { studentId: req.user.id, testId: { in: allTestIds } }, select: { testId: true, status: true } })
    : [];
  const statusByTest = Object.fromEntries(myAttempts.map((a) => [a.testId, a.status]));

  // Sequential, not Promise.all(map(...)) — each membership fans out into its own rank lookups
  // (each of which is itself a 2-way Promise.all internally), so a student in several pools could
  // fire many simultaneous pool connections from one request. Same pool-contention reasoning as
  // auth.js/dashboard.js; this route is hit by every student opening "My Talent Pools" at once
  // after a pool announcement.
  const result = [];
  for (const m of memberships) {
    const testRank = await computeTalentPoolRank(req.user.id, m.poolId);
    const interviewRank = await computeTalentPoolInterviewRank(req.user.id, m.poolId);
    result.push({
      pool: { id: m.pool.id, name: m.pool.name, description: m.pool.description },
      addedVia: m.addedVia,
      addedAt: m.addedAt,
      exclusiveTests: m.pool.testAssignments.map((t) => ({ ...t.test, myStatus: statusByTest[t.test.id] || null })),
      interviewConfigs: m.pool.interviewConfigs,
      testRank,
      interviewRank,
    });
  }
  res.json(result);
});

// =========================== Analytics (platform/institute-wide, across all pools) ===========================
// Registered before "/:id" for the same route-ordering reason as "/my-pools" above.

router.get("/analytics", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const cacheKey = `talentPoolAnalytics:${req.requesterInstituteId || "all"}:${JSON.stringify(req.query)}`;
    const result = await cached(cacheKey, 60 * 1000, () => computeTalentPoolAnalytics(req));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute analytics" });
  }
});

// Extracted so the route above can wrap it in cached() — recomputing this from scratch on every
// request was wasted work despite the queries themselves already being well-batched.
async function computeTalentPoolAnalytics(req) {
    const { poolId, instituteId, departmentId, testId, dateFrom, dateTo } = req.query;

    const poolWhere = {};
    const effectiveInstituteId = req.requesterInstituteId || instituteId;
    if (effectiveInstituteId) poolWhere.institutes = { some: { instituteId: effectiveInstituteId } };
    if (poolId) poolWhere.id = poolId;
    if (dateFrom || dateTo) {
      poolWhere.createdAt = {};
      if (dateFrom) poolWhere.createdAt.gte = new Date(dateFrom);
      if (dateTo) poolWhere.createdAt.lte = new Date(dateTo);
    }

    const pools = await prisma.talentPool.findMany({ where: poolWhere, select: { id: true, name: true, isActive: true } });
    const poolIds = pools.map((p) => p.id);
    const totalPools = pools.length;
    const activePools = pools.filter((p) => p.isActive).length;
    const inactivePools = totalPools - activePools;

    if (poolIds.length === 0) {
      return {
        totals: { totalPools: 0, activePools: 0, inactivePools: 0, totalStudents: 0 },
        perPool: [], instituteWise: [], departmentWise: [],
        assessmentParticipation: { assigned: 0, completed: 0, completionRatePercent: 0 },
        scores: { average: null, highest: null, lowest: null },
      };
    }

    const memberWhere = { poolId: { in: poolIds } };
    if (departmentId) memberWhere.student = { academicGroup: { departmentId } };

    const [members, perPoolCounts] = await Promise.all([
      prisma.talentPoolMember.findMany({
        where: memberWhere,
        select: {
          poolId: true,
          student: {
            select: {
              id: true,
              institute: { select: { name: true } },
              academicGroup: { select: { department: { select: { id: true, name: true } } } },
            },
          },
        },
      }),
      prisma.talentPoolMember.groupBy({ by: ["poolId"], where: { poolId: { in: poolIds } }, _count: { _all: true } }),
    ]);

    const totalStudents = new Set(members.map((m) => m.student.id)).size;

    const instituteCounts = new Map();
    const departmentCounts = new Map();
    for (const m of members) {
      const iName = m.student.institute?.name || "Unassigned";
      instituteCounts.set(iName, (instituteCounts.get(iName) || 0) + 1);
      const dept = m.student.academicGroup?.department;
      const dKey = dept ? dept.id : "unassigned";
      const dName = dept ? dept.name : "Unassigned";
      const existing = departmentCounts.get(dKey) || { departmentId: dKey, name: dName, count: 0 };
      existing.count += 1;
      departmentCounts.set(dKey, existing);
    }

    const countByPool = new Map(perPoolCounts.map((c) => [c.poolId, c._count._all]));
    const perPool = pools.map((p) => ({ poolId: p.id, name: p.name, memberCount: countByPool.get(p.id) || 0 }));

    const testWhere = { poolId: { in: poolIds } };
    if (testId) testWhere.testId = testId;
    const poolTests = await prisma.talentPoolTest.findMany({ where: testWhere, select: { testId: true } });
    const testIds = [...new Set(poolTests.map((t) => t.testId))];
    const memberIds = [...new Set(members.map((m) => m.student.id))];

    const [attempts, tests] = await Promise.all([
      testIds.length && memberIds.length
        ? prisma.testAttempt.findMany({
            where: { testId: { in: testIds }, studentId: { in: memberIds }, status: { not: "IN_PROGRESS" } },
            select: { testId: true, totalScore: true },
          })
        : [],
      testIds.length
        ? prisma.test.findMany({ where: { id: { in: testIds } }, select: { id: true, questions: { select: { question: { select: { points: true } } } } } })
        : [],
    ]);
    const maxByTest = new Map(tests.map((t) => [t.id, t.questions.reduce((s, q) => s + q.question.points, 0)]));
    const scorePercents = attempts
      .map((a) => { const max = maxByTest.get(a.testId) || 0; return max > 0 ? (a.totalScore / max) * 100 : null; })
      .filter((p) => p != null);

    // "Assigned" = every (pool-exclusive test) x (pool member) pairing — the maximum number of
    // attempts that could theoretically exist; "Completed" = how many actually do.
    const assigned = testIds.length * memberIds.length;
    const completed = attempts.length;

    return {
      totals: { totalPools, activePools, inactivePools, totalStudents },
      perPool,
      instituteWise: [...instituteCounts.entries()].map(([name, count]) => ({ name, count })),
      departmentWise: [...departmentCounts.values()],
      assessmentParticipation: { assigned, completed, completionRatePercent: assigned > 0 ? Math.round((completed / assigned) * 100) : 0 },
      scores: {
        average: scorePercents.length ? Math.round(scorePercents.reduce((s, p) => s + p, 0) / scorePercents.length) : null,
        highest: scorePercents.length ? Math.round(Math.max(...scorePercents)) : null,
        lowest: scorePercents.length ? Math.round(Math.min(...scorePercents)) : null,
      },
    };
}

router.get("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  res.json(pool);
});

router.patch("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const data = {};
    for (const key of ["name", "description", "isActive"]) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    if (Array.isArray(req.body.instituteIds)) {
      const instituteIds = [...new Set(req.body.instituteIds.filter(Boolean))];
      if (req.requesterInstituteId && !instituteIds.every((id) => id === req.requesterInstituteId)) {
        return res.status(403).json({ error: "You can only assign your own institute to this Talent Pool" });
      }
      if (instituteIds.length) {
        const validCount = await prisma.institute.count({ where: { id: { in: instituteIds } } });
        if (validCount !== instituteIds.length) return res.status(400).json({ error: "One or more selected institutes were not found" });
      }
      await prisma.talentPoolInstitute.deleteMany({ where: { poolId: pool.id } });
      if (instituteIds.length) {
        await prisma.talentPoolInstitute.createMany({ data: instituteIds.map((instituteId) => ({ poolId: pool.id, instituteId })) });
      }
    }

    const updated = await prisma.talentPool.update({ where: { id: pool.id }, data, include: INSTITUTES_INCLUDE });
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_UPDATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId || poolInstituteIds(pool)[0] || null,
      details: { poolId: pool.id, name: updated.name, changedFields: Object.keys(data) },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update Talent Pool" });
  }
});

// Blocks deletion of a pool with real members — same "empty child rows only" safety bar as the
// Department/Institute auto-cleanup elsewhere on this platform, except here nothing is empty by
// accident (members are always deliberately added), so this is a hard block, not an auto-clean.
router.delete("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const memberCount = await prisma.talentPoolMember.count({ where: { poolId: pool.id } });
    if (memberCount > 0) {
      return res.status(409).json({ error: `This Talent Pool has ${memberCount} member(s) and can't be deleted. Remove all members first.` });
    }
    await prisma.talentPool.delete({ where: { id: pool.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: poolInstituteIds(pool)[0] || null, details: { poolId: pool.id, name: pool.name },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete Talent Pool" });
  }
});

// =========================== Members ===========================

router.get("/:id/members", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const { search, departmentId, batch, section, academicGroupId, instituteId, placementStatus } = req.query;
  const studentWhere = {};
  if (search && search.trim()) {
    const q = search.trim();
    studentWhere.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { rollNumber: { contains: q, mode: "insensitive" } },
      { registrationNumber: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { mobile: { contains: q, mode: "insensitive" } },
    ];
  }
  // academicGroupId is a direct, exact-group filter — mutually exclusive in practice with
  // department/batch/section (the UI offers one or the other), but if both were somehow sent the
  // exact id narrows correctly either way since Prisma ANDs sibling where keys.
  if (academicGroupId) studentWhere.academicGroupId = academicGroupId;
  else if (departmentId || batch || section) {
    studentWhere.academicGroup = {
      ...(departmentId ? { departmentId } : {}),
      ...(batch ? { batch } : {}),
      ...(section ? { section } : {}),
    };
  }
  if (instituteId) studentWhere.instituteId = instituteId;
  if (placementStatus) studentWhere.studentProfile = { placementParticipation: placementStatus };

  // No skip/take pagination here (unlike most list routes) — this same response also feeds the
  // memberIds Set the Search/Browse/Transfer panels use to know which students are already
  // members, so returning only one page would make already-added students look addable again
  // past the first page. Instead this follows the same "cap, not paginate" convention this
  // codebase already uses for exactly this kind of dual-purpose full-set response (see
  // attendance.js's `take: 10000` / exports.js's `MAX_ROWS`) — previously had no cap at all.
  const members = await prisma.talentPoolMember.findMany({
    where: { poolId: pool.id, ...(Object.keys(studentWhere).length ? { student: studentWhere } : {}) },
    orderBy: { addedAt: "desc" },
    include: {
      student: {
        select: {
          ...MEMBER_SELECT,
          institute: { select: { id: true, name: true } },
          academicGroup: { select: { department: { select: { id: true, name: true } } } },
        },
      },
    },
    take: 2000,
  });
  res.json(members);
});

router.post("/:id/members", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  // Staff should not be able to add students unless explicitly permitted — an inactive pool is an
  // admin-management state; only an Admin-tier role may add into one (e.g. while reactivating it).
  if (!pool.isActive && req.user.role === "STAFF") {
    return res.status(403).json({ error: "This Talent Pool is inactive. Ask your Institute Admin to activate it before adding students." });
  }
  try {
    const studentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : [];
    if (!studentIds.length) return res.status(400).json({ error: "At least one student is required" });

    const students = await prisma.user.findMany({ where: { id: { in: studentIds }, role: "STUDENT" }, select: { ...MEMBER_SELECT, instituteId: true } });

    // STAFF (and any institute-scoped ADMIN) may only add students from their own institute, and
    // only into a pool whose configured institutes already include that institute.
    if (req.requesterInstituteId) {
      if (!poolInstituteIds(pool).includes(req.requesterInstituteId)) {
        return res.status(403).json({ error: "Your institute is not part of this Talent Pool" });
      }
      const foreign = students.filter((s) => s.instituteId !== req.requesterInstituteId);
      if (foreign.length) return res.status(403).json({ error: "You can only add students from your own institute" });
    }

    const existing = await prisma.talentPoolMember.findMany({ where: { poolId: pool.id, studentId: { in: studentIds } }, select: { studentId: true } });
    const existingIds = new Set(existing.map((e) => e.studentId));
    const toAdd = students.filter((s) => !existingIds.has(s.id));

    if (toAdd.length) {
      await prisma.talentPoolMember.createMany({
        data: toAdd.map((s) => ({ poolId: pool.id, studentId: s.id, addedVia: "MANUAL", addedByName: req.user.name })),
        skipDuplicates: true,
      });
      await Promise.all(toAdd.map((s) => notifyPoolAdded(prisma, s, pool)));
      await logAudit({
        req, action: AUDIT_ACTIONS.TALENT_POOL_MEMBERS_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
        instituteId: req.requesterInstituteId || poolInstituteIds(pool)[0] || null,
        details: { poolId: pool.id, poolName: pool.name, change: "added", studentIds: toAdd.map((s) => s.id) },
      });
    }
    res.json({ addedCount: toAdd.length, skippedCount: students.length - toAdd.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add members" });
  }
});

router.delete("/:id/members/:studentId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.studentId }, select: { ...MEMBER_SELECT, instituteId: true } });
    if (req.requesterInstituteId && student && student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only remove students from your own institute" });
    }
    const deleted = await prisma.talentPoolMember.deleteMany({ where: { poolId: pool.id, studentId: req.params.studentId } });
    if (deleted.count === 0) return res.status(404).json({ error: "This student is not a member of this pool" });
    if (student) await notifyPoolRemoved(prisma, student, pool);
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_MEMBERS_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId || poolInstituteIds(pool)[0] || null,
      details: { poolId: pool.id, poolName: pool.name, change: "removed", studentId: req.params.studentId },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// Move (remove from source, add to target) or copy (add to target only) a batch of students
// between two pools in one call — for STAFF/institute-scoped ADMIN, both pools must include their
// institute and every student must belong to it, same boundary as the plain add/remove routes.
router.post("/:id/members/transfer", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const sourcePool = await loadPoolScoped(req, res, req.params.id);
  if (!sourcePool) return;
  try {
    const studentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : [];
    const { targetPoolId, mode } = req.body;
    if (!studentIds.length) return res.status(400).json({ error: "At least one student is required" });
    if (!targetPoolId) return res.status(400).json({ error: "A target Talent Pool is required" });
    if (!["MOVE", "COPY"].includes(mode)) return res.status(400).json({ error: 'mode must be "MOVE" or "COPY"' });
    if (targetPoolId === sourcePool.id) return res.status(400).json({ error: "Source and target pool must be different" });

    const targetPool = await prisma.talentPool.findUnique({ where: { id: targetPoolId }, include: INSTITUTES_INCLUDE });
    if (!targetPool) return res.status(404).json({ error: "Target Talent Pool not found" });
    // Same "Staff can't add into an inactive pool" floor as POST /:id/members — a transfer is
    // still an addition into the target pool.
    if (!targetPool.isActive && req.user.role === "STAFF") {
      return res.status(403).json({ error: "The target Talent Pool is inactive. Ask your Institute Admin to activate it before transferring students in." });
    }

    const students = await prisma.user.findMany({ where: { id: { in: studentIds }, role: "STUDENT" }, select: { ...MEMBER_SELECT, instituteId: true } });

    if (req.requesterInstituteId) {
      if (!poolInstituteIds(sourcePool).includes(req.requesterInstituteId) || !poolInstituteIds(targetPool).includes(req.requesterInstituteId)) {
        return res.status(403).json({ error: "Both pools must include your institute" });
      }
      const foreign = students.filter((s) => s.instituteId !== req.requesterInstituteId);
      if (foreign.length) return res.status(403).json({ error: "You can only transfer students from your own institute" });
    }

    const existingTarget = await prisma.talentPoolMember.findMany({ where: { poolId: targetPoolId, studentId: { in: studentIds } }, select: { studentId: true } });
    const existingTargetIds = new Set(existingTarget.map((e) => e.studentId));
    const toAdd = students.filter((s) => !existingTargetIds.has(s.id));

    if (toAdd.length) {
      await prisma.talentPoolMember.createMany({
        data: toAdd.map((s) => ({ poolId: targetPoolId, studentId: s.id, addedVia: "MANUAL", addedByName: req.user.name })),
        skipDuplicates: true,
      });
      await Promise.all(toAdd.map((s) => notifyPoolAdded(prisma, s, targetPool)));
    }

    let removedCount = 0;
    if (mode === "MOVE" && students.length) {
      const removed = await prisma.talentPoolMember.deleteMany({ where: { poolId: sourcePool.id, studentId: { in: students.map((s) => s.id) } } });
      removedCount = removed.count;
      await Promise.all(students.map((s) => notifyPoolRemoved(prisma, s, sourcePool)));
    }

    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_MEMBERS_TRANSFERRED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId || null,
      details: { sourcePoolId: sourcePool.id, targetPoolId, mode, studentIds: students.map((s) => s.id), addedCount: toAdd.length, removedCount },
    });

    res.json({ addedCount: toAdd.length, skippedCount: students.length - toAdd.length, removedCount, mode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to transfer members" });
  }
});

// =========================== Bulk import (Excel: Institute + Registration Number) ===========================

// Roll Number is deliberately NOT a mapped column — matching is by Registration Number (PRN)
// only, never a bulk-upload input anywhere on the platform.
const BULK_IMPORT_FIELD_ALIASES = {
  instituteName: ["institute", "institute name", "college", "college name"],
  // "registration number (prn)" is included because it's this bulk-template's own header below —
  // normalizeBulkImportHeader strips ALL non-alphanumeric chars (no space substitution, unlike
  // users.js's normalizeHeader), so "Registration Number (PRN)" collapses to "registrationnumberprn",
  // which without this alias never matched anything and made the platform's own template fail its
  // own "missing required columns" check.
  registrationNumber: ["registration number", "registration number (prn)", "registration no", "reg no", "reg. no", "prn", "prn no", "prn number"],
};
function normalizeBulkImportHeader(h) {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function buildBulkImportHeaderMap(headers) {
  const map = {};
  for (const [field, aliases] of Object.entries(BULK_IMPORT_FIELD_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeBulkImportHeader);
    const match = headers.find((h) => normalizedAliases.includes(normalizeBulkImportHeader(h)));
    if (match) map[field] = match;
  }
  return map;
}

router.get("/:id/bulk-import-template", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const headers = ["Institute", "Registration Number (PRN)"];
  const sampleRow = [pool.institutes[0]?.institute?.name || "Example Institute", "2024COMP001"];
  const sheet = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Students");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=talent-pool-bulk-import-template.xlsx");
  res.send(buffer);
});

// Matches each row against the registered student database by (Institute, Registration Number/PRN)
// — never creates new student accounts (that's Bulk Upload's job elsewhere on this platform). Roll
// Number is never an import column here, same as every other bulk-upload workflow on the platform.
// Continues past invalid rows rather than aborting, and buckets every row into exactly one of five
// outcomes per the spec's required summary shape.
router.post("/:id/bulk-import", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, upload.single("file"), async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    if (!req.file) return res.status(400).json({ error: "A file is required" });
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ error: "Could not read this file. Please upload a valid .xlsx or .csv file." });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });

    const headerMap = buildBulkImportHeaderMap(Object.keys(rows[0]));
    if (!headerMap.instituteName || !headerMap.registrationNumber) {
      return res.status(400).json({ error: 'The file must have "Institute" and "Registration Number (PRN)" columns.' });
    }

    const configuredInstituteIds = poolInstituteIds(pool);
    const institutes = configuredInstituteIds.length
      ? await prisma.institute.findMany({ where: { id: { in: configuredInstituteIds } }, select: { id: true, name: true } })
      : [];
    const instituteByName = new Map(institutes.map((i) => [i.name.toLowerCase().trim(), i]));

    const existingMembers = await prisma.talentPoolMember.findMany({ where: { poolId: pool.id }, select: { studentId: true } });
    const existingMemberIds = new Set(existingMembers.map((m) => m.studentId));

    // Batch-fetch every candidate student by Registration Number (PRN, globally unique) in one
    // query instead of a per-row findFirst inside the loop below — an institute-wide import can be
    // hundreds to thousands of rows, and a per-row query at that scale is exactly the N+1 pattern
    // this platform already avoids elsewhere (see instituteByName above).
    const registrationNumbersInFile = [...new Set(rows.map((row) => String(row[headerMap.registrationNumber] || "").trim()).filter(Boolean))];
    const candidateStudents = registrationNumbersInFile.length
      ? await prisma.user.findMany({
          where: { role: "STUDENT", registrationNumber: { in: registrationNumbersInFile } },
          select: { id: true, name: true, instituteId: true, registrationNumber: true },
        })
      : [];
    const studentByInstituteAndRegNo = new Map(candidateStudents.map((s) => [`${s.instituteId}::${s.registrationNumber}`, s]));

    const added = [], alreadyExisting = [], invalidInstitute = [], invalidRegistrationNumber = [], failed = [];
    const toCreate = [];
    const seen = new Set();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // 1-indexed spreadsheet row + header row offset
      const row = rows[i];
      const instituteNameRaw = String(row[headerMap.instituteName] || "").trim();
      const registrationNumberRaw = String(row[headerMap.registrationNumber] || "").trim();
      if (!instituteNameRaw && !registrationNumberRaw) continue; // skip fully blank rows

      try {
        if (!instituteNameRaw || !registrationNumberRaw) {
          failed.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, reason: "Institute and Registration Number (PRN) are both required." });
          continue;
        }
        const institute = instituteByName.get(instituteNameRaw.toLowerCase());
        if (!institute) {
          invalidInstitute.push({
            row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw,
            reason: `"${instituteNameRaw}" is not one of this Talent Pool's configured institutes.`,
          });
          continue;
        }
        // Matched by Registration Number (PRN), the platform's sole unique student identifier —
        // Roll Number is never accepted as an import column since it legitimately repeats across
        // departments and is auto-generated from the PRN, not entered manually.
        const student = studentByInstituteAndRegNo.get(`${institute.id}::${registrationNumberRaw}`);
        if (!student) {
          invalidRegistrationNumber.push({
            row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw,
            reason: `No student with Registration Number "${registrationNumberRaw}" was found at ${institute.name}.`,
          });
          continue;
        }
        if (existingMemberIds.has(student.id) || seen.has(student.id)) {
          alreadyExisting.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, name: student.name });
          continue;
        }
        seen.add(student.id);
        toCreate.push({ poolId: pool.id, studentId: student.id, addedVia: "MANUAL", addedByName: req.user.name });
        added.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, name: student.name });
      } catch (rowErr) {
        failed.push({ row: rowNum, institute: instituteNameRaw, registrationNumber: registrationNumberRaw, reason: rowErr.message || "Unexpected error processing this row." });
      }
    }

    if (toCreate.length) {
      await prisma.talentPoolMember.createMany({ data: toCreate, skipDuplicates: true });
      const addedStudents = await prisma.user.findMany({ where: { id: { in: toCreate.map((t) => t.studentId) } }, select: MEMBER_SELECT });
      await Promise.all(addedStudents.map((s) => notifyPoolAdded(prisma, s, pool)));
    }

    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_BULK_IMPORT, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId || configuredInstituteIds[0] || null,
      details: {
        poolId: pool.id, poolName: pool.name, addedCount: added.length, alreadyExistingCount: alreadyExisting.length,
        invalidInstituteCount: invalidInstitute.length, invalidRegistrationNumberCount: invalidRegistrationNumber.length, failedCount: failed.length,
      },
    });

    res.json({
      total: rows.length,
      addedCount: added.length,
      alreadyExistingCount: alreadyExisting.length,
      invalidInstituteCount: invalidInstitute.length,
      invalidRegistrationNumberCount: invalidRegistrationNumber.length,
      failedCount: failed.length,
      added, alreadyExisting, invalidInstitute, invalidRegistrationNumber, failed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process bulk import" });
  }
});

// =========================== Auto-selection rule ===========================

router.get("/:id/auto-rule", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const rule = await prisma.talentPoolAutoRule.findUnique({ where: { poolId: pool.id } });
  res.json(rule);
});

router.put("/:id/auto-rule", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const FIELDS = [
      "minCgpa", "minAttendancePercent", "minAverageScorePercent", "minCompletionPercent",
      "minReadinessScorePercent", "readinessLevelAtLeast", "minBtl4And5Percent", "minCodingPercent", "readinessSubjectId",
      "requiredBadgeIds", "requiredCertificateCourseIds", "matchMode",
      "scopeInstituteId", "scopeDepartmentIds", "scopeBatch",
    ];
    const data = {};
    for (const key of FIELDS) if (req.body[key] !== undefined) data[key] = req.body[key];
    const rule = await prisma.talentPoolAutoRule.upsert({
      where: { poolId: pool.id },
      create: { poolId: pool.id, ...data },
      update: data,
    });
    res.json(rule);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save auto-selection rule" });
  }
});

router.post("/:id/auto-rule/preview", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const result = await previewAutoSelection(prisma, pool.id);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to preview auto-selection" });
  }
});

router.post("/:id/auto-rule/run", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const result = await runAutoSelection(prisma, pool.id);
    if (result.addedIds.length) {
      const added = await prisma.user.findMany({ where: { id: { in: result.addedIds } }, select: MEMBER_SELECT });
      await Promise.all(added.map((s) => notifyPoolAdded(prisma, s, pool)));
    }
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_AUTO_RULE_RUN, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: poolInstituteIds(pool)[0] || null, details: { poolId: pool.id, poolName: pool.name, addedCount: result.addedCount },
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to run auto-selection" });
  }
});

// =========================== Exclusive assessments: Tests ===========================

router.get("/:id/tests", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const links = await prisma.talentPoolTest.findMany({
    where: { poolId: pool.id },
    include: { test: { select: { id: true, title: true, company: true, startTime: true, endTime: true, isPublished: true, attendanceMandatory: true } } },
    orderBy: { assignedAt: "desc" },
  });
  res.json(links);
});

// STAFF may assign a pool a test the same way they can already add/remove pool members
// (loadPoolScoped enforces the institute boundary below) — but only a test they actually own or
// were explicitly shared, mirroring the Staff Test Ownership rules enforced everywhere else a
// staff member touches a test (see testOwnership.js). Without this, a staff member could pool-scope
// (and thereby expose to every pool member) another staff member's private test they have no
// authorization over.
router.post("/:id/tests", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const { testId } = req.body;
    if (!testId) return res.status(400).json({ error: "A test is required" });
    const test = await prisma.test.findUnique({ where: { id: testId }, select: { id: true, title: true, createdById: true, shares: { select: { staffId: true } } } });
    if (!test) return res.status(404).json({ error: "Test not found" });
    if (!canStaffAccessTest(req, test)) {
      return res.status(403).json({ error: "You can only assign tests you created or that were shared with you" });
    }

    const link = await prisma.talentPoolTest.upsert({
      where: { poolId_testId: { poolId: pool.id, testId } },
      create: { poolId: pool.id, testId },
      update: {},
    });

    const members = await prisma.talentPoolMember.findMany({ where: { poolId: pool.id }, include: { student: { select: MEMBER_SELECT } } });
    if (members.length) await notifyAssessmentAssigned(prisma, members.map((m) => m.student), pool, test.title);
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_ASSESSMENT_ASSIGNED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: poolInstituteIds(pool)[0] || null, details: { poolId: pool.id, poolName: pool.name, testId, testTitle: test.title },
    });
    invalidate(`talentPoolLeaderboard:${pool.id}`);
    invalidate(`talentPoolRank:${pool.id}`);
    res.json(link);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign test" });
  }
});

router.delete("/:id/tests/:testId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const test = await prisma.test.findUnique({ where: { id: req.params.testId }, select: { createdById: true, shares: { select: { staffId: true } } } });
  if (test && !canStaffAccessTest(req, test)) {
    return res.status(403).json({ error: "You can only unassign tests you created or that were shared with you" });
  }
  await prisma.talentPoolTest.deleteMany({ where: { poolId: pool.id, testId: req.params.testId } });
  invalidate(`talentPoolLeaderboard:${pool.id}`);
  invalidate(`talentPoolRank:${pool.id}`);
  res.json({ success: true });
});

// =========================== Exclusive assessments: Interview configs ===========================

router.get("/:id/interview-configs", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const configs = await prisma.talentPoolInterviewConfig.findMany({ where: { poolId: pool.id }, orderBy: { createdAt: "desc" } });
  res.json(configs);
});

router.post("/:id/interview-configs", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const { label, config } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ error: "A label is required" });
    const created = await prisma.talentPoolInterviewConfig.create({
      data: { poolId: pool.id, label: label.trim(), config: config || {} },
    });
    const members = await prisma.talentPoolMember.findMany({ where: { poolId: pool.id }, include: { student: { select: MEMBER_SELECT } } });
    if (members.length) await notifyAssessmentAssigned(prisma, members.map((m) => m.student), pool, `Mock Interview: ${created.label}`);
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_ASSESSMENT_ASSIGNED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: poolInstituteIds(pool)[0] || null, details: { poolId: pool.id, poolName: pool.name, interviewConfigId: created.id, label: created.label },
    });
    invalidate(`talentPoolInterviewRank:${pool.id}`);
    res.json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create interview config" });
  }
});

router.patch("/:id/interview-configs/:configId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const data = {};
    for (const key of ["label", "isActive", "config"]) if (req.body[key] !== undefined) data[key] = req.body[key];
    // Scoped by poolId (not just the config's own id) — matching the DELETE route right below —
    // so a configId belonging to a DIFFERENT pool (possibly another institute's) can't be
    // updated just because the caller legitimately owns the pool named in the URL.
    const result = await prisma.talentPoolInterviewConfig.updateMany({ where: { id: req.params.configId, poolId: pool.id }, data });
    if (result.count === 0) return res.status(404).json({ error: "Interview config not found" });
    const updated = await prisma.talentPoolInterviewConfig.findUnique({ where: { id: req.params.configId } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update interview config" });
  }
});

router.delete("/:id/interview-configs/:configId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  await prisma.talentPoolInterviewConfig.deleteMany({ where: { id: req.params.configId, poolId: pool.id } });
  res.json({ success: true });
});

// =========================== Attendance ownership (institute-wise, for attendanceMandatory pool tests) ===========================
// Writes/reads StaffClassAssignment rows scoped by talentPoolId — the same model that already
// drives ordinary division-based attendance, extended with two nullable FKs (see schema.prisma).
// This is deliberately NOT a parallel implementation: once a row exists here, LecturePlan /
// AttendanceSession / AttendanceRecord / ExecuteAttendance / AttendanceReports all work unchanged
// (see attendance.js's resolveAssignmentAccess / rosterWhereForAssignment / eligibleTests, which
// branch on talentPoolId being set).

router.get("/:id/attendance-owners", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const owners = await prisma.staffClassAssignment.findMany({
    where: { talentPoolId: pool.id },
    include: { staff: { select: { id: true, name: true, email: true } }, attendanceInstitute: { select: { id: true, name: true } } },
    orderBy: { assignedAt: "desc" },
  });
  res.json(owners);
});

// ADMIN may assign any staff member of any institute configured on the pool. STAFF may only
// self-assign (staffId must be their own id) for their own institute — "without requiring Admin
// intervention," per the spec. An institute-scoped ADMIN is restricted the same way STAFF is,
// minus the self-only staffId requirement (they can assign any staff at their institute).
// Find-existing-by-(talentPoolId, attendanceInstituteId)-then-update-or-create mirrors the
// convention in attendance.js's POST /admin/staff-assignments, backed additionally here by a real
// @@unique constraint (see schema.prisma's StaffClassAssignment comment).
router.post("/:id/attendance-owners", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const { instituteId, staffId } = req.body;
    if (!instituteId || !staffId) return res.status(400).json({ error: "instituteId and staffId are required" });
    if (!poolInstituteIds(pool).includes(instituteId)) {
      return res.status(400).json({ error: "This institute is not part of this Talent Pool" });
    }

    const staff = await prisma.user.findUnique({ where: { id: staffId }, select: { id: true, name: true, role: true, instituteId: true } });
    if (!staff || staff.role !== "STAFF") return res.status(404).json({ error: "Staff member not found" });
    if (staff.instituteId !== instituteId) return res.status(400).json({ error: "This staff member does not belong to the selected institute" });

    if (req.user.role === "STAFF") {
      // req.user comes straight from the JWT payload, which never carries instituteId (that's
      // exactly why attachRequesterInstitute exists as a separate DB lookup) — req.requesterInstituteId
      // is the correct field here, not req.user.instituteId (which is always undefined and would
      // make this check reject every legitimate self-assign).
      if (req.user.id !== staffId || req.requesterInstituteId !== instituteId) {
        return res.status(403).json({ error: "You can only self-assign attendance ownership for your own institute" });
      }
    } else if (req.requesterInstituteId && req.requesterInstituteId !== instituteId) {
      return res.status(403).json({ error: "You can only assign attendance ownership for your own institute" });
    }

    const existing = await prisma.staffClassAssignment.findFirst({ where: { talentPoolId: pool.id, attendanceInstituteId: instituteId } });
    const include = { staff: { select: { id: true, name: true, email: true } }, attendanceInstitute: { select: { id: true, name: true } } };
    const assignment = existing
      ? await prisma.staffClassAssignment.update({ where: { id: existing.id }, data: { staffId }, include })
      : await prisma.staffClassAssignment.create({ data: { staffId, talentPoolId: pool.id, attendanceInstituteId: instituteId, semester: "" }, include });

    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_ATTENDANCE_OWNER_ASSIGNED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId, details: { poolId: pool.id, poolName: pool.name, staffId, staffName: staff.name, change: existing ? "reassigned" : "assigned" },
    });
    res.json(assignment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign attendance owner" });
  }
});

router.delete("/:id/attendance-owners/:assignmentId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const existing = await prisma.staffClassAssignment.findFirst({ where: { id: req.params.assignmentId, talentPoolId: pool.id } });
    if (!existing) return res.status(404).json({ error: "Attendance ownership assignment not found" });
    if (req.user.role === "STAFF" && existing.staffId !== req.user.id) {
      return res.status(403).json({ error: "You can only remove your own attendance ownership assignment" });
    }
    if (req.user.role !== "STAFF" && req.requesterInstituteId && existing.attendanceInstituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only remove assignments for your own institute" });
    }
    await prisma.staffClassAssignment.delete({ where: { id: existing.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_ATTENDANCE_OWNER_REMOVED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: existing.attendanceInstituteId, details: { poolId: pool.id, poolName: pool.name, assignmentId: existing.id },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove attendance owner" });
  }
});

// =========================== Rankings / Dashboard / Reports ===========================

router.get("/:id/leaderboard", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "STUDENT"), attachRequesterInstitute, async (req, res) => {
  const pool = await prisma.talentPool.findUnique({ where: { id: req.params.id }, include: INSTITUTES_INCLUDE });
  if (!pool) return res.status(404).json({ error: "Talent Pool not found" });
  if (req.user.role === "STUDENT") {
    const isMember = await isStudentTalentPoolMember(prisma, req.user.id, pool.id);
    if (!isMember) return res.status(403).json({ error: "You're not a member of this Talent Pool" });
  } else if (req.requesterInstituteId) {
    const instituteIds = poolInstituteIds(pool);
    if (instituteIds.length && !instituteIds.includes(req.requesterInstituteId)) {
      return res.status(403).json({ error: "You can only view Talent Pools under your own institute" });
    }
  }

  const rows = await cached(`talentPoolLeaderboard:${pool.id}`, 30 * 1000, async () => {
    const members = await prisma.talentPoolMember.findMany({ where: { poolId: pool.id }, include: { student: { select: MEMBER_SELECT } } });
    return Promise.all(
      members.map(async (m) => {
        const [testRank, interviewRank] = await Promise.all([
          computeTalentPoolRank(m.studentId, pool.id),
          computeTalentPoolInterviewRank(m.studentId, pool.id),
        ]);
        return { student: m.student, addedVia: m.addedVia, testRank, interviewRank };
      })
    );
  });
  res.json(rows);
});

router.get("/:id/dashboard", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const [memberCount, testAssignmentCount, interviewConfigCount, members] = await Promise.all([
    prisma.talentPoolMember.count({ where: { poolId: pool.id } }),
    prisma.talentPoolTest.count({ where: { poolId: pool.id } }),
    prisma.talentPoolInterviewConfig.count({ where: { poolId: pool.id } }),
    prisma.talentPoolMember.findMany({ where: { poolId: pool.id }, select: { studentId: true } }),
  ]);

  const memberIds = members.map((m) => m.studentId);
  const [poolTests, attempts, reports] = await Promise.all([
    prisma.talentPoolTest.findMany({ where: { poolId: pool.id }, select: { testId: true } }),
    memberIds.length ? prisma.testAttempt.findMany({ where: { studentId: { in: memberIds } }, select: { studentId: true, testId: true, totalScore: true, status: true } }) : [],
    memberIds.length ? prisma.interviewReport.findMany({ where: { studentId: { in: memberIds } }, select: { overallScore: true } }) : [],
  ]);
  const poolTestIds = new Set(poolTests.map((t) => t.testId));
  const relevantAttempts = attempts.filter((a) => poolTestIds.has(a.testId) && a.status !== "IN_PROGRESS");
  const tests = poolTestIds.size
    ? await prisma.test.findMany({ where: { id: { in: [...poolTestIds] } }, select: { id: true, questions: { select: { question: { select: { points: true } } } } } })
    : [];
  const maxByTest = new Map(tests.map((t) => [t.id, t.questions.reduce((s, q) => s + q.question.points, 0)]));
  const scorePercents = relevantAttempts.map((a) => {
    const max = maxByTest.get(a.testId) || 0;
    return max > 0 ? (a.totalScore / max) * 100 : null;
  }).filter((p) => p != null);
  const avgCodingScore = scorePercents.length ? Math.round(scorePercents.reduce((s, p) => s + p, 0) / scorePercents.length) : null;
  const avgInterviewScore = reports.length ? Math.round(reports.reduce((s, r) => s + r.overallScore, 0) / reports.length) : null;

  res.json({
    totalMembers: memberCount,
    assessmentsAssigned: testAssignmentCount + interviewConfigCount,
    assessmentsCompleted: relevantAttempts.length + reports.length,
    avgCodingScore,
    avgInterviewScore,
  });
});

router.get("/:id/report.pdf", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const members = await prisma.talentPoolMember.findMany({ where: { poolId: pool.id }, include: { student: { select: MEMBER_SELECT } } });

  // One attendanceRecord query for every member instead of one per member inside the loop below —
  // computeTalentPoolRank is already cheap to call per-member (it's backed by a 30s cached()
  // pool-wide ranking computation, see talentPoolRank.js), but this attendance lookup wasn't.
  const memberIds = members.map((m) => m.studentId);
  const allRecords = memberIds.length
    ? await prisma.attendanceRecord.findMany({ where: { studentId: { in: memberIds } }, select: { studentId: true, status: true } })
    : [];
  const recordsByStudent = new Map();
  for (const r of allRecords) {
    if (!recordsByStudent.has(r.studentId)) recordsByStudent.set(r.studentId, []);
    recordsByStudent.get(r.studentId).push(r);
  }

  const rows = await Promise.all(
    members.map(async (m) => {
      const rank = await computeTalentPoolRank(m.studentId, pool.id);
      const records = recordsByStudent.get(m.studentId) || [];
      const present = records.filter((r) => r.status === "PRESENT").length;
      const late = records.filter((r) => r.status === "LATE").length;
      const absent = records.filter((r) => r.status === "ABSENT").length;
      const denom = present + late + absent;
      return {
        rollNumber: m.student.rollNumber, registrationNumber: m.student.registrationNumber, name: m.student.name, addedVia: m.addedVia,
        rank: rank.rank, totalStudents: rank.totalStudents,
        scorePercent: rank.percent,
        attendancePercent: denom > 0 ? Math.round(((present + late) / denom) * 100) : null,
      };
    })
  );

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="talent-pool-${pool.name.replace(/[^a-z0-9]/gi, "-")}.pdf"`);
  generateTalentPoolPdf(pool, rows, res);
});

module.exports = router;
