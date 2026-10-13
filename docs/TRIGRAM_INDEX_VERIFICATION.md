# Trigram search indexes: does boot drop and recreate them? (measurement plan and baseline)

Status: **NOT PROVEN.** Circumstantial evidence points one way (below); the claim becomes proven only by the before/after measurement in section 3. Nothing here runs `db push`, a
migration or a restart.

## 1. What the code does

* `backend/scripts/migrateAndSeed.sh` runs on every container boot: `... npx prisma db push --skip-generate --accept-data-loss && (...) ...` and, later in the chain, `node scripts/addSearchIndexes.js`.
* `backend/scripts/addSearchIndexes.js` creates nine `pg_trgm` GIN indexes (`*_trgm_idx`) idempotently. They are deliberately **not** in `schema.prisma` (see that file's header).
* The deploy script's schema guard diff (`prisma migrate diff --from-url <db> --to-schema-datamodel schema.prisma --script`) lists exactly these nine as `DROP INDEX`, every time.
* `prisma db push` computes the same diff and applies it. Dropping an index is not "data loss", so nothing in the code prevents `db push` from executing those nine `DROP INDEX` statements at boot,
  after which `addSearchIndexes.js` recreates them (its log line is `[addSearchIndexes] Done. 9 trigram index(es) ready, 0 skipped.`). If so, trigram search is slower for the seconds between the drop and
  the recreate, and the indexes are rebuilt on every boot.

## 2. Baseline captured read-only on 2026-10-13 (after the d82db9f boot at 04:32 UTC, captured 04:48 UTC)

Method: `SELECT` on `pg_class` / `pg_index` run through the application container's Prisma client. No row data, no writes.

| index | table.column | OID = relfilenode | bytes |
|---|---|---|---|
| user_name_trgm_idx | User.name | 38696 | 376832 |
| user_rollnumber_trgm_idx | User.rollNumber | 38697 | 90112 |
| user_registrationnumber_trgm_idx | User.registrationNumber | 38698 | 155648 |
| user_mobile_trgm_idx | User.mobile | 38699 | 229376 |
| user_employeeid_trgm_idx | User.employeeId | 38700 | 32768 |
| course_name_trgm_idx | Course.name | 38701 | 16384 |
| question_title_trgm_idx | Question.title | 38702 | 196608 |
| question_description_trgm_idx | Question.description | 38703 | 483328 |
| test_title_trgm_idx | Test.title | 38704 | 40960 |

All nine are `USING gin (<column> gin_trgm_ops)`; `pg_trgm` 1.6; PostgreSQL started 2026-08-21.

Circumstantial evidence: the nine OIDs are consecutive and **higher than every other relation in the `public` schema** (the next highest is `AuditLog_adminId_createdAt_idx`, OID 36234, which was added by a
much later feature). OIDs are assigned in creation order, so the indexes were created after every table and index in the schema, which is what a recreate on a recent boot would produce and not what a
one-time creation in August would produce. This does not say *which* boot recreated them or whether every boot does.

## 3. Verification procedure (use the next planned deploy or restart; needs your approval for the restart itself)

1. Before the window: run the capture query below and save the output (names, OIDs, relfilenodes, definitions, sizes).
2. During the window: perform the approved deploy or restart. Note the container start time and the log lines for `prisma db push` and `[addSearchIndexes]`.
3. After the container reports healthy: run the same capture query again.
4. Compare:
   * OIDs and relfilenodes changed for all nine, definitions identical: **proven** that boot recreates them (and `db push` or the script rebuilds them every time).
   * OIDs unchanged: **proven** that boot leaves them in place; the circumstantial evidence above was an earlier one-off.
   * Some changed, some not, or definitions differ: investigate (do not assume).
5. Optionally, capture search latency (`GET /search` timing) during the first minute after boot to measure the gap if they are recreated.

Capture query (read-only):

```sql
SELECT c.relname AS name, c.oid::int AS oid, c.relfilenode::int AS relfilenode,
       pg_relation_size(c.oid)::int AS bytes, pg_get_indexdef(c.oid) AS def
FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname LIKE '%\_trgm\_idx' ORDER BY c.relname;
```

## 4. If it is confirmed that boot recreates them (a change for later, not made here)

Options, in order of least risk: (a) leave as is and document the brief gap; (b) declare the indexes in `schema.prisma` so `db push` stops dropping them (needs a Prisma version capability check and a
staging run); (c) have `addSearchIndexes.js` run before `db push`. None of these is being made now.
