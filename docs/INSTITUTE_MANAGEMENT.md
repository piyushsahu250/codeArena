# Institute Management

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/institutes.js` · **Frontend:** `InstituteManagement.jsx`

## What It Is
CRUD for `Institute` records — the tenant boundary for the entire platform. Institute-level settings: `requireProfileCompletion`, `singleSessionOnly`, `passwordExpiryDays`, `passwordHistoryDepth`, `aiHintsEnabled`, `marksheetSignatories`, `isActive`, branding.

## Access
List/create/edit/delete: ADMIN only. Edit/Delete/Course-analytics are institute-ownership-checked as of this session's fix (see [FIXED_ISSUES.md](FIXED_ISSUES.md) FI-001) — an institute-scoped Admin can only manage their own institute; an unscoped Admin can manage any.

## Deletion Safety
`DELETE /:id` first deletes any empty (zero-user) classes under the institute, then blocks with a 409 if any classes or users remain linked — prevents accidental data loss of an institute with real enrolled users.

## Profile Completion Stats
`GET /:id/profile-completion-stats` (ADMIN/STAFF/CLERK +Institute) — paginated (capped at 300 pending entries per response), shows completion% and recently-updated students. See [BUSINESS_RULES.md](BUSINESS_RULES.md) §3 for the underlying calculation.

## Course Analytics
`GET /:id/course-analytics` (ADMIN +Institute) — per-course active-learner/certificate/coding-attempt stats for courses assigned to this institute.

## Related
[ACADEMIC_GROUPS.md](ACADEMIC_GROUPS.md), [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md), [KNOWN_ISSUES.md](KNOWN_ISSUES.md) KI-003 (admin.js platform-data routes are separately not institute-scoped — a different file, don't confuse with this one).
