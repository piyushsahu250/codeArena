# Certificate Management

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/certificates.js` · **Frontend:** `MyCertificates.jsx`, `CertificateVerify.jsx`, `CertificateAdmin.jsx`

## Unified Model
`Certificate` (`CertificateType`, `CertificateStatus` enums) covers Learning Module completion, Coding Assessment completion (course-wide — one cert per course, not per module, per project history's fix), and manual issuance — one model, one verification flow, replacing what was previously separate mechanisms (per project history).

## Note: Mock Interview Has Its Own Certificate Model
`InterviewCertificate` is a **separate** model from `Certificate` — see [MOCK_INTERVIEW.md](MOCK_INTERVIEW.md). Not consolidated; NOT VERIFIED why.

## QR Verification
Every certificate carries a QR code encoding a verification URL — `GET /verify/:code` is **public** (no auth), intentionally minimal-info exposure.

## Access
- Student: view/download own — `GET /me`, `GET /:id/download`.
- Admin/Staff: manual issuance (+Institute).
- Admin: revoke (+Institute).
- Admin/Staff: institute certificate list (+Institute).

## PDF Generation
Shared branding helper applied across all certificate PDFs (logo, consistent layout — per project history's branding rollout).

## Related
[LEARNING_MANAGEMENT.md](LEARNING_MANAGEMENT.md), [CODING_ASSESSMENT.md](CODING_ASSESSMENT.md), [MOCK_INTERVIEW.md](MOCK_INTERVIEW.md).
