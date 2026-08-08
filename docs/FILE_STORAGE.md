# File Storage

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## No Dedicated Binary File Storage Service
This platform does **not** integrate an external object-storage service (no S3/GCS/Azure Blob/Cloudinary reference found in `backend/src`). File handling falls into two categories:

## 1. Ephemeral, In-Memory Processing (Multer)
Bulk-upload spreadsheets (8 routes, see [BULK_UPLOAD.md](BULK_UPLOAD.md)) and any other Multer-based upload use `multer.memoryStorage()` — the file exists only in request memory, is parsed immediately (e.g. via `xlsx`), and is **never written to disk or persisted anywhere**. 5MB limit, spreadsheet-file-type filter (`spreadsheetFileFilter`).

## 2. External Links (Not Uploads)
`StudentDocument.documentLink` and `User.profilePhotoUrl` are **URLs/data-URLs**, not binary uploads this platform stores. A student "uploads a document" by providing a link to wherever the file is actually hosted (external to this platform) — confirmed via `studentDocuments.js` never invoking Multer at all. `profilePhotoUrl` is stored as a data URL (base64-encoded inline), which has its own size/performance implications worth being aware of if profile photos ever need to scale.

## Download Proxy
`GET /api/documents/:id/download` proxies a student document's external link server-side — a prior SSRF vulnerability here (an attacker-controlled `documentLink` could make the server fetch an internal/arbitrary URL) was fixed per project history; **re-verify the current implementation before relying on this as still safe**, since this documentation pass did not re-read the route body directly.

## File Type / Ownership / Access Checks
- Multer routes: `spreadsheetFileFilter` rejects non-spreadsheet MIME types (a fix from an earlier security audit — a prior gap here allowed arbitrary file types on some bulk-upload routes).
- Document ownership/institute-scoping: enforced via `authorizeStudentAccess()` on every `studentDocuments.js` route (confirmed clean, this session's audit).

## Broken File References
No automated "orphaned file reference" cleanup job was found. Since documents are external links rather than platform-managed storage, a "broken reference" here would mean a dead external URL, which this platform has no way to detect or clean up automatically (it doesn't own the storage).

## Related
[DOCUMENT_VERIFICATION.md](DOCUMENT_VERIFICATION.md), [SECURITY.md](SECURITY.md), [BULK_UPLOAD.md](BULK_UPLOAD.md).
