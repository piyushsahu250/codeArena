/**
 * One-time (idempotent) backfill for EmailLog.instituteId — the new column that closes a real
 * visibility gap: rows with a studentId could previously only be institute-scoped by joining
 * through the student relation, and rows with no studentId (e.g. POST /admin/email-logs/test)
 * had no institute attribution at all. New rows populate instituteId directly going forward
 * (see mailer.js's sendMailLogged) — this backfills every existing row that still has it null.
 *
 * For every EmailLog still missing instituteId, look up the linked student's own instituteId and
 * copy it over. A row with no studentId (a pre-existing test email, or a student account since
 * deleted) is left alone — there's nothing to derive an institute from, exactly like every other
 * genuinely-institute-less row on this platform. Safe to re-run: only ever touches rows where
 * instituteId is still null and the linked student has an institute, so an already-backfilled row
 * is never revisited.
 */
const prisma = require("../src/prisma");

async function backfillEmailLogInstituteId() {
  const untouched = await prisma.emailLog.findMany({
    where: { instituteId: null },
    select: { id: true, student: { select: { instituteId: true } } },
  });

  let backfilledCount = 0;
  for (const log of untouched) {
    if (log.student?.instituteId) {
      await prisma.emailLog.update({ where: { id: log.id }, data: { instituteId: log.student.instituteId } });
      backfilledCount++;
    }
  }

  return { backfilledCount, scannedCount: untouched.length };
}

async function main() {
  const { backfilledCount, scannedCount } = await backfillEmailLogInstituteId();
  console.log(
    `[backfillEmailLogInstituteId] Done. Backfilled ${backfilledCount} email log(s) from their student's institute ` +
    `(scanned ${scannedCount} row(s) with no instituteId; the rest have no linked student to derive one from).`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillEmailLogInstituteId] failed:", err);
  process.exit(1);
});
