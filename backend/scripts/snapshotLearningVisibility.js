// Read-only. Counts publish flags across the Learning hierarchy so a migration can be proven to change
// nothing: run before and after, diff the output. Writes nothing.
const prisma = require("../src/prisma");
(async () => {
  const out = {};
  out.courses = await prisma.course.groupBy({ by: ["status", "isActive"], _count: true });
  out.modules = await prisma.courseModule.groupBy({ by: ["isActive"], _count: true });
  out.chapters = await prisma.chapter.groupBy({ by: ["isActive"], _count: true });
  out.lessons = await prisma.lesson.groupBy({ by: ["isActive"], _count: true });
  out.levels = await prisma.moduleCodingTest.groupBy({ by: ["isActive", "chapterId"].slice(0, 1), _count: true });
  out.levelsChapterScoped = await prisma.moduleCodingTest.count({ where: { chapterId: { not: null } } });
  out.attempts = await prisma.moduleCodingAttempt.groupBy({ by: ["status"], _count: true });
  out.lessonProgress = await prisma.lessonProgress.count();
  out.questionsInLevels = await prisma.question.count({ where: { moduleCodingTestId: { not: null } } });
  out.levelQuestionStatus = await prisma.question.groupBy({ by: ["questionStatus"], where: { moduleCodingTestId: { not: null } }, _count: true });
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})();
