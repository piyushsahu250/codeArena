# Known Issues

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

Historical entries are never deleted from this file — if an issue is later fixed, it moves to [FIXED_ISSUES.md](FIXED_ISSUES.md) with a cross-reference, it is not erased from here silently.

---

### KI-001 — Interview Question Bank has no institute/creator isolation
- **Date identified:** 2026-08-08 (this session's RBAC/isolation audit)
- **Module:** Mock Interview
- **Problem:** `InterviewQuestion` and `CompanyInterviewProfile` have no `instituteId`/`createdById` columns at all — confirmed against `backend/prisma/schema.prisma`. Any STAFF account can edit or delete any interview-prep question or company round-plan authored by staff at a different institute, via `interview.js`'s `/admin/questions*` and `/admin/company-profiles*` routes.
- **Contrast:** The main Question Bank (`questions.js`) enforces both institute isolation and per-staff-creator privacy on every route — this is the one write-capable STAFF surface on the platform confirmed to have zero tenant isolation.
- **Status:** Not fixed. **Ambiguous whether this is a bug or an intentional "shared platform-wide interview bank" design** — flagged to the user for a scoping decision rather than unilaterally changed, since fixing it is a schema change (new columns + backfill/migration of existing rows) affecting a currently-shared resource, not a same-session bug fix.
- **Recommendation if fixing:** add nullable `instituteId`/`createdById` to both models (additive, safe under `prisma db push`), decide backfill strategy for existing rows (leave `null` = shared/legacy, matching the main Question Bank's own convention), then mirror `questionVisibilityWhere()`/`ownsQuestionRow()` onto the interview routes.

### KI-002 — No continuous-absence-alert feature exists
- **Date identified:** 2026-08-08 (this session's Attendance module audit)
- **Module:** Attendance
- **Problem:** The spec expectation (3 consecutive working-day absences, 3 consecutive subject absences, excluding holidays/approved leave, triggering an alert) has **no implementation at all** — no scheduler/cron infrastructure exists anywhere in the backend (confirmed via a repo-wide search for cron/scheduler patterns), no alert data model, nothing partially built.
- **Status:** Not built. This is a missing feature, not a regression — flagged for scoping (needs a holiday-calendar source, a scheduled job mechanism, and a notification channel decision) rather than silently built under a "fix" banner.

### KI-003 — `institutes.js` GET routes for admin-only platform data are not institute-scoped
- **Date identified:** 2026-08-08 (this session's error-handling/performance audit)
- **Module:** Admin / System Monitoring
- **Problem:** `admin.js`'s four routes (`/stats`, `/question-audit`, `/email-logs`, `/monitoring`) have no `attachRequesterInstitute` — an institute-scoped Admin sees platform-wide data (all institutes' stats/email logs/monitoring/question-audit), not just their own institute's.
- **Status:** Not confirmed as a bug — could be intentional (this data may be considered platform-operational, not tenant-confidential). Documented here as **NOT VERIFIED as intentional** rather than fixed or left unflagged; needs a product decision on whether institute-level confidentiality should apply to this specific data.

### KI-004 — `PlacementOffer.companyId` has no index
- **Date identified:** 2026-08-08 (this session's performance audit)
- **Module:** Placement
- **Problem:** `PlacementOffer.companyId` is an unindexed FK-like `String?` field.
- **Status:** Confirmed **not currently exploitable** — no route filters `PlacementOffer` by `companyId` today (it's only ever written, never used in a `where` clause). Flagged as informational only; add the index if a future feature queries offers by company.

### KI-005 — `LecturePlan.testId` unindexed for standalone lookup
- **Date identified:** 2026-08-08 (this session's performance audit)
- **Module:** Attendance / Talent Pool
- **Problem:** `testId` only appears inside the `@@unique([assignmentId, testId])` compound index (assignmentId-leading, so a `testId`-only lookup can't use it) and inside a P2002-swallowing `create().catch()` — never as a standalone `where: { testId }` filter today.
- **Status:** Not currently exploitable. Worth revisiting if a future feature queries lecture plans by test alone.

### KI-006 — No automated database backup schedule
- **Date identified:** 2026-08-08 (this documentation pass)
- **Module:** Infrastructure / Backups
- **Problem:** The only database backup mechanism is an on-demand, admin-triggered `pg_dump` route (`GET /api/backup/database`). There is no scheduled/automatic backup job. See [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
- **Status:** Confirmed absent, not a bug — a standing infrastructure gap the user has been made aware of, not something silently assumed to exist.

### KI-007 — Documentation itself has known coverage gaps
- **Date identified:** 2026-08-08 (this documentation pass)
- **Module:** Documentation
- **Problem:** Full request/response schemas are not documented for all 394 endpoints (only method/path/role) — see [API_DOCUMENTATION.md](API_DOCUMENTATION.md)'s own scope note. Several module docs (see each file's own NOT VERIFIED markers) rely on route/schema names without re-reading every handler's full body.
- **Status:** Intentional documentation scoping decision, not an error — flagged so a future reader doesn't assume more depth exists than what was actually verified.

---

For confirmed-and-fixed issues, see [FIXED_ISSUES.md](FIXED_ISSUES.md).
