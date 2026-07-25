/**
 * One-time (idempotent) backfill for the new Course.status lifecycle + institute assignment.
 * Every currently-`isActive: true` Course becomes PUBLISHED (preserves today's live set
 * exactly); everything else becomes DRAFT (today's "coming soon" set was never truly live).
 * Every PUBLISHED course then gets a CourseInstituteAssignment row for every existing
 * Institute, so no current student loses access once student-facing visibility gating ships
 * (Phase A5) - a course with zero assignment rows is invisible under the new strict-visibility
 * default, so this backfill MUST run (and be verified) before that phase deploys.
 *
 * Uses `status: "DRAFT"` (the schema default) as the "never touched since this migration ran"
 * signal, so a course an admin already explicitly re-drafted through the new UI is left alone
 * on a re-run. Assignment backfill uses createMany + skipDuplicates instead of a per-pair
 * findOrCreate loop, so re-running this script is always safe.
 */
const prisma = require("../src/prisma");

async function backfillCourseVisibility() {
  const untouched = await prisma.course.findMany({
    where: { status: "DRAFT" },
    select: { id: true, isActive: true, name: true },
  });

  let publishedCount = 0;
  for (const c of untouched) {
    if (c.isActive) {
      await prisma.course.update({ where: { id: c.id }, data: { status: "PUBLISHED" } });
      publishedCount++;
      console.log(`[backfillCourseVisibility] Published "${c.name}" (${c.id}) — was isActive:true.`);
    }
  }

  const publishedCourses = await prisma.course.findMany({ where: { status: "PUBLISHED" }, select: { id: true } });
  const institutes = await prisma.institute.findMany({ select: { id: true } });
  const rows = publishedCourses.flatMap((c) =>
    institutes.map((i) => ({
      courseId: c.id, instituteId: i.id,
      assignedByUserId: "system", assignedByName: "System (backfillCourseVisibility)",
    }))
  );
  const { count: assignmentsCreated } = rows.length
    ? await prisma.courseInstituteAssignment.createMany({ data: rows, skipDuplicates: true })
    : { count: 0 };

  return { publishedCount, assignmentsCreated, publishedTotal: publishedCourses.length, instituteTotal: institutes.length };
}

async function main() {
  const { publishedCount, assignmentsCreated, publishedTotal, instituteTotal } = await backfillCourseVisibility();
  console.log(
    `[backfillCourseVisibility] Done. Published ${publishedCount} course(s) this run. ` +
    `${publishedTotal} course(s) are PUBLISHED total, ${instituteTotal} institute(s) exist, ` +
    `created ${assignmentsCreated} institute-assignment row(s) this run.`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillCourseVisibility] failed:", err);
  process.exit(1);
});
