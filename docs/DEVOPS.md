# DevOps

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## Repository Structure

```
/backend         Express API, Prisma schema, seed/migration scripts, Dockerfile
  /src
    /routes       31 route files (see API_DOCUMENTATION.md)
    /middleware   auth.js, institute.js
    /utils        business logic helpers, judge, mailer, aiClient, etc.
  /prisma          schema.prisma, seed.js, one-off backfill/dedupe scripts
  /scripts         boot-time migration/backfill scripts (see Dockerfile CMD chain)
/frontend         React SPA (Vite)
  /src
    /pages         one file per route/page
    /components    shared UI
    /context       React Context providers
    /utils, /hooks
/docs             This documentation set
docker-compose.yml  Local multi-service compose (NOT VERIFIED in detail this pass — present at repo root)
```

## Branch Strategy

Single `main` branch, direct pushes deploy both backend (Render) and frontend (Vercel). No `develop`/staging branch or PR-gate observed in this session's work — commits go straight to `main`. NOT VERIFIED whether branch-protection rules exist on GitHub itself (outside this environment's visibility).

## CI/CD

- **Confirmed present**: `.github/workflows/ci.yml`, triggered on push/PR to `main`. Two jobs:
  - `backend`: `npm install` (not `npm ci` — the repo's `package-lock.json` has drifted from `package.json` since this environment has no local Node to regenerate it; using `npm install` here deliberately matches what Render's own Dockerfile does, per the workflow's own comment), `npx prisma validate`, `npx prisma generate`. Uses dummy `DATABASE_URL`/`DIRECT_DATABASE_URL` values — `prisma validate`/`generate` parse the schema without opening a real connection, so this catches schema syntax/relation errors only, never runs the actual migration.
  - `frontend`: `npm install`, `npm run build`.
  - This gate does **not** replace Render/Vercel's own deploy — it's an additional catch-before-it-ships check.
- No separate staging environment — `main` deploys straight to production for both frontend and backend.
- **`.github/workflows/docs-sync.yml`** (added 2026-08-08): runs daily (03:00 UTC), on `workflow_dispatch`, and on any push to `main` touching `backend/prisma/schema.prisma` or `backend/src/routes/**`. Executes `scripts/docSync.js`, which recounts API endpoints and Prisma models/enums directly from source and compares them to `docs/platform-manifest.json`. If they've drifted, it updates the manifest's counts and appends a dated `docs/CHANGELOG.md` entry, then commits as `github-actions[bot]`. **Scope is deliberately narrow**: this is a mechanical count-check, not an AI rewrite — it never touches prose in the other 40 doc files. A drift entry is a signal that a human (or an AI session with repo access) still needs to update the relevant narrative docs; see [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) for that checklist.

## Build Process

- **Backend**: Docker, see [DEPLOYMENT.md](DEPLOYMENT.md).
- **Frontend**: `vite build` (via `npm run build`, defined in `frontend/package.json`).

## Local Development

**This environment typically has no local Node/npm available** — see [AI_HANDOVER.md](AI_HANDOVER.md) §3. `docker-compose.yml` exists at the repo root for local multi-service development (NOT independently verified in this pass whether it's current/working).

## Environment Variables

See [ENVIRONMENT.md](ENVIRONMENT.md) — set in Render's and Vercel's own dashboards, never committed to the repo (`.gitignore` excludes `.env`/`.env.*` except `.env.example`).

## Rollback

See [DEPLOYMENT.md](DEPLOYMENT.md) — no automated rollback; redeploy an earlier commit or `git revert`. Schema changes via `prisma db push --accept-data-loss` do not automatically roll back with a code rollback.

## Backup

See [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) — on-demand admin-triggered `pg_dump` only; no scheduled automated backup.

## Monitoring

`GET /api/admin/monitoring` (ADMIN-only, in-app). No external APM tool found.
