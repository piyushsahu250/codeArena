# Reports

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## What This Covers
There is no single "Reports" module/route file — reporting is distributed across each domain: Attendance reports (`attendance.js` `GET /reports`), Placement analytics (`placementOffers.js` `/analytics/*`), Result analytics (`resultManagement.js` `/admin/analytics`, `/admin/search`), Interview analytics (`interview.js` `/admin/analytics`, `/admin/stats`), Talent Pool dashboard/leaderboard (`talentPools.js`), Student performance report (`users.js` `/:id/performance*`), Resume stats (`resume.js` `/admin/stats`), plus the general-purpose Export Center. See each module's own doc for its specific reporting routes, or [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for the complete endpoint list.

## Export Formats
PDF (`pdfkit`), Excel/CSV (`xlsx`), plain JSON — varies per route; check the specific endpoint.

## Access Pattern
Every analytics/report route observed is ADMIN/STAFF (some also CLERK), +Institute-scoped — consistent with the rest of the platform's RBAC model. See [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md).

## Export Center (the general-purpose one)
`GET /api/export/:entity` (ADMIN/STAFF/CLERK, +Institute) — a shared route parameterized by entity name (students/staff/results/certificates/question banks, per project history's "unified export center"), capped at `MAX_ROWS = 5000` per export (per this session's earlier performance audit).

## Related
[BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) (Export Center is a *data export* feature, not a *database backup* — see that file's explicit distinction), [PERFORMANCE.md](PERFORMANCE.md).
