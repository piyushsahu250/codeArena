/**
 * Runs BEFORE `prisma db push` in the Dockerfile CMD chain, immediately after
 * `dedupeRollNumbers.js` — unblocks the new `@@unique([registrationNumber])` constraint on User,
 * which `dedupeRollNumbers.js` doesn't touch. Postgres refuses to create a unique index while
 * existing rows violate it (a repeat of the exact failure mode `dedupeRollNumbers.js`'s own
 * doc-comment describes), which would otherwise fail `db push` and strand the container on its
 * previous deploy.
 *
 * Background: `rollNumber` was historically used to store the student's Registration Number
 * (PRN) — a permanent, system-wide-unique academic ID — while the real classroom Roll Number
 * (non-unique, used for attendance/seating order) had nowhere to live. This script performs the
 * one-time data migration in four ordered, independently-idempotent passes, STUDENT rows only:
 *
 *   1. Copy   — for any student with a blank `registrationNumber` but a real `rollNumber`, strip
 *               a trailing `-DUPn` suffix (a scar `dedupeRollNumbers.js` may have already left on
 *               `rollNumber` in a prior deploy) and copy the cleaned value into
 *               `registrationNumber`. `rollNumber` itself is NEVER written by this pass — that is
 *               what makes the whole script safe to re-run on every deploy: once a student has a
 *               non-empty `registrationNumber` (from this script or, going forward, directly at
 *               account-creation time), this pass's WHERE clause goes permanently false for them,
 *               regardless of anything they later do to `rollNumber` via their own profile.
 *   2. Blank-normalize — any lingering `registrationNumber === ""` becomes real `NULL` (defensive;
 *               required before a unique index can be added).
 *   3. Dedupe — group all non-null `registrationNumber`s PLATFORM-WIDE (PRN is system-wide unique,
 *               not per-institute). Within any collision group, the earliest-created account keeps
 *               its value untouched; every later duplicate gets a `-DUP2`, `-DUP3`, ... suffix
 *               appended, exactly like `dedupeRollNumbers.js` does for `rollNumber` today. Every
 *               case is logged (email + institute) — a genuine data-integrity signal worth an
 *               admin's attention, not something to silently sweep away.
 *   4. Roll Number auto-init — for any student with a still-blank `rollNumber` but a real
 *               `registrationNumber`, set `rollNumber` to the last 3 characters of the PRN (e.g.
 *               "2028COMP00123" -> "123"). Only ever fires while `rollNumber` is empty; stops
 *               firing permanently the moment it's set, by this script or by the student.
 *
 * Idempotent by construction, same contract as `dedupeRollNumbers.js`: never exits non-zero, never
 * deletes a student, never overwrites a value that's already populated.
 */
const prisma = require("../src/prisma");
const { initRollNumberFromRegistration } = require("../src/utils/studentIdentifiers");

async function copyPass() {
  const rows = await prisma.user.findMany({
    where: { role: "STUDENT", OR: [{ registrationNumber: null }, { registrationNumber: "" }], rollNumber: { not: null } },
    select: { id: true, rollNumber: true },
  });
  let copied = 0;
  for (const row of rows) {
    const cleaned = String(row.rollNumber || "").replace(/-DUP\d+$/, "").trim();
    if (!cleaned) continue;
    await prisma.user.update({ where: { id: row.id }, data: { registrationNumber: cleaned } });
    copied++;
  }
  console.log(`[migrateRegistrationNumbers] Copy pass: ${copied} student(s) got registrationNumber populated from rollNumber.`);
  return { copied };
}

async function blankNormalizePass() {
  const result = await prisma.user.updateMany({
    where: { role: "STUDENT", registrationNumber: "" },
    data: { registrationNumber: null },
  });
  if (result.count) console.log(`[migrateRegistrationNumbers] Blank-normalize pass: ${result.count} empty-string registrationNumber(s) set to NULL.`);
  return result;
}

async function dedupePass() {
  const students = await prisma.user.findMany({
    where: { role: "STUDENT", registrationNumber: { not: null } },
    select: { id: true, registrationNumber: true, email: true, instituteId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map(); // registrationNumber -> rows, in createdAt-ascending order
  for (const s of students) {
    if (!groups.has(s.registrationNumber)) groups.set(s.registrationNumber, []);
    groups.get(s.registrationNumber).push(s);
  }

  let fixedCount = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const newRegNumber = `${row.registrationNumber}-DUP${i + 1}`;
      await prisma.user.update({ where: { id: row.id }, data: { registrationNumber: newRegNumber } });
      console.log(
        `[migrateRegistrationNumbers] DUPLICATE PRN: ${row.email} (institute ${row.instituteId}): "${row.registrationNumber}" -> "${newRegNumber}" (duplicate of an earlier account — review recommended).`
      );
      fixedCount++;
    }
  }
  console.log(`[migrateRegistrationNumbers] Dedupe pass: ${fixedCount} duplicate registration number(s) renamed across ${groups.size} distinct value(s) checked.`);
  return { fixedCount };
}

async function autoInitRollNumberPass() {
  const rows = await prisma.user.findMany({
    where: {
      role: "STUDENT",
      OR: [{ rollNumber: null }, { rollNumber: "" }],
      registrationNumber: { not: null },
    },
    select: { id: true, registrationNumber: true },
  });
  let initialized = 0;
  for (const row of rows) {
    const rollNumber = initRollNumberFromRegistration(row.registrationNumber);
    if (!rollNumber) continue;
    await prisma.user.update({ where: { id: row.id }, data: { rollNumber } });
    initialized++;
  }
  console.log(`[migrateRegistrationNumbers] Auto-init pass: ${initialized} student(s) got rollNumber auto-populated from their registrationNumber's last 3 characters.`);
  return { initialized };
}

async function main() {
  await copyPass();
  await blankNormalizePass();
  await dedupePass();
  await autoInitRollNumberPass();
  await prisma.$disconnect();
}

// Deliberately never exits non-zero — this runs before `db push` in the Dockerfile's `&&` chain,
// and a bug in this best-effort migration must not itself block the deploy the way the constraint
// it exists to unblock already has.
main().catch((err) => {
  console.error("[migrateRegistrationNumbers] failed (continuing anyway):", err);
  process.exit(0);
});
