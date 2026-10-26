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

**A-2 (P2, FIXED, VERIFIED in CI) Staff could export results for tests they had no access to.** `GET /export/results` returned every test attempt in the institute (scores, student
names, e-mails, roll numbers, PRNs) to any STAFF account. The tests module's own rule is that staff see results only for tests they created or that were shared with them
(`utils/testOwnership.js`, enforced on every per-test results route); the export centre bypassed it. *Fix:* `staffTestAccessWhere(req)` applied to the export's query (admins unchanged).
*Test:* `backend/scripts/verifyStaffScopeIsolation.js` (owner, other staff, after sharing, institute admin, platform admin, other institute).

**A-3 (P3, FIXED, VERIFIED in CI) Staff search matched every institute's course names.** In `routes/search.js` the staff/legacy-admin branch searched `course` with no institute filter,
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

**S-1 (P2, FIXED, VERIFIED by unit tests) SSRF guard on the document download proxy has a DNS-rebinding gap.** `utils/safeFetch.js` resolves the host, checks the IP, then calls `fetch`,
which resolves again. A hostile DNS server can answer a public address first and a private one second. Exposure is limited (the link is student-supplied, the
fetch is triggered by staff, the response goes to the staff member), and whether the EC2 metadata endpoint is reachable depends on IMDSv2 settings (not checked).
*Proposed fix:* connect to the validated IP (pinned `lookup`), keep the Host/SNI. Needs its own tests; not done in this batch.

**S-2 (P3, FIXED, VERIFIED by unit tests) The same proxy has no response-size or total-time limit.** The 20 s timeout is cleared once the headers arrive; the body then streams without a
cap. A staff member downloading a hostile link could tie up a connection or bandwidth. *Proposed fix:* cap bytes and abort after a total time.

**E-1 (P3, FIXED, VERIFIED by unit tests) About 25 transactional e-mails put names and titles into HTML without escaping** (`<p>Hi ${user.name}`, test titles, pool names; see
`auth.service.js`, `tests.service.js`, `utils/notifications.js`, `users.account.service.js`, `routes/admin.js` custom messages). Only privileged users author these
values, but a crafted title could inject links into mail sent to students. *Proposed fix:* escape at interpolation (the mailer already has `escapeHtml`).

**L-2 (P3, FIXED, NOT VERIFIED) `/api/health/deep` is public** and reveals which optional services are configured and which required environment variable names are missing.
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

Verification of batch 3: all four CI jobs passed on 4af5b8d (unit tests including `safeFetch.test.js`, `emailEscaping.test.js`; the database-backed loop including `verifyStaffScopeIsolation`; the browser suite;
the tenant/role isolation gate). Not verified by any test: the backup-endpoint changes (R-1, R-2) and the document download against a real remote file.

## Batch 4 changes (branch ci/audit-batch-4): imports and health

**I-1 (P2, FIXED, NOT VERIFIED until CI) Spreadsheet uploads had no decompression or row limit.** Eight upload endpoints (bulk users, bulk questions x2, attendance, interview questions, module-coding
questions, result entry, talent pools) called `XLSX.read(buffer)` directly. An `.xlsx` is a ZIP of XML, so an upload under the 5 MB multer limit can describe gigabytes of cells, and the library inflates all of
it into memory inside the API process that also serves exam traffic. All eight now go through `utils/safeWorkbook.js`: every ZIP part is inflated with a hard ceiling (64 MB per part, 200 MB total, sizes the
header declares are not trusted), and a sheet over 50,000 rows is refused outright rather than truncated silently. Test: `backend/test/safeWorkbook.test.js` (ordinary files, CSV, row cap, oversize part, a bomb whose headers
lie, total cap).

**I-2 (P3, FIXED, NOT VERIFIED until CI) The bulk-student confirm step trusted its rows.** `confirm` re-validates the rows in the request body but did not normalise them as the file parser does. Effects: a mixed-case
e-mail ("Foo@X.com") passed the duplicate check against an existing "foo@x.com" (validation compares lower-case values); extra keys rode along; an omitted `isActive` created an account with status INACTIVE but the
active flag still true. Role was already hard-coded to STUDENT and the institute is derived server-side, so there was no privilege escalation. *Fix:* `normalizeConfirmRow` (trim, lower-case e-mail, known columns
only, length caps, explicit isActive). Test: `backend/test/bulkConfirmRows.test.js`.

**L-2 (above) fixed:** `/api/health/deep` returns only `status` and `checkedAt` unless the caller sends the `HEALTH_DEEP_TOKEN` secret in `X-Health-Token`; it has its own per-IP limit (30/min) because it was
mounted before the global limiter and runs a database query per call. Nothing in the repository called it; if an external monitor needs the detail it must send the token (set `HEALTH_DEEP_TOKEN` on the host).
Test: `backend/scripts/verifyDeepHealth.js` (CI verification loop).

**Accessibility visibility:** the existing axe scan (five dashboards) fails the build on critical issues only and printed "serious" ones to a log that needs a sign-in. CI now publishes them as one warning annotation
(report only). No accessibility defects are claimed fixed; the first annotation is the baseline to work from.

## Batch 5 changes (branch ci/audit-batch-5): results integrity and accessibility

**V-1 (P2, FIXED, VERIFIED by unit tests) Examination thresholds were validated on create but not on edit** (`routes/resultManagement.js`). Creating checked only "total marks > 0". `PATCH /admin/examinations/:id`
coerced the values to numbers and recomputed every entry, so an edit could set total marks to 0, negative or NaN, a passing percentage of 150 or -5, passing marks above the total, or lower the total below marks already
entered, which stored (and, for a published examination, published) a percentage over 100. *Fix:* `utils/resultThresholds.js` `validateExamThresholds`, used by create and by edit; edit also refuses a total below the
highest PRESENT mark already entered and names it. Test: `backend/test/resultThresholds.test.js`. Mark entry, update and import already enforced `0 <= marks <= total` (read, not changed).

**B-2 (P3, OPEN, decision needed) Pass/fail is decided on the unrounded percentage, but the stored and displayed percentage is rounded to two decimals** (`computeResult`). With fractional marks, 39.996% fails a 40% pass mark
while the marksheet shows "40.00%". Deciding on the rounded value would be consistent with what students see but would pass a borderline score the current rule fails: a scoring rule, so unchanged.

**B-3 (P2, OPEN, decision needed) Editing thresholds of a PUBLISHED examination silently rewrites students' published pass/fail, grade and tag.** The edit recomputes every entry and is audit-logged
(`thresholdsChanged`), but nothing restricts it once results are published, although the module's own spec comment asks for restrictions on changes to published results. Options: (a) keep as is, (b) block threshold edits
once published (unpublish first), (c) allow with an explicit confirmation and a notification to affected students. Not changed.

**U-1 (P2, FIXED, VERIFIED in CI) Colour contrast of the sidebar footer on every dashboard** (axe, serious): "Powered by ..." used `--ink-dim` (the light-page dim colour) at 65% opacity on the dark sidebar,
contrast 1.77:1 (AA needs 4.5:1). Now `--chalk-dim`, the secondary colour made for that background (about 7.5:1). The CI annotation from the previous batch named the element
(`aside > div:nth-child(2)`), so this was found from evidence, not by guessing.

Verification of batch 5: all four CI jobs passed on 667d0fe. The accessibility annotation that listed one serious finding on each of the five dashboards no longer appears in that run, so the axe scan now reports
none; the scan therefore fails the build on serious findings as well as critical ones (the five scanned dashboards only: other screens are not covered by it). V-1 is verified by unit tests of the validator; the edit
route itself is not exercised by a database-backed test.

## Batch 6 changes (branch ci/audit-batch-6): messaging, AI quota, accessibility

The evidence for this batch is read-only queries against production on 2026-10-22 (AI usage log and e-mail log; no data was changed) plus the code. Nothing below has run in CI or production yet, so every
status is FIXED, NOT VERIFIED until the CI result is added at the end of this section.

**Q-1 (P3, FIXED, VERIFIED in CI and deployed; the cap itself not observed in production) AI usage had no per-user cap, and bookkeeping rows were counted as calls.** `services/ai/rateLimits.js` had an institute budget (300 a day) and a platform budget (2,000 a day) but
nothing per person; the only per-person limit is 5 calls a minute on each route. At that rate one account can use an institute's whole day in about an hour, and a handful of accounts the platform's, leaving every
other student without AI. Separately, `INVALID_RESPONSE` rows (bookkeeping written when a response that did arrive fails our own validation) were counted as calls although the provider call already has its own row,
so a spell of unusable output used each quota slot twice. *Fix:* a per-user cap (`AI_DAILY_LIMIT_PER_USER`, default 100 per UTC day; the 101st call gets the existing 429 `AI_QUOTA_EXCEEDED` with "You have reached
your daily AI usage limit. Please try again tomorrow."), and `INVALID_RESPONSE` rows no longer count. *Why 100:* the busiest user-day on the production record since August was 34 calls, so nobody who used it
before is blocked. *Tests:* `backend/test/aiQuota.test.js` (decision order and boundaries); `backend/scripts/verifyAiQuota.js` (the real table: one below the cap, at the cap, other users unaffected, failed
calls count, invalid-response rows and two-day-old rows do not).

**M-1 (P2, FIXED, VERIFIED in CI and deployed; not observed in production) `POST /admin/announcements` accepted any size and any type.** A non-text `message` crashed the handler (500), there was no length cap, and nothing limited how often one admin
could broadcast to a whole institute (an in-app notification per recipient, optionally an e-mail each). *Fix:* message at most 2,000 and subject at most 150 characters, non-text is a 400, and 5 accepted announcements per
admin per hour (`ANNOUNCEMENTS_PER_HOUR`; a refused request, such as a typo, does not use the allowance); the form has matching `maxLength`. Test: `backend/scripts/verifyMessagingGuards.js`.

**M-2 (P2/P3, FIXED, VERIFIED in CI and deployed; not observed in production) `POST /tests/:id/notify` could e-mail the same test to all its students again and again, and its idempotency key was not tied to a test.** The key stopped only a double
click: with a fresh key each press sent another full round from the shared mail allowance. The key was also looked up without checking the test, so a key replayed against a different test answered "already sent"
with the other test's counts and skipped the real send (P3: it needs a repeated client key). *Fix:* an e-mail notification for a test is refused with 429 for `TEST_EMAIL_NOTIFY_COOLDOWN_MIN` (default 10)
minutes after the last one (in-app notifications stay allowed); a key that belongs to another test is a 409; the same key for the same test still returns the original "already sent" answer. Test:
`backend/scripts/verifyMessagingGuards.js`.

**N-1 (P2, FIXED, VERIFIED by unit tests in CI and in the production image; not observed under a real bulk send) Bulk notices started one e-mail per person all at once.** Course and readiness-test assignments (and the opt-in e-mail forms of test and talent-pool assessment assignments),
talent-pool add and remove, and the publishing of a result examination (in chunks of 15) sent one e-mail per person with no bound, built on `Promise.all(people.map(...))`. Assigning one course to an institute
starts one send per student at the same moment: for example 3,000 simultaneous sends and 3,000 log rows through one Gmail account. The same burst pattern is what tripped the provider's login throttle on
2026-10-06 (a 219-student credentials batch and its resend; 352 credential e-mails failed), and while the throttle is active every send fails, password-reset e-mails included. Stuck PENDING rows (N-3) are the other
visible result of a restart in the middle of such a burst. The talent-pool and result-publish ones also ran inside the HTTP request. *Fix:* `emailEach` and `notifyInBackground` in `utils/notifications.js` (5 in flight,
`EMAIL_CONCURRENCY`); the talent-pool and result-publish fan-outs now run after the response; a bulk course assignment handles one course at a time. Test: `backend/test/emailFanout.test.js` (peak concurrency
never above the bound, order kept, one failure does not stop the rest, and a source scan that fails the build if `Promise.all(list.map(... send ...))` or `forEach(... send ...)` comes back).
The talent-pool "assessment assigned" and "mock interview assigned" notices are in-app only (`sendEmail` defaults to false), so they were left as they are.

**N-2 (P2, FIXED, VERIFIED in CI and deployed; the allowance refusing an e-mail not observed in production) Critical e-mail had no protection from bulk e-mail.** Everything leaves through one provider account with a daily allowance (about 1,900 delivered in one day, and its
"daily sending limit" error has fired on quieter days after a flood), so bulk notices and password-reset or credential e-mails draw on the same allowance. *Fix:* a rolling 24-hour allowance for non-critical e-mail (`BULK_EMAIL_DAILY_BUDGET`, default 1,400; 0 turns it off). The types
`PASSWORD_RESET`, `PASSWORD_RESET_BY_ADMIN`, `CREDENTIALS`, `CREDENTIALS_RESEND` and `EMAIL_VERIFICATION` never count against it and are never refused by it. Once it is used up a non-critical e-mail is not
attempted: its log row is written FAILED with the reason, so it is visible and can be retried, and the in-app notification is unaffected. The check fails open if the count cannot be read.
*1,400 is a policy number, not a measurement of the provider's limit; please confirm or change it.* **Behaviour change:** after 1,400 non-critical e-mails in 24 hours (login alerts, announcements,
assignment notices) further ones are logged FAILED instead of sent. Tests: `backend/test/emailFanout.test.js` (decision logic against a fake database) and `backend/scripts/verifyEmailProtection.js` (the real
table: the last allowed e-mail, the first refused, critical types attempted at the limit, credential, over-24-hour and FAILED rows not counted). No e-mail is sent by either: every send uses an invalid address.

**N-3 (P3, FIXED, VERIFIED in CI and in production: the first sweep changed exactly the 2,768 rows predicted) E-mail rows stuck PENDING for ever.** A log row is created PENDING just before the send; if the server restarts mid-send nothing ever updates it. Production holds 2,768 such
rows from one restart on 2026-10-07, still shown as pending weeks later, which also makes any "is mail working?" view misleading. *Fix:* `sweepStalePendingEmails`, run from
`utils/emailRetryScheduler.js` two minutes after start and every 10 minutes after that (`DISABLE_STALE_EMAIL_SWEEP=true` turns it off; `MAIL_STALE_PENDING_MS`, default 30 minutes, sets the age), marks PENDING
rows older than 30 minutes FAILED with "Not sent: the server restarted, or the send was interrupted, before this e-mail went out. It can be retried from Email Logs." Nothing else on the row changes.
**Deployment note, a production data change:** the first run after deploy will mark those roughly 2,768 historical rows FAILED. That is their true state, but it is a write to production data, so it needs an
explicit OK as part of the deploy approval (or deploy with `DISABLE_STALE_EMAIL_SWEEP=true` and enable it later). Rows stuck in RETRYING (a manual retry interrupted by a restart) are not swept; I did not look
for any. Tests: `emailFanout.test.js` (the query it issues) and `verifyEmailProtection.js` (the real table: only the old PENDING row changes; fresh PENDING, SENT and FAILED rows are untouched; a second sweep
changes nothing).

**U-2 (P3, FIXED, VERIFIED in CI: the sign-in page is in the accessibility gate in both themes and passes) Login page footer contrast.** The "Powered by Acrosoft..." line used `--ink-dim` at 75% opacity, about 3.1:1 on the light page by calculation (AA needs 4.5:1). The opacity is gone.
This was found by reading the style, not by a scan: the public pages had not been scanned.

**Accessibility coverage (report only).** `frontend/e2e/tests/a11yExtended.spec.js` scans 23 public pages in light mode, four of them also in dark mode, and the five dashboards in dark mode (32 scans), and
prints every serious or critical axe finding; CI publishes them as one warning annotation. It cannot fail the build. The first annotation is the baseline; nothing is claimed about those pages until it has been read.

**Observed, not changed (decisions for you).** (1) `OTHER_SYSTEM_EMAIL` is the type of both the "your password was changed" security notice (`modules/auth/auth.service.js`) and the admin test e-mail, so the
notice cannot be exempted from the allowance without a new type, and the auth contract snapshot lists the existing one. (2) `LOGIN_ALERT` (first login, new device) counts as non-critical, so a large first-login
day can use part of the allowance; say if any of these should be critical. (3) One Gmail account stays the ceiling; Amazon SES remains the earlier recommendation.

**U-3 (P2, FIXED, VERIFIED in CI: all 23 public pages pass the accessibility gate in light mode; see batch 8) Public pages failed colour contrast.** The scan added in batch 6 (23 public pages in light mode, four in dark mode, five dashboards in dark mode) first produced a
baseline on 92b5018 that the annotation limit cut off after about a dozen findings; batch 7 split the report into parts so that every finding is visible. The complete list was 17 serious colour-contrast findings on 17 public
pages in light mode, and none listed for the dark-mode runs or the dashboards, in four colour combinations: the marketing eyebrow label (gold #c7852a on dark green #123528, 9 pt) at 4.35:1 on every marketing page; inline
links (green #4f9d6e on cream #fbf9f4, 11.6 to 12.8 pt) at 3.12:1 on `/about`, `/coding-challenges`, `/coding-platform`, `/contact`, `/employability-readiness`, `/for-institutions` and `/lms`; gold links (#c7852a on
#fbf9f4, 10.5 pt) at 2.92:1 on `/login` and `/forgot-password`; gold track pills (#c7852a on #f9efde, 9 pt) at 2.7:1 on `/ai-mock-interview`. AA needs 4.5:1 for text this size. *Cause:* the accent FILL colours had been
used as TEXT colours. The "none listed for dark mode" turned out to be a limit of what the scan could see, not a clean result: see batch 8 for that and for the fix.

**Deployment and verification of batch 6.** All four CI jobs passed on 92b5018 (lint; backend with the new unit tests; frontend; integration with `verifyEmailProtection`, `verifyMessagingGuards`, `verifyAiQuota` and the
browser suite). It was merged to `main` by fast-forward and deployed on 2026-10-22 (container started 18:11 UTC). Checked on the live host afterwards: `/api/health` reports 92b5018; both containers are running with 0
restarts; 0 error lines in the application log; the running code carries the new settings (allowance 1,400, five critical types, AI cap 100); the 33 unit tests of this batch pass inside the production image; unauthenticated
requests to protected routes return 401. The schema guard found no destructive change (only the nine trigram-index lines it ignores by design; batch 6 has no schema change). The sweeper's first run, about two minutes after
start, changed exactly the 2,768 rows predicted beforehand (all created 2026-10-07: COURSE_ASSIGNED 1,925, LOGIN_ALERT 843); PENDING rows older than 30 minutes are now 0, SENT is unchanged at 11,486 and no other row carries
the sweeper's message. Rollback image: `codearena-backend:rollback-20261022181042`. **Not verified in production:** the allowance refusing an e-mail, the announcement limiter and the test-notify cooldown (covered by the
database-backed CI scripts only); main's own re-run of the integration job was still running when this was written (the identical commit had passed all four jobs on its branch run).

**Calibration of the allowance (production, read-only, 2026-10-22).** In the last 60 days non-critical e-mail stayed under 1,400 in every rolling 24 hours except two spells: the busiest rolling 24 hours of e-mail that was
actually sent (leaving out the 2,768 orphans) was 1,970 (ending 2026-10-11 07:00), and 2026-10-07 had about 1,700 once the orphans are removed; both were mass course-assignment and first-login floods (COURSE_ASSIGNED and
LOGIN_ALERT). The next busiest day had 904. On a day like 2026-10-10 the allowance now refuses roughly the last 570 notices (logged FAILED with the reason; in-app notices are unaffected). AI: the busiest user-day since August
is 33 calls under the new counting (34 counting every row), the busiest institute-day 37 and the busiest platform-day 39, far below the caps of 100, 300 and 2,000.

## Batch 7 changes (branch ci/audit-batch-7): resume upload bounds, bundle-size report

**R-3 (P2, FIXED, VERIFIED in CI and in production: a 41 KB .docx that inflates to 40 MB is refused in 18 ms) The student resume upload unpacked a `.docx` with no limit.** After batch 4 every spreadsheet upload went through `safeWorkbook.js`, but `POST /resume/me/upload`
(any STUDENT account, 10 MB limit) still handed the file straight to `mammoth`, which unpacks every part of the ZIP into memory inside the API process (twice, because `extractRawText` and `convertToHtml` run in
parallel). A `.docx` is a ZIP, so a few kilobytes of upload can describe gigabytes of XML; a hostile account could exhaust the memory of the process that also serves exam traffic. Students are the largest group of
accounts on the platform, so this is the most reachable of the unbounded readers. `mammoth` was the only one left (a search of `backend/src` for ZIP-based readers: `safeWorkbook.js`, `bulkImageZip.js` and the
resume parser). *Fix:* the archive check moved to a shared `utils/safeZip.js` (`checkZip`: every part is inflated with a hard output ceiling and the sizes the headers declare are never trusted);
`safeWorkbook.js` now calls it with its own limits and unchanged messages, and `utils/resumeParser.js` calls it before mammoth with 32 MB per part, 64 MB in total and 2,000 parts (a real resume's `document.xml` is
well under 2 MB). A file the check cannot open at all is refused with a plain message rather than being left to mammoth. *Tests:* `backend/test/safeZip.test.js` (the check with small limits: ordinary file, part over the
ceiling, total over the ceiling, too many parts, not an archive, a bomb whose headers understate its size; and the resume path: an ordinary generated `.docx` still reads, a 33 MB-of-spaces `.docx` of under
1 MB is refused promptly, and so is one with understated headers); `safeWorkbook.test.js` is unchanged and still covers the spreadsheet side of the shared code.
**Observed, not changed:** the PDF half of the same upload (`pdf-parse`, which bundles an old pdf.js) also runs inside the API process. A hostile PDF can keep the event loop busy for a long time, which a size check
cannot prevent. The OCR fallback already runs in a separate, privilege-dropped child process (`resumeOcr.js`); running the first-pass parse there too is the proper fix, and is a larger change than this batch.

**F-1 (P3, FIXED, NOT VERIFIED for the error path) Most pages had no error boundary, so an uncaught render error or an unloadable page chunk left a blank white screen.** `ErrorBoundary` existed but wrapped
only about ten routes (interview session, daily and weekly challenge, lessons and a few others) plus the panels inside the student and admin dashboards; the other 140 or so routes had none, and the file's own header comment
records the original symptom ("unmounted straight to a blank white screen with no recovery"). *Fix:* one boundary around the whole route tree (`RouteErrorBoundary` in `App.jsx`) that shows the existing Reload card with a
generic message, and clears itself when the address changes (a new optional `resetKey` on `ErrorBoundary`; boundaries that do not pass one behave exactly as before). Routes with their own boundary still use it first.
*Verification:* the browser suite visits every page of every role, so it shows that the normal path still renders; there is no automated test that forces a render error (it would need a deliberately broken page or a blocked
chunk, which is fragile), so the error path itself is checked by review only.

**Frontend bundle size (report only).** CI now publishes the total size of the built JavaScript and the twelve largest files (raw and gzipped) as one notice on the integration job, so that a future
bundle-size change starts from a measurement. It cannot fail the build. **First measurement (CI run on the batch 7 branch):** all JavaScript is 16,972 KB raw and 4,057 KB gzipped across the build; the two largest files are the Monaco editor's TypeScript worker (about 6.7 MB raw) and the Monaco editor itself (about 4.1 MB raw), the pages that use the editor are lazily loaded routes and `vite.config.js` keeps the editor in its own chunk, but what a visitor to a page without the editor actually downloads was not measured. Nothing was changed in response; it is the starting point for any later bundle work.

**Accessibility report made complete (report only).** The first run of the public-page scan was cut off at about 4 KB of annotation text (U-3). Each finding is now one compact line (a contrast message reduced to the
ratio, the two colours and the type size), and CI publishes the lines in up to eight annotations of eight lines each, plus a notice with the total, so the next run shows every page that has a finding. That run did: 17 findings, all colour contrast, all on public pages in light mode (see U-3 and batch 8).

**Verification of batch 7.** All four CI jobs passed on 0b8de24. It was merged to `main` by fast-forward and deployed on 2026-10-22 (container started 18:31 UTC). Checked on the live host afterwards: `/api/health` reports 0b8de24; both containers are running with 0 restarts; 0 error lines in the application log; inside the running image a synthetic 41,028-byte `.docx` that inflates to 40 MB is refused in 18 ms with the plain "too large to read once unpacked" message, and an ordinary generated `.docx` still reads (in memory only, nothing stored); the 40 unit tests of batches 6 and 7 pass in the production image; unauthenticated requests to the resume upload and to three protected lists return 401. The frontend build on Vercel carries the new error-boundary text. Rollback image: `codearena-backend:rollback-20261022183029`. **Not verified in production:** the error boundary's error path (no automated test forces a render error; see F-1) and the PDF half of the resume upload (unchanged).

## Batch 8 changes (branch ci/audit-batch-8): public-page colour contrast, a dark-theme token fault, and the wider accessibility scan becomes a gate

**U-3 fix, light mode (FIXED, VERIFIED in CI).** All four failing combinations came from using the accent FILL colours as TEXT colours. `theme.css` already defined text-safe variants for badges
(`--warning-text` #8A5A12 and `--success-text` #14703A in light mode, from the 2026-09-17 accessibility pass); the public pages simply did not use them. Changes: the marketing eyebrow uses `--warning-text` on light sections
and the lighter `--amber` on the always-dark bands (hero, stats, call to action, page banners); inline links in the marketing body, the "learn more" links, the test-case pass label and the "Live" badge use
`--success-text`; the track pills use `--warning-text`; and the sign-in, forgot-password, reset-password and verify-email pages use the same tokens for their links and messages (`/register` shows the sign-in page).
Computed contrast (WCAG formula; the same arithmetic reproduces the scan's numbers for the old colours to within 0.01: 4.35, 3.13, 2.93, 2.70): `--warning-text` on cream 5.62:1 and on the pill tint 5.19:1;
`--success-text` on cream 5.86:1; `--amber` on the blackboard green #123528 6.22:1 (7.14:1 on the footer green).

**What the scan could not see.** The home page paints each section only when it scrolls into view (`.ca-reveal` starts at opacity 0), and a contrast check cannot measure text that is not painted, so every run until now
examined only the top of `/`. The scan now scrolls the page in steps, as a visitor does, before it measures. Three things below the fold were computed to fail and are fixed in advance: code-sample strings and function names
in the blackboard mock-ups (`--mint` is 4.08:1 on #123528 and 3.37:1 on #1B4332; they now use the new `--mint-on-dark` #6FBF8F, 6.08:1 and 5.02:1), the test-case "pass" label, and the "Live" badge (2.81:1).

**U-4 (P2, FIXED, VERIFIED in CI; the live theme stylesheet carries the new values) The dark theme's status text colours were below AA.** The scan with the whole page in view failed on the dark-mode home page: the badge at 3.49:1 and the track pill at
3.74:1. The cause was not those two components. The comment in `theme.css` said the dark-mode status text colours (`--success-text`, `--warning-text`, `--danger-text`, `--info-text`) "already contrast well"; measured against
their own tinted backgrounds they do not: 3.77:1 (#4F9D6E on #1E3A2A), 4.22:1 (#C7852A on #3D2F16), 3.13:1 (#C0533B on #3A2420) and 2.67:1 (#3D6FA8 on #1E2E3D). So every use of those four tokens outside the student and
admin dashboards, which carry their own lighter dark-mode tones, was below AA in dark mode; `Badge` is the main user. *Fix:* the dark-mode values are now #7FD6A2, #F2C16B, #F4A08C and #8CB8F2, the tones the dashboards
already use (6.78 to 7.80:1 on their tints, 7.01 to 9.80:1 on the dark page and card). Light mode is unchanged, and the stale comment in the light block is corrected. *Test:* `frontend/scripts/themeContrastRegression.mjs`
(frontend CI job; arithmetic on `theme.css` only, no browser) requires 4.5:1 for every status text colour on its tint, on the page and on the card, and for the main text colours, in BOTH themes, plus the fixed blackboard and
accent pairs; it also checks its own arithmetic against the 21:1 of black on white and the 3.12:1 and 4.35:1 that the browser scan reported.

**The wider scan is now a gate.** `frontend/e2e/tests/a11yExtended.spec.js` fails a test on any serious or critical finding (it was report-only). A page that cannot be loaded or analysed is tried twice and then fails as
well, because a gate that passes when it saw nothing is worse than none. Waits are bounded (navigation 15 s, network-idle 6 s, analysis 20 s, 100 s per test). The details still go to the CI annotations (up to eight parts).
The gate covers 23 public pages in light mode, four in dark mode and the five dashboards in dark mode, on top of the existing gate on the five dashboards in light mode.

**What the CI runs of the first attempt showed (history, kept because it changed the CI settings).** The first two runs of this batch were cancelled at the integration job's 25-minute limit. The public Actions API
(`GET /repos/<owner>/<repo>/actions/jobs/<check-run id>`, no sign-in) lists the time of every step, which settled the cause: in both runs the package downloads were slow (`apt-get` 446 s and 376 s; in the five green runs on
0b8de24, d9fbfd6 and 73bd0ad the same step took 14 to 29 s), and the browser step, which installs the browser's system packages through the same mirrors, took 910 s (cancelled) and 984 s, of which the browser tests
themselves were 496 s (the green runs' whole browser step took 471 to 531 s). The second of those runs also reached the new gate and failed it, correctly, on the dark-mode finding above, and everything else the scan
covered had no finding. So the scan is not the cause of the overrun, but the old 25-minute limit left little room for a slow mirror: it is now 35 minutes. The browser tests keep a separate hard cap of 14 minutes (a hang ends
that step with everything printed so far, instead of costing the whole job), and CI now publishes the duration of the verification scripts, the duration of the browser tests and the eight slowest browser tests as notices.

**Observed, not changed.** (1) `.exam-option.selected .exam-option-badge` (the letter in a selected answer option on the exam screen) is white on `--mint`: 3.29:1 by calculation, in both themes. The letter is
decorative (`aria-hidden`; the option text is what is read out) and the scan does not enter an exam, so nothing would have caught it; a fix changes how the selected option looks, so it is left for you to decide. (2) The
scans cover the 23 public pages and the five dashboards. Other logged-in pages (exam, lessons, admin tools) use `--mint`, `--amber-dark` and `--rust` directly as text colours in places (for example the AI interview error
banner, `--rust` on the danger tint); they are not measured, and nothing is claimed about them. A systematic pass would need either a wider browser scan with seeded data or a static search with arithmetic.

**Verification of batch 8.** All four CI jobs passed on 4ee5f64 (run #918: lint 12 s, backend 53 s, frontend 26 s, integration 11 m 27 s). In that run the browser suite exited 0 in 516 s with the wider accessibility scan as a gate, no accessibility finding was annotated, and the theme contrast test ran in the frontend job. All four jobs passed again on 97f09b0, the commit that went to `main`: the same change rebased onto batch 10, differing only in the `ci.yml` script list and in the tracker. It was merged to `main` by fast-forward on 2026-10-23 (06:03 UTC). Vercel rebuilt the frontend, and the live stylesheet now serves the new values: `--mint-on-dark:#6fbf8f` and the dark theme's `#7fd6a2`, `#f2c16b`, `#f4a08c` and `#8cb8f2` for the four status text colours (the old dark values are gone from it). No backend deploy was needed. **Not verified:** the live pages as rendered (the CI scan ran on the built app of the same commit, not on the live site), and the exam-screen option letter (see "Observed, not changed" above).

## Batch 9 changes (branch ci/audit-batch-9): scoring consistency

Method: read every place that turns attempts into a score, a percentage or a rank (`gradeAttempt`, `submissions`, `attemptManifest`, `studentPerformance`, `groupRank`, `talentPoolRank`, `talentPoolAutoSelect`, the tests
results service and repository, `gradeModuleCodingAttempt`), then measured each suspicion against production with read-only queries (2026-10-22) before deciding how much it matters.

**SC-3 (P3, latent; FIXED, VERIFIED in CI and deployed; the effect on real percentages not observed) Three rankings divided by the wrong maximum.** `attemptManifest.js` states the rule: an attempt's total is out of the questions IT was given (its saved list), "never ... the
test's CURRENT question list". `studentPerformance`, the results screen, the export and two talent-pool reports follow it, but `groupRank.js` (class rank on the student dashboard and the TOP_10_CLASS badge),
`talentPoolRank.js` (pool rank) and `talentPoolAutoSelect.js` (the "minimum average score" rule) summed each test's current question list instead. For a RANDOM test that is the whole bank, so a student with full marks on the
two questions they drew is scored 20 of 60 and ranks below a student with 75% on a fixed test; for a test edited after students sat it, old results move. *Production impact today: none.* All 56 tests are FIXED mode, 0 of
the 1,743 students with finished attempts would change by 5 percentage points or more, and the only auto-selection rule does not use a minimum average. It would bite the first RANDOM test. *Fix:* `sumScores` /
`scoreSumsByStudent` in `attemptManifest.js`, used by all three. *Tests:* `backend/test/scoreSums.test.js` (the arithmetic, and a source scan that fails the build if a maximum is summed from a test's question list again);
`backend/scripts/verifyScoreDenominators.js` (database-backed: class rank, pool rank and the selection rule for a RANDOM draw, a fixed test, an old attempt with no saved list, and a test edited after the attempts; added to
the CI verification loop).

**SC-2 (P2, order FIXED, VERIFIED in CI and deployed; the rank rule itself is a decision) Students with equal scores were ordered by the database on the leaderboard and by start time in the export.** Ties are not rare: 44 of the 56
tests have at least one (475 tied groups), the largest being 138 students on the same 80 marks and 127 on 0. The on-screen leaderboard (`attemptsForResults`) sorted by score alone, so tied students appeared in whatever
order the database returned (it can change between page loads), while the spreadsheet export sorted by score then start time, so the same student could carry different ranks on screen and in the sheet. Both now sort by score,
then earlier start, then id. Ranks are still POSITIONS in that order, so 138 students on one mark receive ranks 1 to 138. Whether tied students should share a rank (1, 1, 1, ..., 139), or be separated by time taken, is a
scoring-policy question and is not changed here (decision B-4 below). *Test:* `verifyScoreDenominators.js` (attempts inserted in the reverse of their start order; screen and export must agree and follow start order).

**Checked, no defect found.** The stored attempt total equals the sum of the best score per question for all 3,689 finished attempts; no attempt scores above what its questions are worth today; none of the 42,035 fully
accepted answers has a stored score that differs from the question's current points, so there is no sign of marks edited after grading; the manifest-based maximum is used by the student result page, the export, the performance
page and both talent-pool reports.

**Observed, not changed (decisions for you).**
* **B-4 Ties.** See SC-2. Options: (a) leave positions; (b) tied students share the best rank; (c) break ties by time taken. (b) is the usual convention for exam results.
* **B-5 Two meanings of "average".** The performance page and PDF show both "Average Score" (the mean of each test's percentage) and "Overall Percentage" (total marks over total possible); the pool rule called "minimum average
  score" and the class rank use the second. A student with 100% on a 10-mark quiz and 50% on a 100-mark exam has an Average Score of 75% and an Overall Percentage of 54.5%.
* **B-6 Editing a question after students answered it is not blocked.** 184 of the 507 questions that have answers were updated after their first answer (any edit counts: an image, a folder move, a status change), but none
  shows a scoring difference today. Editing points, correct options or test cases would change future grading and the denominators of old attempts; options are to block those fields once a question has answers, or to
  copy the question on edit.
* **Pass/fail on a fixed mark.** `passingMarks` is compared with the raw score whatever the attempt was out of; this matters only for RANDOM tests where students can be out of different totals.
* **Pool rule "minimum completion".** `minCompletionPercent` divides lessons completed by every lesson on the platform (`lesson.count()` with no filter), including other institutes' private courses, so almost no one could
  reach a high threshold. The only rule in production does not use it. It needs a definition of "completion" (which courses count) before it can be fixed.
* **Module coding.** The attempt score is the mean of per-question percentages that were each rounded first, and the pass decision uses that rounded mean (the same family as B-2).

**Verification of batch 9.** All four CI jobs passed on d9fbfd6 (the new `scoreSums.test.js` with its source scan, `verifyScoreDenominators` in the database-backed loop, and the browser suite). It was merged to `main` by fast-forward and deployed on 2026-10-23 (container started 05:49 UTC). Checked on the live host afterwards: `/api/health` reports d9fbfd6; both containers are running with 0 restarts; 0 error lines in the application log; the 21 unit tests of this batch and the code it builds on pass in the production image; unauthenticated requests to four protected routes return 401. The schema guard found no destructive change (batch 9 has no schema change). The new class-rank and pool-rank code was also run read-only against production data: the class rank of one student in each of the three largest groups (124, 121 and 120 students) and the pool rank of one member in each of the two largest pools (174 and 108 members) computed without error in 9 to 52 ms. Rollback image: `codearena-backend:rollback-20261023054916`. **Not verified in production:** that any real student's percentage changed. All 56 tests in production were in FIXED mode when last counted (2026-10-22), so for that data the old and the new denominators are expected to agree; the fix matters when RANDOM-mode tests are used. The rank decisions B-4 to B-6 are unchanged and wait for you.

## Batch 10 changes (branch ci/audit-batch-10): students and courses that are not theirs

Method: the by-id access review continued from the route files with the most by-id parameters and the fewest institute checks, reading each student-facing write route and comparing it with the read route for the same
object.

**LMS-1 (P2, FIXED, VERIFIED in CI and deployed; a real student's request not observed in production) Three student routes did not check that the course was theirs.** The lesson read route (`GET /learning/lessons/:id`), the practice-question routes
(`loadEligiblePracticeQuestion`), the project task routes and the readiness start all require the course to be Published and assigned to the student's institute or group. Their siblings did not:
* `POST /learning/lessons/:id/progress` and `POST /learning/lessons/:id/test-submit` checked only the module lock. A student who knew the id of a lesson in another institute's private course, a course never assigned to
  them, or one not yet published could mark it complete (earning XP, including the module-complete award), and `test-submit` returned the practice test's prompts, options, correct answers and explanations: the same
  content that finding A-1 closed for staff reads.
* `GET /module-coding/module/:id` and `POST /module-coding/module/:id/start` (the module-direct coding test) had no course check at all; the comment said these "keep their old rule", which was "all lessons complete".
  The progress route above let anyone satisfy that, so the test's configuration and questions of another institute's course could be read, and an attempt started that counts toward that course's coding certificate.
Exploiting any of it needs the id of a lesson or module in a course the student cannot see (ids are UUIDs; the lists that used to reveal them were closed in batch 2). Whether it was ever used has not been checked in
production yet (a query is prepared for the deploy, below). *Fix:* `studentMayUseCourseOf` in `routes/learning.js` (the course is Published and `studentCanAccessCourse`), applied by both lesson routes before anything is
described or graded, answering "Lesson not found" exactly as for an unknown id; and `resolveAssessment` in `routes/moduleCoding.js` applies `studentMayUseCourse` to the module-direct path, as it already did for chapter
Levels. *Behaviour change to know about:* a student whose course is not assigned to them (or was unassigned, or unpublished) can no longer record progress, take its practice test, or start or resume its module coding
test; reading the lessons was already refused. Attempts already in progress are unaffected (the attempt routes are checked by ownership of the attempt). *Tests:* `backend/scripts/verifyLmsWriteIsolation.js` (database-backed,
in the CI loop): the assigned student still works; the other institute's student gets "not found", nothing is written and no answer or explanation is returned; the module coding test is "not found" even with every lesson
already marked complete; access follows the assignment and not the institute that owns the course; a course that is not Published is closed to writes. `verifyStartOverride.js` and `verifySecureAndroid.js` built their
course without assigning it and then started module-direct tests as students, which is exactly what the old rule allowed; they now assign the course to the institute, as real use does.

**Reviewed, no defect found.** `routes/placementOffers.js` (all routes: students act on their own offers only; staff and clerks are held to their institute, STAFF eligibility to groups they are assigned to; the analytics
are institute-scoped and cached per institute), the readiness assessment start (assignment check, attempt cap re-verified in a serializable transaction), the project task routes (access helper), and the module-coding
attempt routes (ownership of the attempt).

**Exposure check before the deploy (production, read-only, 2026-10-23).** Counts only, in one read-only transaction. Of 4,456 student lesson-progress rows, 1,367 (279 students; 1,126 completed; 68 with a quiz score) are on a course that the student's institute and group are not assigned to, and all of them are on one course, "Java". Of 137 module-direct coding attempts, 26 (15 students) are on such a course, again only "Java". The audit log explains both: on 2026-10-10 a SUPER_ADMIN removed one institute's assignment to "Java" (the affected students are all from that institute, SCOE, in batches 2024-28 and 2025-29), and every one of the 1,367 rows and 26 attempts was written on or before that moment; none was written afterwards. No progress was written on a course that is not Published in the last 30 days. So the numbers are history from an assignment that was legitimate at the time, not use of the gap. What batch 10 changes for those students: they can no longer record progress or start module coding tests for that course (reading its lessons has been closed to them since 2026-10-10); two of the 26 attempts are still IN_PROGRESS (started 2026-09-04 and 2026-09-24) and can still be resumed, because the attempt routes check ownership of the attempt. **Worth confirming:** that removing SCOE from "Java" on 2026-10-10 was intended; it took the course away from 279 students who had progress in it.

**Verification of batch 10.** All four CI jobs passed on 73bd0ad on its branch run (the unit tests, the database-backed loop including the new `verifyLmsWriteIsolation`, and the browser suite). It was merged to `main` by fast-forward and deployed on 2026-10-23 (container started 05:55 UTC); the host's release gate passed while `main`'s own run of the same commit had only just started (it saw the branch run's green results); that run (#920) later passed too, in 10 m 20 s. Checked on the live host afterwards: `/api/health` reports 73bd0ad; both containers are running with 0 restarts; 0 error lines in the application log; the new helper is present in the running routes; the 30 unit tests pass in the production image; and, run read-only against production data, the access rule the new routes use says that of the 570 students with progress on "Java", 291 can open it and 279 cannot, matching the 279 counted in SQL before the deploy. Unauthenticated requests to the two lesson write routes and the module-coding route return 401. The schema guard found no destructive change (batch 10 has no schema change). Rollback image: `codearena-backend:rollback-20261023055516`. **Not verified in production:** the routes' answer to a real student's request ("Lesson not found", nothing written). That is covered only by `verifyLmsWriteIsolation` in CI, because checking it in production would need a student session, and creating one changes production data, which was not requested.

## First-login password change (branch ci/first-login-password-change; not an audit batch)

**A-2 (P2, FIXED, VERIFIED in CI and deployed; the full flow with a real account not observed in production) The requirement to choose a personal password was enforced only by the browser.** A temporary-password sign-in returned a full session at once, and the page alone (a flag in `localStorage`) sent the student to change it; editing the flag or calling any API with the token skipped it. The page also accepted 6-character passwords where the server needs 8 with four kinds of character. *Fix:* the server now answers such a sign-in with `passwordChangeRequired` and no token; `POST /auth/change-temporary-password` re-checks everything and replaces the password by compare-and-swap; the login page shows the new-password fields on the same form. Full description, contract and tests: `docs/FIRST_LOGIN_PASSWORD_CHANGE.md`.

**Verification.** All four CI jobs passed on dc00997 (the database-backed `verifyFirstLoginPasswordChange` and the updated contract scripts, the browser suite with `firstLogin.spec.js`, the unit and regression tests). Merged to `main` by fast-forward and deployed on 2026-10-23 (container started 07:56 UTC). Checked on the live host: `/api/health` reports dc00997; both containers run with 0 restarts; 0 error lines in the log; the 16 auth domain unit tests pass in the image; the new endpoint answers 400 to malformed, mismatching and weak-password requests and 401 to an unknown e-mail; other unauthenticated routes still return 401. The live frontend bundle carries the new endpoint. Rollback image: `codearena-backend:rollback-20261023075536`. Before the deploy (read-only): 1,042 students, 3 staff and 1 institute admin carry the flag (1,011 of the students have never signed in); 3 of the flagged accounts have an open session and keep it; no institute has a password expiry window. **Not verified in production:** the end-to-end flow (it needs a flagged account) and browser password-manager behaviour. **Open:** the credentials e-mail still says "Change your password immediately after logging in"; self-service "forgot password" does not clear `mustChangePassword`.

## Batch 11 (branch ci/audit-batch-11): by-id isolation sweep, second half; no code change

Method: the by-id routes of the files not yet covered were read one by one for the institute (or ownership) check that the object they name requires. **Reviewed, no defect found:**
* `routes/moduleCoding.js`, admin half (all 20 routes): every route that returns or changes a test, its questions or its attempts checks the owning course's institute (`ownsLmsInstitute` with the module, chapter or test resolver), or filters attempts by the requester's institute; the attempt reset checks the student's institute.
* `routes/subjects.js` (subjects, units, topics, staff assignments): every unit and topic route resolves the parent subject and calls `canStaffUseSubject`.
* `routes/interviewDrafts.js`: every draft route reads the row and applies `ownsRow` / `ownerWhere`.
* `routes/companies.js` (`canEditCompany`, `canToggleCompany`) and `routes/notifications.js` (a notification is readable only by its recipient).

**Observed, not changed (decisions for you).**
* *A staff member can reset a student's module coding attempts for any student of their institute* (`DELETE /module-coding/admin/tests/:id/students/:studentId/attempts` checks the institute only, not whether the student belongs to a class the staff member is assigned to). The same question applies to the other STAFF routes that take a student id; whether staff are meant to be limited to their classes there is a rule, not a bug I can settle.
* *The first PDF pass of the resume upload runs inside the API process* (`pdf-parse`, which bundles an old pdf.js; carried over from R-3). The proper fix is to run it in the same sandboxed child process the OCR fallback already uses; it is a design change that needs sample PDFs to test, so it is not started.

**Verification of batch 11:** documentation only; nothing to deploy.

## Batch 12 (branch ci/audit-batch-12): sign-out did not end the server session

**A-3 (P2, FIXED, NOT VERIFIED until CI) Signing out cleared the browser but left the session open on the server for its full 12 hours.** Found on 2026-10-23 during the live first-login test: after the synthetic test student clicked "Sign out", the database still showed its session as active (checked read-only before the account was deleted). Cause, read from the code: `AuthContext.logout` called `api.post("/auth/logout")` and cleared `localStorage` on the next line; axios runs request interceptors asynchronously, so `api.js` looked for the token after it was gone, the request went out without credentials and was refused (the caller ignores the failure). So no sign-out has ended a session on the server since this code was written: a stolen or left-behind token stayed valid for 12 hours after the person signed out, and the "active sessions" view showed signed-out people as active. (The one live observation is a single account; the mechanism is the code reading above, not a measurement of every sign-out.) *Fix:* the token is read first and sent explicitly with the sign-out request. *Test:* `auth.spec.js` signs a seeded student in, signs out through the menu and requires the old token to be refused (401) by the API. *Not changed:* sessions that are open today (they expire by themselves after 12 hours; ending them would sign people out).

**Verification of batch 12:** pending (to be added from the CI run and the deploy).

## Batch 13 (branch ci/audit-batch-13): a changed password ends the other sessions

**A-4 (P2, FIXED, NOT VERIFIED until CI) Changing your own password in Account Settings left every other session of the account open.** Admin reset, bulk reset, "forgot password", deactivation and (since the first-login change) the temporary-password change all close the account's sessions; `PATCH /users/me` did not (`updateOwnAccount` opened a new session and returned it, and nothing else). So a person who changed their password because a device or someone else might hold a session stayed exposed for up to 12 hours on that device. *Fix:* the new `revokeOtherSessions(userId, keepJti)` closes every other active session before the new one is opened; the session that made the change keeps working. *Behaviour change to know about:* a student signed in on a second device is signed out of it when they change their password. *Test:* a new section of `verifyFirstLoginPasswordChange.js` (two sessions; after the change the first and the new one work, the other is refused). **Not changed:** the contract scripts for `/users/me` (the session that makes the change still works, as their snapshot expects).

**Verification of batch 13:** pending (to be added from the CI run and the deploy).
## Decisions applied (branch ci/decisions-1-3-4), 2026-10-23

Decisions from the product owner: (1) staff reset module-coding attempts only for students of their assigned classes; (3) the credentials e-mail asks for a personal password at first login; (4) asking for a reset link must not clear the flag, completing a reset does.

**SC-4 (P2, FIXED, NOT VERIFIED until CI) Staff could reset module-coding attempts for any student of the institute.** `DELETE /module-coding/admin/tests/:id/students/:studentId/attempts` checked only the institute. It now also requires, for STAFF, an assignment to the student's class (`StaffClassAssignment` on the student's academic group: batch, department, section); an institute admin or platform admin is not scoped by class; the refusal is audited as `UNAUTHORIZED_ACCESS_ATTEMPT`; the grant keeps its `REATTEMPT_GRANTED` audit row (actor, student, time, mode, reason). Only that test's module-coding attempts are deleted. *Behaviour change:* a staff member without an assignment can no longer reset attempts. *Test:* `verifyModuleCodingResetScope.js`. **Not changed:** the other STAFF routes that take a student id (test re-attempts, results) were not part of the decision and are not checked here.

**E-1 (P3, FIXED, NOT VERIFIED until CI) The credentials e-mails told students to "change your password immediately after logging in".** Both templates (new account, password reset) now say "For your account security, please create your personal password the first time you log in." They are sent only when an administrator issues or resets a password, which is exactly when the account must choose one (`emailTemplates.test.js`).

**A-5 (P3, FIXED, NOT VERIFIED until CI) A completed "forgot password" reset left the must-change flag set.** A student who chose their own password through the e-mailed link was asked to choose another at their next sign-in. Completing a reset now clears the flag in the same transaction; requesting a link never touches it (`verifyResetClearsFlag.js`).

**Decision 2 (sandboxed PDF parsing): not started in this branch**; see the next batch.

## Batch 14 (branch ci/audit-batch-14): the resume PDF reader had no limits

**UP-1 (P2, FIXED, NOT VERIFIED until CI) A student's uploaded PDF was parsed inside the request, on the API's only thread, with nothing bounding it.** `POST /resume/me/upload` checked only that the file name ended in `.pdf` or `.docx`, then `pdf-parse` (an old pdf.js) read every page in-process: no page limit, no time limit, no memory limit, and no signature check (any bytes named `.pdf` reached the library). Each page also grouped text items with a linear search per item, which is quadratic for a page with very many items. One crafted or merely huge file could stall every request of the API for as long as it took, or run the process out of memory, and the route had no rate limit, so one student could repeat it. (The scanned-PDF fallback was already isolated in a privilege-dropped child process; the common text path was not.) *Fix:* `utils/pdfText.js` — the file must start with the PDF signature (within the first 1,024 bytes, as the specification allows); only the first 15 pages are read; the work runs in a worker thread (`pdfTextWorker.js`) with a 384 MB memory cap, an empty environment (no database URL or signing secret in `process.env`) and a 20-second deadline after which the thread is terminated; at most 2 files are read at once, up to 8 wait, and anything beyond is told to try again in a minute; text items per page are capped at 20,000 (`pdfReadingOrder.js`, the renderer moved out of `resumeParser.js` unchanged otherwise); and `/me/upload` is limited to 6 uploads per account per 10 minutes. *Tests:* `backend/test/pdfText.test.js` (a real PDF is read in order; the page cap; a renamed file and the signature window; a damaged PDF; the deadline stops a read and frees the slot; the concurrency limit and queue).
*Not done, and why:* this bounds time and memory but is not a separate operating-system identity. A worker thread shares the process and the file system, so a hostile PDF that exploited the library could still read what the process can read. Running the text path in the same privilege-dropped, network-denied child process that the OCR fallback uses (decision 2) needs the Docker host to verify the user switch, so it stays open.
**Checked, nothing found:** every bulk-import route already filters by extension and limits size to 5 MB (20 MB for the question import with an images ZIP, which `bulkImageZip.js` bounds further); the global error handler maps `LIMIT_FILE_SIZE` and other multer errors to 413/400 (`index.js`); the question-image upload sniffs magic bytes.

**UP-2 (P1, FOUND LIVE after the batch 14 deploy, FIXED in batch 14b) The first version of the worker could not read small PDFs, including the ones this platform's own resume builder makes.** The live test (2026-10-26, right after the deploy) uploaded a resume made by the platform's generator and was refused with "Couldn't read this PDF"; `validationDatasetAccuracy.js` run in the live image read 0 of 6 PDFs (its DOCX half stayed at 100%). Measured on the host: handing pdf-parse a Node `Buffer` inside a worker thread makes its pdf.js fail with "bad XRef entry" on PDFs under about 4 KB (a plain `Uint8Array` reads every size; the same files read fine on the main thread, and files above about 9 KB read with either). The unit tests had passed because their fixtures were padded to 13 KB; my first explanation here, "the library cannot read small PDFs", was wrong and is withdrawn. *Fix:* `pdfTextWorker.js` passes the `Uint8Array` straight to the library; the tests now use small PDFs, including one produced by the resume builder. Lesson: a CI that cannot see a regression is not evidence; the live check with the platform's own files is what found it. Until 14b is deployed, a student who uploads a resume PDF under about 4 KB (for example one downloaded from this builder with little content) is told it "may be damaged"; larger PDFs, DOCX files and scans are unaffected.
**Verification of batch 14:** CI green on 82e7f77 and deployed 2026-10-26 04:24Z; the live test found U-2 (above). Live results for the rest: the focus-loss rule behaved as designed through the real API (warning, strike 1, 2, 3, auto-submit; late event ignored), a text file named .pdf got the plain "not a valid PDF" message, empty and wrong-type uploads were refused, the 7th upload in ten minutes got 429, the API answered health checks during a parse (slowest 4 ms), and the disposable student, test, question, group and department were removed (0 left).
