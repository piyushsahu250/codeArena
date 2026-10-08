# Platform audit — 2026-10-08

Method: repository inspection plus targeted static scans (route guards, handler scoping, index coverage, dead code, unbounded lists) and live
checks on the production image. "Verified" means reproduced or tested; "by reading" means concluded from the code and not exercised live.

## A. Fixed in this pass (deployed, tested)

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| T-1 | **Leaderboard crossed tenants.** `GET /gamification/leaderboard`: the *department* scope matched on the department **name** across every institute; staff could pass another institute's `academicGroupId` / `instituteId` and read its students' names, roll numbers and XP. (By reading; the cross-institute result was not reproduced against the old build.) | `routes/gamification.js` `resolveScopeStudentIds` | Institute-bound callers are pinned to their own institute for group/department/institute scopes; platform-level callers unchanged. `verifyTenantIsolation.js`: 11 checks pass. |
| T-1b | **Leaderboard cache shared between groups.** The cache key held only query-string values; students send none, so every student got the same cached group/department list for 30 s (wrong data, and a leak across groups). By reading. | same | Key now built from the resolved scope (group, department, institute). Verified (two groups get different lists). |
| S-1 | **Public certificate/marksheet verification could be enumerated** (readable code pattern, only the 600/5 min global limit). | 4 public routes | Shared per-IP limiter, 30/min (`middleware/publicLimiters.js`). Verified. |
| D-1 | **Destructive schema changes could reach production silently** (`db push --accept-data-loss` on every boot, no migrations, image rollback does not restore data). | `scripts/migrateAndSeed.sh` | Deploy-time schema guard (read-only diff; blocks DROP TABLE/COLUMN/TYPE and column type changes). Verified both ways on the server: real schema -> 0 findings; schema with a column removed -> `DROP COLUMN` flagged. |
| P-1 | Missing indexes: `Course.instituteId`, `ModuleCodingSubmission.studentId`, `ExamSecurityEvent(instituteId, createdAt)`, `SecureExamSession.instituteId`. | schema scan | Added (additive). |
| Q-1 | CI ran only `prisma validate` + frontend build; backend tests never ran. | `.github/workflows/ci.yml` | Added `npm run test:unit` (169 tests, 0 failures in the production image). |
| T-2 | **"Overall" leaderboard spanned institutes.** The "overall" scope (gamification and the interview leaderboard, where it was the default) listed names and roll numbers of students from every institute to every student. | `routes/gamification.js`, `routes/interview.js` | **Resolved 2026-10-08 (decision: restrict to own institute).** For institute-bound callers "overall" now returns only their own institute; a platform-level admin still gets the platform-wide list. The "Overall" tab was removed from the Achievements and Interview Leaderboard pages (it would duplicate "Institute"). `verifyTenantIsolation.js`: student, staff, platform-admin and interview cases pass. |
| T-3 | **Shared queues and the company catalogue had no tenant owner.** Any STAFF/INSTITUTE_ADMIN of any institute could list, edit, approve, reject and delete the interview AI-draft queue (questions and pattern notes) and the company-question jobs/reports; any CLERK could edit or deactivate a company every institute uses; an institute-bound ADMIN could change platform-wide settings. | `routes/interviewDrafts.js`, `companyQuestions.js`, `companies.js`, gamification/interview/resume/institutes config routes | **Resolved 2026-10-08.** Additive owner columns (`instituteId`, `createdById`) on drafts and pattern notes, `instituteId` on generation jobs and companies. Institute-bound reviewers see and act only on their institute's rows (404 otherwise); platform-level reviewers see everything; rows with no owner (legacy, scheduler) are platform-owned. Candidate reports follow the submitting student's institute. Approved pattern notes show to the owning institute's students plus everyone for platform-owned ones. Company catalogue: still one shared list everyone can read and use; platform admins edit/deactivate any entry, an institute may add companies and edit only the ones it created, only platform admins can deactivate. Platform-wide settings (gamification XP rules/badges/reset, interview company profiles, resume field config, create institute) now require a platform-level account. Backfill derives owners from existing evidence (`backfillReviewOwnership.js`). `verifyReviewOwnership.js`: 33 checks pass. **Production effect:** all 9 existing drafts and 2 pattern notes had no recoverable owner, so they are platform-owned (the 3 pending drafts and 1 pending note are now visible to platform admins only); TCS became owned by its creating institute, HCL Tech stays platform-owned. |
| T-3b | **Shared/legacy interview questions were editable by any institute.** Rows with no `instituteId` are visible to every institute, but `ownsInterviewQuestionRow` treated them as owned by everyone, so any institute's staff could edit or delete them. | `utils/interviewQuestionVisibility.js`, `routes/interview.js` | **Resolved 2026-10-08.** Reading is unchanged (shared questions stay visible to all). Edit/delete now needs ownership: a shared row can be changed only by a platform-level account; an institute-bound caller only its own institute's rows (staff: rows they created or with no recorded creator). The admin question list marks each row `editable` and the page shows "Shared" instead of Delete. 403 with an explanation for shared rows, 404 for another institute's. Production: 217 shared and 24 institute-owned questions, no data change needed. Verified in `verifyReviewOwnership.js` (now 41 checks). Not changed: a verified candidate report can still increment the verification counter of a shared question it matches (metadata only). |

## B. Decisions needed from you (behaviour would change)

| ID | Finding | Options |
|---|---|---|
| T-4 | Certificate codes embed institute, programme and a sequence (guessable). The new limiter slows enumeration but does not stop it. | Add a random suffix for new certificates; keep old codes valid. |
| R-1 | Roles live as arrays inside ~500 route declarations; `ADMIN` is dual-purpose. A central `can(user, permission)` + permission tables is the right target but touches every route. | Incremental: introduce `can()` and migrate one module at a time, starting with the assessment and user-management routes. |

## C. Structural gaps (not changed — risk or size)

| ID | Gap | Why not changed now |
|---|---|---|
| S-3 | Single instance: judge, schedulers, caches, rate limits and voice tickets are in the web process. Judge concurrency 2 (about 500 simultaneous final submits exceed the retry window; load-tested earlier). | Needs a separate judge worker + shared queue/cache (Redis or SQS) and a deployment change. |
| A-1 | No controller/service/repository layer; route files up to 3k lines hold business logic; pages up to 3k lines. | A rewrite would risk behaviour changes across 43 routers with no E2E safety net. Recommended order: add E2E coverage first, then extract modules one at a time. |
| A-2 | No migration history. | The schema guard is the stop-gap; adopting `prisma migrate` needs a baselined migration against production. |
| Q-2 | No browser E2E, load test or accessibility test in CI; the `verify*.js` scripts are manual. | Needs a test environment with seeded data (never production). |
| F-1 | JWT in `localStorage`. | Moving to httpOnly cookies requires CSRF protection and API changes. |
| F-2 | 18 generic UI components (Input, Modal, Tabs, ...) are unused; pages use hand-written styles. Design tokens exist only for the two dashboard kits. | Adoption is a UI-wide change; not deleting (may be wanted). |
| O-1 | Observability is in-process metrics only; no alerting, no APM. | Needs external tooling. |
| X-1 | Legacy artefacts: `render.yaml`, `backend/CLOUD_RUN.md`, `docs/CLOUD_RUN_MIGRATION.md` describe previous hosts. `pdfRenderWorker.js`/`sqlWorker.js` look unreferenced but are started by path (do not delete). | Confirm with you before removing. |

## D. Things checked and found sound

* Public (no-login) routes are limited to login/reset/verify flows and the four verification endpoints; `POST /auth/register` is a disabled stub.
* Of 43 router files, every data route requires `authenticate`; the routes flagged by the first static scan (`...guard` arrays) do include it.
* Staff/admin handlers by id (users, questions, challenges, interview questions, attendance plans, tests) call ownership helpers; the by-id
  routes sampled (≈25) were scoped. The AI-draft queue and company master are the exceptions (T-3).
* Index coverage for `instituteId`/`studentId`/`academicGroupId`/`userId` is good (6 misses, 4 fixed above, 2 low-traffic left).
* Answer keys and hidden test cases are not sent to students (verified for formal tests, readiness, interviews, practice).

## E. Not done in this pass (and not claimed)

The restructure into `/modules /controllers /services /repositories`, Permission/RolePermission tables, a separate judge service, asynchronous
large-report jobs, a browser E2E suite, load tests at 1,000-2,000 concurrent students, and a full responsive/accessibility sweep of every page.
The release gates in the brief are therefore **not all met**; the open items above are the honest list.
