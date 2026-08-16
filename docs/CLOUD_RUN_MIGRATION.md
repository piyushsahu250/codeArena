# Backend Migration: Render → Google Cloud Run

**Documentation Version:** 1.0.0 · **Added:** 2026-08-16

## Why

Render's free tier blocks all outbound SMTP traffic (ports 25, 465, 587) as of 2025-09-26 — this
is why credential emails could not send (`ETIMEDOUT` connecting to `smtp.gmail.com:587`). It's an
infrastructure-level firewall block, not fixable in code. Google Cloud Run permits outbound
587/465 (only port 25 is blocked there, which this platform never uses) and has a genuine free
tier, so the backend moves there. **The database is untouched** — it was already an external Neon
Postgres instance, not a Render-managed database, so nothing about the data moves.

The frontend (Vercel) does not move.

## What changed in the codebase (already done)

- `backend/docker-entrypoint.sh` (new) — auto-detects whether the container is running as Render,
  a Cloud Run Service, or the Cloud Run migration Job (via `CLOUD_RUN_JOB`/`K_SERVICE`, both
  auto-set by Cloud Run and never set on Render) and behaves accordingly. **Render's behavior is
  completely unchanged** — this is what keeps Render viable as an instant rollback target.
- `backend/scripts/migrateAndSeed.sh` (new) — the exact migration/backfill/seed chain that used to
  be baked into the Dockerfile `CMD`, extracted verbatim. On Cloud Run this runs once per deploy as
  a separate Job, not on every Service cold start (which would otherwise scale-to-zero and re-run
  it every time the app wakes up from idle).
- `backend/Dockerfile` — `CMD` now just invokes `docker-entrypoint.sh`.
- `backend/src/index.js` — `/api/health`'s `commit` field now also checks `COMMIT_SHA` (Cloud
  Build's `$SHORT_SHA`) ahead of `RENDER_GIT_COMMIT`, so the existing poll-health-until-commit-
  matches deploy-verification pattern keeps working on either host.
- `backend/cloudbuild.yaml` (new) — build → push → run migration Job to completion → deploy
  Service, in that order, so a deploy never serves traffic against an unmigrated schema.

Everything below this point is one-time setup **only you can do** — it needs your own Google Cloud
account, billing profile, and GitHub authorization. I can't complete any of it on your behalf.

## One-time setup

### 0. Prerequisites

- A Google Cloud project with billing enabled. Cloud Run's free tier (2M requests, 360,000
  GiB-seconds, 180,000 vCPU-seconds/month) should comfortably cover this platform's scale with
  the scale-to-zero config below — but Google requires a billing account/card on file even to use
  the free tier. You will not be charged unless usage exceeds the free quota.
- [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated
  (`gcloud auth login`, `gcloud config set project YOUR_PROJECT_ID`).

### 1. Enable the required APIs

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com
```

### 2. Create the Artifact Registry repo (holds built Docker images)

```bash
gcloud artifacts repositories create codearena \
  --repository-format=docker --location=asia-south1 \
  --description="CodeArena backend images"
```

(`asia-south1` = Mumbai — closest region to the institute; change it here and in
`backend/cloudbuild.yaml`'s `_REGION` substitution together if you'd rather use a different one.)

### 3. Put secrets in Secret Manager (never as plain env vars, never in the repo)

Each command below prompts you to paste the value — nothing is ever echoed to your terminal
history or committed anywhere:

```bash
printf '%s' "$DATABASE_URL_VALUE"        | gcloud secrets create DATABASE_URL --data-file=-
printf '%s' "$DIRECT_DATABASE_URL_VALUE" | gcloud secrets create DIRECT_DATABASE_URL --data-file=-
printf '%s' "$JWT_SECRET_VALUE"          | gcloud secrets create JWT_SECRET --data-file=-
printf '%s' "$PII_ENCRYPTION_KEY_VALUE"  | gcloud secrets create PII_ENCRYPTION_KEY --data-file=-
printf '%s' "$MAIL_PASSWORD_VALUE"       | gcloud secrets create MAIL_PASSWORD --data-file=-
printf '%s' "$ANTHROPIC_API_KEY_VALUE"   | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
```

Use the exact same values Render already has for each (copy from Render's Environment tab into
your own shell variable first, run the command, then clear your shell history of that value —
`history -d` or just close the terminal).

### 4. Create the Cloud Run Job (migration/seed — runs once per deploy)

```bash
gcloud run jobs create codearena-backend-migrate \
  --image=asia-south1-docker.pkg.dev/YOUR_PROJECT_ID/codearena/codearena-backend:latest \
  --region=asia-south1 \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,DIRECT_DATABASE_URL=DIRECT_DATABASE_URL:latest \
  --max-retries=0 --task-timeout=600
```

(The image tag here is a placeholder — `cloudbuild.yaml`'s first deploy will build and push the
real image; this command just registers the Job resource so the pipeline can update it.)

### 5. Create the Cloud Run Service (the actual API server)

```bash
gcloud run deploy codearena-backend \
  --image=asia-south1-docker.pkg.dev/YOUR_PROJECT_ID/codearena/codearena-backend:latest \
  --region=asia-south1 --platform=managed --allow-unauthenticated \
  --min-instances=0 --max-instances=3 \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,DIRECT_DATABASE_URL=DIRECT_DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,PII_ENCRYPTION_KEY=PII_ENCRYPTION_KEY:latest,MAIL_PASSWORD=MAIL_PASSWORD:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest \
  --set-env-vars=FRONTEND_URL=https://codearena-app.vercel.app,MAIL_HOST=smtp.gmail.com,MAIL_PORT=587,MAIL_USER=codearena001@gmail.com,MAIL_FROM=codearena001@gmail.com,MAIL_FROM_NAME=CodeArena
```

`--allow-unauthenticated` makes the API publicly reachable (same as it is on Render today — auth
is enforced by the app's own JWT middleware, not by Cloud Run's IAM layer). `--min-instances=0`
keeps this on the free tier (scale-to-zero); `--max-instances=3` bounds concurrency. Do **not**
set `PORT` yourself — Cloud Run injects it automatically and the app already reads
`process.env.PORT`.

### 6. Connect the GitHub repo to Cloud Build, for git-push-to-deploy

In the [Cloud Build Triggers console](https://console.cloud.google.com/cloud-build/triggers):
"Connect Repository" → authorize the Cloud Build GitHub App for this repo (one-time OAuth,
must be done by you in-browser) → create a trigger: source = `main` branch, config file =
`backend/cloudbuild.yaml`, included files filter = `backend/**` (so frontend-only commits don't
trigger a backend rebuild).

## Deploying

Once the trigger is connected, every `git push origin main` that touches `backend/**` runs the
pipeline automatically: build → push → run migrations → deploy. Same "push and it deploys" flow as
Render today.

## Verifying (do this before cutting the frontend over)

```bash
curl https://YOUR-CLOUD-RUN-URL/api/health   # poll until `commit` matches the new short SHA
```

Then, with the frontend still pointed at Render, hit the new Cloud Run URL directly (e.g. via
Postman/curl with a valid admin token, or temporarily via the browser devtools console against
the deployed frontend) and use **Admin → Email Logs → Send Test Email** — this is the entire
point of the migration, so confirm it actually works before cutover, not after.

## Cutting the frontend over

On Vercel: Project Settings → Environment Variables → update `VITE_API_URL` to the new Cloud Run
Service URL → trigger a redeploy (Vercel does not auto-redeploy on an env-var-only change).

## Rollback

The Render service is left running, untouched, throughout this migration. If anything goes wrong
after cutover, revert `VITE_API_URL` on Vercel back to the Render URL and redeploy the frontend —
that's the entire rollback. Zero data risk either way, since both hosts point at the same
untouched Neon database.

## Related

[DEPLOYMENT.md](DEPLOYMENT.md), [ENVIRONMENT.md](ENVIRONMENT.md), [DEVOPS.md](DEVOPS.md).
