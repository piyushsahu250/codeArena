# Environment Variables

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08
**Source:** every `process.env.X` reference found in `backend/src`, `backend/prisma`, `backend/scripts`. **No values are ever recorded in this document** — names and purposes only. Never commit real values to this repository or paste them into documentation.

## Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Prisma, pooled). |
| `DIRECT_DATABASE_URL` | Prisma's non-pooled direct connection, used for schema operations (`prisma.schema`'s `directUrl`). Referenced via `env(...)` inside `schema.prisma` itself, not a plain `process.env` read in app code — easy to miss when grepping JS source only. |
| `JWT_SECRET` | HMAC secret for signing/verifying auth JWTs (HS256). |
| `PORT` | Port the Express server listens on. |
| `FRONTEND_URL` | Used for CORS allowlist and building absolute links in emails/PDFs. |

## AI (Anthropic Claude)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables all Claude-backed features (question generation, resume review/rewrite, interview feedback, learning hints, interview drafts). Features degrade to a controlled "not configured" error when unset — do not assume they're always available. |
| `ANTHROPIC_MODEL` | Overrides the default Claude model used, if set. |

## Security / PII

| Variable | Purpose |
|---|---|
| `PII_ENCRYPTION_KEY` | Encrypts `StudentProfile` PII fields at rest. **Missing this variable has previously caused "Failed to save profile" errors in production** — a known operational failure mode if this key is ever unset/rotated without a migration plan. |

## Email

Two transports exist, deliberately not a third-party transactional email API. `sendMail()`
(`backend/src/utils/mailer.js`) tries them in this order:

**1. Google Apps Script bridge (preferred on Render)** — an HTTPS POST from this backend to a
Web App deployed from a Google account, which runs `MailApp.sendEmail()` inside Google's own
infrastructure. This exists because Render's free tier blocks outbound SMTP (ports 25/465/587)
entirely, but does not block outbound HTTPS — the bridge only ever needs port 443. See
[docs/apps-script/CodeArenaEmailBridge.gs](apps-script/CodeArenaEmailBridge.gs) for the Apps
Script source and the setup steps in its own header comment (that side lives in a Google
account this repo has no access to — it must be deployed manually, once).

| Variable | Purpose |
|---|---|
| `APPS_SCRIPT_WEB_APP_URL` | The deployed Apps Script Web App's `/exec` URL. |
| `APPS_SCRIPT_SHARED_SECRET` | Shared bearer secret the backend sends with every request; the script rejects anything that doesn't match its own Script Properties value of the same name. Not a Gmail password — a value you generate yourself (e.g. `openssl rand -hex 32`). |

**2. Direct SMTP via `nodemailer`** — the original transport, kept as a fallback for any host that
does permit outbound SMTP (e.g. Cloud Run). Only used when the Apps Script variables above are
unset.

| Variable | Purpose |
|---|---|
| `MAIL_HOST` | SMTP server hostname, e.g. `smtp.gmail.com`. |
| `MAIL_PORT` | SMTP port — `587` (STARTTLS, recommended) or `465` (implicit TLS). |
| `MAIL_USER` | SMTP username — for Gmail, the full mailbox address, e.g. `codearena001@gmail.com`. |
| `MAIL_PASSWORD` | SMTP password — for Gmail, a 16-character **App Password** (myaccount.google.com/apppasswords, requires 2FA enabled on the account), never the account's normal login password. |
| `MAIL_FROM` | From-address for outbound email, e.g. `codearena001@gmail.com`. Most providers (including Gmail) reject a From address that doesn't match the authenticated mailbox. |
| `MAIL_FROM_NAME` | Optional display name shown alongside `MAIL_FROM`, e.g. `CodeArena`. If set and `MAIL_FROM` is a bare address, the mailer combines them into `"CodeArena <codearena001@gmail.com>"` automatically — `MAIL_FROM` doesn't need to be pre-formatted. Also used as the Apps Script bridge's display name when set. |

If neither transport is configured, the mailer runs in a safe "not configured" mode — every send
attempt is logged and recorded in `EmailLog` as `FAILED` with a clear reason, never silently
reported as successful.

**Setting these on Render**: Dashboard → the backend service → Environment tab → Add Environment
Variable, one row per name above. On Render specifically, set `APPS_SCRIPT_WEB_APP_URL` +
`APPS_SCRIPT_SHARED_SECRET` (outbound SMTP is blocked there regardless of what `MAIL_*` is set
to). If using the SMTP fallback anywhere else, `MAIL_PASSWORD` must be the Gmail **App Password**,
not the normal account password. Save triggers an automatic redeploy; there is no way to configure
this from inside the application, and secret values are never visible again in the dashboard once
saved (Render masks them after entry).

**Setting these on Cloud Run**: secrets (`MAIL_PASSWORD` and the other sensitive values) go into
Secret Manager and are mounted as env vars via `--set-secrets`; non-sensitive values like
`MAIL_HOST`/`MAIL_PORT`/`MAIL_FROM`/`MAIL_FROM_NAME` are plain `--set-env-vars`. See
[CLOUD_RUN_MIGRATION.md](CLOUD_RUN_MIGRATION.md) for exact commands. Render's outbound SMTP is
blocked on ports 25/465/587 as of 2025-09-26 (free tier) — this is why the backend is migrating.

## Judge / Compiler

| Variable | Purpose |
|---|---|
| `JUDGE_CONCURRENCY` | Max concurrent judge executions platform-wide. |
| `JUDGE_CASE_CONCURRENCY` | Max concurrent test-case executions within one submission. |
| `JUDGE_MAX_PROCESSES` | Process-count ceiling for the judge. |
| `JUDGE_COMPILE_TIMEOUT_MS` | Compile-step timeout. |
| `JUDGE_MEMORY_LIMIT_KB` | Default memory limit for judged code. |

## Background Schedulers

| Variable | Purpose |
|---|---|
| `ENABLE_AI_AUTO_REFRESH` | Toggles the AI question/draft auto-refresh scheduler. |
| `AI_AUTO_REFRESH_INTERVAL_MS`, `AI_AUTO_REFRESH_MAX_CALLS_PER_RUN`, `AI_AUTO_REFRESH_MIN_POOL` | Tuning for the above. |
| `ENABLE_CHALLENGE_SCHEDULER` | Toggles the Daily/Weekly Challenge scheduler. |
| `CHALLENGE_SCHEDULER_INTERVAL_MS`, `DAILY_CHALLENGE_LOOKBACK_DAYS`, `WEEKLY_CHALLENGE_LOOKBACK_WEEKS` | Tuning for the above. |
| `ENABLE_TALENT_POOL_REMINDERS` | Toggles the Talent Pool reminder scheduler. |
| `TALENT_POOL_REMINDER_INTERVAL_MS` | Tuning for the above. |
| `INTERVIEW_ANTI_REPEAT_DAYS` | How many days back the interview-question selection avoids repeating a question for the same student. |

## Platform / Runtime (read, not app-specific config)

| Variable | Purpose |
|---|---|
| `RENDER_GIT_COMMIT` | Render's own injected commit SHA — surfaced by the `/api/health` endpoint as `commit`, which is the established deploy-verification signal used throughout this project's history (poll this endpoint after a push until the returned commit matches). |
| `HOME`, `PATH`, `LANG`, `LC_ALL` | Standard process environment, read by the judge's child-process spawning (compiler toolchain lookup, locale) — not application configuration to set manually. |

## Where to Set These

Render (backend) and Vercel (frontend) each have their own environment-variable dashboards — this repository does not commit a `.env` file with real values (only `.env.example`, per `.gitignore`). See [DEPLOYMENT.md](DEPLOYMENT.md) and [DEVOPS.md](DEVOPS.md).

## Frontend

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend API base URL (falls back to `http://localhost:4000/api` if unset). Read in `frontend/src/api.js` and directly in `ModuleCodingAssessment.jsx`/`TestTaking.jsx` for their own fetch calls outside the shared axios instance. |
