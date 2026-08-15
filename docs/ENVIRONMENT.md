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

Email delivery is real SMTP (via `nodemailer`) — deliberately not a third-party transactional
email API. Point it at any real mailbox (Gmail/Google Workspace SMTP with an App Password is the
supported default; any standard SMTP provider works the same way).

| Variable | Purpose |
|---|---|
| `MAIL_HOST` | SMTP server hostname, e.g. `smtp.gmail.com`. |
| `MAIL_PORT` | SMTP port — `587` (STARTTLS, recommended) or `465` (implicit TLS). |
| `MAIL_USER` | SMTP username — for Gmail, the full mailbox address. |
| `MAIL_PASSWORD` | SMTP password — for Gmail, a 16-character **App Password** (myaccount.google.com/apppasswords, requires 2FA enabled on the account), never the account's normal login password. |
| `MAIL_FROM` | From-address for outbound email, e.g. `"CodeArena <youraddress@gmail.com>"`. Most providers (including Gmail) reject a From address that doesn't match the authenticated mailbox. |

If `MAIL_HOST`/`MAIL_USER`/`MAIL_PASSWORD` are not all set, the mailer runs in a safe "not
configured" mode — every send attempt is logged and recorded in `EmailLog` as `FAILED` with a
clear reason, never silently reported as successful.

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
