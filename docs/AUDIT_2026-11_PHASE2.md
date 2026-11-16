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
| A2-01 | P3 (was P1) | **Backups exist in two layers, so the October-era "no backup" statement is out of date.** RDS keeps 7 days of point-in-time recovery plus daily automated snapshots and two manual snapshots (2026-10-06, 2026-10-28); the host runs `/root/backup-db.sh` daily at 20:00 UTC: `pg_dump` custom format, size check, upload to S3 (AES256, public access blocked, 30-day expiry, 32 objects), `pg_restore --list` check (1,062 entries). Last logged run 2026-11-15 20:00 UTC. **Residual risks:** see A2-18 | VERIFIED (AWS + host, read-only) | Document the real setup; see A2-18 | No |
| A2-02 | P3 (was P2) | **Lockfiles are stale and builds are not reproducible, but the deployed backend is on the fixed versions.** Lock pins `axios 1.18.1`, `dompurify 3.2.7`, `react-router-dom 7.18.1`, `express 4.22.2`, `proxy-addr 2.0.7`, `body-parser 1.20.5`; `package.json` requires newer. `npm audit` on the lockfiles (backend 1 critical + 1 high, frontend 5 high) therefore over-reports. **Running backend container (read from it):** `express 4.22.3`, `body-parser 1.20.8`, `proxy-addr 2.0.8`, `qs 6.16.0`, `multer 2.4.0`, `helmet 7.2.0`, `jsonwebtoken 9.0.3`, `xlsx 0.20.3`, `tesseract.js 7.0.0`; `pdfjs-dist 3.11.174` is pinned (sandboxed worker, accepted in October). The frontend's deployed versions were not read (the bundle is minified); the same `npm install` resolution applies | VERIFIED for the backend, UNVERIFIED for the frontend bundle | Regenerate both lockfiles and use `npm ci` so what CI tests is what ships | Deploy needs approval |
| A2-03 | P2 | **67 of 102 verification scripts are not in CI**, including every non-Python judge sandbox script, multi-institute and LMS institute isolation, test security, secure exam, resume and talent-pool flows | VERIFIED (script list versus CI step) | Add an extended CI job on a disposable database; triage stale scripts | No |
| A2-04 | P2 | **No unit/integration test by name** for Practice, Resume, Talent pool, Placement, Attendance, Challenges, Admin/backup | STATIC (file names) | Write tests for the critical flows of each (Phase 5) | No |
| A2-05 | P2 | **Capacity at 1,000 to 2,000 concurrent users is unproven, and the hardware is small.** See section 7 for the measured numbers: one `t3.medium` (2 vCPU, 3.8 GiB, no swap) runs the API and the judge; the database is a `db.t4g.micro` (1 GiB). Only the judge was load tested (CI runner). No API or database load test has ever run | VERIFIED for the judge and the hardware; capacity itself UNVERIFIED | Load test on an isolated staging environment, never production | Staging environment: yes (cost) |
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
| A2-17 | P2 | **The database is a `db.t4g.micro` (1 GiB RAM, 20 GB gp3), single-AZ, deletion protection off.** Over the last 14 days RDS `FreeableMemory` fell to 47 MB, CPU peaked at 51% (credit balance never below 287), connections peaked at 10 (limit about 110 for this size). Fine for today's load; too small to claim 1,000+ concurrent students, and one instance failure means an outage until a restore | VERIFIED (CloudWatch, RDS settings) | Size up before any large exam; enable deletion protection; decide on Multi-AZ | Infrastructure and cost: yes |
| A2-18 | P2 | **Backup restore has never been proven, and the backup job is not under version control.** `/root/backup-db.sh` exists only on the host (modified 2026-09-29, its comments still mention Neon); ten dumps of 34 MB sit in `/root` "for restore test" and are never pruned; S3 has no versioning and a 30-day expiry; nothing shows a test restore into a scratch database. A backup that has not been restored is a hope, not a recovery plan | VERIFIED (host files, S3 settings) | Put the script in the repository, prune the host copies, run one documented restore drill into a temporary RDS instance (cost) | Restore drill and any infrastructure change: yes |
| A2-19 | P3 | **Host hygiene.** Root EBS volume is not encrypted (it holds `container.env` and the dumps); no swap; the backend container has no memory limit while the judge is allowed 3 GiB of a 3.8 GiB host, so a heavy judge load could get the API out-of-memory killed; 15 GB of old images and a large Docker build cache are reclaimable (disk 56% used). On the good side: IMDSv2 required, no pending security updates, both containers `restart=unless-stopped` with an init process, 18 days uptime, no uncaught-exception lines in the last 400 backend log lines | VERIFIED (host, read-only) | Set a backend memory limit and a smaller judge cap; prune images in the deploy script; plan an encrypted volume copy | Infrastructure change: yes |

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

1. ~~Read-only AWS check~~ **Done 2026-11-16** (section 7).
2. **Reproducible installs (A2-02):** regenerate lockfiles, `npm ci`, re-audit. CI proves it; deploy only on approval.
3. **Extended verification in CI (A2-03):** a second job, on a disposable database, that runs the 67 scripts that do not run today; classify each as keep, fix or retire.
4. **Per-role route matrix:** generate, for every one of the 678 routes, the expected outcome for each of Super Admin, Admin, Staff, Clerk, Student, and an institute-B user against institute-A ids; fail CI on any difference from a reviewed golden file. This turns the 180 "no institute guard" routes into evidence.
5. **Judge, other languages:** Java, C, C++, JavaScript: correctness, hidden cases never exposed, timeout, memory limit, output limit, concurrency, error text, on a Linux runner in CI.
6. **Tests for the modules with none by name (A2-04),** starting with attendance, placement offers, resume and talent pool.
7. **Small fixes:** A2-09, A2-10, A2-13, A2-15.
8. **Staging load test (A2-05)** once an isolated environment is approved.

Each group would be a separate commit on this branch with its own CI run; nothing is merged or deployed without explicit approval.

## 7. Read-only AWS and host findings (2026-11-16, VERIFIED)

Everything below was read with read-only calls (SSM command that prints no secrets, RDS/S3/EC2/CloudWatch describe and get calls). Nothing was changed.

| Item | Observation |
|---|---|
| Application host | EC2 `t3.medium`, ap-south-1a, Amazon Linux 2023, 2 vCPU, 3.8 GiB RAM, **no swap**, 40 GB gp3 (56% used, not encrypted), IMDSv2 required, unlimited CPU credits, uptime 18 days, no pending security updates |
| Containers | `codearena-backend` and `codearena-judge` (same image), `restart=unless-stopped`, init process, pids limit 512; judge memory cap 3 GiB, backend uncapped; idle: backend 179 MiB, judge 25 MiB, load average 0.00 |
| Runtime | Node 20.20.2; judge image: Python 3.11.2, OpenJDK 17.0.20, gcc and g++ 12.2.0 |
| Database | RDS PostgreSQL 18.6, `db.t4g.micro`, 20 GB gp3, encrypted, **not** publicly accessible, single-AZ, deletion protection off, SSL required from the app, 7-day backup retention, latest restorable time 6 minutes before the check |
| Database load, last 14 days | CPU peak 51% (mean of hourly peaks 7%), CPU credits never below 287, connections peak 10, **FreeableMemory minimum 47 MB**, free storage minimum 18 GB, read latency about 0 |
| Host load, last 14 days | CPU hourly peak 81%, mean of hourly peaks 2.3%, credit balance minimum 574 |
| Backups | RDS automated snapshots daily (18:20-18:50 UTC window) plus manual snapshots 2026-10-06 and 2026-10-28; host cron 20:00 UTC to S3 bucket `codearena-backups-640538431170` (AES256, public access blocked, 30-day expiry, no versioning, 32 objects); a daily 02:00 UTC health-check cron also runs |
| Secrets handling | The database URL used by the backup job is read from SSM Parameter Store (`--with-decryption`); the app reads its secrets from `/opt/codearena/container.env` (variable names checked, values never printed). Required names (`DATABASE_URL`, `JWT_SECRET`, `PII_ENCRYPTION_KEY`) are present |
| Logs | 0 uncaught-exception or unhandled-rejection lines and 0 database connection errors in the last 400 backend log lines |

What this changes: the October-era claim of no backups is superseded (A2-01); the dependency alarm from `npm audit` is a lockfile artefact for the backend (A2-02); capacity is limited more by the 1 GiB database and the 2-vCPU shared host than by code (A2-05, A2-17); the real remaining backup risk is that no restore was ever tested (A2-18).
