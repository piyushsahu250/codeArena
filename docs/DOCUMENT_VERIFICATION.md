# Document Verification

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/studentDocuments.js` · **Frontend:** `StudentProfile.jsx` (Documents tab, student), `StudentPerformance.jsx` (Documents section, staff/admin/clerk view)

## Storage Model
`StudentDocument.documentLink` is an **external URL**, not a binary upload to this platform — the route file never uses Multer. `GET /:id/download` proxies to that external link (a prior SSRF vulnerability in this proxy was fixed — see [FIXED_ISSUES.md](FIXED_ISSUES.md) "Pre-existing fixes"; re-verify before relying on it as still fixed).

## Workflow
1. Student uploads (adds a link + type) — `POST /`.
2. Staff/Admin/Clerk verify or reject with a remark — `PATCH /:id/verify` (all three roles, +Institute).
3. Rejection requires a remark (`rejectionReason`); re-upload after rejection resets status to PENDING (confirmed via project history — the re-upload path is the student's own `PATCH /:id`, not a separate route).
4. Verification history preserved via `AuditLog` entries (added per project history) — never overwritten.
5. **Once VERIFIED, a document is locked from student edit/delete** (per project history).

## Bulk Verification
`POST /bulk-verify` (ADMIN/STAFF/CLERK, +Institute) — per-document ownership/institute check inside the loop, skips (doesn't fail the whole batch on) any document outside the requester's scope.

## Delete Rights
`DELETE /:id/admin` is **ADMIN only** — Staff's delete rights were explicitly removed (Clerk was never granted them). If you see a UI control offering Staff a delete button on a document, that's a frontend bug — the backend will 403 it. See [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md).

## Completion Tie-In
Uploaded/verified documents count toward the student profile-completion percentage (at least one uploaded document is one of the `MANDATORY_FIELD_CHECKS`) — see [BUSINESS_RULES.md](BUSINESS_RULES.md) §3.

## Related
[BUSINESS_RULES.md](BUSINESS_RULES.md), [PLACEMENT.md](PLACEMENT.md), [SECURITY.md](SECURITY.md) (SSRF note), [FILE_STORAGE.md](FILE_STORAGE.md).
