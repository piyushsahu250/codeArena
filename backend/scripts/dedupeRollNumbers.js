/**
 * Runs BEFORE `prisma db push` in the Dockerfile CMD chain (unlike every other one-time script
 * here, which runs after) — this exists specifically to unblock the new
 * `@@unique([instituteId, rollNumber])` constraint on User. Postgres refuses to create a unique
 * index while existing rows violate it, which would otherwise fail `db push` and — because of the
 * `&&` chain in the Dockerfile CMD — leave `npm start` never running, silently stranding the
 * container on its previous successful deploy on every future push until this is fixed.
 *
 * Roll numbers were never enforced unique before this: bulk-import had a platform-wide (not even
 * institute-scoped) in-memory check, and the single-create/edit routes had no check at all — so
 * duplicates at the same institute are plausible in production data that predates that fix.
 *
 * Safe by construction: never deletes a student or changes anything except the colliding
 * `rollNumber` string. Within each (instituteId, rollNumber) collision group, the earliest-created
 * account keeps its original roll number; every later duplicate gets a `-DUP2`, `-DUP3`, ...
 * suffix appended, so the roll number changes but stays recognizably close to the original —
 * admins can search and correct it properly from the UI afterward. Idempotent: once every
 * (instituteId, rollNumber) pair is unique, a re-run finds no collision groups and no-ops.
 */
const prisma = require("../src/prisma");

async function dedupeRollNumbers() {
  const students = await prisma.user.findMany({
    where: { instituteId: { not: null }, rollNumber: { not: null } },
    select: { id: true, instituteId: true, rollNumber: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map(); // `${instituteId}::${rollNumber}` -> rows, in createdAt-ascending order
  for (const s of students) {
    const key = `${s.instituteId}::${s.rollNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  let fixedCount = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    // rows[0] (earliest) keeps its roll number untouched; every later duplicate is renamed.
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const newRollNumber = `${row.rollNumber}-DUP${i + 1}`;
      await prisma.user.update({ where: { id: row.id }, data: { rollNumber: newRollNumber } });
      console.log(
        `[dedupeRollNumbers] ${row.email} (institute ${row.instituteId}): "${row.rollNumber}" -> "${newRollNumber}" (duplicate of an earlier account).`
      );
      fixedCount++;
    }
  }

  console.log(`[dedupeRollNumbers] Done — ${fixedCount} duplicate roll number(s) renamed across ${groups.size} distinct (institute, rollNumber) key(s) checked.`);
  return { fixedCount };
}

async function main() {
  await dedupeRollNumbers();
  await prisma.$disconnect();
}

// Deliberately never exits non-zero — this runs before `db push` in the Dockerfile's `&&` chain,
// and a bug in this best-effort cleanup script must not itself block the deploy the way the
// constraint it exists to unblock already has.
main().catch((err) => {
  console.error("[dedupeRollNumbers] failed (continuing anyway):", err);
  process.exit(0);
});
