// Skill Graph (LMS master-spec section 33): "Create a visual skill map... Show: Mastered,
// Learning, Needs Practice, Locked. Do not claim mastery without defined criteria."
//
// Deliberately built on the REAL Course -> Module -> Lesson tree that already exists, not an
// invented taxonomy (the spec's own example, "OOP -> Classes, Objects, Inheritance", implies a
// concept hierarchy this platform has no authored data for — PracticeQuestion.tags is a flat set,
// not a tree). Fabricating parent/child relationships between tags nobody curated would be
// exactly the "fake or misleading analytics" the standing rules and spec section 43 warn against.
// Using the course's own already-curated Module/Lesson structure as the map's branches/leaves is
// the honest alternative: every node's status comes from real, already-persisted signals.
const prisma = require("../prisma");
const { getModuleLockMap } = require("./learningLock");
const { computeConceptMastery } = require("./conceptMastery");

const LOW_QUIZ_SCORE_THRESHOLD = 60; // matches learningRecommendations.js's own constant

async function computeSkillGraph(studentId, courseId) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, name: true } });
  if (!course) return null;

  const modules = await prisma.courseModule.findMany({
    where: { courseId }, orderBy: { order: "asc" },
    include: { lessons: { orderBy: { order: "asc" }, include: { questions: { where: { type: "CODING" }, select: { tags: true } } } } },
  });

  const [lockMap, mastery] = await Promise.all([
    getModuleLockMap(prisma, studentId, courseId),
    computeConceptMastery(prisma, studentId),
  ]);
  const needsPracticeTags = new Set(mastery.filter((m) => m.strength === "NEEDS_PRACTICE").map((m) => m.tag));

  const allLessonIds = modules.flatMap((m) => m.lessons.map((l) => l.id));
  const progress = allLessonIds.length
    ? await prisma.lessonProgress.findMany({ where: { studentId, lessonId: { in: allLessonIds } } })
    : [];
  const progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));

  const graphModules = modules.map((mod) => {
    const lock = lockMap.get(mod.id) || { locked: false };
    const lessons = mod.lessons.map((lesson) => {
      if (lock.locked) return { id: lesson.id, title: lesson.title, status: "LOCKED" };

      const p = progressByLesson.get(lesson.id);
      if (!p || p.status !== "COMPLETED") {
        return { id: lesson.id, title: lesson.title, status: p?.status === "IN_PROGRESS" ? "LEARNING" : "NOT_STARTED" };
      }

      // Completed — but "mastered" needs more than just having clicked through it: a low quiz
      // score on this lesson's own test, or a NEEDS_PRACTICE concept among this lesson's own
      // coding practice questions, both mean the student finished it without really landing it.
      const lowQuizScore = lesson.isModuleTest && p.score != null && p.score < LOW_QUIZ_SCORE_THRESHOLD;
      const lessonTags = lesson.questions.flatMap((q) => (Array.isArray(q.tags) ? q.tags : []));
      const hasWeakConcept = lessonTags.some((t) => needsPracticeTags.has(t));
      const status = lowQuizScore || hasWeakConcept ? "NEEDS_PRACTICE" : "MASTERED";
      return { id: lesson.id, title: lesson.title, status };
    });
    return { id: mod.id, title: mod.title, locked: lock.locked, lessons };
  });

  return { course: { id: course.id, name: course.name }, modules: graphModules };
}

module.exports = { computeSkillGraph };
