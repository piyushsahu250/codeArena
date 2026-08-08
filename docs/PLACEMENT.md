# Placement

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/placementOffers.js` · **Frontend:** `StudentProfile.jsx` (Placement Offers panel), `StudentPerformance.jsx` (Placement section), `ClerkDashboard.jsx`

## What It Is
Tracks a student's placement offers (`PlacementOffer`: company, package, `OfferVerificationStatus`) plus department/clerk-managed eligibility flags, feeding institute-wide placement analytics.

## Student Flow
Self-manage own offers (add/edit/delete, `POST/PATCH/DELETE /offers`, `/offers/:id`) — own-record-only. View own summary (`/offers/summary/me`).

## Staff/Clerk/Admin Flow
View a student's offers (+Institute), verify an offer (`PATCH /offers/:id/verify` — re-derives the student from the offer's own `studentId` before authorizing, so a cross-institute offer id can't be verified even if guessed — confirmed clean, this session's audit). Set department-level eligibility (Staff/Admin) or clerk-managed eligibility (Clerk/Admin) separately — two distinct eligibility concepts, two distinct routes.

## Analytics
`GET /analytics/registration`, `/offers`, `/department`, `/report.pdf`, `/documents` — ADMIN/STAFF/CLERK, +Institute.

## Data Integrity
"All student info from correct student record" — confirmed: `authorizeStudentAccess()` institute-scopes every route, and verify/eligibility routes re-derive the student from the target record rather than trusting a client-supplied institute claim.

## Related
[DOCUMENT_VERIFICATION.md](DOCUMENT_VERIFICATION.md), [TALENT_POOL.md](TALENT_POOL.md), [CLERK_MODULE.md](CLERK_MODULE.md), [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md).
