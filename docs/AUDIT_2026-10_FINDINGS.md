# Platform audit tracker (2026-10)

Running record of the end-to-end audit. Status words are used strictly:
**PASS** = executed with evidence. **FAIL** = executed and failed. **BLOCKED** = could not run (reason given). **NOT RUN** = not attempted.
**FIXED, NOT VERIFIED** = code changed but the relevant check has not passed yet.

## Method and limits

* Static review of the source (routes, services, middleware, schema, frontend) plus the project's own CI as the only test runner. The audit workstation has no
  Node, so nothing can be run locally: every test in this document runs in GitHub Actions (`ci.yml`: lint, backend, frontend, integration).
* Production was not touched: no data changes, no load tests, no credentials rotated.
* NOT RUN so far: load/performance measurement, real-device and Caps Lock checks, accessibility scans beyond the existing `a11y.spec.js`, dependency-scan triage.
* This is not a claim that the platform is bug-free. It is a list of what was examined, what was found, and what was verified.

## Inventory scanned so far

| Area | Evidence | Status |
| --- | --- | --- |
| Route authentication (45 route files, ~400 endpoints) | Static scan of every `router.<verb>` for `authenticate`/`requireRole` | PASS (static): only login, register(disabled, 403), forgot/reset/verify, certificate verification and health are public |
| Self-service ownership (`/users/:id/performance*`) | `users.performance.service.js` `authorize()` | PASS (static): student self only; staff scoped to institute |
| Student documents (`studentDocuments.js`) | Full read | PASS (static) for ownership, institute scoping, mass assignment; see S-1/S-2 below |
| JWT, CORS, helmet, global rate limit, error handler | `index.js` | PASS (static); see L-2, L-3 |
| Raw SQL / eval | grep | PASS: no `$queryRawUnsafe`/`$executeRawUnsafe`; `child_process` only in backup (pg_dump), judge and resume OCR |
| HTML injection in the UI | `dangerouslySetInnerHTML` sites | PASS: lesson content is sanitised with DOMPurify; KaTeX runs with trust off |
| LMS content isolation (`learning.js`) | Read of the by-id reads | **FAIL then FIXED, PASS in CI** (A-1) |
| Staff-facing by-id routes in the other 44 route files | Heuristic scan, plus a manual read of ten handlers (attendance, challenges, staffClerk, interview, interviewDrafts, resume, resultManagement, placementOffers, companyQuestions, studentDocuments) | PASS (static, partial): each of those calls an institute-scope helper before acting; the helper bodies were read for studentDocuments, resultManagement and learning only. `learning.js` was the one route file with unscoped reads (A-1). Not every handler in every file was read |
| Exam submission integrity and idempotency (`submissions.service.js`, schema) | Read of submit/finalize and the constraints | PASS (static): unique `(attemptId, questionId)` and `(testId, studentId)`; answers replace rather than append; the answered question must belong to the attempt; finalise is an atomic claim so completion XP is granted once; deadline checks are server-side. Not load-tested |
| Spreadsheet exports (formula injection) | Read of every XLSX/CSV writer | **FAIL then FIXED, PASS in CI** (E-2); the other writers use `spreadsheetSafe` |

## Findings

### P1/P2 — authorization

**A-1 (P2, FIXED, VERIFIED in CI) Another institute's private course content was readable by id/slug.**
`GET /learning/lessons/:id` and `GET /learning/practice/:id` returned the full question data (correct answers, explanations, hidden test cases) to any
non-student account of any institute that knew the id, and `GET /learning/courses/:slug/modules/:moduleId/lessons` listed another institute's private lessons by
a guessable slug (e.g. `java`). Courses can be institute-owned (`Course.instituteId`, set when an institute admin authors one). The sibling `projects/:id/admin`
route already had an explicit IDOR guard; these three did not. Ids are UUIDs, so exploitation needed a known id, but the slug route needed nothing.
*Fix:* `canReadCourseContent` in `routes/learning.js`: own institute or global course, never another institute's; unscoped platform admins unchanged.
*Regression test:* `backend/scripts/verifyLmsContentIsolation.js` (added to the CI verification loop). Result: PASS in the integration job of CI run #888 (commit f0a8302, all four jobs green); the script checks the owner, a foreign institute (staff and institute admin), a student, an unscoped platform admin, and that global courses stay readable.

### P2/P3 — other

**A-2 (P2, FIXED, NOT VERIFIED) Staff could export results for tests they had no access to.** `GET /export/results` returned every test attempt in the institute (scores, student
names, e-mails, roll numbers, PRNs) to any STAFF account. The tests module's own rule is that staff see results only for tests they created or that were shared with them
(`utils/testOwnership.js`, enforced on every per-test results route); the export centre bypassed it. *Fix:* `staffTestAccessWhere(req)` applied to the export's query (admins unchanged).
*Test:* `backend/scripts/verifyStaffScopeIsolation.js` (owner, other staff, after sharing, institute admin, platform admin, other institute).

**A-3 (P3, FIXED, NOT VERIFIED) Staff search matched every institute's course names.** In `routes/search.js` the staff/legacy-admin branch searched `course` with no institute filter,
so a staff account could discover another institute's private and draft course names and slugs. The admin-tier branch of the same file already scoped it. *Fix:* the same
own-or-assigned filter. *Test:* the same script.

**E-2 (P2, FIXED, VERIFIED in CI) Spreadsheet formula injection in the audit-log CSV and the result-entry template.**
`auditCsv` (`modules/users/users.domain.js`) quoted each value but did not neutralise a leading `=`, `+`, `-` or `@`. Its Device column is the login request's
`User-Agent` header, which any user controls, so a crafted header such as `=HYPERLINK(...)` became a live formula when an administrator opened the export in
Excel. The result-entry template (`routes/resultManagement.js`) wrote student and institute names the same way. Other exports already use `utils/spreadsheetSafe.js`.
*Fix:* `safeCell` applied to every audit CSV value and to the two template name cells. *Test:* `backend/test/spreadsheetFormulaSafety.test.js` (unit, CI backend job).

**E-3 (P3, FIXED, VERIFIED in CI) The audit-log CSV doubled the quotes of its Details column twice,** so the JSON inside the cell could not be parsed back (`""""title""""`).
The contract snapshot had pinned the broken output. *Fix:* quotes are doubled once; `users-contract.json` updated for the one affected line. *Test:* the same unit test
reads Details back as JSON.

**S-1 (P2, FIXED, NOT VERIFIED) SSRF guard on the document download proxy has a DNS-rebinding gap.** `utils/safeFetch.js` resolves the host, checks the IP, then calls `fetch`,
which resolves again. A hostile DNS server can answer a public address first and a private one second. Exposure is limited (the link is student-supplied, the
fetch is triggered by staff, the response goes to the staff member), and whether the EC2 metadata endpoint is reachable depends on IMDSv2 settings (not checked).
*Proposed fix:* connect to the validated IP (pinned `lookup`), keep the Host/SNI. Needs its own tests; not done in this batch.

**S-2 (P3, FIXED, NOT VERIFIED) The same proxy has no response-size or total-time limit.** The 20 s timeout is cleared once the headers arrive; the body then streams without a
cap. A staff member downloading a hostile link could tie up a connection or bandwidth. *Proposed fix:* cap bytes and abort after a total time.

**E-1 (P3, FIXED, NOT VERIFIED) About 25 transactional e-mails put names and titles into HTML without escaping** (`<p>Hi ${user.name}`, test titles, pool names; see
`auth.service.js`, `tests.service.js`, `utils/notifications.js`, `users.account.service.js`, `routes/admin.js` custom messages). Only privileged users author these
values, but a crafted title could inject links into mail sent to students. *Proposed fix:* escape at interpolation (the mailer already has `escapeHtml`).

**L-2 (P3, OPEN) `/api/health/deep` is public** and reveals which optional services are configured and which required environment variable names are missing.
No secret values. *Proposed fix:* keep `/api/health` public, require a platform admin or a shared header for `/deep` (check what monitors call it first).

**L-3 (P2, OPEN) `uncaughtException` and `unhandledRejection` are logged and the process keeps running.** After an uncaught exception Node's state can be
inconsistent; the usual guidance is to exit and let the supervisor restart. *Proposed change:* exit after logging (the container already restarts). Needs a decision
because it changes failure behaviour under load.

### Test-infrastructure findings

**T-1 (P2, FIXED in release 8123378) A flaky browser test** (resume after reload) read the wrong question half the time because question order is shuffled per attempt.

**T-2 (P2, FIXED, pending the strict CI run) Two isolation scripts were never run by CI.** `verifyTenantIsolation.js` and `verifyRoleIsolation.js` document earlier audit fixes
(leaderboard scopes, role isolation) but no pipeline ran them, so those fixes had no regression protection. They ran once as an observe-only final step with no
failure reported; the step is now a hard gate, so the next CI run is the proof.

## Next batches (not started)

1. Institute isolation sweep of the remaining by-id reads: `attendance.js`, `talentPools.js`, `placementOffers.js`, `subjects.js`, `challenges.js`, `readiness.js`,
   `resultManagement.js`, `moduleCoding.js`, `interviewDrafts.js`, `exports.js`, `search.js`, `backup.js`.
2. Exports and bulk imports (formula injection in CSV/XLSX cells, size limits).
3. Uploads (`multer` limits, type checks), resume OCR sandbox.
4. Score and total consistency between UI, API and database for tests and module coding.
5. Frontend: bundle size and route splitting (measure with `vite build`), unhandled error boundaries, accessibility on the main role dashboards.
6. Load test plan (scripts exist under `backend/scripts/loadTest*.js`; running them needs an isolated staging environment, BLOCKED until one is approved).

## Dependencies

**D-1 (P3, FIXED, VERIFIED only for behaviour) `multer` 1.4.5-lts (the 1.x line) has published denial-of-service advisories fixed in 2.0.x** (malformed multipart bodies). Every upload
route is behind authentication, so it needs a logged-in account, but a bulk-upload endpoint is exactly what an exam-day abuser would hit. `package.json` now asks for
`^2.0.2`; the lockfile does not track `multer` (it has drifted, which CI already works around with `npm install`), so the deployed version is whatever the range resolves to
at image build. The API used here (`memoryStorage`, `single`, `fields`, `LIMIT_FILE_SIZE`, `MulterError`) is unchanged in 2.x. *Verification:* the upload contract scripts in
CI (`verifyQuestionImportExportContract`, `verifyUsersWriteContract`) and the browser suite. *Confirm with:* the report-only `npm audit` step on the next CI run (not readable without a
GitHub sign-in from this workstation, so I have not seen the advisory list; this finding rests on the published advisories as I recall them and should be checked against that report).

## Needs a product decision (not changed)

**B-1 (P3, OPEN, decision needed) Streak and daily-challenge day boundaries are UTC, not Indian time.** `routes/gamification.js`, `routes/dashboard.js` and
`modules/studentDashboard/studentDashboard.service.js` each carry their own copy of the streak rule using the server's local midnight, and the container runs with no `TZ`, so
that midnight is 05:30 IST. `routes/challenges.js` (`dayStart`, `isoWeekStart`) uses UTC midnight for "today's" daily challenge and the week start. Effects for an Indian student
body: the new daily challenge appears at 05:30 IST rather than midnight; two sessions on the same IST day that straddle 05:30 can count as two streak days; the streak can
look broken for someone who studies late at night. `modules/staffAnalytics` already uses `Asia/Kolkata` explicitly, so the platform has no single answer. This changes who holds a live
streak and when challenges roll over, so it is a rule change: I have not touched it. *Options:* (a) keep UTC and say so on the page, (b) move all three streak copies and the challenge
day to IST behind one shared helper (also removes the triplicated logic). Needs your choice before any data-affecting change.

## Reliability

**R-1 (P2, PARTLY FIXED, NOT VERIFIED) `GET /api/backup/database` buffers the entire `pg_dump` output in memory and has no one-at-a-time guard.** (`routes/backup.js`) As the database grows (code
submissions, audit and email logs), one click holds the whole dump in the API process's heap, and several clicks run several dumps at once; either can exhaust memory or CPU on the single
host that also serves exam traffic. The role gate is correct (platform-level admin only, institute admins refused) and every download is audit-logged.
*Proposed change:* a single-flight lock (second request gets 409/429), a size ceiling that aborts the dump with a clear error, and ideally scheduled server-side backups to private storage instead of
browser downloads. Trade-off to decide: the code buffers on purpose so a mid-dump failure never gives a truncated file; streaming would need a checksum or trailer for the same guarantee.

**R-2 (P3, FIXED, NOT VERIFIED) The `pg_dump` child inherits the whole server environment** (`env: { ...process.env, PGPASSWORD, ... }`), including the JWT secret and API keys it has no use for.
Pass only `PATH`, `HOME` and the `PG*` variables.

## Dependency triage (npm audit, production dependencies; CI run on 975250e)

The audit output used to sit behind a GitHub sign-in; CI now publishes it as an annotation (`backend/scripts/auditSummary.js`). Result: backend critical 2, high 4, moderate 3,
low 1; frontend high 4, moderate 6, low 1. Triage below separates what the application can actually reach from what it cannot. "Fixed" means a patched release exists on the npm
registry (checked) and this branch moves to it; it does not mean exercised in production.

| Package (where) | Severity | Reachable here? | Disposition |
| --- | --- | --- | --- |
| `adm-zip` (backend, direct): crafted ZIP allocates GBs; understated declared size | HIGH | **Yes.** The question-import images ZIP is uploaded by staff and extracted in memory (`utils/bulkImageZip.js`), and the code trusted the declared size | **Fixed**: `^0.6.1`, and extraction now inflates with a hard output ceiling and counts real bytes. Test: `backend/test/bulkImageZipBounds.test.js` |
| `dompurify` (frontend, direct): XSS bypasses | MODERATE (4 advisories) | **Yes.** `LessonView` sanitises admin-authored lesson HTML for students with it | **Fixed**: `^3.4.17`, and an `overrides` entry (`$dompurify`) so the copy Monaco depends on resolves to the same patched release |
| `proxy-addr` (backend, via express): IP spoofing via IPv4-mapped IPv6 trust *subnet* | CRITICAL | Not as configured: `trust proxy` is a hop count (`TRUST_PROXY_HOPS`, default 1), not a subnet list | **Fixed anyway**: `overrides` `^2.0.8`, express `^4.22.3` |
| `body-parser` (via express): an invalid `limit` value silently disables the cap | LOW | No: `express.json({ limit: "1mb" })` is valid | **Fixed anyway**: `overrides` `^1.20.8` |
| `axios` (frontend, direct): prototype-pollution gadgets, Node-side ReDoS | HIGH | Browser use only; the gadgets need a pollution source and the ReDoS path is Node-only | **Fixed**: `^1.20.0`. `follow-redirects` (Node-only, transitive) is not reachable in a browser; pinned to `^1.16.1` by an `overrides` entry anyway |
| `react-router(-dom)` (frontend): RSC-mode CSRF bypass | HIGH | No: the app is a client-side SPA, not RSC mode | **Fixed**: `^7.18.4` |
| `tar`, `@mapbox/node-pre-gyp`, `canvas` 2.x (backend): arbitrary file overwrite when extracting a hostile tarball | CRITICAL/HIGH | Install time only (`canvas` downloads its prebuilt binary); nothing extracts an untrusted tar at runtime | **Accepted**. Real fix is `canvas` 3.x (major); it is used by the PDF/OCR render worker, so it needs its own validation pass. Not changed |
| `pdfjs-dist` 3.11.174 (backend, pinned): script execution on a malicious PDF | HIGH | Only inside the sandboxed PDF-render/OCR worker, which `utils/resumeOcr.js` documents as running under the unprivileged sandbox user with resource limits | **Accepted, documented risk.** Newer releases are ESM-only (major change). Revisit with the OCR worker |
| `mammoth` / `argparse` / `sprintf-js`, `@tensorflow/tfjs` (via argparse) | MODERATE | No: the DoS needs an attacker-controlled format string; neither library formats document text | **Accepted** |
| `katex` (frontend, direct): bypass of its `trust` restrictions | LOW | No: `trust` is off (`MathText.jsx`) | **Accepted** (fix is a major release) |

Not verified: whether production's image resolved the same versions as CI (the lockfiles do not track every package); the host's own `npm audit` could not be read because the AWS deploy role's
MFA window had lapsed. The CI numbers use the same `npm install` resolution as the Dockerfile.

**Before and after (CI annotations, same `npm install` resolution as the Dockerfile):**

| | critical | high | moderate | low |
| --- | --- | --- | --- | --- |
| Backend before (975250e) | 2 | 4 | 3 | 1 |
| Backend after (306984a) | 1 (`tar`, install-time only) | 3 (`node-pre-gyp`, `canvas`, `pdfjs-dist`) | 3 (`mammoth` chain) | 0 |
| Frontend before | 0 | 4 | 6 | 1 |
| Frontend after | 0 | 0 | 3 (`tfjs` chain) | 1 (`katex`) |

Everything left is in the "Accepted" rows above, with the reason. Verification: all four CI jobs passed on 306984a (unit tests including the new ZIP tests, production build, database-backed scripts, browser suite
and the tenant/role isolation gate). Not verified: behaviour on the production host after deploy.

## Batch 3 changes (branch ci/audit-batch-3)

* **A-2, A-3** (staff export and search scope): see their entries above. Test: `backend/scripts/verifyStaffScopeIsolation.js`, added to the CI verification loop.
* **S-1, S-2** (document-download proxy): `utils/safeFetch.js` now resolves each hop once, checks every returned address, and connects to that same address (a pinned `lookup`), so a second DNS answer is never
  consulted. It also caps the body at 25 MB and the whole download at 60 s (the old 20 s limit ended when the headers arrived), and blocks more reserved ranges (NAT64, 6to4, benchmarking,
  documentation, IPv4-embedded IPv6 in hex form). `routes/studentDocuments.js` streams with `pipeline` so a mid-stream error ends the response. Test: `backend/test/safeFetch.test.js` (local server,
  injected resolver: pinning, one lookup per hop, redirect re-validation, byte and time ceilings, the address table).
* **E-1** (e-mail HTML): every user-supplied value on an HTML e-mail line goes through `escapeHtml` (names, test, pool and course titles, document labels and remarks, the admin broadcast message, the device
  summary). Test: `backend/test/emailEscaping.test.js` (the helper, and a source scan that fails if an unescaped interpolation returns). Behaviour change to know about: the admin broadcast message is now treated
  as plain text, so any HTML typed into it is shown literally rather than rendered.
* **R-1 (partly), R-2** (`routes/backup.js`): one dump at a time (a second request gets 429), a memory ceiling (`BACKUP_MAX_BYTES`, default 1 GiB, then 413), the dump stops if the client disconnects, stderr is capped,
  and `pg_dump` receives only `PATH`, `LANG`, `HOME` and the `PG*` variables. Not done: streaming or scheduled server-side backups (needs a decision). Not verified: no automated test (CI has no matching `pg_dump`),
  so this one is checked by review only.
