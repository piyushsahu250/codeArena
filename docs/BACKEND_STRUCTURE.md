# Backend structure, permissions, judge service and browser tests

What exists today, what was verified, and what was deliberately left alone.

## 1. Layering (controller / service)

New and migrated code follows `src/modules/<name>/`:

| File | Responsibility |
|---|---|
| `<name>.routes.js` | URL, authentication, permission check, nothing else |
| `<name>.controller.js` | read the request, call the service, choose the status code, log failures |
| `<name>.service.js` | the business logic and database reads; no `req`/`res` |

**Migrated so far:** `modules/studentDashboard` (the old `routes/studentDashboard.js` now only re-exports it, so `index.js` is unchanged). Its output is identical; `scripts/verifyStudentDashboard.js` covers it.

**Not migrated:** the other ~45 files in `src/routes/` still hold route, controller and query code together. They work and are tested; moving them is a mechanical but large change, so it should be done one module per release, each guarded by its verify script, rather than in one sweep. A repository layer (a file of Prisma queries per module) is not introduced yet: it would only add indirection until services are shared between modules.

## 2. Permissions

Tables `Permission(key, description)` and `RolePermission(role, permissionKey)`; code in `src/utils/permissions.js`.

- `can(user, "staff.console")` and the route guard `requirePermission("staff.console")`.
- The code registry is the default grant table. At boot `seedPermissions()` adds permissions that do not exist yet with their default grants; it never changes an existing permission, so edits made in the database stay.
- Checks read the tables through a 60 s cache. If the tables are empty or unreachable the registry answers, so a database fault cannot lock everyone out or widen access. Unknown keys are denied.
- `GET /api/auth/permissions` returns the signed-in account's permissions for the UI. The UI may hide controls with it; the server still enforces every request.
- There is no user-to-role table: every account has exactly one `User.role`, so one would add nothing. If multi-role accounts are ever needed, add `UserRole` then.
- Each key mirrors an existing `requireRole(...)` list exactly. `scripts/verifyPermissions.js` checks all 8 keys x 6 roles against the original lists.

**Converted:** `studentDashboard` and `adminCommand` (8 routes). **Not converted:** the roughly 600 other `requireRole(...)` calls. They keep working unchanged. Convert a route by replacing the list with the key whose role set is identical (most lists map to `staff.console`, `institute.console`, `student.portal`, `platform.console`, `placement.console`); add a new key only when a route needs a different set.

## 3. Judge service

`src/judgeServer.js` runs student code in its own container (`codearena-judge`, same image, `JUDGE_ROLE=server`) with its own CPU and memory limits, no database credentials and no published port. The API reaches it at `http://codearena-judge:4100` on the private network `codearena-net`.

- Requests are signed: HMAC-SHA256 over `timestamp.body` with `JUDGE_SHARED_SECRET`, 60 s window, constant-time compare.
- `src/utils/judgeGateway.js` is the one entry point used by routes. It falls back to running in-process only when the service cannot be reached (connection refused, DNS failure). A timeout is surfaced, never retried locally, so a submission cannot run twice.
- Switched by `JUDGE_REMOTE_ENABLED=1` in `container.env`; `scripts/deploy-aws-host.sh` generates the secret, starts the judge first, and gives the API `JUDGE_URL` only if the judge became healthy.
- `/api/health` reports `checks.judge`.
- `scripts/verifyJudgeService.js` (inside the API container) checks health, unsigned / wrong-secret / replayed / tampered requests, remote execution, a time-limit case and 12 concurrent submissions. `--fallback` is run with the judge stopped.

Limit: it is still one host. The service can now be moved to another machine (set `JUDGE_URL` to it), but there is no autoscaling.

## 4. Browser end-to-end tests

`frontend/e2e` (Playwright) runs on the AWS host with `scripts/run-e2e-host.sh`. It builds the SPA against the local API, seeds disposable accounts with `backend/scripts/e2eSeed.js` (removed afterwards, even on failure), and keeps all credential entry on localhost.

Coverage: login and logout, role-based access, all five dashboards, responsive layout 320-1920 px, light and dark contrast (WCAG AA), accessibility (axe), a student taking and submitting a test, a finished test not restarting, a PROCTORED second-tab takeover, and no question content before the attempt starts.

Not covered: a real mobile device, other browsers than Chromium, the secure exam desktop client, load.
