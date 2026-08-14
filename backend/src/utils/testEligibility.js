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
// The "open to everyone" branch is itself bounded by Test.instituteId: a platform-wide test
// (instituteId null, only ever created by the instituteId-less platform admin) really is open to
// every student on every institute, but an institute-scoped test with zero group/class assignments
// is only open to students within that SAME institute — never across institutes. Without this,
// a staff member at Institute A who leaves the picker empty would leak the test to every other
// institute; see the schema comment on Test.instituteId. studentInstituteId is the requesting
// student's own User.instituteId.
//
// Talent Pool exclusivity (memberPoolIds, all three functions below) is a separate, overriding
// axis: a test with any TalentPoolTest row stops being eligible for the "open to everyone" or
// academicGroup/class branch entirely — it's ONLY reachable via pool membership, even if it also
// has zero group/class assignments. This is deliberately not OR'd in with the existing checks,
// since an admin assigning a test to a Talent Pool means "only these people," not "these people,
// plus whatever the group/class rules would otherwise allow."

function testEligibilityWhere(academicGroupId, classId, memberPoolIds = [], studentInstituteId) {
  // memberPoolIds may be a Set (getStudentPoolIds' native return shape) or a plain array — normalize
  // here rather than trusting every call site to spread it first. A Set has `.size`, not `.length`,
  // so `memberPoolIds.length` on a raw Set is always `undefined` (falsy) and silently drops the
  // entire pool-membership branch below, making every Talent-Pool-exclusive test invisible to every
  // student regardless of membership — this is exactly the bug that broke Talent Pool test
  // visibility platform-wide; normalizing here (matching isTestVisibleToStudent/studentCanAccessTest
  // below, which already do this) prevents the whole bug class for any future caller too.
  const poolIds = memberPoolIds instanceof Set ? [...memberPoolIds] : memberPoolIds;
  return {
    OR: [
      {
        talentPools: { none: {} },
        OR: [
          {
            academicGroups: { none: {} },
            classes: { none: {} },
            // Passing `instituteId: undefined` to Prisma drops the key entirely (matches every
            // row) rather than matching nothing, so studentInstituteId must never be spread in
            // as undefined — omit the second OR branch instead when it's falsy.
            OR: studentInstituteId ? [{ instituteId: null }, { instituteId: studentInstituteId }] : [{ instituteId: null }],
          },
          ...(academicGroupId ? [{ academicGroups: { some: { academicGroupId } } }] : []),
          ...(classId ? [{ classes: { some: { classId } } }] : []),
        ],
      },
      ...(poolIds.length ? [{ talentPools: { some: { poolId: { in: poolIds } } } }] : []),
    ],
  };
}

// For an already-loaded test that includes `academicGroups: {select:{academicGroupId:true}}`,
// `classes: {select:{classId:true}}`, `talentPools: {select:{poolId:true}}`, and `instituteId` —
// synchronous, no extra query. memberPoolIds may be a Set or a plain array of the requesting
// student's pool ids. studentInstituteId is the requesting student's own instituteId.
function isTestVisibleToStudent(test, academicGroupId, classId, memberPoolIds, studentInstituteId) {
  const pools = test.talentPools || [];
  if (pools.length > 0) {
    if (!memberPoolIds) return false;
    const ids = memberPoolIds instanceof Set ? memberPoolIds : new Set(memberPoolIds);
    return pools.some((p) => ids.has(p.poolId));
  }
  const groups = test.academicGroups || [];
  const classes = test.classes || [];
  if (groups.length === 0 && classes.length === 0) {
    return test.instituteId == null || test.instituteId === studentInstituteId;
  }
  if (academicGroupId && groups.some((g) => g.academicGroupId === academicGroupId)) return true;
  if (classId && classes.some((c) => c.classId === classId)) return true;
  return false;
}

// DB-authoritative check for call sites that only have the IDs, not a preloaded relation.
async function studentCanAccessTest(prisma, testId, academicGroupId, classId, memberPoolIds, studentInstituteId) {
  const poolLinks = await prisma.talentPoolTest.count({ where: { testId } });
  if (poolLinks > 0) {
    if (!memberPoolIds) return false;
    const ids = memberPoolIds instanceof Set ? [...memberPoolIds] : memberPoolIds;
    if (!ids.length) return false;
    const match = await prisma.talentPoolTest.findFirst({ where: { testId, poolId: { in: ids } } });
    return !!match;
  }
  // Sequential, not Promise.all — this runs on POST /tests/:id/start, the "Begin Test" click,
  // which is exactly the most synchronized moment on the whole platform: a full class clicking
  // Start at the scheduled exam time. Same pool-contention reasoning as auth.js/dashboard.js.
  const groupLinks = await prisma.testAcademicGroup.count({ where: { testId } });
  const classLinks = await prisma.testClass.count({ where: { testId } });
  if (groupLinks === 0 && classLinks === 0) {
    const test = await prisma.test.findUnique({ where: { id: testId }, select: { instituteId: true } });
    return test.instituteId == null || test.instituteId === studentInstituteId;
  }
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
