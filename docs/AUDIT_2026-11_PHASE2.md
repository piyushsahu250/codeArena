# Full-repository audit, Phase 2: inventory and findings (2026-11-16)

Branch: `audit/full-2026-11` (from `main` f6e2337). **No application code was changed in Phase 1 or 2.** This file is the only change, and it is documentation.
It builds on the earlier audits (`AUDIT_2026-10_FINDINGS.md` batches 1-21, `PLATFORM_AUDIT_2026-10.md`, `PERFORMANCE_2026-10.md`, `KNOWN_ISSUES.md`) and does not repeat them.

**Legend.** VERIFIED = executed or measured, evidence given. STATIC = read from the source by a script or by hand, not executed against a running system. UNVERIFIED = not checked. PENDING-AWS = needs the read-only AWS check (the AWS session had expired).

## 1. Method and limits

* Static scan of every Express route registration (`routes/*.js`, `modules/*/*.routes.js`): which of `authenticate`, a role or permission guard, and an institute guard stand in front of the handler. Guard arrays defined in the same file are expanded. Regex-based: a review list, not a proof.
* File-name based evidence matrix (feature module versus unit/integration tests, browser specs, `verify*.js` scripts, frontend check scripts). A floor, not a measure of quality: a test named differently is not counted.
* Backend unit tests run locally (751). Everything database-backed, the frontend lint, the production build and the browser suite run only in CI (no database and no `node_modules` for the frontend on this machine); CI is green on `main` for f6e2337 (all four jobs).
* `npm audit` run against the committed lockfiles.
* Nothing was run against production except harmless GETs of the public health endpoint and the response headers.

## 2. Route guard scan (STATIC, 678 route registrations in 52 files)

| Check | Result |
|---|---|
| Routes with **no** `authenticate` | **10**, all expected: login, change-temporary-password, forgot-password, reset-password, verify-email, the disabled `register` stub, and the four public certificate/result verification lookups (verify routes are rate limited) |
| Signed-in routes with no role/permission guard | 31, all self-service or catalogue reads (own profile and sessions, notifications, search, practice and course catalogue, leaderboard). Needs the per-route self-scoping check in Phase 4, not a finding yet |
| Admin/staff/clerk routes with no institute guard in the router | 4 (`/users/:id/performance`, `/placement-readiness`, and the two report downloads). **Checked by hand: sound.** `users.performance.service.authorize()` refuses a student asking for anyone else and applies `performanceRefusal` with the viewer's institute |
| Signed-in routes without `attachRequesterInstitute` | 180. Most are student self-service or reference data. Not all can be judged by a regex; a generated per-role request matrix over every route is proposed (section 6) |

## 3. Feature inventory with evidence

Status words: **Working** = exercised in CI or live with evidence; **Partial** = some parts evidenced; **Unverified** = nothing re-checked in this audit.

| Module | Endpoints | Tests by name (unit/int, browser, verify, frontend) | Status and evidence |
|---|---|---|---|
| Auth, sessions, first login, password | 8 | 1, 1, 1, 1 | Working. Contract and first-login scripts run in CI; login limiter; sessions revocable. Real-device not checked |
| RBAC and tenant isolation | 8 | 1, 1, 10, 0 | Working in CI (`verifyPermissions`, `verifyStaffScopeIsolation`, `verifyTenantIsolation`, `verifyRoleIsolation`, plus the permissions matrix test added 2026-11-03). `verifyMultiInstituteIsolation` and `verifyLmsInstituteIsolation` are **not** in CI |
| Users, profiles, PRN/roll numbers | 6 | 0, 1, 4, 1 | Partial. `verifyRollNumberIntegrity` and the profile-permission script are not in CI |
| Institutes, groups, classes | 17 | 1, 0, 3, 0 | Partial |
| Question bank | 15 | 2, 0, 2, 0 | Working (contract scripts in CI) |
| Formal tests and submissions | n/a | 2, 0, 4, 0 | Partial. Autosave and deadline scripts in CI |
| Test management and series | 23 | 2, 0, 0, 0 | Working (CI integration test) |
| Section exams | 30 | 3, 1, 0, 0 | Working (CI integration plus browser spec, and fixes verified live this month). Real-camera proctoring on real browsers UNVERIFIED |
| Exam security, proctoring, secure client, Android | 23 | 3, 3, 4, 2 | Partial. `verifyExamSecurity`, `verifySecureExam`, `verifyTestSecurity` are not in CI. Android and desktop clients not examined |
| Coding judge | n/a | 5, 0, 7, 0 | **Python: VERIFIED** (real production judge, 6,037 runs, sandbox user, load on the CI runner, zombie fix live). **Java, C, C++, JavaScript: Partial.** `verifyFourLanguages`, `verifyCJudgeSandbox`, `verifyJavaPractice`, `verifyJudgeSandbox`, `verifyJudgeUlimits`, `verifyPidsLimit` are not in CI; only `verifyCEndToEnd` is |
| Module coding assessments | 25 | 2, 0, 4, 0 | Working (assessment end to end in CI, 27 published live 2026-11-04) |
| Learning (LMS), lessons, certificates | 79 | 4, 1, 6, 0 | Working for the Python course (220 lessons; certificate end to end in CI; **never earned on the live site**). Java course UNVERIFIED this round |
| Practice courses | 4 | 0, 0, 1, 1 | Partial |
| Readiness assessment | 23 | 3, 1, 5, 2 | Partial |
| Mock and AI interviews | 80 | 11, 1, 5, 0 | Partial (most tests of any module; Gemini connectivity script not in CI) |
| Resume builder | 30 | 0, 0, 5, 0 | Partial. No unit test by name; 5 verify scripts, none in CI |
| Talent pool | 30 | 0, 0, 2, 0 | Partial. Same |
| Placement, companies, offers | 17 | 0, 1, 4, 0 | Partial |
| Attendance | 24 | 0, 0, 1, 0 | **Weak.** One verify script, not in CI. Continuous-absence alert never built (KI-002) |
| Results, marksheets, verification | 42 | 3, 0, 4, 0 | Working (verification codes hardened in the October audit) |
| Dashboards and analytics | 16 | 2, 2, 2, 0 | Partial. Numbers not cross-checked against source data here |
| Challenges and gamification | 40 | 0, 2, 4, 0 | Partial. UTC day boundary open (B-1) |
| Notifications and e-mail | 4 | 3, 0, 2, 0 | Working (messaging guards in CI). Real delivery (SES) not exercised |
| Admin, monitoring, audit, backup | 27 | 0, 1, 6, 0 | Partial. **Backups: see A2-01** |
| Search, documents | 11 | 2, 1, 0, 1 | Partial |

Verification scripts: **102 exist; 35 run in CI** (plus `verifyTenantIsolation` and `verifyRoleIsolation` in a separate step). **67 do not run in CI.** Some may be superseded; none has been triaged.

## 4. Findings register

Severity: P1 can lose data or breach isolation, P2 real risk or large evidence gap, P3 hygiene or decision. "Needs approval" means a behaviour change, infrastructure change or product decision.

| ID | Sev | Finding | Evidence | Proposed action | Needs approval |
|---|---|---|---|---|---|
| A2-01 | P1 until shown otherwise | **No evidence of any scheduled database backup on AWS.** `BACKUP_AND_RECOVERY.md` describes Render (superseded); `KNOWN_ISSUES` KI-006 says no automated backup; the only mechanism found is the on-demand `GET /api/backup/database` that buffers a full dump in memory | STATIC | Read-only AWS check of where the database runs and what snapshots/dumps exist (PENDING-AWS). Then a tested restore | Infrastructure change: yes |
| A2-02 | P2 | **Lockfiles are stale and builds are not reproducible.** Lock pins `axios 1.18.1`, `dompurify 3.2.7`, `react-router-dom 7.18.1`, `express 4.22.2`, `proxy-addr 2.0.7`, `body-parser 1.20.5`; `package.json` requires newer (`^1.20.0`, `^3.4.17`, `^7.18.4`, `^4.22.3`, overrides `^2.0.8`, `^1.20.8`). `npm audit` on the lockfiles: backend 1 critical + 1 high, frontend 5 high. `backend/Dockerfile` runs `npm install`, which resolves the newer versions, so the deployed versions are probably fixed, but this is unproven | VERIFIED (lockfile contents, audit output); deployed versions PENDING-AWS | Regenerate both lockfiles with Node (available now), switch install steps to `npm ci`, re-run the audit; read the deployed backend versions from the container | Low risk; deploy needs approval |
| A2-03 | P2 | **67 of 102 verification scripts are not in CI**, including every non-Python judge sandbox script, multi-institute and LMS institute isolation, test security, secure exam, resume and talent-pool flows | VERIFIED (script list versus CI step) | Add an extended CI job on a disposable database; triage stale scripts | No |
| A2-04 | P2 | **No unit/integration test by name** for Practice, Resume, Talent pool, Placement, Attendance, Challenges, Admin/backup | STATIC (file names) | Write tests for the critical flows of each (Phase 5) | No |
| A2-05 | P2 | **Capacity at 1,000 to 2,000 concurrent users is unproven.** Only the judge was load tested (on the CI runner: 200 simultaneous accepted, p95 3.3 s; 242 gave 36 clean 503s). No API or database load test has ever run; a single instance hosts the API, schedulers, caches and rate limits (S-3) | VERIFIED for the judge only | Load test on an isolated staging environment, never production; measure database pool and CPU first | Staging environment: yes (cost) |
| A2-06 | P2 | **`uncaughtException` and `unhandledRejection` are logged and the process keeps running** (L-3 from October, still open) | STATIC | Log, flush and exit so the container restarts clean; confirm the restart policy | Behaviour change: yes |
| A2-07 | P2 | **Editing thresholds of a published exam silently rewrites students' published pass/fail** (B-3 from October, still open) | STATIC | Product decision: lock thresholds after publish, or version the result | Yes |
| A2-08 | P2 | **The login token lives in browser storage** (F-1). The site's script policy (`script-src 'self'`) and DOMPurify reduce the chance of theft but do not remove it | STATIC | Decision: httpOnly cookies plus CSRF protection | Yes (large) |
| A2-09 | P3 | Resume upload trusts the client's declared file type (`routes/resume.js`: size limit 10 MB, no file filter, parser chosen from mimetype/name). Parsing runs in a sandboxed worker for OCR | STATIC | Check the real file signature before parsing | No |
| A2-10 | P3 | `POST /auth/register` (a disabled stub) has no rate limiter | STATIC | Add the limiter, or remove the stub | No |
| A2-11 | P3 | 23 remote branches are not merged. Possibly valuable: `ci/decisions-1-3-4`, `ci/strict-exam-security`, `ci/audit-batch-8`, `ci/editor-audit`. The `uiux-bisect-*` and `uiux-diag-*` branches look like leftovers | VERIFIED (branch list) | Triage each: merge, rebase, or delete with approval | Deleting: yes |
| A2-12 | P3 | Stale documentation and hosting leftovers: Render-era backup and deploy text, `render.yaml`, `keep-warm.yml` marked TEMPORARY and pointed at the AWS standby | STATIC | Update the docs to the AWS reality; confirm before removing `render.yaml` | Removal: yes |
| A2-13 | P3 | Supply chain hygiene: `tesseract.js` is unpinned (`*`); `xlsx` comes from a CDN tarball, not the registry | STATIC | Pin the version; vendor or pin the tarball hash | No |
| A2-14 | P3 | Open product decisions from earlier audits: KI-001 interview bank has no institute isolation, KI-003 admin stats unscoped, B-1 UTC day boundaries, B-2 percentage rounding, KI-002 absence alerts never built | STATIC | Decide each; implement | Yes |
| A2-16 | P3 | **API documentation is out of date.** `API_DOCUMENTATION.md` and `docs/README.md` say 394 endpoints in 31 route files; the scan finds 678 registrations in 52 files (the newer `modules/*` routers are not covered), and `platform-manifest.json` records `lastCodeReview` 2026-08-08 | STATIC | Regenerate the endpoint table from source (the scan script in this audit can produce it) | No |
| A2-15 | P3 | `judgeC.test.js` "other languages still run through the same judge" fails on Windows only (needs GNU `/usr/bin/time`); passes in CI. Developer-experience defect, not a product bug | VERIFIED (fails identically without any change) | Skip the test when the tool is absent | No |

## 5. Checked and found sound (no action)

* Exactly the expected routes are public (section 2); public verification and login routes are rate limited (42 limiters in 21 files).
* No unsafe raw SQL: no `$queryRawUnsafe`/`$executeRawUnsafe`; the 44 raw queries use tagged templates and `Prisma.sql`, with values as parameters.
* No hard-coded keys or private keys in tracked source; no tracked `.env` files; secrets are read from the environment and the required ones are checked at start.
* Only three uses of `dangerouslySetInnerHTML`, and each passes through DOMPurify (lesson HTML, math rendering).
* CORS is an explicit allow-list (no wildcard); the API sends HSTS, CSP, `nosniff`, `no-referrer`; the site sends CSP, HSTS, `Permissions-Policy` limited to camera/microphone/fullscreen for itself.
* Spreadsheet uploads are capped at 5 MB with a file filter; the October audit added decompression and row limits.
* `/api/health/deep` is public but returns only `status` and a timestamp.
* Hidden test cases and expected answers are not sent to students: verified for formal tests, readiness, interviews and practice in October, and for module assessments and exam coding in November (statement, samples, results).
* Command execution is limited to three files (`backup.js`, `judge.js`, `resumeOcr.js`), the judge and OCR running as an unprivileged user in a stripped environment.

## 6. Proposed Phase 3 and later work (nothing started)

1. **Read-only AWS check (needs a fresh `aws login --profile codearena-admin`):** where the database runs; snapshots or dumps and their age; disk, memory and CPU headroom; container restart policy; the dependency versions actually installed in the running backend and judge. Results go into A2-01, A2-02 and A2-05.
2. **Reproducible installs (A2-02):** regenerate lockfiles, `npm ci`, re-audit. CI proves it; deploy only on approval.
3. **Extended verification in CI (A2-03):** a second job, on a disposable database, that runs the 67 scripts that do not run today; classify each as keep, fix or retire.
4. **Per-role route matrix:** generate, for every one of the 678 routes, the expected outcome for each of Super Admin, Admin, Staff, Clerk, Student, and an institute-B user against institute-A ids; fail CI on any difference from a reviewed golden file. This turns the 180 "no institute guard" routes into evidence.
5. **Judge, other languages:** Java, C, C++, JavaScript: correctness, hidden cases never exposed, timeout, memory limit, output limit, concurrency, error text, on a Linux runner in CI.
6. **Tests for the modules with none by name (A2-04),** starting with attendance, placement offers, resume and talent pool.
7. **Small fixes:** A2-09, A2-10, A2-13, A2-15.
8. **Staging load test (A2-05)** once an isolated environment is approved.

Each group would be a separate commit on this branch with its own CI run; nothing is merged or deployed without explicit approval.
