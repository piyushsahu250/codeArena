# Deployment

**Documentation Version:** 1.2.0 · **Last Updated:** 2026-08-25

## Backend — AWS EC2 + Docker (current production)

Superseded the Render/Cloud Run plan described below — this is what's actually live. Was never
documented anywhere in the repo until now, having only ever lived in ad-hoc deploy commands; write
down any change to this command immediately, since the flags below are security-load-bearing, not
cosmetic (see the `--pids-limit` note).

- **Instance:** EC2 `i-075147bbdfea613de`, `ap-south-1`, reached via AWS Systems Manager (`aws ssm
  send-command` / `Send-SSMCommand`), not direct SSH.
- **Secrets:** AWS Secrets Manager, secret `codearena/backend/secrets` (plain name, not ARN).
  `/opt/codearena/fetch-secrets-envfile.sh /opt/codearena/container.env` regenerates the env file
  from it — **run this before every deploy**, not just the first one; a stale `container.env` was
  the root cause of a real mail-delivery outage earlier in this project's history.
- **Build:** `cd /opt/codearena/backend && docker build -t codearena-backend:<tag> .` — context
  must be `backend/`, not the repo root (`COPY package*.json ./` in the Dockerfile expects it).
- **Run** (the complete, correct command — every flag here was added for a real reason, don't drop one):
  ```bash
  docker run -d --name codearena-backend --restart unless-stopped \
    --pids-limit=512 \
    -p 127.0.0.1:4000:4000 \
    --env-file /opt/codearena/container.env \
    codearena-backend:latest
  ```
  - `--pids-limit=512`: **security-critical, not optional.** The judge's in-process `ulimit -u`
    (meant to cap a single submission's process count as fork-bomb protection) does not actually
    bind on this host/kernel combination — confirmed via live testing 2026-08-25 (see
    [SECURITY.md](SECURITY.md)'s Coding Judge Sandbox section). This container-level, cgroup-
    enforced limit is the real fork-bomb defense; omitting it on a future recreation silently
    regresses that protection with no error or warning.
  - `-p 127.0.0.1:4000:4000` (not a custom `--network`): matches nginx's `proxy_pass
    http://127.0.0.1:4000` — a guessed custom network once caused a real ~2-3 minute outage.
  - No `USER` directive drops the main app process to non-root in the Dockerfile itself yet (see
    Docker Known Issues below) — the judge's own child processes are dropped to the unprivileged
    `sandbox` uid at spawn time regardless (`JUDGE_DROP_PRIVILEGES=true`, set in Secrets Manager).
- **Health check:** `curl http://127.0.0.1:4000/api/health` (from the instance) or the public
  domain externally.
- **Standard swap procedure**: tag the current `latest` as a timestamped rollback checkpoint before
  retagging the new build → stop/rm the old container → run the command above. A container
  recreation re-runs the full migrate/seed boot chain (see below), which takes ~20-30s before the
  server actually starts listening — health-check only after that, not immediately after `docker
  run` returns.

## Docker Known Issues
The application process still runs as root inside the container (no `USER` directive in the final
Dockerfile stage) — per this project's own standing instruction, do NOT add one until the judge's
privilege-isolation architecture is separately verified end-to-end, since the two are coupled
(historically, reversing the tmpDir ownership handover order in `judge.js`'s `prepare()` only
surfaced as a bug once the process actually ran non-root). The Coding Judge Sandbox itself (its own
child processes, not the main app process) was live-verified 2026-08-25 — see SECURITY.md.

## Backend — Render / Cloud Run (historical, not current — kept for reference only)

Backend hosting was at one point migrating from Render to Google Cloud Run — Render blocks
outbound SMTP on its free tier, which broke credential email delivery. See
[CLOUD_RUN_MIGRATION.md](CLOUD_RUN_MIGRATION.md) for that migration's history. Neither is what's
actually serving production traffic today — see the EC2 section above.

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
