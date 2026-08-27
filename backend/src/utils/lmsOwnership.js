// LMS content-ownership resolution — Course carries the only instituteId in the Course > Module >
// Chapter > Lesson / PracticeQuestion / ModuleCodingTest tree (see Course.instituteId's schema
// comment); every nested resource's ownership is resolved by walking up to its Course. Mirrors the
// same "own institute, or unscoped platform admin owns everything" convention already used by
// challenges.js's ownsChallengeRow and talentPools.js's loadPoolScoped — kept as its own small
// module rather than importing across route files, matching this codebase's existing layering.
const prisma = require("../prisma");

// !req.requesterInstituteId: an unscoped (platform-level) Super Admin/Admin owns everything.
// Otherwise the resource's owning course must be scoped to that exact institute — a null
// (global/platform-authored) course is NOT ownable by any institute-scoped admin, same as a
// foreign institute's course isn't.
function ownsLmsInstitute(req, resourceInstituteId) {
  return !req.requesterInstituteId || resourceInstituteId === req.requesterInstituteId;
}

async function resolveModuleCourseInstituteId(moduleId) {
  const mod = await prisma.courseModule.findUnique({ where: { id: moduleId }, select: { course: { select: { instituteId: true } } } });
  return mod ? mod.course.instituteId : undefined; // undefined = module not found
}

async function resolveChapterCourseInstituteId(chapterId) {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { module: { select: { course: { select: { instituteId: true } } } } } });
  return chapter ? chapter.module.course.instituteId : undefined;
}

// Lesson.moduleId is denormalized directly on every Lesson row (chapter-scoped or not — see
// Chapter's schema comment), so this only needs one hop through Module, not through Chapter first.
async function resolveLessonCourseInstituteId(lessonId) {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { module: { select: { course: { select: { instituteId: true } } } } } });
  return lesson ? lesson.module.course.instituteId : undefined;
}

async function resolvePracticeQuestionCourseInstituteId(practiceQuestionId) {
  const q = await prisma.practiceQuestion.findUnique({ where: { id: practiceQuestionId }, select: { lesson: { select: { module: { select: { course: { select: { instituteId: true } } } } } } } });
  return q ? q.lesson.module.course.instituteId : undefined;
}

// ModuleCodingTest ("Level") is scoped either directly to a Module (legacy) or to a Chapter (see
// its schema comment) — exactly one of moduleId/chapterId is set, never both.
async function resolveModuleCodingTestCourseInstituteId(testId) {
  const test = await prisma.moduleCodingTest.findUnique({
    where: { id: testId },
    select: {
      module: { select: { course: { select: { instituteId: true } } } },
      chapter: { select: { module: { select: { course: { select: { instituteId: true } } } } } },
    },
  });
  if (!test) return undefined;
  return test.module ? test.module.course.instituteId : test.chapter.module.course.instituteId;
}

module.exports = {
  ownsLmsInstitute,
  resolveModuleCourseInstituteId,
  resolveChapterCourseInstituteId,
  resolveLessonCourseInstituteId,
  resolvePracticeQuestionCourseInstituteId,
  resolveModuleCodingTestCourseInstituteId,
};
