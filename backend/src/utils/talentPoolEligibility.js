// Every student's current Talent Pool memberships, as a Set for O(1) lookup — used both by
// testEligibility.js's memberPoolIds threading (a Test can be pool-exclusive) and directly by
// callers that just need "which pools is this student in" (e.g. GET /talent-pools/my-pools).
async function getStudentPoolIds(prismaClient, studentId) {
  const rows = await prismaClient.talentPoolMember.findMany({
    where: { studentId },
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
