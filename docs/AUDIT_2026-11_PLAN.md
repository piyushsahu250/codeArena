# Full-repository audit, Phase 3: root causes and implementation plan (2026-11-16)

Branch `audit/full-2026-11`; CI runs on `ci/audit-2026-11`. Nothing here is merged to `main` or deployed. Findings are numbered as in `AUDIT_2026-11_PHASE2.md`.
Status words: **DONE (CI pending)** = committed on the audit branch, local checks pass, the pipeline has not finished; **NEXT** = repository-only work I can do without an approval; **APPROVAL** = needs your decision or an infrastructure change; **WITHDRAWN** = the finding was wrong.

## 1. Done on this branch (commits in order)

| Commit | Finding | Root cause | Change | Evidence |
|---|---|---|---|---|
| 0451b8b | A2-15 | The judge runs every program under GNU `/usr/bin/time`, which does not exist on Windows or macOS, so one regression test failed there with `spawn /usr/bin/time ENOENT` | The test skips (never fakes) when the tool is absent, as it already skipped without gcc | Backend unit tests locally: 756 tests, 709 pass, **0 fail**, 47 skipped (was 1 fail) |
| ef6083e | A2-10, A2-16 | `POST /auth/register` (a disabled stub) was the only public route with no rate limiter; the API document counted 394 endpoints and nothing stopped a new route from being public by accident | Limiter added. `scripts/routeInventory.js` scans all 678 route registrations; `test/routeGuards.test.js` + `snapshots/route-guards.json` fail the build if the set of public routes or of role-less signed-in routes changes, if a public route lacks a limiter, or if a route is declared twice. `docs/ROUTE_INVENTORY.md` is generated from it | New test passes (5/5); **proven to fail** when the register limiter is removed and when `authenticate` is removed from a route (both mutations reverted) |
| b27bedb | A2-02, A2-13 | The backend lockfile listed 124 packages and lacked about twenty direct dependencies (helmet, multer, canvas, the AWS SDK...), so every build resolved whatever was newest and CI could not reproduce what shipped | Both lockfiles regenerated with `npm install --package-lock-only`; CI backend, frontend, integration and SPA steps use `npm ci`; `qs` override raised from 6.16.0 to 6.16.1 (fixes three moderate advisories); `tesseract.js` pinned to `^7.0.0` (was `*`) | `npm ci --dry-run` accepts both locks. Lock versions equal production's (express 4.22.3, proxy-addr 2.0.8, xlsx 0.20.3, tesseract.js 7.0.0, pdfjs-dist 3.11.174); differences: multer 2.5.0 (prod 2.4.0), body-parser 1.20.9 (prod 1.20.8), qs 6.16.1. `npm audit` production: backend 3 left (October-accepted: `tar`/`node-pre-gyp` via `canvas` at install time, `pdfjs-dist` pinned and sandboxed), frontend 1 low (`katex`). Backend unit tests pass with the new lock |
| 44b76a9 | A2-09 | n/a | **Withdrawn**: resume uploads already check the extension, the PDF signature (bounded worker) and DOCX ZIP limits | Code read |
| (next commit) | A2-01, A2-12, A2-18 (docs part) | Backup documentation described the previous host; the job existed only on the server | `BACKUP_AND_RECOVERY.md` and `KNOWN_ISSUES.md` KI-006 updated to the verified AWS state; the host script copied to `scripts/aws/backup-db.sh` unchanged | Read-only AWS evidence in the Phase 2 report |

Not changed on purpose: the `Dockerfile` still runs `npm install` (it honors the lock when in sync). Switching it to `npm ci` is a deploy-path change; do it after the first deploy that uses the new locks. `xlsx` still comes from the SheetJS CDN tarball (the lock records its integrity hash); vendoring it is a larger change.

## 2. NEXT: repository-only work, no approval needed

| # | Finding | Root cause | Plan | How it is verified | Risk |
|---|---|---|---|---|---|
| N1 | A2-03 | 102 verification scripts were written for manual runs against a live API; only 35 are wired into CI, 67 are not (including every non-Python judge sandbox script, multi-institute and LMS institute isolation, test security, secure exam, resume and talent-pool flows) | Add an `extended-verification` workflow (manual and nightly) that runs the 67 on the disposable CI database, **non-blocking at first**, and prints a pass/fail table; then promote passing scripts into the blocking list and fix or retire the failing or stale ones | The first run is the evidence; each fix gets its own commit and CI run | Low: no product code |
| N2 | A2-04 | No test by name for Attendance, Placement offers, Resume, Talent pool, Practice, Challenges, Admin/backup | One integration test per module for its critical flow (create, role and institute isolation, the main rule), reusing the seeded CI fixtures. Start with Attendance (weakest), Placement offers, Resume | Each test must fail when its rule is broken (mutation check, as for the route guard test) | Low |
| N3 | Brief item 8 | Java, C, C++ and JavaScript were last verified by older scripts, outside CI | Fold the existing judge scripts into a Linux CI job: correctness, hidden cases never exposed in any response, time limit, memory limit, output limit, fork bomb, concurrency, error text | CI job output | Low |
| N4 | Brief item 7 | The route scan says what is guarded, not what each role actually receives | Generate, for every route of the inventory, a request per role (Super Admin, Admin, Staff, Clerk, Student) and per institute (A and B ids), compare the status with a reviewed table, run in CI against the seeded database | CI job; the table is the evidence | Medium: needs careful fixtures; read-only requests only |
| N5 | A2-11 | 23 unmerged branches | Read each branch's diff against `main`; recommend merge, rebase or delete with reasons (I will not delete anything) | A short table in the plan | None |
| N6 | A2-16, brief item 9 | `platform-manifest.json` says last code review 2026-08-08; several module docs predate the module refactor | Refresh the mechanical facts (route and model counts, dependency versions) | docs-sync already recomputes counts | None |

## 3. APPROVAL: needs your decision or an infrastructure change

| Finding | What it needs | Why I will not do it unasked |
|---|---|---|
| A2-17 database size, single-AZ, deletion protection | Resize `db.t4g.micro` (1 GiB; free memory dipped to 47 MB), enable deletion protection, decide on Multi-AZ | Changes a production database and its cost; resizing causes a restart |
| A2-18 restore never tested | A restore drill into a **temporary** RDS instance, timed and compared with production row counts, then deleted | Creates paid infrastructure |
| A2-19 host hygiene | Backend memory limit and a smaller judge cap, prune old images, encrypted volume copy, swap | Changes the production host and deploy script |
| A2-05 capacity (1,000 to 2,000 users) | An **isolated staging** copy (never production) with a seeded database, then ramped load against the API, the database pool and the judge | Paid environment; production must never be load tested |
| A2-06 | Exit the process after an uncaught exception so Docker restarts it clean | Changes runtime behaviour for every user |
| A2-07 (B-3), A2-08 (F-1), A2-14 | Product decisions: lock thresholds of a published exam (or version results); move the login token to httpOnly cookies with CSRF protection; interview bank isolation (KI-001), admin stats scoping (KI-003), UTC day boundaries (B-1), rounding (B-2), absence alerts (KI-002) | They change behaviour or need a design choice |
| Deploying anything | The audit branch is merged and deployed only on your explicit word, after green CI on that exact commit | Standing rule |

## 4. Order of work and stop points

1. Finish the pipeline on \`ci/audit-2026-11\` (all four jobs, now with \`npm ci\`).
2. N1 (extended verification run) first: it turns "unverified" into evidence for the most modules at the lowest risk.
3. N3, N2, N4 in that order, one commit and one CI run each.
4. N5, N6 alongside.
5. Stop and report before any merge. Every item in section 3 waits for you.
