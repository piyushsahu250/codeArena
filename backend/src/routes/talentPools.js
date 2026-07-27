const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { cached, invalidate } = require("../utils/cache");
const { isStudentTalentPoolMember } = require("../utils/talentPoolEligibility");
const { computeTalentPoolRank, computeTalentPoolInterviewRank } = require("../utils/talentPoolRank");
const { previewAutoSelection, runAutoSelection } = require("../utils/talentPoolAutoSelect");
const { notifyPoolAdded, notifyPoolRemoved, notifyAssessmentAssigned } = require("../utils/notifications");
const { generateTalentPoolPdf } = require("../utils/talentPoolPdf");

const router = express.Router();

const MEMBER_SELECT = { id: true, name: true, email: true, rollNumber: true, registrationNumber: true };

async function loadPoolScoped(req, res, poolId) {
  const pool = await prisma.talentPool.findUnique({ where: { id: poolId } });
  if (!pool) { res.status(404).json({ error: "Talent Pool not found" }); return null; }
  if (req.requesterInstituteId && pool.instituteId && pool.instituteId !== req.requesterInstituteId) {
    res.status(403).json({ error: "You can only manage Talent Pools under your own institute" });
    return null;
  }
  return pool;
}

// =========================== Pool CRUD ===========================

router.get("/", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const where = {};
  if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
  else if (req.query.instituteId) where.instituteId = req.query.instituteId;
  const pools = await prisma.talentPool.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { institute: { select: { id: true, name: true } }, _count: { select: { members: true, testAssignments: true, interviewConfigs: true } } },
  });
  res.json(pools);
});

router.post("/", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { name, description, instituteId } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Pool name is required" });
    const resolvedInstituteId = req.requesterInstituteId || instituteId || null;
    if (req.requesterInstituteId && instituteId && instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only create Talent Pools under your own institute" });
    }
    const pool = await prisma.talentPool.create({
      data: { name: name.trim(), description: description || null, instituteId: resolvedInstituteId, createdById: req.user.id },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: resolvedInstituteId, details: { poolId: pool.id, name: pool.name },
    });
    res.json(pool);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create Talent Pool" });
  }
});

// Registered BEFORE the generic GET /:id below — Express matches routes in registration order,
// and "/my-pools" would otherwise be swallowed by "/:id" (with id="my-pools") since both are a
// GET at the same single-segment path depth.
router.get("/my-pools", authenticate, requireRole("STUDENT"), async (req, res) => {
  const memberships = await prisma.talentPoolMember.findMany({
    where: { studentId: req.user.id },
    include: {
      pool: {
        include: {
          testAssignments: { include: { test: { select: { id: true, title: true, startTime: true, endTime: true, isPublished: true } } } },
          interviewConfigs: { where: { isActive: true }, select: { id: true, label: true } },
        },
      },
    },
  });

  const result = await Promise.all(
    memberships.map(async (m) => {
      const [testRank, interviewRank] = await Promise.all([
        computeTalentPoolRank(req.user.id, m.poolId),
        computeTalentPoolInterviewRank(req.user.id, m.poolId),
      ]);
      return {
        pool: { id: m.pool.id, name: m.pool.name, description: m.pool.description },
        addedVia: m.addedVia,
        addedAt: m.addedAt,
        exclusiveTests: m.pool.testAssignments.map((t) => t.test),
        interviewConfigs: m.pool.interviewConfigs,
        testRank,
        interviewRank,
      };
    })
  );
  res.json(result);
});

router.get("/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  res.json(pool);
});

router.patch("/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const data = {};
    for (const key of ["name", "description", "isActive"]) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const updated = await prisma.talentPool.update({ where: { id: pool.id }, data });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update Talent Pool" });
  }
});

// Blocks deletion of a pool with real members — same "empty child rows only" safety bar as the
// Department/Institute auto-cleanup elsewhere on this platform, except here nothing is empty by
// accident (members are always deliberately added), so this is a hard block, not an auto-clean.
router.delete("/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
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
      instituteId: pool.instituteId, details: { poolId: pool.id, name: pool.name },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete Talent Pool" });
  }
});

// =========================== Members ===========================

router.get("/:id/members", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const members = await prisma.talentPoolMember.findMany({
    where: { poolId: pool.id },
    orderBy: { addedAt: "desc" },
    include: { student: { select: MEMBER_SELECT } },
  });
  res.json(members);
});

router.post("/:id/members", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const studentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : [];
    if (!studentIds.length) return res.status(400).json({ error: "At least one student is required" });

    const students = await prisma.user.findMany({ where: { id: { in: studentIds }, role: "STUDENT" }, select: MEMBER_SELECT });
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
        instituteId: pool.instituteId, details: { poolId: pool.id, poolName: pool.name, change: "added", studentIds: toAdd.map((s) => s.id) },
      });
    }
    res.json({ addedCount: toAdd.length, skippedCount: students.length - toAdd.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add members" });
  }
});

router.delete("/:id/members/:studentId", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.studentId }, select: MEMBER_SELECT });
    const deleted = await prisma.talentPoolMember.deleteMany({ where: { poolId: pool.id, studentId: req.params.studentId } });
    if (deleted.count === 0) return res.status(404).json({ error: "This student is not a member of this pool" });
    if (student) await notifyPoolRemoved(prisma, student, pool);
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_MEMBERS_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: pool.instituteId, details: { poolId: pool.id, poolName: pool.name, change: "removed", studentId: req.params.studentId },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// =========================== Auto-selection rule ===========================

router.get("/:id/auto-rule", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const rule = await prisma.talentPoolAutoRule.findUnique({ where: { poolId: pool.id } });
  res.json(rule);
});

router.put("/:id/auto-rule", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const FIELDS = [
      "minCgpa", "minAttendancePercent", "minAverageScorePercent", "minCompletionPercent",
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

router.post("/:id/auto-rule/preview", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
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

router.post("/:id/auto-rule/run", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
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
      instituteId: pool.instituteId, details: { poolId: pool.id, poolName: pool.name, addedCount: result.addedCount },
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to run auto-selection" });
  }
});

// =========================== Exclusive assessments: Tests ===========================

router.get("/:id/tests", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const links = await prisma.talentPoolTest.findMany({
    where: { poolId: pool.id },
    include: { test: { select: { id: true, title: true, company: true, startTime: true, endTime: true, isPublished: true } } },
    orderBy: { assignedAt: "desc" },
  });
  res.json(links);
});

router.post("/:id/tests", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const { testId } = req.body;
    if (!testId) return res.status(400).json({ error: "A test is required" });
    const test = await prisma.test.findUnique({ where: { id: testId }, select: { id: true, title: true } });
    if (!test) return res.status(404).json({ error: "Test not found" });

    const link = await prisma.talentPoolTest.upsert({
      where: { poolId_testId: { poolId: pool.id, testId } },
      create: { poolId: pool.id, testId },
      update: {},
    });

    const members = await prisma.talentPoolMember.findMany({ where: { poolId: pool.id }, include: { student: { select: MEMBER_SELECT } } });
    if (members.length) await notifyAssessmentAssigned(prisma, members.map((m) => m.student), pool, test.title);
    await logAudit({
      req, action: AUDIT_ACTIONS.TALENT_POOL_ASSESSMENT_ASSIGNED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: pool.instituteId, details: { poolId: pool.id, poolName: pool.name, testId, testTitle: test.title },
    });
    invalidate(`talentPoolLeaderboard:${pool.id}`);
    res.json(link);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign test" });
  }
});

router.delete("/:id/tests/:testId", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  await prisma.talentPoolTest.deleteMany({ where: { poolId: pool.id, testId: req.params.testId } });
  invalidate(`talentPoolLeaderboard:${pool.id}`);
  res.json({ success: true });
});

// =========================== Exclusive assessments: Interview configs ===========================

router.get("/:id/interview-configs", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const configs = await prisma.talentPoolInterviewConfig.findMany({ where: { poolId: pool.id }, orderBy: { createdAt: "desc" } });
  res.json(configs);
});

router.post("/:id/interview-configs", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
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
      instituteId: pool.instituteId, details: { poolId: pool.id, poolName: pool.name, interviewConfigId: created.id, label: created.label },
    });
    res.json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create interview config" });
  }
});

router.patch("/:id/interview-configs/:configId", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  try {
    const data = {};
    for (const key of ["label", "isActive", "config"]) if (req.body[key] !== undefined) data[key] = req.body[key];
    const updated = await prisma.talentPoolInterviewConfig.update({ where: { id: req.params.configId }, data });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update interview config" });
  }
});

router.delete("/:id/interview-configs/:configId", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  await prisma.talentPoolInterviewConfig.deleteMany({ where: { id: req.params.configId, poolId: pool.id } });
  res.json({ success: true });
});

// =========================== Rankings / Dashboard / Reports ===========================

router.get("/:id/leaderboard", authenticate, async (req, res) => {
  const pool = await prisma.talentPool.findUnique({ where: { id: req.params.id } });
  if (!pool) return res.status(404).json({ error: "Talent Pool not found" });
  if (req.user.role === "STUDENT") {
    const isMember = await isStudentTalentPoolMember(prisma, req.user.id, pool.id);
    if (!isMember) return res.status(403).json({ error: "You're not a member of this Talent Pool" });
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

router.get("/:id/dashboard", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
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

router.get("/:id/report.pdf", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const pool = await loadPoolScoped(req, res, req.params.id);
  if (!pool) return;
  const members = await prisma.talentPoolMember.findMany({ where: { poolId: pool.id }, include: { student: { select: MEMBER_SELECT } } });

  const rows = await Promise.all(
    members.map(async (m) => {
      const [rank, records] = await Promise.all([
        computeTalentPoolRank(m.studentId, pool.id),
        prisma.attendanceRecord.findMany({ where: { studentId: m.studentId }, select: { status: true } }),
      ]);
      const present = records.filter((r) => r.status === "PRESENT").length;
      const late = records.filter((r) => r.status === "LATE").length;
      const absent = records.filter((r) => r.status === "ABSENT").length;
      const denom = present + late + absent;
      return {
        rollNumber: m.student.rollNumber, name: m.student.name, addedVia: m.addedVia,
        rank: rank.rank, totalStudents: rank.totalStudents,
        scorePercent: null,
        attendancePercent: denom > 0 ? Math.round(((present + late) / denom) * 100) : null,
      };
    })
  );

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="talent-pool-${pool.name.replace(/[^a-z0-9]/gi, "-")}.pdf"`);
  generateTalentPoolPdf(pool, rows, res);
});

module.exports = router;
