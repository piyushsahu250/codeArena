/**
 * One-time backfill for the new Course.status lifecycle + institute assignment, run as part of
 * the standard migrate/backfill/seed chain (scripts/migrateAndSeed.sh) on EVERY container boot on
 * this deployment (not a genuine one-shot Cloud Run migration Job here) — so "one-time" had to be
 * enforced explicitly, not just implied by the docstring.
 *
 * BUG FOUND AND FIXED (2026-09-21): the institute-assignment step below used to run its full
 * "every PUBLISHED course -> every institute" backfill unconditionally on every single boot, not
 * just the first one. That was fine (a true no-op) for courses already fully assigned, but for
 * ANY course that got marked PUBLISHED afterward and simply hadn't been assigned yet -- an admin
 * mid-setup, testing, or who forgot the Assign step -- the very next deploy silently gave it a
 * CourseInstituteAssignment row for every institute on the platform, exposing it to every
 * student everywhere with zero admin intent behind that exposure. Confirmed live: "Java Bootcamp"
 * (2 modules, 0 lessons, 0 prior assignments, published by an admin on 2026-09-19) was silently
 * assigned to all 3 institutes the moment an unrelated backend deploy ran two days later. The
 * ORIGINAL, legitimate one-time run of this exact backfill (2026-07-25/26, before institute-scoped
 * visibility gating shipped) only ever touched "Java" -- confirmed via the audit trail before this
 * fix, and left untouched by it.
 *
 * Fix: the institute-assignment step now runs only if it has NEVER run before on this database
 * (no CourseInstituteAssignment row with assignedByUserId "system" exists yet) -- a genuine
 * one-time gate, not just an idempotent-but-still-firing one. The DRAFT->PUBLISHED status
 * normalization above is unrelated to this bug (a course an admin re-drafts through the UI is
 * already excluded by the `status: "DRAFT"` filter) and is left exactly as before.
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

  const alreadyRan = await prisma.courseInstituteAssignment.findFirst({ where: { assignedByUserId: "system" }, select: { id: true } });
  if (alreadyRan) {
    console.log("[backfillCourseVisibility] Institute-assignment backfill already ran previously — skipping (this is a one-time migration, not a per-deploy sync).");
    return { publishedCount, assignmentsCreated: 0, publishedTotal: null, instituteTotal: null, skipped: true };
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
  const { publishedCount, assignmentsCreated, publishedTotal, instituteTotal, skipped } = await backfillCourseVisibility();
  console.log(
    skipped
      ? `[backfillCourseVisibility] Done. Published ${publishedCount} course(s) this run. Institute-assignment backfill already completed previously.`
      : `[backfillCourseVisibility] Done. Published ${publishedCount} course(s) this run. ` +
        `${publishedTotal} course(s) are PUBLISHED total, ${instituteTotal} institute(s) exist, ` +
        `created ${assignmentsCreated} institute-assignment row(s) this run.`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillCourseVisibility] failed:", err);
  process.exit(1);
});
