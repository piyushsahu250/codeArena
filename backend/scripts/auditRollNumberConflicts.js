// READ-ONLY conflict scan for Roll Number integrity — never modifies, updates, or deletes any row.
// Run manually (e.g. via Render's Shell tab: `node scripts/auditRollNumberConflicts.js`), NOT
// wired into the automatic boot chain.
//
// This is deliberately separate from backfillGarbledRollNumbers.js (which DOES write -- it
// auto-repairs invalid/missing Roll Numbers and already runs on every boot). That script's own
// conflict-detection logic is reused here read-only, via the exact same actual business rule
// established elsewhere on this platform: Roll Number is unique only WITHIN one Academic Group
// (Institute + Batch + Department + Section, i.e. User.academicGroupId), never platform-wide --
// see schema.prisma's own comment on User's rollNumber index. This script exists purely to
// produce a report an admin can review BEFORE any auto-fix runs, with zero side effects.
//
// Checks:
//   1. Same-group (academicGroupId, rollNumber) duplicates -- what a DB-level
//      @@unique([academicGroupId, rollNumber]) constraint would reject.
//   2. NULL/missing rollNumber on a student who has an academicGroupId (should have been
//      auto-filled at creation).
//   3. Syntactically invalid values: not exactly 3 digits, or containing "DUP" (the one
//      corruption signature this platform has actually seen in production -- see
//      studentIdentifiers.js's isValidRollNumber()).
//   4. Any value that looks like the literal strings "NULL"/"NaN"/"undefined" (defensive --
//      isValidRollNumber() would already reject these as non-3-digit, but called out explicitly
//      since the spec asks for them by name).
const prisma = require("../src/prisma");
const { isValidRollNumber } = require("../src/utils/studentIdentifiers");

async function auditRollNumberConflicts() {
  const students = await prisma.user.findMany({
    where: { role: "STUDENT" },
    select: {
      id: true, name: true, rollNumber: true, registrationNumber: true, academicGroupId: true,
      instituteId: true, batchYear: true, department: true, section: true, createdAt: true,
      email: true, mobile: true, isActive: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const duplicates = []; // same (academicGroupId, rollNumber)
  const missing = []; // has academicGroupId but no rollNumber
  const invalid = []; // has a rollNumber but it fails isValidRollNumber()
  const suspiciousLiterals = []; // literal "NULL"/"NaN"/"undefined" strings specifically

  const byGroup = new Map();
  for (const s of students) {
    if (s.academicGroupId) {
      if (!byGroup.has(s.academicGroupId)) byGroup.set(s.academicGroupId, []);
      byGroup.get(s.academicGroupId).push(s);
    }

    const hasValue = s.rollNumber != null && String(s.rollNumber).trim() !== "";
    if (!hasValue) {
      if (s.academicGroupId) missing.push(s);
      continue;
    }
    if (/^(null|nan|undefined)$/i.test(String(s.rollNumber).trim())) suspiciousLiterals.push(s);
    if (!isValidRollNumber(s.rollNumber)) invalid.push(s);
  }

  for (const [groupId, groupStudents] of byGroup) {
    const seen = new Map();
    for (const s of groupStudents) {
      if (!s.rollNumber || !isValidRollNumber(s.rollNumber)) continue; // already reported above
      const existing = seen.get(s.rollNumber);
      if (existing) duplicates.push({ groupId, rollNumber: s.rollNumber, students: [existing, s] });
      else seen.set(s.rollNumber, s);
    }
  }

  return { scanned: students.length, duplicates, missing, invalid, suspiciousLiterals };
}

async function main() {
  const { scanned, duplicates, missing, invalid, suspiciousLiterals } = await auditRollNumberConflicts();
  console.log(`[auditRollNumberConflicts] Scanned ${scanned} student row(s).`);
  console.log(`  Same-group duplicate roll numbers: ${duplicates.length}`);
  console.log(`  Missing roll number (has a group, no value): ${missing.length}`);
  console.log(`  Invalid roll number (not exactly 3 digits, or contains "DUP"): ${invalid.length}`);
  console.log(`  Literal "NULL"/"NaN"/"undefined" strings: ${suspiciousLiterals.length}`);
  console.log("");

  if (duplicates.length === 0 && missing.length === 0 && invalid.length === 0 && suspiciousLiterals.length === 0) {
    console.log("[auditRollNumberConflicts] 0 conflicts of any kind found. Safe to add @@unique([academicGroupId, rollNumber]) to User in a follow-up migration.");
    await prisma.$disconnect();
    process.exit(0);
  }

  if (duplicates.length > 0) {
    console.warn("=== DUPLICATE ROLL NUMBERS (same Academic Group) ===");
    for (const d of duplicates) {
      console.warn(`Group ${d.groupId} | Roll Number "${d.rollNumber}":`);
      for (const s of d.students) console.warn(`  - ${s.name} (${s.id}) | PRN ${s.registrationNumber || "none"} | created ${s.createdAt.toISOString()}`);
    }
    console.warn("");
  }
  if (missing.length > 0) {
    console.warn("=== MISSING ROLL NUMBER (has a group, no value) ===");
    for (const s of missing) console.warn(`  - ${s.name} (${s.id}) | PRN ${s.registrationNumber || "none"} | group ${s.academicGroupId}`);
    console.warn("");
  }
  if (invalid.length > 0) {
    console.warn("=== INVALID ROLL NUMBER (not 3 digits, or contains DUP) ===");
    for (const s of invalid) console.warn(`  - ${s.name} (${s.id}) | rollNumber="${s.rollNumber}" | PRN ${s.registrationNumber || "none"}`);
    console.warn("");
  }
  if (suspiciousLiterals.length > 0) {
    console.warn('=== LITERAL "NULL"/"NaN"/"undefined" STRINGS ===');
    for (const s of suspiciousLiterals) console.warn(`  - ${s.name} (${s.id}) | rollNumber="${s.rollNumber}"`);
    console.warn("");
  }

  console.warn("Remediation strategy (this script never writes -- nothing above was modified):");
  console.warn("  1. Missing/invalid/literal-string values: run `node scripts/backfillGarbledRollNumbers.js`");
  console.warn("     (already deployed, runs safe auto-repair for exactly these cases -- see its own");
  console.warn("     header comment) or re-run it manually now instead of waiting for the next deploy.");
  console.warn("  2. Genuine same-group duplicates: backfillGarbledRollNumbers.js deliberately does NOT");
  console.warn("     auto-resolve these (a valid-looking value might be a student's real, intentionally");
  console.warn("     assigned number) -- an admin must manually reassign one of the conflicting students'");
  console.warn("     Roll Number via the existing admin edit UI (PATCH /users/:id), which already rejects");
  console.warn("     a same-group clash with a clear error.");
  console.warn("  3. Re-run this script after each fix until it reports 0 of every category.");
  console.warn("  4. Only then apply: `@@unique([academicGroupId, rollNumber])` to the User model in");
  console.warn("     schema.prisma, then deploy per the platform's normal migration path.");

  await prisma.$disconnect();
  process.exit(1);
}

// Exported so routes/users.js's GET /roll-number-conflicts (the admin-facing dashboard — spec:
// "provide Admin/Super Admin with a clear conflict-resolution interface") reuses this exact same
// duplicate-detection logic instead of a second, separately-written definition of "conflict."
// Only invoked as a CLI script (below) when required directly, never when required as a module.
module.exports = { auditRollNumberConflicts };

if (require.main === module) {
  main().catch((err) => {
    console.error("[auditRollNumberConflicts] failed:", err);
    process.exit(2);
  });
}
