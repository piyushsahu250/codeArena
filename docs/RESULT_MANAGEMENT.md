# Result Management

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/resultManagement.js` · **Frontend:** `ResultManagement.jsx` (admin/staff/clerk), `MyResults.jsx` (student)

## Model
`ResultExamination` (name, term, `ResultExaminationStatus`, publish state, department scoping via `ResultExaminationDepartment`) → `ResultEntry` (per-student row, `ResultEntrySource`: manual vs. bulk-import origin).

## Publish Gate
An examination's entries are only visible to students once published (`PATCH /admin/examinations/:id/publish`, ADMIN only, +Institute). Unpublish is also ADMIN-only — this is the platform's "published results immutable to unauthorized viewers" control point. Entry-mutation routes independently re-verify a server-computed `canEditEntries()` check (not just trusting a frontend `canEdit` flag) — confirmed via this session's RBAC audit on `ResultManagement.jsx`'s frontend/backend parity.

## Access
- **View examinations/entries**: ADMIN/STAFF/CLERK, +Institute.
- **Create/Edit/Delete examination, Publish/Unpublish**: ADMIN only, +Institute.
- **Entry CRUD, bulk import**: ADMIN/STAFF/CLERK, +Institute.
- **Student**: own results only (`GET /me`, `/me/:entryId`).

## Bulk Import
Template + import, per-examination. Duplicate/validation handling per row (mirrors the platform-wide bulk-upload convention — see [BULK_UPLOAD.md](BULK_UPLOAD.md)).

## Marksheet / QR
`GET /me/:entryId/marksheet.pdf`, `/qr.png` (student, own) and the admin equivalents (+Institute) — see [MARKSHEET.md](MARKSHEET.md).

## Notifications
Publishing an examination fires `notifyResultPublished()` (per project history — in-app + email).

## Related
[MARKSHEET.md](MARKSHEET.md), [BULK_UPLOAD.md](BULK_UPLOAD.md), [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md).
