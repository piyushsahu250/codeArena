// Simple, rule-based (NOT AI) learning recommendations for a student's Learning Hub/Dashboard.
// Every signal here is real, already-persisted student data — no random suggestions, no course
// ever recommended outside what courseEligibility.js already says this student can see.
//
// Priority order (highest first), matching the spec this was built against:
//   1. Required incomplete content (first unlocked-but-incomplete module in an eligible course)
//   2. Failed assessment (a ModuleCodingAttempt that didn't pass, or a low module-quiz score)
//   3. Weak topic (CRITICAL-strength topics from the student's own latest Readiness report, if any)
//   4/5. Practice suggestions / next learning activity
//
// Reuses getModuleLockMap() (learningLock.js) for "next module" instead of recomputing lock
// state a second, possibly-diverging way, and courseEligibilityWhere/isCourseVisibleToStudent
// (courseEligibility.js) so a recommendation can never point at a course this student isn't
// actually assigned/eligible for.
const { getModuleLockMap } = require("./learningLock");
const { courseEligibilityWhere, isEligibilityUnresolvable } = require("./courseEligibility");

const LOW_QUIZ_SCORE_THRESHOLD = 60;
const MAX_RECOMMENDATIONS = 6;

async function computeLearningRecommendations(prisma, studentId) {
  const student = await prisma.user.findUnique({ where: { id: studentId }, select: { instituteId: true, academicGroupId: true } });
  if (!student || isEligibilityUnresolvable(student.instituteId, student.academicGroupId)) return [];

  const eligibleCourses = await prisma.course.findMany({
    where: { status: "PUBLISHED", ...courseEligibilityWhere(student.instituteId, student.academicGroupId) },
    orderBy: { order: "asc" },
    select: { id: true, slug: true, name: true },
  });
  if (eligibleCourses.length === 0) return [];

  const recs = [];

  // --- Priority 1: required incomplete content (first unlocked-but-incomplete module) ---
  for (const course of eligibleCourses) {
    const lockMap = await getModuleLockMap(prisma, studentId, course.id);
    const modules = await prisma.courseModule.findMany({ where: { courseId: course.id }, orderBy: { order: "asc" }, select: { id: true, title: true } });
    const next = modules.find((m) => {
      const state = lockMap.get(m.id);
      return state && !state.locked && !state.completed;
    });
    if (next) {
      recs.push({
        type: "CONTINUE_LEARNING",
        priority: 1,
        title: `Continue ${course.name}`,
        description: `Pick up where you left off in ${next.title}.`,
        actionLabel: "Continue",
        actionUrl: `/learning/${course.slug}`,
      });
      break; // one "keep going" nudge is enough — this isn't meant to be a full course listing
    }
  }

  // --- Priority 2a: most recent failed Module Coding Assessment attempt ---
  // ModuleCodingAttempt has no createdAt column (only startedAt/submittedAt) — ordering by
  // createdAt threw PrismaClientValidationError on every single call, silently caught by the
  // route's try/catch (see [dashboard/student] recommendations failed in the logs), which meant
  // this recommendation never once fired for any student. startedAt is the correct "most recent
  // attempt" ordering field.
  const failedAttempt = await prisma.moduleCodingAttempt.findFirst({
    where: { studentId, passed: false, status: { not: "IN_PROGRESS" } },
    orderBy: { startedAt: "desc" },
    include: { moduleCodingTest: { include: { module: { include: { course: true } } }, } },
  });
  if (failedAttempt?.moduleCodingTest?.module?.course) {
    const course = failedAttempt.moduleCodingTest.module.course;
    if (eligibleCourses.some((c) => c.id === course.id)) {
      recs.push({
        type: "RETRY_ASSESSMENT",
        priority: 2,
        title: `Retry ${failedAttempt.moduleCodingTest.module.title} Assessment`,
        description: `Your last attempt didn't pass (${failedAttempt.score}%). Give it another try.`,
        actionLabel: "Retry",
        actionUrl: `/learning/${course.slug}/module/${failedAttempt.moduleCodingTest.module.id}/coding-assessment`,
      });
    }
  }

  // --- Priority 2b: a completed module quiz with a low score ---
  const weakQuiz = await prisma.lessonProgress.findFirst({
    where: { studentId, status: "COMPLETED", score: { lt: LOW_QUIZ_SCORE_THRESHOLD }, lesson: { isModuleTest: true } },
    orderBy: { updatedAt: "desc" },
    include: { lesson: { include: { module: { include: { course: true } } } } },
  });
  if (weakQuiz?.lesson?.module?.course && eligibleCourses.some((c) => c.id === weakQuiz.lesson.module.course.id)) {
    recs.push({
      type: "REVIEW_TOPIC",
      priority: 2,
      title: `Review ${weakQuiz.lesson.module.title}`,
      description: `You scored ${weakQuiz.score}% on this module's practice test — worth another look before moving on.`,
      actionLabel: "Review",
      actionUrl: `/learning/${weakQuiz.lesson.module.course.slug}/lesson/${weakQuiz.lessonId}`,
    });
  }

  // --- Priority 3: weakest topic from the student's own latest Employability Readiness report ---
  const latestReport = await prisma.readinessReport.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } });
  if (latestReport && Array.isArray(latestReport.topicScores)) {
    const weakest = latestReport.topicScores.find((t) => t.strength === "CRITICAL");
    if (weakest) {
      recs.push({
        type: "PRACTICE_WEAK_AREA",
        priority: 3,
        title: `Practice ${weakest.topic}`,
        description: "This came up as a weak area in your Employability Readiness results.",
        actionLabel: "View report",
        actionUrl: "/readiness",
      });
    }
  }

  return recs.sort((a, b) => a.priority - b.priority).slice(0, MAX_RECOMMENDATIONS);
}

module.exports = { computeLearningRecommendations };
