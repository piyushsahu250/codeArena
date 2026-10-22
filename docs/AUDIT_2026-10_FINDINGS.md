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
| LMS content isolation (`learning.js`) | Read of the by-id reads | **FAIL then FIXED, NOT VERIFIED** (A-1) |
| Staff-facing by-id routes in the other 44 route files | Heuristic scan, plus a manual read of ten handlers (attendance, challenges, staffClerk, interview, interviewDrafts, resume, resultManagement, placementOffers, companyQuestions, studentDocuments) | PASS (static, partial): each of those calls an institute-scope helper before acting; the helper bodies were read for studentDocuments, resultManagement and learning only. `learning.js` was the one route file with unscoped reads (A-1). Not every handler in every file was read |
| Spreadsheet exports (formula injection) | Read of every XLSX/CSV writer | **FAIL then FIXED, NOT VERIFIED** (E-2); the other writers use `spreadsheetSafe` |

## Findings

### P1/P2 — authorization

**A-1 (P2, FIXED, NOT VERIFIED) Another institute's private course content was readable by id/slug.**
`GET /learning/lessons/:id` and `GET /learning/practice/:id` returned the full question data (correct answers, explanations, hidden test cases) to any
non-student account of any institute that knew the id, and `GET /learning/courses/:slug/modules/:moduleId/lessons` listed another institute's private lessons by
a guessable slug (e.g. `java`). Courses can be institute-owned (`Course.instituteId`, set when an institute admin authors one). The sibling `projects/:id/admin`
route already had an explicit IDOR guard; these three did not. Ids are UUIDs, so exploitation needed a known id, but the slug route needed nothing.
*Fix:* `canReadCourseContent` in `routes/learning.js`: own institute or global course, never another institute's; unscoped platform admins unchanged.
*Regression test:* `backend/scripts/verifyLmsContentIsolation.js` (added to the CI verification loop). Result: pending the CI run of this branch.

### P2/P3 — other

**E-2 (P2, FIXED, NOT VERIFIED) Spreadsheet formula injection in the audit-log CSV and the result-entry template.**
`auditCsv` (`modules/users/users.domain.js`) quoted each value but did not neutralise a leading `=`, `+`, `-` or `@`. Its Device column is the login request's
`User-Agent` header, which any user controls, so a crafted header such as `=HYPERLINK(...)` became a live formula when an administrator opened the export in
Excel. The result-entry template (`routes/resultManagement.js`) wrote student and institute names the same way. Other exports already use `utils/spreadsheetSafe.js`.
*Fix:* `safeCell` applied to every audit CSV value and to the two template name cells. *Test:* `backend/test/spreadsheetFormulaSafety.test.js` (unit, CI backend job).

**E-3 (P3, FIXED, NOT VERIFIED) The audit-log CSV doubled the quotes of its Details column twice,** so the JSON inside the cell could not be parsed back (`""""title""""`).
The contract snapshot had pinned the broken output. *Fix:* quotes are doubled once; `users-contract.json` updated for the one affected line. *Test:* the same unit test
reads Details back as JSON.

**S-1 (P2, OPEN) SSRF guard on the document download proxy has a DNS-rebinding gap.** `utils/safeFetch.js` resolves the host, checks the IP, then calls `fetch`,
which resolves again. A hostile DNS server can answer a public address first and a private one second. Exposure is limited (the link is student-supplied, the
fetch is triggered by staff, the response goes to the staff member), and whether the EC2 metadata endpoint is reachable depends on IMDSv2 settings (not checked).
*Proposed fix:* connect to the validated IP (pinned `lookup`), keep the Host/SNI. Needs its own tests; not done in this batch.

**S-2 (P3, OPEN) The same proxy has no response-size or total-time limit.** The 20 s timeout is cleared once the headers arrive; the body then streams without a
cap. A staff member downloading a hostile link could tie up a connection or bandwidth. *Proposed fix:* cap bytes and abort after a total time.

**E-1 (P3, OPEN) About 25 transactional e-mails put names and titles into HTML without escaping** (`<p>Hi ${user.name}`, test titles, pool names; see
`auth.service.js`, `tests.service.js`, `utils/notifications.js`, `users.account.service.js`, `routes/admin.js` custom messages). Only privileged users author these
values, but a crafted title could inject links into mail sent to students. *Proposed fix:* escape at interpolation (the mailer already has `escapeHtml`).

**L-2 (P3, OPEN) `/api/health/deep` is public** and reveals which optional services are configured and which required environment variable names are missing.
No secret values. *Proposed fix:* keep `/api/health` public, require a platform admin or a shared header for `/deep` (check what monitors call it first).

**L-3 (P2, OPEN) `uncaughtException` and `unhandledRejection` are logged and the process keeps running.** After an uncaught exception Node's state can be
inconsistent; the usual guidance is to exit and let the supervisor restart. *Proposed change:* exit after logging (the container already restarts). Needs a decision
because it changes failure behaviour under load.

### Test-infrastructure findings

**T-1 (P2, FIXED in release 8123378) A flaky browser test** (resume after reload) read the wrong question half the time because question order is shuffled per attempt.

**T-2 (P2, OBSERVING) Two isolation scripts were never run by CI.** `verifyTenantIsolation.js` and `verifyRoleIsolation.js` document earlier audit fixes
(leaderboard scopes, role isolation) but no pipeline ran them, so those fixes had no regression protection. This branch adds them as an observe-only final
step. If they pass, move them into the main loop; if they fail, the failure is the finding.

## Next batches (not started)

1. Institute isolation sweep of the remaining by-id reads: `attendance.js`, `talentPools.js`, `placementOffers.js`, `subjects.js`, `challenges.js`, `readiness.js`,
   `resultManagement.js`, `moduleCoding.js`, `interviewDrafts.js`, `exports.js`, `search.js`, `backup.js`.
2. Exports and bulk imports (formula injection in CSV/XLSX cells, size limits).
3. Uploads (`multer` limits, type checks), resume OCR sandbox.
4. Score and total consistency between UI, API and database for tests and module coding.
5. Frontend: bundle size and route splitting (measure with `vite build`), unhandled error boundaries, accessibility on the main role dashboards.
6. Load test plan (scripts exist under `backend/scripts/loadTest*.js`; running them needs an isolated staging environment, BLOCKED until one is approved).

## Dependencies

**D-1 (P3, FIXED, NOT VERIFIED) `multer` 1.4.5-lts (the 1.x line) has published denial-of-service advisories fixed in 2.0.x** (malformed multipart bodies). Every upload
route is behind authentication, so it needs a logged-in account, but a bulk-upload endpoint is exactly what an exam-day abuser would hit. `package.json` now asks for
`^2.0.2`; the lockfile does not track `multer` (it has drifted, which CI already works around with `npm install`), so the deployed version is whatever the range resolves to
at image build. The API used here (`memoryStorage`, `single`, `fields`, `LIMIT_FILE_SIZE`, `MulterError`) is unchanged in 2.x. *Verification:* the upload contract scripts in
CI (`verifyQuestionImportExportContract`, `verifyUsersWriteContract`) and the browser suite. *Confirm with:* the report-only `npm audit` step on the next CI run (not readable without a
GitHub sign-in from this workstation, so I have not seen the advisory list; this finding rests on the published advisories as I recall them and should be checked against that report).
