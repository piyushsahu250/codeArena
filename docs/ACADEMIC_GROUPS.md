# Academic Groups

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/academicGroups.js`, `resolveAcademicGroup()` in `users.js` · **Frontend:** `AcademicGroups.jsx`

## What It Is
`AcademicGroup` = **Institute + Batch + Department + Section**, the canonical enrollment/grouping unit that replaced an older `Class`-based model (per project history — `Class`/`classId` is kept for rollback safety but no longer written by current code paths). See [DATABASE.md](DATABASE.md) and [DATA_DICTIONARY.md](DATA_DICTIONARY.md) for the model shape.

## Auto-Creation
Groups are **find-or-create**, never manually created directly — `resolveAcademicGroup()` (in `users.js`) is called whenever a student is assigned batch/department/section (single-create, PATCH, bulk-upload). Missing department/section default to "Unassigned"/"Section A". A race-safe `upsert()` pattern avoids duplicate-group creation under concurrent requests.

## Why It Matters
This is the scope unit for:
- **Roll Number uniqueness** (see [BUSINESS_RULES.md](BUSINESS_RULES.md) §2).
- **Course visibility** via `CourseAcademicGroupAssignment` (see [BUSINESS_RULES.md](BUSINESS_RULES.md) §4).
- **Attendance** — `StaffClassAssignment.academicGroupId` (see [ATTENDANCE.md](ATTENDANCE.md)).
- **Test assignment** via `TestAcademicGroup`.
- **Talent Pool / Daily/Weekly Challenge scoping.**

## Access
List/view students in a group: ADMIN/STAFF (+Institute). Bulk password reset, delete: ADMIN only (+Institute).

## Deletion
`deleteAcademicGroupIfEmpty()` (shared util) auto-removes a group once it has zero enrolled students — called after any student move/edit that changes their group, and from the dedicated `DELETE /academic-groups/:id` route (which requires admin password re-verification and cascade-deletes any remaining students — a genuinely destructive action, gated accordingly).

## Related
[BUSINESS_RULES.md](BUSINESS_RULES.md), [BULK_UPLOAD.md](BULK_UPLOAD.md), [ATTENDANCE.md](ATTENDANCE.md).
