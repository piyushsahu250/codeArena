// Shared between routes/learning.js (enforcing the lock) and routes/dashboard.js (surfacing a
// "module unlocked" notification) — kept in one place so the two never drift out of sync.

// Sequential module locking: module N is locked unless every lesson in module N-1 is COMPLETED
// (including that module's isModuleTest lesson, the final practice test). A module's proctored
// Coding Assessment (the legacy Module-direct codingTest, or a Chapter's Level) is tracked and
// returned here too, but deliberately does NOT gate the next module's unlock — it's an
// independent, optional achievement that only gates the CODING_ASSESSMENT certificate (see
// gatingLevels.js/gradeModuleCodingAttempt.js, which don't call this function at all). Once one
// module is locked, everything after it stays locked, regardless of that module's own state.
async function getModuleLockMap(prisma, studentId, courseId) {
  const modules = await prisma.courseModule.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    include: {
      lessons: { select: { id: true } },
      codingTest: true,
      chapters: { include: { levels: true } },
    },
  });
  const allLessonIds = modules.flatMap((m) => m.lessons.map((l) => l.id));
  const progress = allLessonIds.length
    ? await prisma.lessonProgress.findMany({
        where: { studentId, lessonId: { in: allLessonIds }, status: "COMPLETED" },
        select: { lessonId: true },
      })
    : [];
  const completedSet = new Set(progress.map((p) => p.lessonId));

  function gatingTestIds(m) {
    const ids = m.codingTest?.isActive ? [m.codingTest.id] : [];
    return ids.concat(m.chapters.flatMap((c) => c.levels.filter((l) => l.isActive).map((l) => l.id)));
  }
  const allGatingTestIds = modules.flatMap(gatingTestIds);
  const passedTestIds = allGatingTestIds.length
    ? new Set(
        (
          await prisma.moduleCodingAttempt.findMany({
            where: { moduleCodingTestId: { in: allGatingTestIds }, studentId, passed: true },
            select: { moduleCodingTestId: true },
          })
        ).map((a) => a.moduleCodingTestId)
      )
    : new Set();

  const map = new Map();
  let prevSatisfied = true; // nothing is required before the first module
  for (const m of modules) {
    const locked = !prevSatisfied;
    const lessonsComplete = m.lessons.length > 0 && m.lessons.every((l) => completedSet.has(l.id));
    const testIds = gatingTestIds(m);
    const codingRequired = testIds.length > 0;
    const codingPassed = codingRequired ? testIds.every((id) => passedTestIds.has(id)) : true;
    // Coding Assessment status is reported below (for the UI badge / certificate eligibility) but
    // intentionally excluded from moduleSatisfied — passing it is not required to unlock the next
    // module, only lesson content (including the final practice test) is.
    const moduleSatisfied = !locked && lessonsComplete;
    map.set(m.id, {
      locked,
      completed: moduleSatisfied,
      lessonsComplete: !locked && lessonsComplete,
      codingTest: codingRequired ? { required: true, passed: codingPassed } : { required: false, passed: true },
    });
    prevSatisfied = moduleSatisfied;
  }
  return map;
}

module.exports = { getModuleLockMap };
