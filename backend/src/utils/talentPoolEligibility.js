// Every student's current Talent Pool memberships, as a Set for O(1) lookup — used both by
// testEligibility.js's memberPoolIds threading (a Test can be pool-exclusive) and directly by
// callers that just need "which pools is this student in" (e.g. GET /talent-pools/my-pools).
async function getStudentPoolIds(prismaClient, studentId) {
  // pool: { isActive: true } — every caller of this helper (test/dashboard eligibility, my-pools
  // performance aggregation) uses the result to decide what a student is currently eligible to
  // see/attempt. Without this filter, deactivating a pool never actually revoked the exclusive-test
  // access its members already had, silently violating "students should only be eligible for
  // active Talent Pools" (confirmed: no isActive check existed anywhere in this eligibility chain).
  const rows = await prismaClient.talentPoolMember.findMany({
    where: { studentId, pool: { isActive: true } },
    select: { poolId: true },
  });
  return new Set(rows.map((r) => r.poolId));
}

// DB-authoritative single-pool check — for call sites (e.g. the interview.js session-create gate)
// that only need to know about one specific pool, not the student's full membership set.
async function isStudentTalentPoolMember(prismaClient, studentId, poolId) {
  const match = await prismaClient.talentPoolMember.findUnique({
    where: { poolId_studentId: { poolId, studentId } },
  });
  return !!match;
}

module.exports = { getStudentPoolIds, isStudentTalentPoolMember };
