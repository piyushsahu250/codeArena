// One-time (idempotent), repeated-on-every-boot repair for corrupted student Roll Numbers.
//
// A valid Roll Number is exactly 3 numeric digits (see isValidRollNumber() in
// utils/studentIdentifiers.js) — this script audits every student against that rule and
// classifies each row into exactly one bucket:
//
//   - INVALID (auto-fixed): rollNumber is set but fails isValidRollNumber() — non-numeric,
//     wrong length, or contains "DUP". This includes the original bug this script was written
//     for (see git history: the old collision-resolution loop could slide into a PRN's
//     alphabetic institute/batch/department code and hand out a fragment like "MXF" as a Roll
//     Number). Regenerated via resolveRollNumberAvoidingCollisions, scoped to the student's own
//     Academic Group so the new value can't collide with a group-mate.
//   - MISSING (auto-filled): rollNumber is null/empty but the student has both a
//     registrationNumber and an academicGroupId — there's no existing value to lose here, so
//     it's safe to auto-init the same way account creation would have.
//   - CONFLICT (reported, never auto-overwritten): rollNumber is already a syntactically valid
//     3-digit value, but collides with another student's equally-valid value in the same
//     Academic Group. A valid-looking value cannot be reliably distinguished from one a student
//     deliberately typed in themselves — silently overwriting it would violate "do not blindly
//     overwrite manually edited roll numbers." These are logged for an admin to resolve by hand
//     (e.g. via PATCH /users/:id, which will reject a same-group clash with a clear error).
//
// Every already-valid, non-colliding Roll Number is left completely untouched.
const prisma = require("../src/prisma");
const { resolveRollNumberAvoidingCollisions, isValidRollNumber } = require("../src/utils/studentIdentifiers");

async function backfillGarbledRollNumbers() {
  const students = await prisma.user.findMany({
    where: { role: "STUDENT", academicGroupId: { not: null } },
    select: { id: true, name: true, rollNumber: true, registrationNumber: true, academicGroupId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const byGroup = new Map();
  for (const s of students) {
    if (!byGroup.has(s.academicGroupId)) byGroup.set(s.academicGroupId, []);
    byGroup.get(s.academicGroupId).push(s);
  }

  let fixed = 0;
  let filled = 0;
  const conflicts = [];
  const unfixable = [];

  for (const [groupId, groupStudents] of byGroup) {
    // Seed `taken` with every already-valid Roll Number in the group so a regenerated/filled
    // value can never collide with a student who isn't part of this repair; `current` tracks
    // each student's in-memory current value (updated as this loop writes fixes) so the
    // collision pass below never needs to re-query what was just written.
    const taken = new Set(
      groupStudents.filter((s) => s.rollNumber && isValidRollNumber(s.rollNumber)).map((s) => s.rollNumber)
    );
    const current = new Map(groupStudents.map((s) => [s.id, s.rollNumber]));

    for (const s of groupStudents) {
      const hasValue = s.rollNumber != null && String(s.rollNumber).trim() !== "";
      const valid = hasValue && isValidRollNumber(s.rollNumber);

      if (hasValue && valid) continue; // checked for group-collisions below, not here

      if (!s.registrationNumber) {
        // Nothing to derive a replacement from — can't safely auto-fix, just report it.
        if (hasValue) unfixable.push({ id: s.id, name: s.name, rollNumber: s.rollNumber, reason: "invalid value, no Registration Number to regenerate from" });
        continue;
      }

      const next = resolveRollNumberAvoidingCollisions(s.registrationNumber, taken);
      if (!next || next === s.rollNumber) continue;
      taken.add(next);
      current.set(s.id, next);
      await prisma.user.update({ where: { id: s.id }, data: { rollNumber: next } });
      if (hasValue) fixed++;
      else filled++;
    }

    // Collision pass: every remaining rollNumber in this group is now either freshly
    // regenerated/filled (guaranteed unique within `taken`) or was already valid — check the
    // valid-but-untouched ones against each other for a genuine same-group duplicate.
    const seen = new Map();
    for (const s of groupStudents) {
      const rollNumber = current.get(s.id);
      if (!rollNumber || !isValidRollNumber(rollNumber)) continue;
      const dupOf = seen.get(rollNumber);
      if (dupOf) {
        conflicts.push({ groupId, rollNumber, students: [dupOf, { id: s.id, name: s.name }] });
      } else {
        seen.set(rollNumber, { id: s.id, name: s.name });
      }
    }
  }

  return { scanned: students.length, fixed, filled, conflicts, unfixable };
}

async function main() {
  const { scanned, fixed, filled, conflicts, unfixable } = await backfillGarbledRollNumbers();
  console.log(`[backfillGarbledRollNumbers] Scanned ${scanned} student(s): ${fixed} invalid value(s) repaired, ${filled} missing value(s) filled in.`);
  if (conflicts.length) {
    console.warn(`[backfillGarbledRollNumbers] ${conflicts.length} genuine same-group conflict(s) found — NOT auto-resolved, needs manual review:`);
    for (const c of conflicts) console.warn(`  - Roll Number "${c.rollNumber}" in group ${c.groupId}: ${c.students.map((s) => `${s.name} (${s.id})`).join(" vs ")}`);
  }
  if (unfixable.length) {
    console.warn(`[backfillGarbledRollNumbers] ${unfixable.length} invalid value(s) could not be auto-repaired (no Registration Number on file):`);
    for (const u of unfixable) console.warn(`  - ${u.name} (${u.id}): "${u.rollNumber}" — ${u.reason}`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillGarbledRollNumbers] failed:", err);
  process.exit(1);
});
