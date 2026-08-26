# Automated Daily Platform Health System

## Scope decision (explicit, from the user)

**Detect + report only — no auto-deploy.** The health check never modifies application code, never
triggers a deploy, and never rolls anything back automatically. It reads/verifies live state and
writes one row to `PlatformHealthReport`. Every "fix" it might reveal is a human decision.

## What this actually is

- `backend/scripts/dailyHealthCheck.js` — a Node script, run manually (`node scripts/
  dailyHealthCheck.js`) or via a scheduled invocation (see "Scheduling" below). It:
  - Creates 3–5 temporary test accounts (via the same `createSession` mechanism a real login uses),
    hits real endpoints with real HTTP requests, and deletes the accounts + sessions afterward by
    exact ID — never a broad filter.
  - Checks institute isolation (an Institute-A admin can't reach an Institute-B student) and basic
    RBAC (a STUDENT session can't reach an admin-only endpoint).
  - Runs read-only data-integrity scans: duplicate PRNs, duplicate roll numbers within one academic
    group, orphaned Institute/AcademicGroup references, elevated email-failure rate in the last 24h,
    elevated AI-failure rate in the last 24h. **It reports these — it never deletes, renames, or
    merges any row.**
  - Submits one trivial Python program to the real judge sandbox and checks it actually compiles
    and passes — a genuine smoke test, not a status flag.
  - Calls the real AI service with a 10-token "reply with ok" prompt (only if `GEMINI_API_KEY` is
    configured) to confirm the provider is reachable and not silently broken.
  - Hits a handful of real per-role endpoints (STUDENT/STAFF/INSTITUTE_ADMIN) and flags 5xx/4xx
    responses and response times over 1s/2s/5s (P3/P2/P1).
  - Assigns each finding a priority (P0 critical / P1 high / P2 medium / P3 low), assembles an
    overall status (HEALTHY / WARNING / CRITICAL), and persists it to `PlatformHealthReport`.
  - Prints a plain-text summary to stdout.

- **"Report a Problem"** — a real, user-facing feature (not part of the automated check):
  - `frontend/src/components/ReportProblemWidget.jsx` — a floating button on every non-fullscreen
    authenticated page. Submits to `POST /api/issue-reports`, a real `UserReportedIssue` row.
  - `backend/src/routes/issueReports.js` — any authenticated user can submit and see their own
    reports; ADMIN/SUPER_ADMIN/INSTITUTE_ADMIN see an institute-scoped review queue and can set
    status/severity/notes by hand (`frontend/src/pages/IssueReports.jsx`, `/admin/issue-reports`).
  - `backend/src/routes/platformHealth.js` — SUPER_ADMIN-only read view of the health check's own
    history (`GET /api/platform-health/latest`, `GET /api/platform-health`).

## What this is explicitly NOT

These were considered and deliberately left out — do not assume they exist:

- **No automated test suite.** This codebase has none (confirmed by search across the whole repo).
  The health check's per-role/endpoint checks are a lightweight smoke test, not a substitute.
- **No staging environment or canary deploy.** Every deploy in this project goes straight to the
  single production EC2 instance.
- **No automatic fixing of anything**, low-risk or otherwise. Findings are reported; a human decides.
- **No auto-rollback on regression.** Rollback (`pre-<name>-<timestamp>` tagged images) remains a
  manual step a human takes after reviewing what broke.
- **No AI-based ticket classification.** Severity/status on a reported issue is set by the human
  reviewer in the admin queue, not inferred by a model.
- **No per-institute health dashboard.** `PlatformHealthReport` is platform-wide and SUPER_ADMIN-only.
- **No true latency percentiles (P95/P99).** The "slow" flags above come from a handful of on-demand
  smoke-test requests, not sampled production traffic. Treat a slow/fast reading from a single run
  as a signal to investigate, not a load-bearing SLA number.
- **A CRITICAL/WARNING/HEALTHY status with zero P0s does not mean "bug-free."** It means the
  specific checks this script runs passed on this one run. Read the actual `findings` array before
  trusting the headline status for anything important.

## Scheduling caveat (read before promising "runs every night at 2 AM")

If this is scheduled via the `scheduled-tasks` mechanism available in this environment: **that
scheduler only fires while the host app is open — if it's closed when the task is due, the task
runs on next launch instead of at the scheduled time.** A guaranteed fixed-time daily run needs a
real always-on scheduler (a cron job on the EC2 host itself, or a CI scheduled workflow) — see
whichever mechanism was actually wired up for this deployment before claiming a specific time.

## Running it manually

```bash
docker exec codearena-backend node scripts/dailyHealthCheck.js
```

Requires the script to already be present inside the running container (copy it in with `docker cp`
after any container recreation, same as every other one-off script in this project).
