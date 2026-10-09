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
