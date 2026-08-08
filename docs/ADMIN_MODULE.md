# Admin Module

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## Feature Surface
Everything. `/admin` dashboard plus every management surface in the platform: Bulk Upload, Academic Groups, Course Assignments, Institute Management, Attendance Structure, Talent Pools, Result Management, Email Logs, Question Audit, Password Reset History, Audit Log, Certificate Admin, Backups, Export Center, System Monitoring, Student Search/Performance, Staff/Clerk Management, Company Master — the complete `/admin/*` route tree in `frontend/src/App.jsx`, plus everything Staff and (for read paths) Clerk can see.

## Critical: Two Kinds of Admin
**Unscoped ("Super Admin")** vs. **institute-scoped Admin** — not separate roles, distinguished entirely by `User.instituteId`. See [USER_ROLES.md](USER_ROLES.md) for the full explanation and why this distinction has been the source of repeated security bugs when a new route omits the ownership check. **Before adding any new ADMIN-only route that touches institute-owned data, verify it includes `attachRequesterInstitute` + an explicit ownership comparison.**

## Admin-Exclusive Actions (not shared with Staff even where Staff has some access to the same module)
- Creating/editing/deleting institutes.
- Creating any account, bulk-uploading students, deleting any account.
- Publishing/deleting formal tests and result examinations (Staff can publish tests but not delete them).
- All Learning Management writes (Staff is read-only, see [STAFF_MODULE.md](STAFF_MODULE.md)).
- Deleting a student document post-verification (Staff's delete rights were explicitly revoked — see [FIXED_ISSUES.md](FIXED_ISSUES.md)/[DOCUMENT_VERIFICATION.md](DOCUMENT_VERIFICATION.md)).
- Database backup trigger, system monitoring, email logs, question audit.

## Cross-References
[RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md) for the full matrix, [INSTITUTE_MANAGEMENT.md](INSTITUTE_MANAGEMENT.md), [BULK_UPLOAD.md](BULK_UPLOAD.md), [AUDIT_LOG.md](AUDIT_LOG.md), [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
