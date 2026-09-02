// Shared by gradeModuleCodingAttempt.js's certificate-issuance check. Returns the flattened list
// of ModuleCodingTest ids that must be passed for a course's course-wide CODING_ASSESSMENT
// certificate: every legacy Module-direct test (always required, predates the Chapter concept).
//
// Chapter-scoped Levels are excluded here too, for the identical reason learningLock.js's
// gatingTestIds excludes them from module-unlock progression: there is currently no student-
// facing route anywhere in the codebase to start or submit an attempt against a chapterId-scoped
// ModuleCodingTest, so requiring one passed would make the certificate permanently unearnable
// regardless of pool size or countsTowardCertificate. Both consumers must apply the identical
// exclusion or they could silently disagree about what's actually required — see learningLock.js
// for the full reasoning and the TODO to reinstate Level support once that flow ships.
async function getCertificateGatingTestIds(prisma, courseId) {
  const modules = await prisma.courseModule.findMany({
    where: { courseId },
    select: {
      codingTest: { select: { id: true, isActive: true, _count: { select: { questions: true } } } },
    },
  });
  return modules.filter((m) => m.codingTest?.isActive && m.codingTest._count.questions > 0).map((m) => m.codingTest.id);
}

module.exports = { getCertificateGatingTestIds };
