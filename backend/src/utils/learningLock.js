// Shared between routes/learning.js (enforcing the lock) and routes/dashboard.js (surfacing a
// "module unlocked" notification) — kept in one place so the two never drift out of sync.

// Sequential module locking: module N is locked unless every lesson in module N-1 is COMPLETED
// (including that module's isModuleTest lesson, the final practice test) AND, when module N-1 has
// an active Coding Assessment configured (the legacy Module-direct codingTest, or a Chapter's
// Level), the student has actually PASSED it — a submission alone, or an in-progress/still-
// evaluating attempt, is never enough (see ModuleCodingAttempt.status: only a `passed: true` row
// counts, computed by gradeModuleCodingAttempt.js after real grading, never at submission time).
// The passing bar itself is whatever that Level/Test's own passingPercent is configured to (see
// moduleCoding.js's admin CRUD) — never hard-coded here. Previously excluded the Coding Assessment
// entirely from this gate ("intentionally excluded... only lesson content is required") — that let
// the next module unlock on lesson-completion alone even when a required Coding Assessment was
// still unsubmitted, in progress, or outright failed. Fixed 2026-08-28: a Coding Assessment
// configured on a module is now a real prerequisite for the module *after* it, exactly like lesson
// completion already was — it still ALSO gates the CODING_ASSESSMENT certificate via the
// independent path in gatingLevels.js/gradeModuleCodingAttempt.js, unchanged. Once one module is
// locked, everything after it stays locked, regardless of that module's own state.
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
    // A module is only satisfied (and so only unlocks the one after it) once its lesson content
    // AND its required Coding Assessment (if any) are both done — codingPassed is only true for a
    // graded `passed: true` ModuleCodingAttempt, never a bare submission/in-progress/failed one.
    const moduleSatisfied = !locked && lessonsComplete && codingPassed;
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
