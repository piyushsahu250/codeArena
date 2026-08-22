/**
 * Read-only audit: scans every existing User row for email data-quality issues under the new,
 * stricter validation rules (see src/utils/emailValidation.js) -- missing email, invalid format,
 * and duplicate email (case-insensitive) that predates the DB's own unique constraint or slipped
 * past it via a race. Never writes anything, never deactivates or deletes an account -- this only
 * produces a report so a human can decide how to correct each row (see docs/ADMIN or the
 * Email Issues section this powers).
 *
 * `emailVerified` is deliberately NOT treated as a "problem" here: it defaults false for every
 * account that existed before this field was added, which is expected, not a data-quality issue --
 * only a total count is reported for context, not a per-row finding.
 */
const prisma = require("../src/prisma");
const { isValidEmail } = require("../src/utils/emailValidation");

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, registrationNumber: true, instituteId: true, emailVerified: true, institute: { select: { name: true } } },
  });

  const missing = [];
  const invalidFormat = [];
  const seenLower = new Map(); // lowercased email -> [user, ...]

  for (const u of users) {
    if (!u.email || !u.email.trim()) {
      missing.push(u);
      continue;
    }
    if (!isValidEmail(u.email)) {
      invalidFormat.push(u);
    }
    const key = u.email.trim().toLowerCase();
    if (!seenLower.has(key)) seenLower.set(key, []);
    seenLower.get(key).push(u);
  }

  const duplicates = [...seenLower.values()].filter((group) => group.length > 1);
  const unverifiedCount = users.filter((u) => !u.emailVerified).length;

  console.log(`\n=== Email Issues Audit (${users.length} total users) ===\n`);

  console.log(`Missing email: ${missing.length}`);
  for (const u of missing) console.log(`  - [${u.role}] ${u.name} (${u.id}) PRN=${u.registrationNumber || "-"} institute=${u.institute?.name || "-"}`);

  console.log(`\nInvalid format: ${invalidFormat.length}`);
  for (const u of invalidFormat) console.log(`  - [${u.role}] ${u.name} (${u.id}) email="${u.email}" institute=${u.institute?.name || "-"}`);

  console.log(`\nDuplicate email (case-insensitive collision, ${duplicates.length} group(s)):`);
  for (const group of duplicates) {
    console.log(`  - "${group[0].email.toLowerCase()}" used by ${group.length} accounts:`);
    for (const u of group) console.log(`      [${u.role}] ${u.name} (${u.id}) email="${u.email}" institute=${u.institute?.name || "-"}`);
  }

  console.log(`\nUnverified email (informational -- expected for every pre-existing account): ${unverifiedCount} of ${users.length}`);
  console.log("\n=== End of report -- no data was modified ===\n");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
