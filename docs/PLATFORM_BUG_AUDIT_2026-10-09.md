# Platform bug audit, 2026-10-09

Evidence-based: every item below was found by running something (a scan, a test, a log search), not by suspicion. "Fixed" means changed, deployed and verified as stated. Anything not verified is under "Open".

## Confirmed bugs, fixed

| # | Severity | Bug | Evidence | Fix | Regression test |
|---|---|---|---|---|---|
| 1 | High (user-blocking) | Leaving a mock interview left the browser in fullscreen. The Exit control was a router link and nothing released fullscreen on unmount. | Browser test run against the old code: Exit left the page in fullscreen; a refusing browser was never reported. | `utils/fullscreenSession.js` (owner-aware release), `useProctoring`, interview/assessment/AI-interview/formal-test pages, `FullscreenExitNotice` | `e2e/tests/fullscreen.spec.js` (8) |
| 2 | High (user-blocking) | Module-test lessons ("Coding Problems") in all 14 modules rendered a blank page: `isMobile` and the editor setup were declared in `LessonView` but used in `PracticeQuestionCard`. | `lms.spec.js` opened all 179 Java lessons: 14 broken, same ReferenceError. | declarations moved into the component that uses them; error boundary on the lesson route | `lms.spec.js` |
| 3 | High (user-blocking) | Mini-project task pages (`ProjectView.jsx`) had the same defect: 12 undefined references. | Undefined-variable lint scan. | moved into `ProjectTaskCard` | lint gate (below) |
| 4 | High | AI voice interview: after every answer the code logged an undefined variable (`skipped`), threw, and so never issued the next question; the student saw "Failed to process your answer". | Backend undefined-variable scan; code read. | `voiceSessionHandler.js` | pre-deploy lint gate (below). Not exercised end to end (the voice flow needs the Gemini live service). |
| 5 | High (reliability) | An async route that threw before answering left the request hanging (Express 4 does not catch promise rejections); about 66 handlers have no try/catch. | `scripts/verifyAsyncErrors.js`: before the fix the request hangs, after it answers 500. Verified on the live container. | `utils/asyncErrors.js` patched into Express's route layer; `res.headersSent` guard | `verifyAsyncErrors.js` |
| 6 | Medium | An exam answer could be lost when a student answered, moved on and answered again before the first save went out; failed saves were dropped, not retried. | E2E regression test failed (5/10 instead of 10/10). | pending answer sent before being replaced; saves ordered per question; failed saves retried; submit waits and warns | `journeys.spec.js` |
| 7 | Medium | Quiz answer saves shared the 20/min code-execution rate limit. | code read; no 429 seen in 11,727 logged saves, so latent. | separate 240/min limiter | `verifyAttemptManifest.js` |
| 8 | Medium | Reports computed an attempt's maximum from the test's current question list (results export, Talent Pool averages). | `verifyAttemptManifest.js` | `utils/attemptManifest.js` | `verifyAttemptManifest.js` (31 checks) |
| 9 | Medium | Pages that fire an API call with no `.catch` (59 files) failed silently: empty screen or endless spinner. | pattern scan; `resilience.spec.js` | one plain-language notice for any unhandled API failure (`RequestFailedNotice`) | `resilience.spec.js` |

## Clean results (checked, nothing to fix)

- Authentication: of 607 routes the only ones without `authenticate` are login, registration, password reset, email verification and public certificate verification, all rate-limited.
- Stored assessment data: 2,045 attempts, 0 question-count mismatches, 0 score or denominator differences.
- Event listeners and timers in the frontend are balanced (the apparent mismatches were one line removing two listeners).
- Unbounded queries: the large-table `findMany` calls are scoped to a class, group or institute.
- Tenant and role isolation scripts all pass on the deployed version.

## Guards added so these do not return

- `frontend/.oxlintrc.json`: `no-undef` and `react/jsx-no-undef`, with the browser environment.
- `scripts/run-e2e-host.sh` fails the run if the frontend has an undefined variable.
- `scripts/deploy-aws-host.sh` aborts a backend deploy on an undefined variable (`scripts/lint-backend-host.sh`). The gate was added after the 2026-10-09 deploy of `9e8e05a` started, so its first real run is the next deploy; it was run by hand and reports 0.

## Verification run on the deployed version (`9e8e05a`)

`verifyPermissions`, `verifyAttemptManifest`, `verifyJudgeService`, `verifyTestSecurity`, `verifyRoleIsolation`, `verifyTenantIsolation`, `verifyStudentDashboard`, `verifyAdminCommand`, `verifyAsyncErrors`: all passed. Browser tests on the branch before merge: 31 passed (login, exam journeys, fullscreen, dashboards, resilience). A full-suite run on the final `main` was not repeated.

## Open (not fixed or not verified)

- The full 49-test browser suite was last run before the fullscreen and audit-group merges; the lesson smoke test intermittently reports an API rate-limit answer (429) when it opens ~180 lessons in a row, which is a test-pacing issue, not a crash. Its last paced run's result was not read.
- Mock interview: driven only through its Resume screen (the normal start needs a detected face). Chromium only; no real device, no Safari/Firefox/mobile.
- About 66 async handlers still have no try/catch of their own. They now return a generic 500 instead of hanging, but give no specific message.
- `ModuleCodingAttempt` and readiness question snapshots were not audited for count or denominator consistency.
- About 2,768 old PENDING emails (course-assigned, login alerts) remain unsent; mail goes over SMTP with a daily limit. Not touched.
- Not audited at all in this pass: slow-query analysis, mobile layout beyond the existing responsive test, notification/email failure handling, certificate flows, placements/attendance workflows, and the AI features other than the voice handler fix.
- Remaining lint noise (87 unused variables, mostly fields deliberately dropped by destructuring) was reviewed and left alone.

## Rollback

Frontend: revert the merge commit on `main` (Vercel redeploys). Backend: the deploy script keeps `codearena-backend:rollback-*` images and rolls back automatically if the health check fails; to roll back by hand, run the previous image with the same arguments. No database change was made in this audit pass.

## Update: second audit pass (same day)

Full browser suite on `main` (`5c805c2`): **60 passed, 0 failed**; the lesson smoke test opened all 179 lessons, 0 broken.

| # | Severity | Finding | Evidence | Action |
|---|---|---|---|---|
| 10 | Medium (data integrity) | Module coding attempts were never closed unless the student came back: 11 stuck in progress past their deadline, nine with every answer already saved, so their work was never graded. | `scripts/auditStuckSessions.js`, `auditStuckModuleCoding.js` (read-only) | **Fixed for recent ones:** `sweepExpiredModuleCodingAttempts()` in the existing auto-finalize scheduler closes attempts that expired within the last 48 h (`MODULE_CODING_SWEEP_MAX_AGE_HOURS`), grading them exactly as a late finalize does. `verifyModuleCodingSweep.js`: 6/6 on the live host. |
| 11 | Needs your decision | The 10 older stuck attempts are 15 to 76 days overdue (`Introduction to Java` 9, `Java Basics` 1). Grading them applies the rules to old work and could change module access or issue certificates. | same | **Not touched.** Left for an approved one-off. |
| 12 | Low | 86 mock-interview sessions are in progress past their deadline (all of them). The create route already abandons an expired one when the student starts a new one, so flows are unaffected, but counts and analytics include them. | `auditStuckSessions.js` | Not changed: needs a product decision (an "abandoned" status vs finalizing into a scored report). |
| 13 | Low | 2 AI voice interview sessions past their expiry are still active. The expiry timer lives with the live connection, so a dropped connection leaves nothing to close it. | `auditStuckSessions.js` | Not changed: closing triggers AI evaluation, and AI quota is limited. |

Formal tests and readiness assessments: 0 stuck (their sweeps work).

The first run of the new sweep in production may close one real attempt that expired about 21 hours before the deploy (all three answers saved); that is the intended behaviour and equivalent to the student returning.

## Update: third audit pass (verification batch, request logs, metrics)

### Verification scripts for the previously unaudited areas (run on the live host, each on disposable data)

22 of 26 passed outright: attendance and certificate flows, certificate codes, talent pools (25/25), results export and bulk import, LMS and multi-institute isolation (30/30), admin stats scoping, admin audit and institute admin, role-fix routes, profile edit permissions (32/32), roll-number integrity (13/13), publish hierarchy, feature management, issue reports, platform health guard, review ownership, exam security, secure exam, module coding and formal test flows, formal test autosave (10/10), test creation overhaul (26/26).

The other four were test problems, not product bugs:
- `verifyResultManagementV2` was stale: the create-exam route (by design) now requires an academic group. Script updated; now 18/18.
- `verifyReadinessAndTalentPoolFlows` and `verifyReadinessStrictProctoring` pick an institute where the `readiness_test` feature is switched off (403 "Feature not available"). Environmental. Not re-run against an institute with the feature on.
- `verifyModuleCodingAutosubmit` targets an assessment that is now a draft ("not currently available"). Stale; not updated.

### Real traffic, 9 days of request logs (101,296 requests; `scripts/analyzeRequestLogs.js`, read-only)

- Server errors outside 2026-10-07: 1, 1 and 0 on the other days. The platform is stable under real use (2026-10-08: 18,089 requests, about 143 users, 1 error).
- 2026-10-07 shows 1,030 server errors and a 67 s median on the attempt finalize endpoint. That day is the synthetic secure-exam load test (2,961 distinct users in one day, 60,112 requests), not a student incident. It does show the capacity limit: about a third of ~3,000 near-simultaneous coding finalizations failed when the judge saturated. The judge now runs as a separate service (see `BACKEND_STRUCTURE.md`), but a repeat of that test has not been run against it.
- Requests with `undefined` in the URL (a client building a URL from a missing id): 10 in total, all from verification scripts failing earlier the same day. No real client bug found.
- Login: 4,794 attempts, 720 failures, 272 rate-limited. The limiter is keyed by IP plus email, so a shared campus network cannot lock out other students. On 2026-10-08 there were 176 wrong-password failures and 175 lockouts: students retrying credentials they probably never received, consistent with the known email-delivery limit (see project notes). Not a limiter bug.
- Scanner noise (wp-login, .env, wp-json) is answered 404 quickly; no action.

### Monitoring added

`backend/src/utils/metrics.js` now keeps a bounded per-route breakdown (slowest by p95, routes with 5xx) in the existing monitoring snapshot (`routeTiming`), so the next audit can use live data instead of logs. Verified by `scripts/verifyRouteMetrics.js`. The first version keyed failing routes without their mount path; fixed in the same pass and covered by the test.

### Read-only analysis tools added

`analyzeRequestLogs.js`, `analyzeRouteByDay.js`, `analyzeBadPaths.js`, `auditStuckSessions.js`, `auditStuckModuleCoding.js`.

## Update: fourth audit pass (AI reliability, mobile layout)

### AI features (`scripts/auditAiReliability.js`, read-only, from `AiUsageLog`)
- Very little use: 131 calls in 14 days. Everything except admin question generation succeeds 87-100% of the time.
- `question_bank_generate`: 44% success over the window. The parse failures (`INVALID_RESPONSE`: 5 on Sep 11, 13 of 13 on Sep 30) predate the 2026-10-05 fix that normalises the model's answer format. Since the fix: 2 on Oct 5 and 2 of 4 calls on Oct 8, a sample too small to conclude from. The rest is quota or rate limiting (10 daily-quota and 11 rate-limited errors, mostly Oct 5).
- Gap found and fixed: a rejected reply recorded no reason, so the next failure could not be diagnosed. `aiService.js` now logs `ai_invalid_response` with the reason and reply length (never the content).

### Mobile layout (`e2e/tests/pages.spec.js`: every page without URL parameters for four roles, 75 pages, at 375, 320 and 1280 px)
- No page crashed, rendered blank, or showed "undefined"/"NaN". All findings were pages scrolling sideways on a phone: 34 problem lines on about 22 pages (Resume 758 px on a 375 px screen, Mock Interview hub 602 px, test creation 561 px, audit log 458 px).
- Causes: (1) a long `<option>` or intrinsic input width sets a control's width; (2) a wide child stretches a grid or flex track past the screen; (3) rows of buttons or tabs with inline `display:flex` that do not wrap; (4) four grids demanding 260-420 px minimum columns; (5) a chart that keeps its old pixel width when the window narrows.
- Fixes: shared rules in `theme.css` at 640 px and below (controls and their containers shrink, grid/flex children shrink, inline flex rows wrap, tables' containers shrink, file inputs shrink), four grids made adaptive (`minmax(min(Npx, 100%), 1fr)`), and charts clipped to their container.
- Result on the final run: 63 browser tests passed (every page, accessibility, dark-mode contrast, dashboards, login, exam journeys, fullscreen, resilience, role access). Two admin pages still scroll slightly at 320 px only (`/admin/users`, `/admin/staff-clerk`); the overflow is not attributable to any element and four rounds of fixes did not clear it. They are named as accepted residuals in the test.
- Not checked: how the wrapped rows look (the tests prove no sideways scroll, not that the wrapped layout is attractive), real phones, iOS Safari, pages that need a URL parameter (a lesson, a test, an exam result).
