const prisma = require("../prisma");

// Shared by both the student-facing lookup routes (challenges.js) and the scheduler
// (challengeScheduler.js), so the two never disagree about what "most specific" means. Fetches
// the (at most 3) candidate rows and picks the most specific in JS rather than relying on
// Postgres/Prisma NULL-ordering in an `orderBy` — safer and unambiguous.
//
// Resolution order: a challenge scoped to the student's own academic group beats one scoped to
// their institute (with no academic group) beats the Global one (no institute, no academic
// group) — exactly one of at most three rows can exist per date/week per this student, enforced
// by the partial unique indexes added in scripts/addChallengeScopeIndexes.js.
async function resolveMostSpecificChallenge(model, dateField, dateValue, student) {
  const candidates = await model.findMany({
    where: {
      [dateField]: dateValue,
      isActive: true,
      OR: [
        ...(student?.academicGroupId ? [{ academicGroupId: student.academicGroupId }] : []),
        ...(student?.instituteId ? [{ instituteId: student.instituteId, academicGroupId: null }] : []),
        { instituteId: null, academicGroupId: null },
      ],
    },
  });
  if (candidates.length === 0) return null;
  const byAcademicGroup = student?.academicGroupId && candidates.find((c) => c.academicGroupId === student.academicGroupId);
  if (byAcademicGroup) return byAcademicGroup;
  const byInstitute = student?.instituteId && candidates.find((c) => c.instituteId === student.instituteId && !c.academicGroupId);
  if (byInstitute) return byInstitute;
  return candidates.find((c) => !c.instituteId && !c.academicGroupId) || null;
}

// studentId -> {instituteId, academicGroupId}, single small lookup — req.user (JWT payload) only
// carries id/role/email/jti, not these scope fields, same reasoning as attachRequesterInstitute.
async function loadStudentScope(studentId) {
  const student = await prisma.user.findUnique({ where: { id: studentId }, select: { instituteId: true, academicGroupId: true } });
  return student || { instituteId: null, academicGroupId: null };
}

module.exports = { resolveMostSpecificChallenge, loadStudentScope };
