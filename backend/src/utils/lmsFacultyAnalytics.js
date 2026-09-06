// Faculty LMS Analytics + At-Risk Students (LMS master-spec sections 40-41). "Do NOT label
// students as at risk based on arbitrary/random criteria" — every reason below is a concrete,
// named, already-persisted signal, never a guess:
//   NO_ACTIVITY               - zero LessonProgress rows ever recorded for this course
//   REPEATED_ASSESSMENT_FAILURE - 2+ failed (passed:false) ModuleCodingAttempt rows for this course
const prisma = require("../prisma");

// The reverse of courseEligibility.js's own direction: given a course, which students can even see
// it (via CourseInstituteAssignment or CourseAcademicGroupAssignment), optionally narrowed to one
// institute (an institute-scoped admin/staff must only ever see their OWN institute's students,
// even for a globally-assigned course visible to several institutes).
async function getEligibleStudents(courseId, scopeInstituteId) {
  const [instAssign, groupAssign] = await Promise.all([
    prisma.courseInstituteAssignment.findMany({ where: { courseId }, select: { instituteId: true } }),
    prisma.courseAcademicGroupAssignment.findMany({ where: { courseId }, select: { academicGroupId: true } }),
  ]);
  const instituteIds = instAssign.map((a) => a.instituteId);
  const groupIds = groupAssign.map((a) => a.academicGroupId);
  if (instituteIds.length === 0 && groupIds.length === 0) return [];

  const where = {
    role: "STUDENT",
    OR: [
      ...(instituteIds.length ? [{ instituteId: { in: instituteIds } }] : []),
      ...(groupIds.length ? [{ academicGroupId: { in: groupIds } }] : []),
    ],
  };
  if (scopeInstituteId) where.instituteId = scopeInstituteId;
  return prisma.user.findMany({ where, select: { id: true, name: true, registrationNumber: true, email: true } });
}

async function computeCourseAnalytics(courseId, scopeInstituteId) {
  const students = await getEligibleStudents(courseId, scopeInstituteId);
  const studentIds = students.map((s) => s.id);
  if (studentIds.length === 0) {
    return { enrolledCount: 0, activeCount: 0, completedCount: 0, completionRate: 0, moduleCompletion: [], atRisk: [] };
  }

  const modules = await prisma.courseModule.findMany({
    where: { courseId }, orderBy: { order: "asc" },
    select: { id: true, title: true, lessons: { select: { id: true } } },
  });
  const allLessonIds = modules.flatMap((m) => m.lessons.map((l) => l.id));

  const [progressRows, activeStudentRows, certRows, failedAttemptRows] = await Promise.all([
    allLessonIds.length
      ? prisma.lessonProgress.findMany({ where: { studentId: { in: studentIds }, lessonId: { in: allLessonIds }, status: "COMPLETED" }, select: { studentId: true, lessonId: true } })
      : [],
    allLessonIds.length
      ? prisma.lessonProgress.groupBy({ by: ["studentId"], where: { studentId: { in: studentIds }, lessonId: { in: allLessonIds } } })
      : [],
    prisma.certificate.findMany({ where: { studentId: { in: studentIds }, courseId, type: "LEARNING_MODULE", status: "VALID" }, select: { studentId: true } }),
    prisma.moduleCodingAttempt.groupBy({
      by: ["studentId"],
      where: { studentId: { in: studentIds }, passed: false, moduleCodingTest: { OR: [{ module: { courseId } }, { chapter: { module: { courseId } } }] } },
      _count: { _all: true },
    }),
  ]);

  const completedLessonsByStudent = new Map(); // studentId -> Set<lessonId>
  for (const p of progressRows) {
    if (!completedLessonsByStudent.has(p.studentId)) completedLessonsByStudent.set(p.studentId, new Set());
    completedLessonsByStudent.get(p.studentId).add(p.lessonId);
  }
  const activeSet = new Set(activeStudentRows.map((a) => a.studentId));
  const completedSet = new Set(certRows.map((c) => c.studentId));
  const failedCountByStudent = new Map(failedAttemptRows.map((f) => [f.studentId, f._count._all]));

  const moduleCompletion = modules.map((mod) => {
    const lessonIds = mod.lessons.map((l) => l.id);
    const completedCount = lessonIds.length === 0 ? 0 : studentIds.filter((sid) => {
      const set = completedLessonsByStudent.get(sid);
      return set && lessonIds.every((lid) => set.has(lid));
    }).length;
    return { moduleId: mod.id, title: mod.title, completedCount, totalStudents: studentIds.length };
  });

  const atRisk = students
    .map((s) => {
      const reasons = [];
      if (!activeSet.has(s.id)) reasons.push("NO_ACTIVITY");
      if ((failedCountByStudent.get(s.id) || 0) >= 2) reasons.push("REPEATED_ASSESSMENT_FAILURE");
      return { id: s.id, name: s.name, registrationNumber: s.registrationNumber, email: s.email, reasons };
    })
    .filter((s) => s.reasons.length > 0);

  return {
    enrolledCount: studentIds.length,
    activeCount: activeSet.size,
    completedCount: completedSet.size,
    completionRate: Math.round((completedSet.size / studentIds.length) * 100),
    moduleCompletion,
    atRisk,
  };
}

module.exports = { computeCourseAnalytics };
