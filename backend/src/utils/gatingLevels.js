// Shared by gradeModuleCodingAttempt.js's certificate-issuance check. Returns the flattened list
// of ModuleCodingTest ids that must be passed for a course's course-wide CODING_ASSESSMENT
// certificate: every legacy Module-direct test (always required, predates the Chapter concept)
// plus every active Level belonging to a Chapter explicitly marked countsTowardCertificate.
// Deliberately NOT reused by learningLock.js — module-unlock progression requires ALL active
// Levels regardless of countsTowardCertificate (that flag only ever affects the certificate).
async function getCertificateGatingTestIds(prisma, courseId) {
  const modules = await prisma.courseModule.findMany({
    where: { courseId },
    select: {
      codingTest: { select: { id: true, isActive: true } },
      chapters: {
        where: { countsTowardCertificate: true },
        select: { levels: { where: { isActive: true }, select: { id: true } } },
      },
    },
  });
  return [
    ...modules.filter((m) => m.codingTest?.isActive).map((m) => m.codingTest.id),
    ...modules.flatMap((m) => m.chapters.flatMap((c) => c.levels.map((l) => l.id))),
  ];
}

module.exports = { getCertificateGatingTestIds };
