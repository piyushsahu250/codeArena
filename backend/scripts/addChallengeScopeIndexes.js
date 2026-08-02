/**
 * Idempotent boot-time partial-unique-index setup for DailyChallenge/WeeklyChallenge scoping.
 *
 * Postgres treats NULL as distinct within a composite unique index/constraint, so the plain
 * `@@unique([date, instituteId, academicGroupId])` in schema.prisma (enforced automatically by
 * `prisma db push`) stops two rows for the same fully-specified academic group, but does NOT stop
 * two different "Global" rows (instituteId=NULL, academicGroupId=NULL) or two different
 * institute-wide rows (academicGroupId=NULL) for the same date — Postgres allows unlimited rows
 * where all unique-index columns are NULL. Partial unique indexes close that gap, but partial
 * indexes aren't expressible in Prisma's schema syntax, and this project only ever runs
 * `prisma db push` (never `prisma migrate`, no migrations folder) — so, same pattern as
 * addSearchIndexes.js, this is a plain idempotent script wired into the Dockerfile boot chain
 * rather than something declared in schema.prisma.
 */
const prisma = require("../src/prisma");

const INDEXES = [
  { name: "daily_challenge_global_unique", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "daily_challenge_global_unique" ON "DailyChallenge" (date) WHERE "instituteId" IS NULL AND "academicGroupId" IS NULL;` },
  { name: "daily_challenge_institute_unique", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "daily_challenge_institute_unique" ON "DailyChallenge" (date, "instituteId") WHERE "academicGroupId" IS NULL;` },
  { name: "weekly_challenge_global_unique", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "weekly_challenge_global_unique" ON "WeeklyChallenge" ("weekStart") WHERE "instituteId" IS NULL AND "academicGroupId" IS NULL;` },
  { name: "weekly_challenge_institute_unique", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "weekly_challenge_institute_unique" ON "WeeklyChallenge" ("weekStart", "instituteId") WHERE "academicGroupId" IS NULL;` },
];

async function addChallengeScopeIndexes() {
  let created = 0;
  for (const { name, sql } of INDEXES) {
    try {
      await prisma.$executeRawUnsafe(sql);
      created++;
    } catch (err) {
      console.warn(`[addChallengeScopeIndexes] Could not create index "${name}":`, err.message);
    }
  }
  return { created, total: INDEXES.length };
}

async function main() {
  const { created, total } = await addChallengeScopeIndexes();
  console.log(`[addChallengeScopeIndexes] Done. ${created}/${total} partial unique index(es) ready.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[addChallengeScopeIndexes] failed:", err);
  process.exit(1);
});
