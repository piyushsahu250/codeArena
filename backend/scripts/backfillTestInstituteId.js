/**
 * One-time (idempotent) backfill for Test.instituteId — the new column that closes a real
 * data-isolation bug: a staff-created Test with zero group/class assignments used to be visible
 * to every student on the platform, not just their own institute, because the "empty assignment
 * = open to everyone" convention in testEligibility.js had no institute boundary. Test.instituteId
 * now gates that convention (see testEligibility.js's comment on Test.instituteId).
 *
 * For every Test still missing instituteId, look up its creator's own instituteId and copy it
 * over. A test created by the true platform-level admin (creator has no instituteId) is left
 * alone — it's correctly platform-wide, exactly like every other "instituteId: null" row on this
 * platform (QuestionFolder, etc.). Safe to re-run: only ever touches rows where instituteId is
 * still null and the creator has an institute, so an already-backfilled or genuinely
 * platform-wide test is never revisited.
 */
const prisma = require("../src/prisma");

async function backfillTestInstituteId() {
  const untouched = await prisma.test.findMany({
    where: { instituteId: null },
    select: { id: true, title: true, createdBy: { select: { instituteId: true } } },
  });

  let backfilledCount = 0;
  for (const t of untouched) {
    if (t.createdBy?.instituteId) {
      await prisma.test.update({ where: { id: t.id }, data: { instituteId: t.createdBy.instituteId } });
      backfilledCount++;
    }
  }

  return { backfilledCount, scannedCount: untouched.length };
}

async function main() {
  const { backfilledCount, scannedCount } = await backfillTestInstituteId();
  console.log(
    `[backfillTestInstituteId] Done. Backfilled ${backfilledCount} test(s) to their creator's institute ` +
    `(scanned ${scannedCount} test(s) with no instituteId; the rest were created by a platform-level admin and stay platform-wide).`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillTestInstituteId] failed:", err);
  process.exit(1);
});
