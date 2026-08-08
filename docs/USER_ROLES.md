# User Roles

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08
**Source:** `Role` enum in `backend/prisma/schema.prisma`, cross-referenced against every `requireRole(...)` call in `backend/src/routes/*.js` and `frontend/src/App.jsx`'s route table.

## The Four Roles

`Role` enum: `STUDENT`, `STAFF`, `CLERK`, `ADMIN`.

### STUDENT
The learner. Every route scoped to `STUDENT` operates on that student's own data only (`req.user.id`) — confirmed via this session's security audit to have no IDOR gaps on any student-facing route (submissions, resume, profile, moduleCoding all checked and clean). Home route: `/dashboard`.

### STAFF
Teaching staff. Manages the Question Bank (own-authored questions are private unless shared/unowned), test creation, attendance for their assigned subject(s), mock-interview review/CMS, resume review, Learning Management (**read-only**, except an explicitly-permitted coding-assessment attempt-reset action). Can be institute-scoped or unscoped. Home route: `/staff`.

### CLERK
Placement Cell operator. Student search/profile view, placement offer verification, document verification, results (view/entry per examination permissions), company master, audit log. **No access to Learning Management or Test/Question Bank management** — confirmed by the absence of `CLERK` in any `learning.js`/`questions.js`/`tests.js` `requireRole(...)` call. Always institute-scoped in practice (every Clerk route that touches student data runs `attachRequesterInstitute`). Home route: `/clerk`.

### ADMIN
Full administrative access. **Two distinct sub-kinds exist at the data level, not as separate enum values:**
- **Unscoped ("Super Admin")** — `User.instituteId = null`. Sees/manages every institute.
- **Institute-scoped Admin** — `User.instituteId` set. Restricted to their own institute's data on every route that runs `attachRequesterInstitute` and does the ownership comparison. This distinction is enforced entirely by application code checking `req.requesterInstituteId` — there is no separate `SUPER_ADMIN` role. **This exact scoping check has been the source of multiple confirmed security bugs when a route omitted it** (see [FIXED_ISSUES.md](FIXED_ISSUES.md) and [KNOWN_ISSUES.md](KNOWN_ISSUES.md)) — always verify a new institute-scoped Admin route includes it.

Home route: `/admin`.

## Account Scoping Summary

| Role | Can be unscoped (platform-wide)? | Can be institute-scoped? | Notes |
|---|---|---|---|
| STUDENT | No | Always (via `academicGroupId` → `AcademicGroup.instituteId`) | — |
| STAFF | Yes | Yes | Same scoping mechanism as Admin |
| CLERK | NOT VERIFIED whether an unscoped Clerk is a supported configuration — every Clerk-facing route observed runs `attachRequesterInstitute`, implying Clerk is intended to always be institute-scoped in practice, but the schema does not forbid `instituteId = null` on a CLERK row. |
| ADMIN | Yes | Yes | See above |

## Frontend Role Gating (convenience only, not security)

`frontend/src/App.jsx`'s `<Protected roles={[...]}>` wrapper redirects away from a route if the logged-in user's role isn't in the list. This is purely UX — the authoritative check is always the backend's `requireRole(...)`. Confirmed (this session's RBAC audit) that every UI-hidden control across `LearningManagement.jsx`, `QuestionBank.jsx`, `ResultManagement.jsx` has a matching server-side gate; no mismatches found as of this documentation pass.

## Special Account States (not roles, but affect access)

- `mustChangePassword` (on `User`) — forces redirect to `/change-password` regardless of role, before any other route is reachable.
- `requireProfileCompletion` (institute setting) + `profileComplete` (computed) — for STUDENT accounts, blocks all routes except `/profile` and `/resume` until the mandatory profile fields reach 80% (see [BUSINESS_RULES.md](BUSINESS_RULES.md)).
- `isActive` / `accountStatus` (`AccountStatus` enum) — an inactive account cannot log in (enforced server-side in `auth.js`).
- `singleSessionOnly` (institute setting) — when enabled, a new login invalidates the account's other active `LoginSession` rows.

See [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md) for the full per-module permission matrix.
