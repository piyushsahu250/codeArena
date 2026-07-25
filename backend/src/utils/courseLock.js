// Course-level prerequisite lock: a course with unmet prerequisites (student doesn't hold a
// LEARNING_MODULE certificate for every course in its CoursePrerequisite list) is locked —
// distinct from learningLock.js's per-module lock, which only applies once a course is already
// open. A course with zero prerequisites is never locked by this check.
async function getCourseLockInfo(prisma, studentId, courseId) {
  const prereqs = await prisma.coursePrerequisite.findMany({
    where: { courseId },
    select: { prerequisiteCourseId: true, prerequisite: { select: { id: true, name: true } } },
  });
  if (prereqs.length === 0) return { locked: false, missingPrerequisites: [] };

  const certs = await prisma.certificate.findMany({
    where: {
      studentId,
      type: "LEARNING_MODULE",
      status: "VALID",
      courseId: { in: prereqs.map((p) => p.prerequisiteCourseId) },
    },
    select: { courseId: true },
  });
  const satisfiedIds = new Set(certs.map((c) => c.courseId));
  const missing = prereqs.filter((p) => !satisfiedIds.has(p.prerequisiteCourseId)).map((p) => p.prerequisite);
  return { locked: missing.length > 0, missingPrerequisites: missing };
}

// Simple BFS cycle check used when an admin sets a course's prerequisite list — prevents A
// requiring B while B (transitively) requires A, which would make both permanently unlockable.
async function wouldCreateCycle(prisma, courseId, newPrerequisiteIds) {
  if (newPrerequisiteIds.includes(courseId)) return true;
  const visited = new Set();
  let frontier = [...newPrerequisiteIds];
  while (frontier.length > 0) {
    const rows = await prisma.coursePrerequisite.findMany({
      where: { courseId: { in: frontier } },
      select: { prerequisiteCourseId: true },
    });
    const next = [];
    for (const r of rows) {
      if (r.prerequisiteCourseId === courseId) return true;
      if (!visited.has(r.prerequisiteCourseId)) {
        visited.add(r.prerequisiteCourseId);
        next.push(r.prerequisiteCourseId);
      }
    }
    frontier = next;
  }
  return false;
}

module.exports = { getCourseLockInfo, wouldCreateCycle };
