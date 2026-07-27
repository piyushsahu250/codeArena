// Shared test-eligibility logic, replacing several independently-duplicated copies of the same
// "is this test open to this student" check (tests.js had 3, dashboard.js and studentPerformance.js
// one each, attendance.js two more inline).
//
// A test is visible to a student if it has NO restriction at all (open to everyone — the
// long-standing "empty assignment = unscoped" convention), OR the student's current academic
// group is one of the assigned groups, OR — backward-compat safety net — the student's legacy
// classId is one of the assigned legacy classes. The classId branch exists because the one-time
// migration script mirrors every existing TestClass row onto TestAcademicGroup, but a test created
// through the not-yet-rebuilt class picker (Phase E replaces it with an academic-group picker)
// still only writes TestClass; without this fallback such a test would silently become invisible
// to everyone until that picker ships. Once nothing writes TestClass anymore this fallback becomes
// a permanent no-op, not a bug — safe to leave in place rather than requiring a coordinated flip.
//
// Talent Pool exclusivity (memberPoolIds, all three functions below) is a separate, overriding
// axis: a test with any TalentPoolTest row stops being eligible for the "open to everyone" or
// academicGroup/class branch entirely — it's ONLY reachable via pool membership, even if it also
// has zero group/class assignments. This is deliberately not OR'd in with the existing checks,
// since an admin assigning a test to a Talent Pool means "only these people," not "these people,
// plus whatever the group/class rules would otherwise allow."

function testEligibilityWhere(academicGroupId, classId, memberPoolIds = []) {
  return {
    OR: [
      {
        talentPools: { none: {} },
        OR: [
          { academicGroups: { none: {} }, classes: { none: {} } },
          ...(academicGroupId ? [{ academicGroups: { some: { academicGroupId } } }] : []),
          ...(classId ? [{ classes: { some: { classId } } }] : []),
        ],
      },
      ...(memberPoolIds.length ? [{ talentPools: { some: { poolId: { in: memberPoolIds } } } }] : []),
    ],
  };
}

// For an already-loaded test that includes `academicGroups: {select:{academicGroupId:true}}`,
// `classes: {select:{classId:true}}`, and `talentPools: {select:{poolId:true}}` — synchronous, no
// extra query. memberPoolIds may be a Set or a plain array of the requesting student's pool ids.
function isTestVisibleToStudent(test, academicGroupId, classId, memberPoolIds) {
  const pools = test.talentPools || [];
  if (pools.length > 0) {
    if (!memberPoolIds) return false;
    const ids = memberPoolIds instanceof Set ? memberPoolIds : new Set(memberPoolIds);
    return pools.some((p) => ids.has(p.poolId));
  }
  const groups = test.academicGroups || [];
  const classes = test.classes || [];
  if (groups.length === 0 && classes.length === 0) return true;
  if (academicGroupId && groups.some((g) => g.academicGroupId === academicGroupId)) return true;
  if (classId && classes.some((c) => c.classId === classId)) return true;
  return false;
}

// DB-authoritative check for call sites that only have the IDs, not a preloaded relation.
async function studentCanAccessTest(prisma, testId, academicGroupId, classId, memberPoolIds) {
  const poolLinks = await prisma.talentPoolTest.count({ where: { testId } });
  if (poolLinks > 0) {
    if (!memberPoolIds) return false;
    const ids = memberPoolIds instanceof Set ? [...memberPoolIds] : memberPoolIds;
    if (!ids.length) return false;
    const match = await prisma.talentPoolTest.findFirst({ where: { testId, poolId: { in: ids } } });
    return !!match;
  }
  const [groupLinks, classLinks] = await Promise.all([
    prisma.testAcademicGroup.count({ where: { testId } }),
    prisma.testClass.count({ where: { testId } }),
  ]);
  if (groupLinks === 0 && classLinks === 0) return true;
  if (academicGroupId) {
    const match = await prisma.testAcademicGroup.findUnique({
      where: { testId_academicGroupId: { testId, academicGroupId } },
    });
    if (match) return true;
  }
  if (classId) {
    const match = await prisma.testClass.findUnique({
      where: { testId_classId: { testId, classId } },
    });
    if (match) return true;
  }
  return false;
}

module.exports = { testEligibilityWhere, isTestVisibleToStudent, studentCanAccessTest };
