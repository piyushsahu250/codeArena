/**
 * Idempotent boot-time index setup for global/question-bank search.
 *
 * Every "search" in this codebase (GET /search, questions.js's buildWhere) uses Prisma
 * `contains` + `mode: "insensitive"`, which Postgres executes as `ILIKE '%term%'` — a
 * leading-wildcard pattern that a plain B-tree index (including the existing @unique ones on
 * email/Institute.name) cannot accelerate. Postgres' pg_trgm extension's trigram GIN indexes are
 * the standard fix for exactly this access pattern.
 *
 * schema.prisma has no `previewFeatures`/`extensions` block and this project only ever runs
 * `prisma db push` (never `prisma migrate`), so declaring these indexes in the Prisma schema
 * would require an unconfirmed Prisma-version capability and risk breaking `db push` on every
 * future boot. Instead this follows the same pattern already used for every other one-time/
 * idempotent setup step in this codebase (see backfillCourseVisibility.js etc.): a plain Node
 * script wired into the Dockerfile's `(node scripts/X.js; true)` boot chain, non-fatal by design
 * — if the DB user lacks privilege to create the extension (possible on some managed Postgres
 * tiers), search still works via plain ILIKE, just without the index speedup.
 */
const prisma = require("../src/prisma");

const TRIGRAM_INDEXES = [
  { name: "user_name_trgm_idx", table: "User", column: "name" },
  { name: "user_rollnumber_trgm_idx", table: "User", column: "rollNumber" },
  { name: "course_name_trgm_idx", table: "Course", column: "name" },
  { name: "question_title_trgm_idx", table: "Question", column: "title" },
  { name: "question_description_trgm_idx", table: "Question", column: "description" },
  { name: "test_title_trgm_idx", table: "Test", column: "title" },
];

async function addSearchIndexes() {
  let extensionReady = false;
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    extensionReady = true;
  } catch (err) {
    console.warn("[addSearchIndexes] Could not create pg_trgm extension (search will still work, just unindexed):", err.message);
  }

  if (!extensionReady) return { created: 0, skipped: TRIGRAM_INDEXES.length };

  let created = 0;
  for (const { name, table, column } of TRIGRAM_INDEXES) {
    try {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" USING GIN ("${column}" gin_trgm_ops);`
      );
      created++;
    } catch (err) {
      console.warn(`[addSearchIndexes] Could not create index "${name}" on "${table}"."${column}":`, err.message);
    }
  }
  return { created, skipped: TRIGRAM_INDEXES.length - created };
}

async function main() {
  const { created, skipped } = await addSearchIndexes();
  console.log(`[addSearchIndexes] Done. ${created} trigram index(es) ready, ${skipped} skipped.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[addSearchIndexes] failed:", err);
  process.exit(1);
});
