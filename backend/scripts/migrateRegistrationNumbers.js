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
 * one-time data migration in five ordered, independently-idempotent passes. Passes 1, 4, and 5 are
 * STUDENT-only (rollNumber semantics only apply to students); passes 2 (blank-normalize) and 3
 * (dedupe) scan every role, since @@unique([registrationNumber]) is a table-wide constraint
 * Postgres enforces regardless of role — a role-scoped pass here can corrupt non-student rows (see
 * pass 2's repair step, added after exactly that happened for one boot).
 *
 * Every pass runs in its own try/catch inside main(), and every per-row write inside a pass is
 * also individually try/catch'd: a single row failing to update must never stop the rest of that
 * pass, or the rest of the script, from making progress in the same boot.
 *
 *   1. Copy + reinit — for any student with a blank `registrationNumber` but a real `rollNumber`
 *               (i.e. a row that has never been through this migration before — see idempotency
 *               note below), strip a trailing `-DUPn` suffix (a scar `dedupeRollNumbers.js` may
 *               have already left on `rollNumber` in a prior deploy) and copy the cleaned value
 *               into `registrationNumber`. In the SAME update, `rollNumber` is reset to the last 3
 *               characters of that cleaned value — every pre-existing student's `rollNumber` holds
 *               the legacy PRN, not a real classroom number, so leaving it untouched here (an
 *               earlier version of this pass did) permanently stranded it at the old long value,
 *               since the separate auto-init pass below only ever fires when `rollNumber` is
 *               already blank, which it never is for these rows. This is safe specifically because
 *               `registrationNumber` being blank is proof this row has never been migrated before —
 *               once it's set (here or at account-creation time going forward), this pass's WHERE
 *               clause goes permanently false for that student, so a later self-service edit to
 *               `rollNumber` is never touched or reverted by a subsequent deploy's re-run.
 *   2. Blank-normalize — any lingering `registrationNumber === ""`, on any role, becomes real
 *               `NULL` (required before a unique index can be added — Postgres unique indexes
 *               treat two NULLs as non-colliding, but two empty strings collide like any other
 *               value). Also repairs any row whose `registrationNumber` starts with `"-DUP"` — a
 *               one-boot corruption possible before this pass covered every role (see dedupePass).
 *   3. Dedupe — group all non-null `registrationNumber`s across every role and institute (PRN is
 *               system-wide unique, not per-institute, and the underlying constraint isn't scoped
 *               to STUDENT rows either). Within any collision group, the earliest-created account
 *               keeps its value untouched; every later duplicate gets a `-DUP2`, `-DUP3`, ...
 *               suffix appended. Every case is logged (email + institute) — a genuine data-integrity signal worth an
 *               admin's attention, not something to silently sweep away.
 *   4. Roll Number auto-init — defensive fallback only, for any student with a still-blank
 *               `rollNumber` but a real `registrationNumber` that pass 1 didn't already handle
 *               (e.g. a row whose `registrationNumber` was populated by some other path with
 *               `rollNumber` left blank). Sets `rollNumber` to the PRN's last 3 characters. Only
 *               ever fires while `rollNumber` is empty; stops firing permanently once it's set, by
 *               this script or by the student.
 *   5. Roll-length fix — targets rows structurally unreachable by passes 1 and 4: any student whose
 *               `registrationNumber` was ALREADY non-null before this migration ever ran (e.g.
 *               populated by a very old code path, or by a bulk-upload row predating the platform-
 *               wide 3-character Roll Number cap), so pass 1's WHERE clause (`registrationNumber`
 *               blank) never fires for it, yet `rollNumber` is still left holding an oversized
 *               legacy value. Any row where `rollNumber` is already <=3 characters is left
 *               completely untouched — that's proof of either a prior auto-init/auto-reset or a
 *               legitimate short value a student deliberately chose, and this pass must never
 *               revert either. Once fixed here, `rollNumber` is <=3 characters forever, so this
 *               pass's effective condition (`length > 3`) goes permanently false for that row —
 *               same self-terminating, idempotent contract as every other pass in this file.
 *
 * Idempotent by construction, same contract as `dedupeRollNumbers.js`: never exits non-zero, never
 * deletes a student, never overwrites a value outside the one-time transition each pass targets.
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
    const reinitRoll = initRollNumberFromRegistration(cleaned);
    await prisma.user.update({
      where: { id: row.id },
      data: { registrationNumber: cleaned, ...(reinitRoll ? { rollNumber: reinitRoll } : {}) },
    });
    copied++;
  }
  console.log(`[migrateRegistrationNumbers] Copy pass: ${copied} student(s) got registrationNumber populated from rollNumber.`);
  return { copied };
}

async function blankNormalizePass() {
  // Platform-wide, not STUDENT-only: dedupePass below now scans every role (the
  // @@unique([registrationNumber]) constraint isn't role-scoped), so an empty-string value on a
  // Staff/Admin/Clerk row must be blanked to NULL here too — otherwise dedupePass treats several
  // blank non-student rows as "duplicates" of each other and corrupts them with a literal "-DUPn"
  // value. (That exact bug shipped for one boot before this fix; see the repair step below.)
  const blanked = await prisma.user.updateMany({
    where: { registrationNumber: "" },
    data: { registrationNumber: null },
  });
  // One-time repair: before this function covered every role, a boot's dedupePass grouped several
  // Staff/Clerk rows that all had registrationNumber: "" as "duplicates" of each other and
  // overwrote them with a bare "-DUP2", "-DUP3", ... value — garbage that can never be a real PRN
  // (REGISTRATION_NUMBER_RE requires 9-12 alphanumeric characters, no hyphens). Detect and revert
  // that specific corruption back to NULL. Safe and permanent: once reverted, a row's
  // registrationNumber no longer starts with "-DUP", so this condition never fires for it again.
  const repaired = await prisma.user.updateMany({
    where: { registrationNumber: { startsWith: "-DUP" } },
    data: { registrationNumber: null },
  });
  if (blanked.count) console.log(`[migrateRegistrationNumbers] Blank-normalize pass: ${blanked.count} empty-string registrationNumber(s) set to NULL.`);
  if (repaired.count) console.log(`[migrateRegistrationNumbers] Repair pass: ${repaired.count} spurious "-DUPn"-only registrationNumber(s) (a one-boot corruption from an earlier version of dedupePass) reset to NULL.`);
  return { blanked: blanked.count, repaired: repaired.count };
}

async function dedupePass() {
  // @@unique([registrationNumber]) is a table-wide constraint on User, not scoped to role: STUDENT
  // — Postgres will refuse to create it if ANY two rows share a value, regardless of role. This
  // pass must therefore scan every role, not just students, even though registrationNumber is
  // documented as student-only: a stray non-null value on a Staff/Admin/Clerk row (e.g. from a
  // legacy import) would otherwise never be seen here yet would still block the index.
  const users = await prisma.user.findMany({
    where: { registrationNumber: { not: null } },
    select: { id: true, registrationNumber: true, email: true, instituteId: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map(); // registrationNumber -> rows, in createdAt-ascending order
  for (const u of users) {
    if (!groups.has(u.registrationNumber)) groups.set(u.registrationNumber, []);
    groups.get(u.registrationNumber).push(u);
  }

  let fixedCount = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const newRegNumber = `${row.registrationNumber}-DUP${i + 1}`;
      // Per-row try/catch: one row's write failing (e.g. a stray collision) must not abort the
      // remaining rows in this pass — every other row still gets its chance to be fixed this boot.
      try {
        await prisma.user.update({ where: { id: row.id }, data: { registrationNumber: newRegNumber } });
        console.log(
          `[migrateRegistrationNumbers] DUPLICATE PRN: ${row.email} (${row.role}, institute ${row.instituteId}): "${row.registrationNumber}" -> "${newRegNumber}" (duplicate of an earlier account — review recommended).`
        );
        fixedCount++;
      } catch (err) {
        console.error(`[migrateRegistrationNumbers] Dedupe pass: failed to rename ${row.email}'s registrationNumber (continuing with remaining rows):`, err.message);
      }
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

async function rollLengthFixPass() {
  const rows = await prisma.user.findMany({
    where: { role: "STUDENT", registrationNumber: { not: null }, rollNumber: { not: null } },
    select: { id: true, registrationNumber: true, rollNumber: true, email: true },
  });
  let fixed = 0;
  for (const row of rows) {
    if (String(row.rollNumber).length <= 3) continue; // already valid — auto-set or a legitimate student override, never touch
    const reinit = initRollNumberFromRegistration(row.registrationNumber);
    if (!reinit) continue;
    // Per-row try/catch, same reasoning as dedupePass above: this is the pass that cleans up
    // rollNumber values still scarred with a "-DUPn" suffix from the deleted dedupeRollNumbers.js
    // script (e.g. "038-DUP2" -> "038"), and one row hitting a leftover collision must not stop
    // every other scarred row in the same boot from getting cleaned.
    try {
      await prisma.user.update({ where: { id: row.id }, data: { rollNumber: reinit } });
      fixed++;
    } catch (err) {
      console.error(`[migrateRegistrationNumbers] Roll-length-fix pass: failed to reset ${row.email}'s rollNumber (continuing with remaining rows):`, err.message);
    }
  }
  console.log(`[migrateRegistrationNumbers] Roll-length-fix pass: ${fixed} student(s) had an oversized (>3 char) legacy rollNumber reset to their registrationNumber's last 3 characters.`);
  return { fixed };
}

async function main() {
  // Each pass runs in its own try/catch: a failure partway through one pass must not prevent the
  // later passes from running this boot — the same "one early failure blocks all forward progress"
  // pattern that stalled this platform's entire deploy pipeline for most of a day (see git history)
  // must not also apply inside this script's own passes.
  for (const pass of [copyPass, blankNormalizePass, dedupePass, autoInitRollNumberPass, rollLengthFixPass]) {
    try {
      await pass();
    } catch (err) {
      console.error(`[migrateRegistrationNumbers] ${pass.name} failed (continuing to next pass):`, err);
    }
  }
  await prisma.$disconnect();
}

// Deliberately never exits non-zero — this runs before `db push` in the Dockerfile's `&&` chain,
// and a bug in this best-effort migration must not itself block the deploy the way the constraint
// it exists to unblock already has.
main().catch((err) => {
  console.error("[migrateRegistrationNumbers] failed (continuing anyway):", err);
  process.exit(0);
});
