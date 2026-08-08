# Marksheet

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** part of `resultManagement.js` · **Frontend:** `MarksheetView.jsx`, `MarksheetVerify.jsx`

## What It Is
A PDF marksheet generated per `ResultEntry`, with a QR code linking to a public verification page (`/results/verify/:code`, no auth required) and institute-configured signatories (`Institute.marksheetSignatories`, up to 4 name+title entries).

## Access
- Student: own marksheet only (`GET /me/:entryId/marksheet.pdf`, `/qr.png`).
- Admin/Staff/Clerk: any student's marksheet within their institute scope (+Institute).
- Public: verification-by-code only — no other marksheet data is exposed to an unauthenticated request.

## Security
Only published examination entries are marksheet-accessible at all (see [RESULT_MANAGEMENT.md](RESULT_MANAGEMENT.md)'s publish gate) — an unpublished result cannot be viewed or downloaded by a student even if they know the entry id.

## Digital Signatures
"Digital Signatures" in the sense of institute-configured signatory name/title pairs printed on the PDF — **not** cryptographic digital signing of the PDF file itself. Treat any assumption of cryptographic signing as **NOT VERIFIED / likely incorrect** unless confirmed by reading `backend/src/utils/` PDF-generation code directly.

## Related
[RESULT_MANAGEMENT.md](RESULT_MANAGEMENT.md), [CERTIFICATE_MANAGEMENT.md](CERTIFICATE_MANAGEMENT.md) (same QR-verification pattern).
