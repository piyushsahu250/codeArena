# Clerk Module

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## Feature Surface
`/clerk` dashboard, Student Search (`/clerk/students`), Company Master, Result Management (`/clerk/results`), Audit Log (`/clerk/audit-log`). That is the **entire** frontend route surface for CLERK — confirmed by the complete absence of any other `CLERK`-gated route in `frontend/src/App.jsx`.

## Defining Characteristic: No Learning/Test/Question-Bank Access
CLERK is never listed in any `requireRole(...)` call in `learning.js`, `questions.js`, or `tests.js`. This is a deliberate scope boundary — Clerk is a Placement Cell role, not a teaching or assessment role.

## Backend Permission Surface (beyond the frontend routes above)
Clerk also has API access (without a dedicated frontend page beyond what's listed) to: placement offer verification (`placementOffers.js`), document verification (`studentDocuments.js`), student profile view (`profile.js`), user search/browse (`users.js`), export center (`exports.js`). See [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md) for the full per-action matrix.

## Scoping
Every Clerk-facing route observed runs `attachRequesterInstitute` — Clerk accounts are institute-scoped in every observed case (see [USER_ROLES.md](USER_ROLES.md) for the one caveat: the schema doesn't technically forbid an unscoped Clerk, but no route behaves as if that's a supported configuration).

## Cross-References
[PLACEMENT.md](PLACEMENT.md), [DOCUMENT_VERIFICATION.md](DOCUMENT_VERIFICATION.md), [RESULT_MANAGEMENT.md](RESULT_MANAGEMENT.md), [SEARCH.md](SEARCH.md), [AUDIT_LOG.md](AUDIT_LOG.md).
