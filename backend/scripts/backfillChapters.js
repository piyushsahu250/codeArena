/**
 * One-time (idempotent) backfill for the new Course->Module->Chapter hierarchy. Every
 * CourseModule that predates the Chapter model has zero Chapter rows; this script gives each
 * one a single "General" Chapter and repoints all of that module's existing Lessons at it, so
 * every pre-existing course keeps rendering/gating exactly as before (module unlock/certificate
 * logic in learningLock.js / gradeModuleCodingAttempt.js is a no-op for a module whose only
 * Chapter has zero Levels). Safe to re-run: a module that already has at least one Chapter is
 * left untouched, and a Lesson that already has a chapterId is left untouched.
 */
const prisma = require("../src/prisma");

async function backfillChapters() {
  const modules = await prisma.courseModule.findMany({
    include: { chapters: { select: { id: true } }, lessons: { select: { id: true, chapterId: true } } },
  });

  let chaptersCreated = 0;
  let lessonsRepointed = 0;

  for (const mod of modules) {
    let generalChapter = mod.chapters[0];
    if (!generalChapter) {
      generalChapter = await prisma.chapter.create({
        data: { moduleId: mod.id, title: "General", order: 0, isActive: true, countsTowardCertificate: true },
      });
      chaptersCreated++;
      console.log(`[backfillChapters] Created "General" chapter for module "${mod.title}" (${mod.id}).`);
    }

    const unassigned = mod.lessons.filter((l) => !l.chapterId);
    if (unassigned.length > 0) {
      await prisma.lesson.updateMany({
        where: { id: { in: unassigned.map((l) => l.id) } },
        data: { chapterId: generalChapter.id },
      });
      lessonsRepointed += unassigned.length;
    }
  }

  return { chaptersCreated, lessonsRepointed };
}

async function main() {
  const { chaptersCreated, lessonsRepointed } = await backfillChapters();
  console.log(`[backfillChapters] Done. Created ${chaptersCreated} chapter(s), repointed ${lessonsRepointed} lesson(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillChapters] failed:", err);
  process.exit(1);
});
