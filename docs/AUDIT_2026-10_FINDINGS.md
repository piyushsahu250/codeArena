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

**Q-1 (P3, FIXED, NOT VERIFIED) AI usage had no per-user cap, and bookkeeping rows were counted as calls.** `services/ai/rateLimits.js` had an institute budget (300 a day) and a platform budget (2,000 a day) but
nothing per person; the only per-person limit is 5 calls a minute on each route. At that rate one account can use an institute's whole day in about an hour, and a handful of accounts the platform's, leaving every
other student without AI. Separately, `INVALID_RESPONSE` rows (bookkeeping written when a response that did arrive fails our own validation) were counted as calls although the provider call already has its own row,
so a spell of unusable output used each quota slot twice. *Fix:* a per-user cap (`AI_DAILY_LIMIT_PER_USER`, default 100 per UTC day; the 101st call gets the existing 429 `AI_QUOTA_EXCEEDED` with "You have reached
your daily AI usage limit. Please try again tomorrow."), and `INVALID_RESPONSE` rows no longer count. *Why 100:* the busiest user-day on the production record since August was 34 calls, so nobody who used it
before is blocked. *Tests:* `backend/test/aiQuota.test.js` (decision order and boundaries); `backend/scripts/verifyAiQuota.js` (the real table: one below the cap, at the cap, other users unaffected, failed
calls count, invalid-response rows and two-day-old rows do not).

**M-1 (P2, FIXED, NOT VERIFIED) `POST /admin/announcements` accepted any size and any type.** A non-text `message` crashed the handler (500), there was no length cap, and nothing limited how often one admin
could broadcast to a whole institute (an in-app notification per recipient, optionally an e-mail each). *Fix:* message at most 2,000 and subject at most 150 characters, non-text is a 400, and 5 accepted announcements per
admin per hour (`ANNOUNCEMENTS_PER_HOUR`; a refused request, such as a typo, does not use the allowance); the form has matching `maxLength`. Test: `backend/scripts/verifyMessagingGuards.js`.

**M-2 (P2/P3, FIXED, NOT VERIFIED) `POST /tests/:id/notify` could e-mail the same test to all its students again and again, and its idempotency key was not tied to a test.** The key stopped only a double
click: with a fresh key each press sent another full round from the shared mail allowance. The key was also looked up without checking the test, so a key replayed against a different test answered "already sent"
with the other test's counts and skipped the real send (P3: it needs a repeated client key). *Fix:* an e-mail notification for a test is refused with 429 for `TEST_EMAIL_NOTIFY_COOLDOWN_MIN` (default 10)
minutes after the last one (in-app notifications stay allowed); a key that belongs to another test is a 409; the same key for the same test still returns the original "already sent" answer. Test:
`backend/scripts/verifyMessagingGuards.js`.

**N-1 (P2, FIXED, NOT VERIFIED) Bulk notices started one e-mail per person all at once.** Course and readiness-test assignments (and the opt-in e-mail forms of test and talent-pool assessment assignments),
talent-pool add and remove, and the publishing of a result examination (in chunks of 15) sent one e-mail per person with no bound, built on `Promise.all(people.map(...))`. Assigning one course to an institute
starts one send per student at the same moment: for example 3,000 simultaneous sends and 3,000 log rows through one Gmail account. The same burst pattern is what tripped the provider's login throttle on
2026-10-06 (a 219-student credentials batch and its resend; 352 credential e-mails failed), and while the throttle is active every send fails, password-reset e-mails included. Stuck PENDING rows (N-3) are the other
visible result of a restart in the middle of such a burst. The talent-pool and result-publish ones also ran inside the HTTP request. *Fix:* `emailEach` and `notifyInBackground` in `utils/notifications.js` (5 in flight,
`EMAIL_CONCURRENCY`); the talent-pool and result-publish fan-outs now run after the response; a bulk course assignment handles one course at a time. Test: `backend/test/emailFanout.test.js` (peak concurrency
never above the bound, order kept, one failure does not stop the rest, and a source scan that fails the build if `Promise.all(list.map(... send ...))` or `forEach(... send ...)` comes back).
The talent-pool "assessment assigned" and "mock interview assigned" notices are in-app only (`sendEmail` defaults to false), so they were left as they are.

**N-2 (P2, FIXED, NOT VERIFIED) Critical e-mail had no protection from bulk e-mail.** Everything leaves through one provider account with a daily allowance (about 1,900 delivered in one day, and its
"daily sending limit" error has fired on quieter days after a flood), so bulk notices and password-reset or credential e-mails draw on the same allowance. *Fix:* a rolling 24-hour allowance for non-critical e-mail (`BULK_EMAIL_DAILY_BUDGET`, default 1,400; 0 turns it off). The types
`PASSWORD_RESET`, `PASSWORD_RESET_BY_ADMIN`, `CREDENTIALS`, `CREDENTIALS_RESEND` and `EMAIL_VERIFICATION` never count against it and are never refused by it. Once it is used up a non-critical e-mail is not
attempted: its log row is written FAILED with the reason, so it is visible and can be retried, and the in-app notification is unaffected. The check fails open if the count cannot be read.
*1,400 is a policy number, not a measurement of the provider's limit; please confirm or change it.* **Behaviour change:** after 1,400 non-critical e-mails in 24 hours (login alerts, announcements,
assignment notices) further ones are logged FAILED instead of sent. Tests: `backend/test/emailFanout.test.js` (decision logic against a fake database) and `backend/scripts/verifyEmailProtection.js` (the real
table: the last allowed e-mail, the first refused, critical types attempted at the limit, credential, over-24-hour and FAILED rows not counted). No e-mail is sent by either: every send uses an invalid address.

**N-3 (P3, FIXED, NOT VERIFIED) E-mail rows stuck PENDING for ever.** A log row is created PENDING just before the send; if the server restarts mid-send nothing ever updates it. Production holds 2,768 such
rows from one restart on 2026-10-07, still shown as pending weeks later, which also makes any "is mail working?" view misleading. *Fix:* `sweepStalePendingEmails`, run from
`utils/emailRetryScheduler.js` two minutes after start and every 10 minutes after that (`DISABLE_STALE_EMAIL_SWEEP=true` turns it off; `MAIL_STALE_PENDING_MS`, default 30 minutes, sets the age), marks PENDING
rows older than 30 minutes FAILED with "Not sent: the server restarted, or the send was interrupted, before this e-mail went out. It can be retried from Email Logs." Nothing else on the row changes.
**Deployment note, a production data change:** the first run after deploy will mark those roughly 2,768 historical rows FAILED. That is their true state, but it is a write to production data, so it needs an
explicit OK as part of the deploy approval (or deploy with `DISABLE_STALE_EMAIL_SWEEP=true` and enable it later). Rows stuck in RETRYING (a manual retry interrupted by a restart) are not swept; I did not look
for any. Tests: `emailFanout.test.js` (the query it issues) and `verifyEmailProtection.js` (the real table: only the old PENDING row changes; fresh PENDING, SENT and FAILED rows are untouched; a second sweep
changes nothing).

**U-2 (P3, FIXED, NOT VERIFIED) Login page footer contrast.** The "Powered by Acrosoft..." line used `--ink-dim` at 75% opacity, about 3.1:1 on the light page by calculation (AA needs 4.5:1). The opacity is gone.
This was found by reading the style, not by a scan: the public pages had not been scanned.

**Accessibility coverage (report only).** `frontend/e2e/tests/a11yExtended.spec.js` scans 23 public pages in light mode, four of them also in dark mode, and the five dashboards in dark mode (32 scans), and
prints every serious or critical axe finding; CI publishes them as one warning annotation. It cannot fail the build. The first annotation is the baseline; nothing is claimed about those pages until it has been read.

**Observed, not changed (decisions for you).** (1) `OTHER_SYSTEM_EMAIL` is the type of both the "your password was changed" security notice (`modules/auth/auth.service.js`) and the admin test e-mail, so the
notice cannot be exempted from the allowance without a new type, and the auth contract snapshot lists the existing one. (2) `LOGIN_ALERT` (first login, new device) counts as non-critical, so a large first-login
day can use part of the allowance; say if any of these should be critical. (3) One Gmail account stays the ceiling; Amazon SES remains the earlier recommendation.

**U-3 (P2, OPEN) Public pages fail colour contrast: the baseline from the new report-only scan on 92b5018.** The scan (23 public pages in light mode, four in dark mode, five dashboards in dark mode) reports every serious or critical finding, and every
finding that is visible is a serious colour-contrast one. The CI annotation is cut at about 4 KB, so only the first dozen findings (alphabetical, `/about` to `/login`) are readable: the remaining public pages, the
dark-mode runs and the dashboards in dark mode are NOT yet visible, and nothing is claimed about them. What is visible: the marketing eyebrow label (gold #c7852a on dark green #123528, 9 pt) at 4.35:1 on every marketing page;
inline links (green #4f9d6e on cream #fbf9f4, 11.6 to 12.8 pt) at 3.12:1 on `/about`, `/coding-challenges`, `/coding-platform`, `/contact`, `/employability-readiness`, `/for-institutions` and `/lms`; gold links
(#c7852a on #fbf9f4, 10.5 pt) at 2.92:1 on `/login` and `/forgot-password`; gold track pills (#c7852a on #f9efde, 9 pt) at 2.7:1 on `/ai-mock-interview`. AA needs 4.5:1 for text this size. Not fixed yet: the fix is darker
text variants of the two accent colours on light backgrounds (a brand-colour choice), and the annotation must be split so that every finding is visible before the work can be called complete.

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

**R-3 (P2, FIXED, NOT VERIFIED until CI) The student resume upload unpacked a `.docx` with no limit.** After batch 4 every spreadsheet upload went through `safeWorkbook.js`, but `POST /resume/me/upload`
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
bundle-size change starts from a measurement. It cannot fail the build. Until the first run has been read, no claim is made about the bundle.

**Accessibility report made complete (report only).** The first run of the public-page scan was cut off at about 4 KB of annotation text (U-3). Each finding is now one compact line (a contrast message reduced to the
ratio, the two colours and the type size), and CI publishes the lines in up to eight annotations of eight lines each, plus a notice with the total, so the next run shows every page that has a finding.

**Verification of batch 7:** pending (to be added from the CI run).
