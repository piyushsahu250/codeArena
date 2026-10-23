# UI/UX audit (2026-10): inventory, baseline, findings

Living document, newest information at the bottom of each section. Method: a report-only browser probe (`frontend/e2e/tests/uxAudit.spec.js`, its own CI step "UI/UX audit probe") walks the parameterless pages of the four seeded roles at 1280x720 and 375x667 and prints findings and performance as CI annotations; findings are then read in the code, fixed one at a time and re-checked by the next probe run. Status words: **FIXED, VERIFIED** (a test or the probe confirms), **FIXED, NOT VERIFIED**, **OPEN**, **NOT A BUG**, **BLOCKED**.

## Inventory (from `frontend/src/App.jsx`)

136 `<Route>` elements: 24 public (marketing, sign-in, verification-by-code pages), 29 student, 37 admin-or-staff, 27 admin, 8 clerk, 6 student/admin/staff (learning), 2 super-admin, 1 any signed-in role, 1 staff/clerk, 1 admin/super-admin/institute-admin, plus the 404 route. 25 are gated by a feature flag (`FeatureProtected`). The existing browser suite renders 78 parameterless routes (22 student, 24 staff, 24 platform admin, 8 clerk) and checks for blank pages, "undefined"/"NaN" text, error pages and sideways scroll at 320, 375 and 1280 px. **Not covered by any browser test before this audit:** routes with URL parameters (detail and edit pages), browser history, scroll reachability, overlays, forms, the 24 public pages beyond the accessibility scan, and the institute-admin role (it shares the platform-admin account's pages in the seed).

## Performance baseline (CI run of 07c3b1a, 2026-10-23; local server, small database, cold loads, headless Chromium)

| Role (pages) | LCP median | LCP p90 | Slowest page | Worst CLS (largest shifting element) |
|---|---|---|---|---|
| student (22) | 124 ms | 399 ms | /portfolio 546 ms | /interview/companies 0.662 (`main.ca-page-enter`); /dashboard/performance 0.211 |
| staff (24) | 385 ms | 439 ms | /staff/interview-drafts 547 ms | /staff/interview-reports 0.525 (`form.card`); /staff/interviews 0.434 (`main.ca-page-enter`) |
| platform admin (24) | 390 ms | 403 ms | /admin/exports 554 ms | /admin/staff-analytics 0.201; /admin/users 0.178 |
| clerk (8) | 377 ms | 552 ms | /clerk/exports 552 ms | /clerk/placement-analytics 0.217; /clerk/exports 0.203 |

Long-task time is 0 ms on all but `/challenges/daily` (141 ms, the code editor). These are a floor, not field measurements: the server is local and the database tiny. INP could not be measured (no interaction script); memory behaviour was not measured; real-device and production-network numbers are NOT RUN.

## Findings

| ID | Page(s) / role | Finding | Severity | Status |
|---|---|---|---|---|
| UX-1 | about 74 pages with a Back button, all roles, phone width | The shared Back button (`.ca-back-btn`) was 23 px tall: below the 24 px minimum touch target (WCAG 2.5.8). Cause: 12.5 px text with 4 px padding and no minimum height. Fix: `min-height: 32px`, `padding: 4px 10px` in `theme.css`. Test: `touchTargets.spec.js`. | P3 | FIXED, NOT VERIFIED until CI |
| UX-2 | phone width, forms and lists | Selects 21 px tall, native checkboxes and radio buttons 13 px, `<summary>` rows 16 px. Fix: phone-width-only rules in `theme.css` (select 32 px, checkbox/radio 20 px, summary 24 px; the custom switch is excluded). Test: `touchTargets.spec.js`. Not changed: a few single buttons (Delete 52x18 on /admin/users, "View usage" 77x17, the resume zoom buttons) are page-specific and listed for the next batch. | P3 | FIXED, NOT VERIFIED until CI |
| UX-3 | /interview/companies, /staff/interviews, /staff/interview-reports, /clerk/placement-analytics, /admin/staff-analytics, /admin/users, /clerk/exports, /dashboard/performance | Cumulative layout shift 0.18 to 0.66 on cold load (0.1 is good, 0.25 poor). The probe names the shifting element (`main.ca-page-enter`, `form.card`, `div`) but not why; the next probe run records the element's rectangle before and after. | P2 | OPEN (investigating) |
| UX-4 | /resume (student) | Two vertical scrollbars: the page scrolls and so does the live-preview pane (`overflow: auto; max-height: 80vh`, `ResumeBuilder.jsx`). The pane is a deliberate scaled preview, but a scroll area inside a scrolling page traps touch scrolling on phones. | P3 | OPEN (decision: keep, or let the preview grow with the page) |
| UX-5 | /interview/certificate (student) | `GET /api/interview/certificate` answers 400 for a student who has not earned the certificate. The page shows the message ("Complete more interviews..."): by design. | n/a | NOT A BUG |
| UX-6 | /dashboard (student) | The probe saw one `request failed` for `/api/student/dashboard` (an aborted request). Not yet explained: either the page leaves the request unfinished when the probe changes the window size, or the page cancels and repeats it. | P3 | OPEN (investigating) |

**Checked, nothing found:** the probe's history walk (click through the sidebar, Back x3, Forward x1) and the Back-after-sign-out check printed no anomaly for any role; no console error or uncaught error on any of the 78 pages; no page that cannot be scrolled to its end (html/body locked) at either size. These are results for the parameterless pages of the seeded accounts only.

## Not yet audited (next batches)

Detail/edit routes, overlays and modals (focus, Escape, scroll lock), forms (state kept after errors, double submit), session expiry mid-page, the exam and code-editor pages under touch, the 24 public pages for history and layout, 320 px and 768/1024/1920 widths for layout (the existing suite covers 320/375/1280 for overflow only), INP and memory, production-network performance (needs approval).
