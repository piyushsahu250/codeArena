# Staff & Clerk performance analytics

Command Centre module: `/admin/staff-analytics` (admins), `/admin/staff-analytics/:id` (one person), `/my-activity` (staff and clerks, own record only).
API: `/api/staff-analytics/*`, code in `backend/src/modules/staffAnalytics/` (domain, repository, service, controller, routes).

## Who can see what (decided on the server)
| Role | Access |
|---|---|
| SUPER_ADMIN, platform ADMIN (no institute) | every college; optional college filter |
| INSTITUTE_ADMIN, institute-bound ADMIN | own college only; asking for another college returns 403; another college's person is 404 |
| STAFF, CLERK | their own record (`/me`) only; no list, no peers, no ranking |
| STUDENT | none |

Permissions: `staffAnalytics.view` (admin tiers) and `staffAnalytics.self` (staff, clerk), in the central permission registry.
Isolation is applied in SQL by joining each audit event to the actor's own `User` row (institute, department, role). `AuditLog.instituteId` is not used because it records the institute of the student acted on and is often empty.

## Data sources
* **Activity**: `AuditLog` rows written when the action happened. One source, and each audit action belongs to exactly one category (checked at load time), so nothing is counted twice. Categories: test management, test conduct, question bank, talent pools, results processing, attendance, placement operations, learning content, data exports. The full action list is in the in-app "How these numbers are calculated" panel.
* **Portfolio** (shown separately, never added to activity): tests, attempts, talent pools and questions created by the person in the period, from their own tables.
* Directory: `User` (name, role, institute, department, designation, status, last login). Email and mobile are never returned.

## Metric definitions
* Counted events: audit events of categories that apply to the person's role, in the period (Asia/Kolkata days, `to` inclusive).
* Active days: distinct days with a counted event. Events per active day = counted events / active days. Busiest day = max events in one day. Students touched = distinct students named on counted events.
* Change vs previous: same-length period immediately before; shown only when the earlier period had events.
* Test rework share = (TEST_UPDATED + TEST_UNPUBLISHED + TEST_DELETED) / all test-management events.
* Result correction share = (RESULT_ENTRY_EDITED + RESULT_ENTRY_CORRECTED) / (RESULT_ENTRY_CREATED + RESULT_ENTRIES_BULK_IMPORTED + RESULT_ENTRY_EDITED + RESULT_ENTRY_CORRECTED).
* Ratios are withheld below 10 events. There is **no composite performance score**.

## Zero is not the same as missing
* `NOT_APPLICABLE`: the work does not exist for the role (a clerk cannot create tests). Never shown as 0 and excluded from totals.
* `NOT_TRACKED`: the platform has never recorded this activity. No number is shown.
* `PARTIAL`: recording began after the period started. The count is shown with the date recording began.
* `TRACKED` with 0: a real zero.
* Days before the platform first recorded any catalogued action are plotted as "no data", not zero.

## Privacy and security
* Server-side RBAC and institute scoping on every endpoint, drill-down and export; out-of-scope people return 404.
* Event drill-downs expose only whitelisted, non-personal detail keys; names, emails and student identifiers are dropped.
* Viewing a person, the event log, a comparison and every export are written to the audit trail (`STAFF_ANALYTICS_VIEWED`, `STAFF_ANALYTICS_EXPORTED`). Viewing your own page is not audited.
* Exports: CSV/XLSX are formula-injection safe, bounded to 20,000 rows, rate-limited to 10 per minute per user; PDF is bounded; responses are `no-store`.
* Read endpoints are rate-limited to 120 per minute per user.

## Performance
Aggregations run in SQL (`GROUP BY` over indexed ranges). `AuditLog` gained an additive index `(adminId, createdAt)`; existing `(action, createdAt)` serves the action filter. Platform-wide "first recorded" dates are cached for 10 minutes.

## Tests
`backend/test/staffAnalyticsDomain.test.js` (formulas, zero vs missing, dates, redaction), `backend/scripts/verifyStaffAnalytics.js` (real API and database: roles, isolation on list/detail/events/compare/export, exact counts, N/A vs not tracked vs zero, ratio gating, pagination, privacy, CSV/XLSX/PDF, audit entries), `frontend/e2e/tests/staff-analytics.spec.js` and the phone-width sweep in `pages.spec.js`.

## Known limits
* History starts when the platform began writing each audit action; nothing earlier is inferred.
* Some staff work leaves no audit event (for example, reading a report or searching students), so "no activity recorded" means no recorded events, not that the person did nothing.
* An audit event counts an action, not its effort or quality; a bulk import is one event. Compare people of the same role and similar duties.
* Only tests, talent pools and questions carry a creator in their own tables; results examinations do not, so result work is visible only through the audit trail.
* The list is capped at 5,000 accounts (flagged in the response).
