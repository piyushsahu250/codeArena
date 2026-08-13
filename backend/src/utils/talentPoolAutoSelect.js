const prisma = require("../prisma");

// Mirrors attendance.js's computeAttendancePercent exactly (present+late over present+absent+late)
// — re-derived here rather than imported, since that function lives in a route file and this
// codebase's convention is routes import from utils, never the reverse.
function attendancePercent(counts) {
  const present = counts.PRESENT || 0, absent = counts.ABSENT || 0, late = counts.LATE || 0;
  const denominator = present + absent + late;
  if (denominator === 0) return null;
  return ((present + late) / denominator) * 100;
}

// Base candidate set for a rule: every STUDENT, optionally narrowed by institute/department/batch.
// Department/batch scoping goes through AcademicGroup (the platform's real Institute->Batch->
// Department->Section hierarchy) since User has no direct departmentId.
async function getCandidateStudents(prismaClient, rule) {
  const where = { role: "STUDENT" };
  if (rule.scopeInstituteId) where.instituteId = rule.scopeInstituteId;
  const groupFilter = {};
  const deptIds = Array.isArray(rule.scopeDepartmentIds) ? rule.scopeDepartmentIds : [];
  if (deptIds.length) groupFilter.departmentId = { in: deptIds };
  if (rule.scopeBatch) groupFilter.batch = rule.scopeBatch;
  if (Object.keys(groupFilter).length) where.academicGroup = groupFilter;
  return prismaClient.user.findMany({ where, select: { id: true } });
}

// Evaluates every configured criterion against the candidate set in batched queries (never one
// query per candidate — this platform already learned that lesson the hard way, see the
// leaderboard fix in its own project history). Returns { matchedIds, detail } where detail is a
// per-student breakdown of which criteria passed/failed, for the rule-builder preview UI.
async function evaluateCandidates(prismaClient, rule, candidateIds) {
  if (candidateIds.length === 0) return { matchedIds: [], detail: [] };

  const checks = []; // [{ key, values: Map<studentId, number|boolean> }]

  if (rule.minCgpa != null) {
    const rows = await prismaClient.studentProfile.findMany({
      where: { studentId: { in: candidateIds } },
      select: { studentId: true, cgpa: true },
    });
    const values = new Map(rows.map((r) => [r.studentId, r.cgpa]));
    checks.push({ key: "minCgpa", pass: (id) => (values.get(id) ?? -Infinity) >= rule.minCgpa });
  }

  if (rule.minAttendancePercent != null) {
    const records = await prismaClient.attendanceRecord.findMany({
      where: { studentId: { in: candidateIds } },
      select: { studentId: true, status: true },
    });
    const countsByStudent = new Map();
    for (const r of records) {
      const c = countsByStudent.get(r.studentId) || {};
      c[r.status] = (c[r.status] || 0) + 1;
      countsByStudent.set(r.studentId, c);
    }
    checks.push({
      key: "minAttendancePercent",
      pass: (id) => {
        const pct = attendancePercent(countsByStudent.get(id) || {});
        return pct != null && pct >= rule.minAttendancePercent;
      },
    });
  }

  if (rule.minAverageScorePercent != null) {
    const attempts = await prismaClient.testAttempt.findMany({
      where: { studentId: { in: candidateIds }, status: { not: "IN_PROGRESS" } },
      select: { studentId: true, testId: true, totalScore: true },
    });
    const testIds = [...new Set(attempts.map((a) => a.testId))];
    const tests = testIds.length
      ? await prismaClient.test.findMany({
          where: { id: { in: testIds } },
          select: { id: true, questions: { select: { question: { select: { points: true } } } } },
        })
      : [];
    const maxByTest = new Map(tests.map((t) => [t.id, t.questions.reduce((s, q) => s + q.question.points, 0)]));
    const scoreSum = new Map(), maxSum = new Map();
    for (const a of attempts) {
      const max = maxByTest.get(a.testId) || 0;
      scoreSum.set(a.studentId, (scoreSum.get(a.studentId) || 0) + a.totalScore);
      maxSum.set(a.studentId, (maxSum.get(a.studentId) || 0) + max);
    }
    checks.push({
      key: "minAverageScorePercent",
      pass: (id) => {
        const s = scoreSum.get(id) || 0, m = maxSum.get(id) || 0;
        return m > 0 && (s / m) * 100 >= rule.minAverageScorePercent;
      },
    });
  }

  if (rule.minCompletionPercent != null) {
    const [totalLessons, completedRows] = await Promise.all([
      prismaClient.lesson.count(),
      prismaClient.lessonProgress.groupBy({
        by: ["studentId"],
        where: { studentId: { in: candidateIds }, status: "COMPLETED" },
        _count: { _all: true },
      }),
    ]);
    const completedByStudent = new Map(completedRows.map((r) => [r.studentId, r._count._all]));
    checks.push({
      key: "minCompletionPercent",
      pass: (id) => totalLessons > 0 && ((completedByStudent.get(id) || 0) / totalLessons) * 100 >= rule.minCompletionPercent,
    });
  }

  // Employability & Readiness criteria — evaluated against each candidate's BEST completed
  // ReadinessReport (see schema comment on TalentPoolAutoRule.minReadinessScorePercent for why
  // "best" rather than "latest"), optionally narrowed to one subject.
  const READINESS_LEVEL_RANK = { FOUNDATION_REQUIRED: 0, NEEDS_IMPROVEMENT: 1, DEVELOPING: 2, NEARLY_READY: 3, JOB_READY: 4, EXCELLENTLY_READY: 5 };
  if (rule.minReadinessScorePercent != null || rule.readinessLevelAtLeast) {
    const reports = await prismaClient.readinessReport.findMany({
      where: {
        studentId: { in: candidateIds },
        ...(rule.readinessSubjectId ? { assessment: { subjectId: rule.readinessSubjectId } } : {}),
      },
      select: { studentId: true, overallScore: true, readinessLevel: true },
    });
    const bestByStudent = new Map();
    for (const r of reports) {
      const cur = bestByStudent.get(r.studentId);
      if (!cur || r.overallScore > cur.overallScore) bestByStudent.set(r.studentId, r);
    }
    const requiredRank = rule.readinessLevelAtLeast ? (READINESS_LEVEL_RANK[rule.readinessLevelAtLeast] ?? 0) : null;
    checks.push({
      key: "readiness",
      pass: (id) => {
        const best = bestByStudent.get(id);
        if (!best) return false;
        if (rule.minReadinessScorePercent != null && best.overallScore < rule.minReadinessScorePercent) return false;
        if (requiredRank != null && (READINESS_LEVEL_RANK[best.readinessLevel] ?? 0) < requiredRank) return false;
        return true;
      },
    });
  }

  const requiredBadgeIds = Array.isArray(rule.requiredBadgeIds) ? rule.requiredBadgeIds : [];
  if (requiredBadgeIds.length) {
    const rows = await prismaClient.studentBadge.findMany({
      where: { studentId: { in: candidateIds }, badgeId: { in: requiredBadgeIds } },
      select: { studentId: true, badgeId: true },
    });
    const badgesByStudent = new Map();
    for (const r of rows) {
      const set = badgesByStudent.get(r.studentId) || new Set();
      set.add(r.badgeId);
      badgesByStudent.set(r.studentId, set);
    }
    checks.push({
      key: "requiredBadgeIds",
      pass: (id) => requiredBadgeIds.every((b) => badgesByStudent.get(id)?.has(b)),
    });
  }

  const requiredCertificateCourseIds = Array.isArray(rule.requiredCertificateCourseIds) ? rule.requiredCertificateCourseIds : [];
  if (requiredCertificateCourseIds.length) {
    const rows = await prismaClient.certificate.findMany({
      where: { studentId: { in: candidateIds }, courseId: { in: requiredCertificateCourseIds }, status: "VALID" },
      select: { studentId: true, courseId: true },
    });
    const certsByStudent = new Map();
    for (const r of rows) {
      const set = certsByStudent.get(r.studentId) || new Set();
      set.add(r.courseId);
      certsByStudent.set(r.studentId, set);
    }
    checks.push({
      key: "requiredCertificateCourseIds",
      pass: (id) => requiredCertificateCourseIds.every((c) => certsByStudent.get(id)?.has(c)),
    });
  }

  const matchMode = rule.matchMode === "ANY" ? "ANY" : "ALL";
  const detail = candidateIds.map((id) => {
    const results = checks.map((c) => ({ key: c.key, passed: c.pass(id) }));
    const matched = checks.length === 0 ? false : matchMode === "ALL" ? results.every((r) => r.passed) : results.some((r) => r.passed);
    return { studentId: id, matched, results };
  });

  return { matchedIds: detail.filter((d) => d.matched).map((d) => d.studentId), detail };
}

// Dry-run for the rule-builder UI's "N students would be added" preview — no writes.
async function previewAutoSelection(prismaClient, poolId) {
  const rule = await prismaClient.talentPoolAutoRule.findUnique({ where: { poolId } });
  if (!rule) return { matchedCount: 0, newCount: 0, detail: [] };
  const [candidates, existingMembers] = await Promise.all([
    getCandidateStudents(prismaClient, rule),
    prismaClient.talentPoolMember.findMany({ where: { poolId }, select: { studentId: true } }),
  ]);
  const existingIds = new Set(existingMembers.map((m) => m.studentId));
  const { matchedIds, detail } = await evaluateCandidates(prismaClient, rule, candidates.map((c) => c.id));
  const newIds = matchedIds.filter((id) => !existingIds.has(id));
  return { matchedCount: matchedIds.length, newCount: newIds.length, detail };
}

// Runs the rule and adds newly-matching students only — re-running never removes an existing
// member (manual or auto-added), since a live metric like attendance% dropping below the
// threshold must not silently evict someone; removal stays an explicit manual action.
async function runAutoSelection(prismaClient, poolId) {
  const rule = await prismaClient.talentPoolAutoRule.findUnique({ where: { poolId } });
  if (!rule) return { addedCount: 0, addedIds: [] };
  const [candidates, existingMembers] = await Promise.all([
    getCandidateStudents(prismaClient, rule),
    prismaClient.talentPoolMember.findMany({ where: { poolId }, select: { studentId: true } }),
  ]);
  const existingIds = new Set(existingMembers.map((m) => m.studentId));
  const { matchedIds } = await evaluateCandidates(prismaClient, rule, candidates.map((c) => c.id));
  const newIds = matchedIds.filter((id) => !existingIds.has(id));

  if (newIds.length) {
    await prismaClient.talentPoolMember.createMany({
      data: newIds.map((studentId) => ({ poolId, studentId, addedVia: "AUTO_RULE" })),
      skipDuplicates: true,
    });
  }
  await prismaClient.talentPoolAutoRule.update({
    where: { poolId },
    data: { lastRunAt: new Date(), lastRunAddedCount: newIds.length },
  });

  return { addedCount: newIds.length, addedIds: newIds };
}

module.exports = { getCandidateStudents, evaluateCandidates, previewAutoSelection, runAutoSelection };
