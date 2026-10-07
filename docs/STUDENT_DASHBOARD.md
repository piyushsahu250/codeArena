# Student Dashboard

## Before (audit)
- `pages/StudentDashboard.jsx` fired ~8 parallel requests plus a heavy waterfall (`/learning/courses/:slug`) on mount.
- Missing metrics rendered as `0` (`?? 0`); `user.name.split(" ")[0]` could throw; raw `toLocaleString` dates.
- Readiness score was composited client-side; no per-subject readiness, difficulty split, certificates list, announcements or pending-task list.
- Notifications on the dashboard were derived on the fly, not the persisted `Notification` model.

## Now
- **One request:** `GET /api/student/dashboard` (`backend/src/routes/studentDashboard.js`), student-only, keyed by the JWT user (no id accepted from the client).
- **Per-section isolation:** a failing section returns `{ error: true }`; the UI shows a retry for that card only.
- **Honest data:** unavailable metrics are `null` ("Not available yet"), never `0`. Expired, never-attempted tests are not "tasks".
- **Scoping:** tests via `testEligibilityWhere`, course via `courseEligibilityWhere`, notifications/announcements/certificates by `recipientId`/`studentId`.
- **No hidden data:** DTO fields only; coding section returns counts, never test cases.
- **Caching:** only recommendations (existing 5-min cache). Tests, timers, results are never cached.

## Frontend
- Tokens: `frontend/src/styles/studentDashboard.css` (`--sd-*`, mapped onto theme.css; dark mode has its own overrides).
- Components: `frontend/src/components/student/` (`sdKit.jsx`, `LearningSections.jsx`, `CareerSections.jsx`, `PerformanceChart.jsx` – lazy, no chart library).
- Header/search/notifications/help/profile: existing `Navbar` + `GlobalSearch` (unchanged). Sidebar: existing collapsible/drawer `Sidebar`, student menu regrouped (Academy / Assessments / Coding / Career / Performance / Profile / Settings), still feature-gated.
- Preferences: compact/comfortable density in `localStorage` (`caStudentDashDensity`); sidebar collapse already persisted.
- Analytics: `track()` dispatches a `ca:analytics` window event (dashboard_opened, continue_learning_clicked, quick_action_clicked, task_clicked, recommendation_clicked, certificate_download_clicked, next_action_clicked). No collector is attached.

## Verify
`docker exec codearena-backend node scripts/verifyStudentDashboard.js` (creates and removes two throwaway institutes).

## Rollback
Revert the commit; the legacy `/api/dashboard/student` route is untouched. No schema changes.
