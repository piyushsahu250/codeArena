# Backup & Recovery

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## Documentation Backup vs. Data Backup — Read This Distinction First

**These are two completely different things.** This `/docs` folder (and its accompanying [platform-manifest.json](platform-manifest.json)) is a **documentation backup** — a portable description of the platform's architecture, features, database schema, APIs, permissions, and business rules. It contains **zero real student/staff/production data**. It is not, and must never be presented as, a backup of the actual platform data.

## A. Platform Documentation Backup (this `/docs` folder)

Contains: architecture description, feature inventory, database schema description, API reference, permission matrix, business rules, change history. Portable to another Claude session, another developer, or another AI system with no other context. See [README.md](README.md) for the full index.

**To "back this up" further**: it's just files in the git repository — committing them to `main` is the backup. No additional mechanism is needed or exists beyond normal git history.

## B. Actual Data Backup

Contains: the real PostgreSQL database (student/staff/institute records, attendance, results, question banks, certificates, audit logs — everything in [DATABASE.md](DATABASE.md)) and any externally-linked uploaded documents.

### What Exists

**A single on-demand, admin-triggered database dump route**: `GET /api/backup/database` (ADMIN only, +Institute scoping present on the route though a full `pg_dump` is realistically a platform-wide operation — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md)'s note on this). Shells out to `pg_dump` against `DATABASE_URL`, buffers the entire dump in memory, and returns it as a downloadable file. Implementation: `backend/src/routes/backup.js`.

A separate **Export Center** (`GET /api/export/:entity`, ADMIN/STAFF/CLERK +Institute) provides CSV/Excel/JSON exports of specific entities (students, staff, results, certificates, question banks, etc.) — this is a data-export feature for reporting/portability, **not a restorable database backup**.

### What Does NOT Exist

- **No automated/scheduled database backup.** Nothing runs `pg_dump` on a timer. A backup only happens when an Admin manually visits the Backups page and triggers one.
- **No verified restore procedure documented in this codebase.** The `pg_dump` route produces a dump file; there is no corresponding "restore from dump" route or documented `psql`/`pg_restore` runbook found in this repository.
- **No off-site/redundant storage of backups.** A triggered dump is downloaded to whoever's browser requested it — it is not automatically stored anywhere else (S3, another region, etc.), as far as this codebase shows.
- **No file-storage backup mechanism** for uploaded documents (though most documents are stored as external links per this session's earlier audit — the "storage" being backed up would be whatever external service hosts those links, which this platform does not control).

### What This Means Practically

**If the production database were lost or corrupted right now, recovery would depend entirely on whatever backup Render's own managed-Postgres offering provides at the infrastructure level** — this codebase's own backup capability is manual-trigger-only and has no automated cadence. **This is a real, standing operational gap**, not a hypothetical one. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) KI-006.

## Recommendations (not implemented — flag to the user, do not silently build)

- A scheduled job (or a Render Cron Job, if available on the current plan) that triggers `pg_dump` on a regular cadence and uploads the result somewhere durable and separate from the primary database.
- A documented, tested restore procedure.
- Verification that Render's managed PostgreSQL plan includes its own point-in-time-recovery or automated snapshots — if so, that may already substantially cover this gap, but it was **not verified during this documentation pass** since it's outside this repository's code.

## Before Any Schema or Data-Touching Change

Given the backup gap above, treat every non-additive schema change (see [DATABASE.md](DATABASE.md) §1) and every bulk data-correction task as higher-risk than it would be on a platform with automated backups. Prefer additive/reversible changes; when a destructive change is genuinely necessary, ask the user to trigger a manual backup via the existing Admin Backups page first.
