# Deployment

**Documentation Version:** 1.1.0 · **Last Updated:** 2026-08-16

Backend hosting is migrating from Render to Google Cloud Run — Render blocks outbound SMTP on its
free tier, which broke credential email delivery. See [CLOUD_RUN_MIGRATION.md](CLOUD_RUN_MIGRATION.md)
for the full migration (why, what changed, one-time GCP setup, verification, rollback). Render is
kept running, untouched, as the rollback target until Cloud Run is verified in production — the
section below still describes it accurately during that window.

## Backend — Render (Docker) — being phased out, kept as rollback target

- **Service:** `sanjivani-codearena-backend-docker` on Render, free tier.
- **Health check:** `GET https://sanjivani-codearena-backend-docker.onrender.com/api/health` → `{status, service, commit}`. `commit` comes from `RENDER_GIT_COMMIT` (Render's own injected env var).
- **Build**: `backend/Dockerfile` — installs judge toolchains (gcc/g++, default-jdk-headless, python3, GNU time, postgresql-client, util-linux) via `apt-get`, then `npm install`, then `npx prisma generate`.
- **Boot command (`CMD`)**: `backend/docker-entrypoint.sh`, which auto-detects the host (via
  `CLOUD_RUN_JOB`/`K_SERVICE`, both Cloud-Run-only env vars, never set on Render) and on Render
  falls through to the original behavior — `backend/scripts/migrateAndSeed.sh` (the same
  migration/backfill/seed chain that used to be inlined directly in the `CMD`) followed by
  `npm start`. In order:
  1. `node prisma/dedupeDuplicateSubmissions.js` — one-time-safe cleanup that must run before the schema push below.
  2. `node scripts/migrateRegistrationNumbers.js`
  3. `npx prisma db push --skip-generate --accept-data-loss` — **applies the current `schema.prisma` to the live database, with no confirmation, potentially destructively.** See [DATABASE.md](DATABASE.md) §1.
  4. A chain of `(node scripts/<name>.js; true)` idempotent backfill/migration scripts — each wrapped so a failure doesn't abort the boot chain (`; true`).
  5. `npm run seed || true` — seed data, non-fatal if it fails.
  6. `npm start` — finally starts the Express server.
  On Cloud Run this chain instead runs once per deploy as a separate Job, and the Service itself
  just runs `npm start` — see [CLOUD_RUN_MIGRATION.md](CLOUD_RUN_MIGRATION.md).
- **Deploy trigger:** push to `main` on GitHub (`origin`, currently pointing at a moved repo location — `https://github.com/piyushsahu250/codeArena.git` per a redirect notice observed during this session; the checkout's remote may still show the old URL).

## Frontend — Vercel

- Auto-deploys on push to `main`.
- Config: `frontend/vercel.json` (NOT re-read in full during this documentation pass).
- No established health-check/commit-poll pattern exists for the frontend the way it does for the backend — a frontend deploy's success needs to be checked in the Vercel dashboard directly, which this environment historically has not had direct access to.

## The Established Verify Pattern

Throughout this project's history, the standard way to confirm a backend deploy actually landed is:
1. `git push origin main`
2. Poll `GET /api/health` in a loop until the returned `commit` matches the new push's short SHA.
3. Only then consider the change "deployed and verified."

This pattern exists specifically because there is no other reliable deploy-status signal available from this environment — no direct Render dashboard/API access, no CI status webhook consumed here. **Render's free-tier builds can take longer than a short poll window** (this platform's Docker image does a from-scratch `apt-get install` of several large compiler toolchains) — if a poll loop times out, that does not necessarily mean the deploy failed; extend the wait before concluding failure.

## Rollback

No automated rollback mechanism is configured. To roll back, redeploy an earlier commit (Render will rebuild from it) or `git revert` and push. **Because `prisma db push --accept-data-loss` runs on every boot, rolling back the *code* does not roll back a *destructive schema change* that already applied** — the database schema does not automatically revert with the code.

## Monitoring

`GET /api/admin/monitoring` (ADMIN-only) — a real (non-fabricated, per project history) monitoring page. No external APM/monitoring service integration found in this codebase.

## Related
[DEVOPS.md](DEVOPS.md), [ENVIRONMENT.md](ENVIRONMENT.md), [DATABASE.md](DATABASE.md) §1, [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
