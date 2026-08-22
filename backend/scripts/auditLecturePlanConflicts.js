// READ-ONLY conflict scan for LecturePlan scheduling — never modifies, updates, or deletes any
// row. Run manually (e.g. via Render's Shell tab: `node scripts/auditLecturePlanConflicts.js`),
// NOT wired into the automatic boot chain (migrateAndSeed.sh) since this is a one-off diagnostic,
// not a required-every-deploy step.
//
// Checks whether adding a DB-level @@unique([assignmentId, scheduleDate, slotLabel]) constraint to
// LecturePlan would be safe: it groups every existing plan by that exact triple and reports any
// group with more than one row. Two different lecture-number plans sharing the same
// assignment+date+slot is a scheduling data-quality issue (a staff double-booked a slot), NOT an
// attendance-record duplication risk on its own — that's already closed by
// AttendanceSession.planId's own @unique constraint (one attendance session per plan, no matter
// how many plans exist for the same slot).
//
// Exit code 0 with "0 conflicts" printed = safe to add the constraint in a follow-up.
// Exit code 0 with N>0 conflicts printed = DO NOT add the constraint yet; resolve what's listed
// below first (see the remediation notes in the printed report).
const prisma = require("../src/prisma");

async function auditLecturePlanConflicts() {
  const plans = await prisma.lecturePlan.findMany({
    select: {
      id: true, assignmentId: true, scheduleDate: true, slotLabel: true,
      lectureNumber: true, subject: true, topic: true, createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map(); // "assignmentId::YYYY-MM-DD::slotLabel" -> plan[]
  for (const p of plans) {
    // scheduleDate's time-of-day is not meaningful (see the model's own comment) -- group by the
    // calendar date only, in UTC, so a plan stored at any time-of-day on the same day collides
    // correctly rather than being split by an incidental timestamp difference.
    const dateKey = p.scheduleDate.toISOString().slice(0, 10);
    const key = `${p.assignmentId}::${dateKey}::${p.slotLabel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const conflicts = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  return { scanned: plans.length, conflicts };
}

async function main() {
  const { scanned, conflicts } = await auditLecturePlanConflicts();
  console.log(`[auditLecturePlanConflicts] Scanned ${scanned} LecturePlan row(s), grouped by (assignmentId, scheduleDate, slotLabel).`);

  if (conflicts.length === 0) {
    console.log(`[auditLecturePlanConflicts] 0 conflicts found. Safe to add @@unique([assignmentId, scheduleDate, slotLabel]) to LecturePlan in a follow-up migration.`);
    await prisma.$disconnect();
    process.exit(0);
  }

  console.warn(`[auditLecturePlanConflicts] ${conflicts.length} conflicting slot(s) found — DO NOT add the unique constraint until these are resolved.`);
  console.warn("");
  for (const [key, rows] of conflicts) {
    const [assignmentId, date, slot] = key.split("::");
    console.warn(`Assignment ${assignmentId} | Date ${date} | Slot "${slot}" -- ${rows.length} plans:`);
    for (const r of rows) {
      console.warn(`  - LecturePlan ${r.id} | Lecture #${r.lectureNumber} | Subject "${r.subject}" / Topic "${r.topic}" | created ${r.createdAt.toISOString()}`);
    }
    console.warn("");
  }

  console.warn("Remediation strategy (do NOT apply automatically -- this script never writes):");
  console.warn("  1. For each conflicting slot, an admin/staff member should review the listed plans and");
  console.warn("     decide which lecture number is the real one for that date/slot.");
  console.warn("  2. Reassign the conflicting plan(s) to a different, actually-free slot/date via the");
  console.warn("     existing Attendance Setup UI (editing scheduleDate/slotLabel), or delete a plan only");
  console.warn("     if it was a genuine duplicate created by mistake AND has no AttendanceSession attached");
  console.warn("     (check LecturePlan.session -- deleting a plan with an existing session would destroy");
  console.warn("     real attendance history, which must never happen).");
  console.warn("  3. Re-run this script after each fix until it reports 0 conflicts.");
  console.warn("  4. Only then apply: `@@unique([assignmentId, scheduleDate, slotLabel])` to the LecturePlan");
  console.warn("     model in schema.prisma, then deploy per the platform's normal migration path.");

  await prisma.$disconnect();
  process.exit(1); // non-zero so this is unambiguous in CI/shell output, but nothing was modified
}

main().catch((err) => {
  console.error("[auditLecturePlanConflicts] failed:", err);
  process.exit(2);
});
