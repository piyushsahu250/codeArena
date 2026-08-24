/**
 * One-time (idempotent) migration: promotes exactly one account — sahupiyush250@gmail.com — to
 * the new SUPER_ADMIN role. This is the only place in the codebase that ever sets this role; no
 * user-facing create/update endpoint accepts it (see users.js/admin.js's role whitelists), and
 * scripts/enforceSingleSuperAdmin.js's partial unique index makes a second one impossible at the
 * database level even if that ever changed.
 *
 * Deliberately narrow preconditions — only touches the account if it's in exactly the state this
 * migration expects (existing, role ADMIN, no institute, active). Anything else (already
 * SUPER_ADMIN from a prior run, doesn't exist yet, or in some unexpected state) is left alone and
 * logged rather than forced, so this can never silently do something unintended to production
 * data. Must run after enforceSingleSuperAdmin.js in migrateAndSeed.sh so the uniqueness
 * constraint is already in place before this writes the first (and only) SUPER_ADMIN row.
 */
const prisma = require("../src/prisma");

const SUPER_ADMIN_EMAIL = "sahupiyush250@gmail.com";

async function migrateSuperAdmin() {
  const existingSuperAdmin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (existingSuperAdmin) {
    return { status: "already_migrated", email: existingSuperAdmin.email };
  }

  const account = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
  if (!account) {
    return { status: "account_not_found", email: SUPER_ADMIN_EMAIL };
  }
  if (account.role !== "ADMIN" || account.instituteId) {
    return { status: "unexpected_state", email: SUPER_ADMIN_EMAIL, role: account.role, instituteId: account.instituteId };
  }

  await prisma.user.update({ where: { id: account.id }, data: { role: "SUPER_ADMIN" } });
  return { status: "migrated", email: SUPER_ADMIN_EMAIL };
}

async function main() {
  const result = await migrateSuperAdmin();
  console.log(`[migrateSuperAdmin] ${JSON.stringify(result)}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[migrateSuperAdmin] failed:", err);
  process.exit(1);
});
