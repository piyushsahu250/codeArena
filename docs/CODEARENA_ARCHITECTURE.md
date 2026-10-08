# CodeArena — Architecture (as built, verified against the repository on 2026-10-08)

This document describes what the code actually does today. Where the platform differs from an ideal design, that is stated under
"Gaps" in [PLATFORM_AUDIT_2026-10.md](PLATFORM_AUDIT_2026-10.md) rather than hidden here. Older, topic-specific documents in this folder
(`AUTHENTICATION.md`, `RBAC_PERMISSIONS.md`, `EXAM_SECURITY.md`, `SECURE_EXAM_ARCHITECTURE.md`, `DEPLOYMENT.md` ...) remain the detail references.

## 1. Shape of the system

```
  Browser (React 19 SPA, Vite)                       Secure Exam App (Electron, Windows lab kit)   [unverified on hardware]
        |  Vercel (static + CSP headers)                    |
        v                                                   v
  api-aws.codearena.site  --nginx-->  Docker container "codearena-backend" (Node 20, Express 4, ws)   one EC2 instance
        |                                   |-- in-process: judge (sandboxed child processes), schedulers, AI queue, caches
        |                                   |-- Prisma 5  -->  PostgreSQL (RDS, ap-south-1), 117 models, 30 enums
        |                                   |-- AWS SES / SMTP / Apps Script (email), S3 + CloudFront (question images, backups)
        |                                   `-- Google Gemini (AI generation, evaluation, live voice)
        `-- GitHub Actions: prisma validate + unit tests + frontend build  (deploy = scripts/deploy-aws-host.sh via SSM)
```

Single backend instance. Everything marked "in-process" (judge queue, caches, rate-limit counters, voice tickets, schedulers) is
therefore **not multi-instance safe** — see audit item S-3.

## 2. Repository layout (actual)

| Path | Contents |
|---|---|
| `frontend/src/pages` (103) | One file per screen; many are 1,000-3,000 lines (LearningManagement, TestTaking, ResumeBuilder ...). |
| `frontend/src/components` (70) | Shared widgets; `components/student/` and `components/admin/` hold the dashboard kits; 18 generic UI primitives (Input, Modal, Tabs ...) exist but are not imported by any page. |
| `frontend/src/hooks`, `utils`, `context`, `styles` | `useProctoring`, `useExamSession`, auth/theme/feature contexts, `studentDashboard.css` / `adminConsole.css` (the only design-token sets). |
| `backend/src/routes` (43) | Express routers. Business logic lives **in the route handlers** (29.5k lines); there is no controller/service/repository split. |
| `backend/src/utils` (123) + `services/` | Domain helpers (grading, eligibility, exam security, publishing state ...) and the AI interview/Gemini services. |
| `backend/src/middleware` | `auth.js` (authenticate, requireRole), `institute.js` (attachRequesterInstitute), `featureGate.js`, `publicLimiters.js`. |
| `backend/prisma/schema.prisma` | The schema (4.2k lines). **No migrations directory**: the container runs `prisma db push` on boot. |
| `backend/scripts` (142) | Backfills, seeds and ~25 `verify*.js` live integration checks (not part of CI). |
| `secure-client/` | Electron secure-exam client + Windows kiosk kit. |
| `scripts/deploy-aws-host.sh` | Deploy: pull, build, **schema guard**, container swap, health check, auto-rollback. |

## 3. Authentication and sessions

* Email + password, bcrypt; JWT (HS256) carrying a `jti`; every request checks the `LoginSession` row (`isActive`), so logout and forced
  logout revoke immediately. Per-institute policy: password expiry, history depth, single-session-only.
* Self-registration is disabled (`POST /auth/register` returns 403); accounts are created by admins (bulk import or single).
* Login, forgot/reset password and verify-email have their own limiters; a global limiter (600/5 min) is keyed by user id when the token
  verifies, otherwise by IP.
* The browser stores the token in `localStorage` (XSS exposure is mitigated by Vercel CSP, not eliminated).
* Exam sessions: formal tests, readiness tests and mock/AI interviews issue a per-attempt `sessionId` (newest start wins; stale tab gets
  409). Coding assessments additionally support device-bound secure sessions (HMAC challenge/response).

## 4. Authorization and tenancy

* **Roles** (enum): `STUDENT, STAFF, CLERK, ADMIN, INSTITUTE_ADMIN, SUPER_ADMIN`. `ADMIN` is historical and dual-purpose (platform-level when
  `instituteId` is null, institute-scoped otherwise); the frontend treats `SUPER_ADMIN` and `INSTITUTE_ADMIN` as satisfying `ADMIN` gates.
  At most one `SUPER_ADMIN` can exist (partial unique index).
* **Route-level**: every router declares `authenticate, requireRole(...)`; staff-facing routers add `attachRequesterInstitute`, which loads the
  caller's `instituteId` into `req.requesterInstituteId` (null = platform-level).
* **Resource-level**: tenancy is enforced inside handlers through helpers (`ownsLmsInstitute`, `ownsInterviewQuestionRow`, `ownsChallengeRow`,
  `testEligibilityWhere`, `courseEligibilityWhere`, `canStaffAccessTest`, `staffTestAccessWhere`, `questionVisibilityWhere`, `isSubjectOwner` ...).
  There is **no central permission table**; permissions are the role arrays in route declarations. See `RBAC_PERMISSIONS.md`.
* **Feature flags**: `FeatureSetting(instituteId, featureKey)` + `requireFeature(key)` per institute (Feature Management page).
* **Tenant ownership of data**: `instituteId` is on `User`, `AcademicGroup`, `Department`, `Test`, `Question`, institute-authored `Course`,
  `ResultExamination`, `EmailLog`, `AuditLog`, etc. Courses are shared content assigned to institutes/groups. A few resources are deliberately
  global (company master, interview AI-draft queue, gamification config) — audit items T-2/T-3.

## 5. Domain modules

| Module | Main files | Notes |
|---|---|---|
| Users / import | `routes/users.js`, `profile.js`, `staffClerk.js`, `studentDocuments.js` | PII fields encrypted (`PII_ENCRYPTION_KEY`); documents/offers verified by clerks. |
| Academic structure | `academicGroups.js`, `classes.js`, `attendance.js` | Institute → Department → Batch → Section (`AcademicGroup`); `StaffClassAssignment` per subject. |
| LMS | `learning.js`, `utils/publishState.js`, `learningLock.js`, `gatingLevels.js`, `practiceProgress.js` | Course → Module → Chapter → Lesson; Draft/Published/Archived per level; server-side module locks; JAVA Practice track. |
| Question bank | `questions.js` (3k lines), `utils/questionValidation.js` | Folders, bulk import with preview/confirm, visibility rules (institute + creator). |
| Assessment engines (4) | `tests.js`+`submissions.js` (formal MCQ/coding), `moduleCoding.js` (coding assessments/levels), `readiness.js`, `interview.js`, `aiInterview.js` | Separate attempt models; shared exam-security layer (§6). |
| Results | `resultManagement.js`, marksheet PDFs, public `/results/verify/:code` | |
| Placement | `placementOffers.js`, `companies.js`, `talentPools.js`, `readiness` placement overview | |
| Certificates | `certificates.js`, `utils/certificates.js`, PDFs | Public verify by code (rate limited). |
| Notifications / email | `notifications.js`, `utils/notifications.js`, `mailer.js`, `emailRetryScheduler` | `Notification` + `EmailLog`; email never blocks the request (background batches, retry scheduler). |
| AI | `services/ai/aiService.js`, `aiQueue.js`, `interviewDraftGenerator.js` | Gemini key pool, daily/RPM limits, `AiUsageLog`; generated questions go to a DRAFT queue before publishing. |
| Dashboards | `studentDashboard.js` (`/api/student/dashboard`), `adminCommand.js` (`/api/command/{super,institute,staff,clerk}`) | One aggregated request per dashboard; per-section failure isolation. |
| Search | `search.js` | Role-scoped; grouped results for admin tiers. |
| Exports / backup | `exports.js`, `backup.js`, `utils/exportFile.js` | Spreadsheet-injection-safe CSV/XLSX; export audit entries. |

## 6. Assessment security model (summary)

Server = authority, browser = detection, managed device = enforcement. Details: `EXAM_SECURITY.md`, `SECURE_EXAM_ARCHITECTURE.md`.

* Levels: STANDARD / PROCTORED (all engines) and LOCKDOWN (coding engine only; needs the secure client).
* Server-enforced: attempt limits, timer from `startedAt`, question authorization, hidden tests never sent, question content withheld before
  start (formal tests), phone refusal for PROCTORED, one active session, server-assigned severity, per-attempt strike limit (3) where the engine
  has strikes (tests, readiness, mock interview, AI voice interview).
* Evidence: `ExamSecurityEvent` (kind TEST / MODULE_CODING / READINESS / INTERVIEW / AI_INTERVIEW) plus the legacy per-engine violation tables;
  monitors under `/staff/exam-security/*`, overview `GET /api/exam-security/overview`.
* A web page cannot see other apps, extensions or OS overlays; nothing in the product claims otherwise.

## 7. Coding judge

`utils/judge.js` runs C, C++, Java, Python, JavaScript (and SQL via `sqlJudge`) in child processes: per-run temp dir, CPU/memory/time/process
limits (`JUDGE_*`), privilege drop to a sandbox uid, and an iptables rule dropping that uid's outbound traffic (installed by the entrypoint).
Concurrency is a **semaphore inside the web process** (`utils/queue.js`, default 2 concurrent, queue 20) — the judge shares CPU/memory with the API.

## 8. Background work

Schedulers started from `index.js` (each has an `ENABLE_*` switch): AI pool refresh, talent-pool reminders, challenge scheduling, scheduled
test publishing, test-attempt auto-finalize (+ security-event retention sweep), email retry. They are `setInterval` loops in the web process;
there is no external queue. Grading of coding submissions, email batches and PDF rendering run in-process (PDF in worker threads).

## 9. Caching and rate limiting

In-memory TTL cache (`utils/cache.js`) for dashboards, leaderboards, recommendations, command-center aggregates (20-60 s). Rate limiters:
global per-user/IP, login/reset, judge execution, AI, exam events, public verification endpoints. All in-process.

## 10. Observability

`X-Request-Id` on every response and in the structured request log; `metrics.js` rolling timing/event-loop snapshot; `GET /api/health`
(database, AI, email, storage, required env presence); Super Admin command center and Platform Health page read live checks (DB ping, judge
queue, AI/email failure rates). No external APM or alerting.

## 11. Data safety and deployment

* Schema is applied with `prisma db push --accept-data-loss` followed by an idempotent chain of backfill scripts (`scripts/migrateAndSeed.sh`).
  There is no migration history, so **`deploy-aws-host.sh` now runs a read-only schema guard** before touching the running container: it diffs the
  live database against the new schema and refuses to deploy when it would drop a table/column/enum or change a column type
  (`ALLOW_DESTRUCTIVE_SCHEMA=1` to override deliberately). Rolling an image back does not undo a boot that already dropped data.
* Deploy: `aws ssm send-command` -> `deploy-aws-host.sh` (pull, tag rollback image, build, guard, swap, wait for `/api/health` reporting the new
  commit, automatic rollback). Backups: `docs/BACKUP_AND_RECOVERY.md`.
* Environment: 88 variables are read by the backend (grouped in `ENVIRONMENT.md`); required at boot: `DATABASE_URL`, `JWT_SECRET`, `PII_ENCRYPTION_KEY`.

## 12. Testing

* Unit: `npm run test:unit` — 169 tests (pure logic), run in CI and passing in the production image.
* Integration (need Postgres): `backend/test/*.integration.test.js`.
* Live verification scripts (`backend/scripts/verify*.js`, run on the server against throwaway data): dashboards, admin command center, tenant
  isolation, test/readiness/mock/AI-interview security, exam security, secure exam, publishing, Java practice, feature management.
* No browser E2E suite and no load test in CI; responsive and dark-mode checks are manual.
