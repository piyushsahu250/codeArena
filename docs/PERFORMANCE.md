# Performance

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## IMPLEMENTED

- **Database indexes** on hot query paths — added incrementally over the project's history, most recently `LecturePlan.createdById` and `AttendanceSession.markedById` (this session). See [DATABASE.md](DATABASE.md) §5.
- **Pagination** on previously-unbounded list routes (TalentPool members, AuditLog, EmailLogs, StudentSearch browse — per project history) plus a `take` cap added this session on `companies.js`.
- **In-process TTL cache** (`backend/src/utils/cache.js`) for hot read endpoints (institute list, group rank, admin stats, placement offers, resume stats) — lightweight, in-memory, not Redis. Explicitly invalidated on writes (e.g. `invalidate("institutes:")` after institute create/update/delete) rather than relying purely on TTL expiry.
- **DB-side leaderboard computation** — replaced an earlier pattern that loaded all students into memory to rank them.
- **Parallelized sequential awaits** on interview admin/analytics routes.
- **Frontend code-splitting** — `React.lazy()` for Monaco/TensorFlow/recharts-heavy pages, `vite.config.js` `manualChunks` for the same libraries (NOT re-verified in this pass beyond its presence).
- **Debounced search** on `QuestionBank.jsx`.
- **Compression** (`compression` middleware) and **security headers** (`helmet`) on every response.
- **Global rate limiting** to bound worst-case load from any single client.
- **pg_trgm GIN index** for search (per project history — search.js's fuzzy-matching backing index).

## RECOMMENDED (not implemented)

- Redis or another external cache layer — current caching is in-process only, meaning it doesn't share state across multiple backend instances (not relevant on a single Render instance, but would matter if ever scaled horizontally).
- A real job queue (Bull/BullMQ or similar) for the three `setInterval`-based schedulers — currently fine at this scale, but an in-process interval doesn't survive a restart mid-cycle or coordinate across multiple instances.
- CDN for static assets — NOT VERIFIED whether Vercel's own edge network already covers this adequately (likely yes, by default, for a Vercel-hosted frontend — not independently confirmed in this pass).
- Formal load-testing — no evidence of a load-test suite in the repository.

## Known Constraint: Render Free Tier

Backend runs on Render's free tier (0.1 vCPU / 512MB RAM), which cold-starts after idle. This is a **structural, accepted limitation** — the user has explicitly declined migrating off it. Do not re-propose this without being asked. Any performance work should assume this ceiling, not work around it by requesting infrastructure changes.

## Compiler / Judge Performance
Warm-up compilation runs at boot (`judge.js`'s warm-up log, `backend/Dockerfile`) to pre-warm the OS page cache for `javac`/`gcc`/`g++` rather than paying that cost on the first real student submission. Per-question and per-case concurrency are configurable via `JUDGE_CONCURRENCY`/`JUDGE_CASE_CONCURRENCY` (see [ENVIRONMENT.md](ENVIRONMENT.md)).

## Related
[DATABASE.md](DATABASE.md) (indexes), [DEVOPS.md](DEVOPS.md) (infra), [KNOWN_ISSUES.md](KNOWN_ISSUES.md) (KI-004, KI-005 — two informational unindexed-field notes, confirmed not currently exploitable).
