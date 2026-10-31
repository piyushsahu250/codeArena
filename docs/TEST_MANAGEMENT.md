# Test Management

A dedicated area for staff and administrators to organise, switch on/off, archive and group tests, plus **Test Series** that bundle existing tests and are assigned to academic groups and Talent Pools. Students get a Test section with *Individual Tests* and *Test Series*.

Nothing here replaces the existing test engine. Creating, scheduling, assigning, taking and scoring a test work exactly as before.

## Concepts

| Term | Meaning | Where stored |
| --- | --- | --- |
| Published | The person's decision that students may see the test | `Test.isPublished` (existing) |
| Active | Switched on for **new** attempts. A published test can be inactive | `Test.isActive` (new, default true) |
| Archived | Off working lists and student lists; results kept; restorable | `Test.archivedAt` (new) |
| Window | Start/end time of the test | `Test.startTime/endTime` (existing) |
| Starred / Hidden / Folder | **Per-user** marks. Never affect students, assignment or results | `TestUserState` |
| Series | Ordered set of existing tests; owns no questions, schedule for its tests or results | `TestSeries`, `TestSeriesItem` |
| Series assignment | A series given to one academic group or Talent Pool, with its own window or **No Expiry** | `TestSeriesAssignment` |

A student can start a test only if it is published, active, not archived, inside its window, eligible by the existing rules, and (when the student reaches it through a sequential series) not locked.

## Staff/Admin screens (`/staff/test-management`)

Overview, Tests (All, Active, Inactive, Published, Unpublished, Starred, Hidden, Archived), My folders, Test Series, Assignments, Results & Analytics. Lists are paginated and filtered on the server (search, window, academic group, folder). Bulk actions return a per-test result; archive, switch-off, unpublish and publish need explicit confirmation (server returns `409 needsConfirmation` otherwise). The previous page stays at `/staff/tests/classic`.

Student: `/tests` (tabs Individual Tests, Test Series) and `/tests/series/:id`.

## API (`/api/test-management`)

Staff (`staff.console` or `institute.console`): `GET /overview`, `GET /tests`, `POST /tests/bulk`, `GET /tests/:id/results-by-group`, folders `GET|POST /folders`, `PATCH|DELETE /folders/:id`, `GET /assignment-options`, `GET /assignments`, series `GET|POST /series`, `GET|PUT /series/:id`, `POST /series/:id/action/:action` (publish, unpublish, activate, deactivate, archive, restore), `POST /series/:id/assignments/preview`, `POST /series/:id/assignments` (needs `confirm:true`), `PATCH|DELETE /series/:id/assignments/:aid`, `GET /series/:id/report`, `GET /series/:id/report.csv`.
Student (`student.portal`): `GET /student/series`, `GET /student/series/:id`.

Rate limits: writes 120/min, bulk 30/min, exports 10/min.

## Permissions

- Staff see and change only tests they created or that are shared with them (existing ownership rules); their folders, stars and hides are private to them.
- Administrators act institute-wide (folders of others are view-only). Super Admin is unrestricted by institute.
- Another person's series, folder or assignment answers 404. Assigning is limited to academic groups of the actor's own institute; Talent Pool assignment is administrator-only.
- Series never bypass test rules: every start is checked by the existing engine, then by the sequential-lock check on the server.

## Multi-department use

One test can be assigned to many groups through its existing assignments. One **series** can be assigned to many groups/pools as separate assignment rows, each with its own opens/closes/No Expiry/deadline/instructions. Series reports list groups separately and can be filtered by group or pool; the per-test "results by group" view never merges groups. Assigning to one group never exposes anything to another.

## Database changes

Additive only: `Test.isActive boolean default true`, `Test.archivedAt timestamptz null`, and tables `TestFolder`, `TestUserState`, `TestSeries`, `TestSeriesItem`, `TestSeriesAssignment` (indexes on owner, institute, status, position, targets; uniques prevent duplicate folder names, duplicate states, duplicate items and duplicate assignments). Applied with `prisma db push`; existing rows get `isActive=true`, `archivedAt=null`, so every existing test behaves as before.

### Migration validation
After deploy: `SELECT count(*) FROM "Test" WHERE "isActive" IS NOT TRUE OR "archivedAt" IS NOT NULL;` must be 0. Student test lists and attempt counts should equal the pre-deploy numbers.

### Rollback
No data is rewritten. To roll back, redeploy the previous backend and frontend; the new columns/tables are ignored by the old code. Dropping them is optional and only after confirming no one needs the series data.

## Audit
Actions logged: `TEST_STATE_CHANGED`, `TEST_FOLDER_CHANGED`, `TEST_SERIES_CHANGED`, `TEST_SERIES_ASSIGNMENT_CHANGED`, `TEST_RESULTS_EXPORTED`.

## Tests
`backend/test/testManagementRules.test.js` (pure rules) and `backend/test/testManagement.integration.test.js` (HTTP scenarios against a seeded DB, run in CI): folders private and non-destructive, star/hide personal, published vs active, archive keeps results, bulk per-test results, series build/reorder/version conflict/IDOR, assignment confirmation/No Expiry/duplicates/institute and pool authorisation, student view and progress, sequential lock enforced on `/api/tests/:id/start`, series report and CSV, existing workflow unaffected.

## Known limitations / deferred
- **Per-assignment schedules for individual tests** (one test, different windows per department) are not implemented: the test engine has a single window per test. Use a series assignment (which has its own window) or duplicate the test for a different window.
- Series have no attempt limits or combined score of their own; each test keeps its own marks and attempt rules.
- Staff cannot assign series to Talent Pools (administrator-only, as for tests).
- Series reports are capped at 20,000 students per export.
- No automatic expiry job: expiry is evaluated at read time from stored timestamps.
