# Backup & Recovery

**Documentation Version:** 1.1.0 · **Last Updated:** 2026-11-16

## Documentation Backup vs. Data Backup — Read This Distinction First

**These are two completely different things.** This `/docs` folder (and its accompanying [platform-manifest.json](platform-manifest.json)) is a **documentation backup** — a portable description of the platform's architecture, features, database schema, APIs, permissions, and business rules. It contains **zero real student/staff/production data**. It is not, and must never be presented as, a backup of the actual platform data.

## A. Platform Documentation Backup (this `/docs` folder)

Contains: architecture description, feature inventory, database schema description, API reference, permission matrix, business rules, change history. Portable to another Claude session, another developer, or another AI system with no other context. See [README.md](README.md) for the full index.

**To "back this up" further**: it's just files in the git repository — committing them to `main` is the backup. No additional mechanism is needed or exists beyond normal git history.

## B. Actual Data Backup

> **Updated 2026-11-16.** The earlier text of this section (written 2026-08-08 for the previous Render host) said no scheduled backup existed. Production now runs on AWS and the state below was **read from AWS and the host with read-only calls on 2026-11-16** (audit `docs/AUDIT_2026-11_PHASE2.md`, finding A2-01). Nothing here was changed by the audit.

Contains: the real PostgreSQL database (student/staff/institute records, attendance, results, question banks, certificates, audit logs: everything in [DATABASE.md](DATABASE.md)). Uploaded images (question images) live in S3, not in the database.

### What exists (verified)

| Layer | What it is | Evidence on 2026-11-16 |
|---|---|---|
| **RDS automated backups** | RDS PostgreSQL 18.6 instance `codearena-db` (`db.t4g.micro`, 20 GB gp3, encrypted, private, single-AZ). Daily automated snapshot in the 18:20-18:50 UTC window and **point-in-time recovery for the last 7 days** | `BackupRetentionPeriod` 7; latest restorable time within minutes of the check; automated snapshots listed for each of the previous days |
| **RDS manual snapshots** | Taken by hand before risky changes | `pre-publish-hierarchy-20261007-0356` (2026-10-06), `codearena-db-manual-2026-10-28`. Manual snapshots do not expire |
| **Nightly logical dump to S3** | `/root/backup-db.sh` on the application host, run by cron at **20:00 UTC daily**: reads the connection string from SSM Parameter Store, `pg_dump --format=custom` (in a `postgres:18` container), refuses a dump under 1,000 bytes, uploads to `s3://codearena-backups-640538431170/`, confirms the object exists, and runs `pg_restore --list` as a structural check (1,062 entries) | Log shows a clean run on 2026-11-15; 32 objects in the bucket (about 34 MB each); a copy of the script is kept in this repository at `scripts/aws/backup-db.sh` |
| **S3 bucket protection** | Default encryption AES256; all public access blocked; lifecycle rule `expire-old-backups` deletes objects after **30 days**; **versioning is not enabled** | read with `s3api` |
| **Admin download** | `GET /api/backup/database` still exists (ADMIN, on demand) | route list |
| **Export Center** | `GET /api/export/:entity`: CSV/Excel/JSON of specific entities | route list |

### What is NOT proven or not in place

- **A restore has never been tested.** The nightly job proves a dump is structurally readable (`pg_restore --list`); nothing shows a dump or snapshot restored into a scratch database and checked. Until one is, treat recovery time and completeness as unproven. The script even keeps the latest dumps on the host "for restore test", and none has been done.
- **Everything is in one AWS region and one account.** No cross-region copy of the S3 dumps or the RDS snapshots.
- **The RDS instance is single-AZ with deletion protection off.** An instance failure is an outage until restore; deleting the instance by mistake would also delete its automated backups (manual snapshots survive).
- **The host copy of the script is the only deployed copy.** It lives at `/root/backup-db.sh` (last modified 2026-09-29; its comments still mention Neon). The repository copy is for review and version control; changing the host copy needs an approved change.
- **Dumps accumulate on the host.** Ten daily dumps (about 34 MB each) sat in `/root` and are never pruned. S3 is pruned (30 days); the host is not.
- No file-storage backup for question images beyond S3's own durability (no versioning).

### Recommended next steps (none are done; each changes infrastructure and needs approval)

1. One documented **restore drill** into a temporary RDS instance from the latest snapshot and from the latest S3 dump; record the time taken and the row counts compared with production; delete the temporary instance.
2. Enable **deletion protection** on `codearena-db`; decide on Multi-AZ and on a larger instance class (see audit finding A2-17).
3. Enable **S3 versioning** (with a lifecycle for noncurrent versions) and consider cross-region replication of the bucket.
4. Prune host dumps in the script, and move it to a managed place (SSM document or a scheduled job) so it is not a single file on one server.

## Before Any Schema or Data-Touching Change

Backups exist (section B), but a restore is untested, so treat every non-additive schema change (see [DATABASE.md](DATABASE.md) §1) and every bulk data-correction task as higher-risk than it would be on a platform with automated backups. Prefer additive/reversible changes; when a destructive change is genuinely necessary, ask the user to trigger a manual backup via the existing Admin Backups page first.
