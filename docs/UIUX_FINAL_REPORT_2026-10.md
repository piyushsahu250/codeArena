# CodeArena UI/UX audit: final report (2026-10)

Scope: the platform-wide UI/UX audit, 15 batches, plus the related slow-page investigation, the coding editor audit and four backend fixes found along the way.
Companion documents: `docs/UIUX_AUDIT_2026-10.md` (every finding, UX-1 to UX-20, with its record) and `docs/PERFORMANCE_2026-10.md` (server and network measurements).

Rules used for results: **PASS** = automated check ran in CI and passed. **FAIL** = ran and failed. **BLOCKED** = could not be done here, reason given. **NOT RUN** = not attempted. "Measured" numbers come
from a CI browser probe against a local server with a small database; they are a floor, not what a user on a real network sees. "Estimate" is always labelled. No claim is made that the platform is bug-free.

## 1. Method
A report-only browser probe (Playwright, headless Chromium, production build) walked every parameterless page of the four seeded roles at a phone width (375 px) and a desktop width (1280 px) and printed
problems; further probes walked the 23 public pages, 28 ID-based detail routes with a missing ID, API requests per page, and the real timed test with touch emulation at three screen sizes.
Fixes were made on `ci/**` branches; each was merged to `main` only after lint, backend, frontend and integration jobs were all green on the exact commit. Probes ran on throwaway branches and were never merged.

## 2. Inventory
136 routes: 24 public, 29 student, 37 admin-or-staff, 27 admin, 8 clerk, 6 student/admin/staff (learning), 2 super-admin, 1 any signed-in role. The probe covered 78 parameterless pages (student 22, staff 24,
platform admin 24, clerk 8), 23 public pages, 28 detail routes, and the timed coding test.

## 3. Issues found and their status
| ID | Area | Finding | Priority | Status |
|---|---|---|---|---|
| UX-1, UX-2 | phone width, ~74 pages | Back button 23 px, selects 21 px, checkboxes 13 px, summary rows 16 px (below the 24 px WCAG 2.5.8 minimum) | P2 | Fixed (batch 2) |
| UX-3 | 8 pages across roles | Layout shift 0.18 to 0.66: the page slid in from the left because the sidebar padding animated on every load | P2 | Fixed (batches 4 and 15) |
| UX-4 | /resume | two vertical scrollbars (page and the live-preview pane) | P3 | OPEN: needs your decision (keep the scrolling preview, or let it grow) |
| UX-5 | /interview/certificate | HTTP 400 for a student who has not earned the certificate; the page shows its message | n/a | Not a bug |
| UX-6 | first page after sign-in | one cancelled `/api/features/me` request | n/a | Not a bug (the probe navigates away; the error is handled) |
| UX-7 | every dialog | dialogs taller than the screen clipped their buttons | P2 | Fixed (batch 3) |
| UX-8 | /staff/interview-reports, /dashboard/performance | content pushed down after data loaded (form +168 px; skeleton narrower than the page) | P3 | Fixed (batch 5) |
| UX-9 | phone width | page-specific buttons 15 to 22 px tall | P3 | Fixed (batch 5) |
| UX-10 | every write button | double click sent the same request twice (duplicate question, duplicate e-mail) | P2 | Fixed (batch 6) |
| UX-11 | 4 detail pages + 3 others | a missing record left "Loading…" forever or threw an uncaught 404 | P2 | Fixed (batch 7) |
| UX-12 | every page | after an expired session, sign-in went to the dashboard, not the page you were on | P2 | Fixed (batch 8) |
| UX-13 | /staff/interviews | the question list was requested twice on load | P3 | Fixed (batch 9) |
| UX-14 | 9 public pages | no `<h1>` | P3 | Fixed (batch 10) |
| UX-15 | public pages, phone | footer links 16 px, "Learn more" 17 px, "Forgot password?" 15 px | P3 | Fixed (batch 10) |
| UX-16 | exam pages, landscape phone | 380 px editor taller than the 375 px screen | P2 | Fixed (batch 11) |
| UX-17 | create / edit test | a reload or expired session lost the whole form | P2 | Fixed (batch 12) |
| UX-18 | create / edit question | same | P2 | Fixed (batch 13) |
| UX-19 | /register | a browser alert() instead of an in-page explanation | P3 | Fixed (batch 14) |
| UX-20 | /learning, /interview | the whole shell (sidebar and top bar) was swapped for a full-screen "Loading" while a page's code downloaded: layout shift 0.375 | P2 | Fixed (batch 15) |

No P0 or P1 issue was found. Fifteen of the twenty are P2 or P3 usability and accessibility defects; none lost data on the server.

## 4. Root causes (one line each)
Shared components with undersized or unbounded styling (UX-1, 2, 7, 9, 15, 16); a CSS animation on the page's left padding plus a missing loading boundary in the shell (UX-3, 20); loading placeholders sized differently from
the content (UX-8); no protection in the shared API client against an identical write sent twice (UX-10); reads with no error handler (UX-11); the sign-in page always going to the role's home (UX-12); two effects
loading the same data (UX-13); page titles written as `<h2>` (UX-14); long forms keeping no draft (UX-17, 18).

## 5. Fixes by batch (merge commit on `main`)
2 `e2dd9c1` touch targets; 3 `93ad71c` dialogs; 4 `3cea878` sidebar slide; 5 `17d4ff3` small buttons and loading placeholders; 6 `7edf7ed` double-click protection; 7 `9b230f2` missing records;
8 `cee326f` return to page after expiry; 9 `9f3c186` duplicate request; 10 `dbfb963` public pages; 11 `5b01dd6` landscape editor; 12 `a768888` test draft; 13 `d6b7791` question draft;
14 `20ffe86` register notice; 15 `bbf6161` shell loading boundary. All frontend-only except where noted in section 11.

## 6. Files and components changed (main ones)
`frontend/src/theme.css`, `App.jsx` (shell Suspense), `components/Sidebar.jsx`, `api.js` with `utils/dedupeWrites.js`, `utils/returnTo.js`, `utils/formDraft.js`, `utils/editorHeight.js`, `hooks/useShortLandscape.js`,
`pages/Login.jsx`, `Register.jsx`, `TestPreview.jsx`, `CreateTest.jsx`, `CreateQuestion.jsx`, `TestResults.jsx`, `InterviewAdmin.jsx`, `InterviewReports.jsx`, `StudentPerformance.jsx`, `TestTaking.jsx`,
`ModuleCodingAssessment.jsx`, `ReadinessAssessment.jsx`, nine public pages (h1), plus the e2e specs and regression scripts listed in section 18.

## 7. Navigation (Back / Forward, direct links)
Probe history walk (click through the sidebar, Back x3, Forward x1) and a Back-after-sign-out check: no anomaly for any role. 28 ID-based routes opened with a missing ID: 24 already handled it, 4 did not (fixed).
Sign-out ends the server session (earlier batch). Direct link after expiry now returns to the page (UX-12). **PASS** (CI). Not tested: Back/Forward timing on a slow network.

## 8. Scrolling, viewport and layout
No page found that cannot be scrolled to its end. Dialogs scroll inside themselves (UX-7). Sideways scroll: none found on the public pages or the exam page in the output that could be read. One open item: UX-4.
**PASS** with the open decision above.

## 9. Buttons, links and interactions
Touch targets under 24 px fixed on all pages the probes flagged (UX-1, 2, 9, 15). Double-click protection for every write (UX-10). **PASS** (CI). Checkboxes and radios are 20 px (accepted at the 24 px rule's
inline-control tolerance); the audit did not change them further.

## 10. Forms
Double submit (UX-10); draft kept and offered back for create-test and create-question (UX-17, 18); resume builder already saves per section and was left alone; expiry returns to the page (UX-12). Not covered: the
profile editors' drafts. **PASS** for the covered forms.

## 11. Dashboards, tables and API performance
Measured on production (read-only, 24 h of the live request log, 4,723 requests): zero server errors; student dashboard p50 83 ms / p95 223 ms; login p50 87 ms; database trivial query 0.8 ms; host load 0.06.
The server and database are not the bottleneck; the network path is. Three changes went live (deployed 2026-10-25, `a1e8177`): CORS preflight caching (`Access-Control-Max-Age: 7200`, confirmed on the live
API), `preconnect` to the API, `forgot-password` no longer waits for the mail server (it was p50 1.4 s, p95 12 s, and leaked account existence by timing). Request counts per page (78 pages): median 2 to 3, max 9; one
duplicate GET found and fixed. Backend fixes also live (deployed `17d4ff3`): readiness-test seed no longer re-creates deleted tests or overwrites edits, AI question generation repairs invalid JSON, interview analytics
trends sorted and bucketed correctly. **PASS** (CI, plus live header and health checks). The real-device effect of the preflight and preconnect changes is an **estimate**: one fewer round trip per call after the first
(about 0.2 s each from India) and about 1 s less on the first call of a cold page. It has not been measured from a user's browser.

## 12. Responsive design
Widths actually exercised by the audit probes: 375 and 1280 (all signed-in and public pages), 667x375 landscape and 768x1024 (exam page). The existing responsive suite has its own widths. **NOT RUN:** 320, 430, 1366 and
1920 in this audit.

## 13. Loading, empty and error states
Missing-record and failed-read states fixed (UX-11); loading placeholders sized to their content (UX-8); the shell stays mounted during a page load (UX-20). **PASS** (CI).

## 14. Accessibility
Nine public pages gained an `<h1>` (UX-14); touch targets (above); dialogs scroll and keep focus behaviour. Existing axe checks in CI stayed green. **NOT RUN:** a manual screen-reader pass; keyboard-only walk of
every page.

## 15. Role-specific UI
All four seeded roles (student, staff, platform admin, clerk) were probed. **NOT RUN:** a separate Institute Admin and a Super Admin walk (the test data has no second Super Admin; the database allows one).

## 16. Feature regression
The full CI suite (lint, backend unit tests, frontend regression scripts, the whole Playwright suite against a seeded database) was green on every merge. **PASS.** Not exercised: live production flows end to end.

## 17. Performance before and after (probe, local server, cold load; measured)
| Role | Worst layout shift before | Worst after (batch 15 base) | LCP median before | LCP median after |
|---|---|---|---|---|
| Student | 0.662 (/interview/companies) | 0.018 (/profile) | 124 ms | 360 ms |
| Staff | 0.525 (/staff/interview-reports) | 0.085 (/staff/interviews) | 385 ms | 372 ms |
| Platform admin | 0.201 (/admin/staff-analytics) | 0.113 (/admin/staff-clerk) | 390 ms | 361 ms |
| Clerk | 0.217 (/clerk/placement-analytics) | 0.042 (/clerk/placement-analytics) | 377 ms | 364 ms |

Layout shift: every role improved; every page is under 0.1 except `/admin/staff-clerk` at 0.113 (a card that moves; not yet fixed). **Student LCP rose from 124 ms to about 350 to 360 ms and stayed there in three
separate later runs** (351, 356, 360 ms); staff, admin and clerk did not change. The cause has **not been investigated**; it may be real or a difference between the baseline run and later runs, so it is listed
below as the first thing to look at. INP was not measured. No improvement in loading time is claimed from the frontend changes.

## 18. Tests executed
All run in CI (GitHub Actions) on the exact merged commit: lint, backend unit and integration suites, frontend regression scripts (`dedupeWritesRegression`, `returnToRegression`, `editorHeightRegression`,
`formDraftRegression`, `passwordPolicyRegression`, theme contrast and others), and the Playwright suite including the specs added in this audit: `touchTargets`, `modalShortScreen`, `layoutShift`, `shellStability`,
`missingRecords`, `noDuplicateRequests`, `publicPages`, `examLandscape`, `testDraft`, `questionDraft`, `registerNotice`, `editorCaseFidelity`, `issueReportDelete`. Result: **PASS** on every merge.
**NOT RUN locally:** nothing was run on a developer machine (no Node runtime was available in this environment); CI was the first and only run of each new test. **NOT RUN:** Firefox, Safari, Edge, a real phone, other
keyboard layouts, IME input, a load test (not permitted without approval), Core Web Vitals field data.

## 19. Remaining issues, blocked items, recommendations
1. **Student LCP 124 ms to about 355 ms** (section 17): investigate first; bisect between the baseline commit and the first later probe run.
2. **UX-4** `/resume` double scrollbar: your decision.
3. `/admin/staff-clerk` layout shift 0.113: one card moves after load.
4. **Editor "letters turn uppercase" report: not reproduced.** Typing lowercase code that looks like built-in names (string, map, date, vector) key by key in all five languages gave exactly what was typed in desktop Chromium,
   and every editor already disables phone auto-capitalisation. Remaining causes are outside the page: Caps Lock, a phone keyboard or transliteration IME, an extension. A specific device or test where it happened is needed.
5. A human pass on a physical phone with the keyboard open (exam pages, landscape question text sits above the editor), and a screen-reader pass.
6. Drafts for the profile editors; widths 320, 430, 1366, 1920; Institute Admin and Super Admin walks.
7. A real-device before and after for the preflight, preconnect and `forgot-password` changes.
8. Housekeeping decisions you have not answered earlier (older decision list, the 1,400/day e-mail allowance) are unchanged by this work.

Rollback: every merge is a single fast-forward commit on `main`; a frontend change is reverted by reverting its commit (Vercel rebuilds). The two backend deploys have rollback images on the host
(`codearena-backend:rollback-20261025054030` for `a1e8177`).
