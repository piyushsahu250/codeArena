/**
 * Creates a Postgres partial unique index that makes "at most one User row can ever have
 * role = SUPER_ADMIN" a database-level guarantee — not an application check that a bug, a
 * direct DB write, or a future code path could bypass. This is the actual enforcement
 * mechanism behind the "there must always be only ONE active Super Admin" requirement; the
 * application-level whitelist in users.js/admin.js (which roles a create/update endpoint will
 * ever accept) is defense-in-depth on top of this, not a substitute for it.
 *
 * A unique index on a single column, scoped by a WHERE predicate that itself only matches rows
 * with that exact value, is the standard Postgres idiom for "at most one row where X" — every
 * row the index actually applies to necessarily has the same `role` value, so uniqueness among
 * them means at most one can exist. `IF NOT EXISTS` makes this safe to run on every boot
 * (see migrateAndSeed.sh) without erroring on a redeploy where it already exists.
 */
const prisma = require("../src/prisma");

async function enforceSingleSuperAdmin() {
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "user_single_super_admin_idx" ON "User" (role) WHERE role = 'SUPER_ADMIN'`
  );
}

async function main() {
  await enforceSingleSuperAdmin();
  console.log("[enforceSingleSuperAdmin] Done — at most one User row can ever have role=SUPER_ADMIN, enforced at the database level.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[enforceSingleSuperAdmin] failed:", err);
  process.exit(1);
});
