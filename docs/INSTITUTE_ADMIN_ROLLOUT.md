# SUPER_ADMIN / INSTITUTE_ADMIN rollout status

This is a route-by-route rollout, not a single change. `requireRole("ADMIN")` appears at
~331 call sites across ~29 route files; each one needs individual judgment about whether it's
safe to also accept `INSTITUTE_ADMIN` (safe wherever the route already scopes its data by
`req.requesterInstituteId` via `attachRequesterInstitute` — that mechanism doesn't care what
role reached it) or whether it's a genuinely platform-wide, Super-Admin-only operation (institute
CRUD, cross-institute backups/exports, global feature-flag config) that must stay
`SUPER_ADMIN`-only. A blind find-and-replace across all 331 would risk exactly the cross-institute
leak this system exists to prevent, so this file tracks real, verified status instead of claiming
full coverage.

## Foundation (done, deployed, verified against production data)

- `Role` enum: added `SUPER_ADMIN`, `INSTITUTE_ADMIN` (`backend/prisma/schema.prisma`).
- Database-level guarantee that at most one `SUPER_ADMIN` row can ever exist: a partial unique
  index (`scripts/enforceSingleSuperAdmin.js`), not just an application check.
- `sahupiyush250@gmail.com` migrated `ADMIN` → `SUPER_ADMIN` (`scripts/migrateSuperAdmin.js`),
  idempotent, narrow preconditions, wired into the boot-time migration chain.
- The other pre-existing platform-level `ADMIN` account (`admin@sanjivani.edu.in`, "Platform
  Admin") deliberately left untouched per explicit user decision — not converted, not deactivated.

## Routes updated so far (`backend/src/routes/users.js`)

| Route | Change |
|---|---|
| `GET /users` | Now also accepts `SUPER_ADMIN`, `INSTITUTE_ADMIN` — already institute-scoped via `req.requesterInstituteId`, safe to extend as-is. |
| `POST /users` | Same, plus a role-assignment whitelist: an institute-scoped creator (institute-scoped `ADMIN` or `INSTITUTE_ADMIN`) can only grant `STUDENT`/`STAFF`/`CLERK`; only a platform-level `SUPER_ADMIN` (or legacy platform-level `ADMIN`) can grant `INSTITUTE_ADMIN` or legacy `ADMIN`. `SUPER_ADMIN` is never a grantable role anywhere. |
| `PATCH /users/:id` | Now also accepts `SUPER_ADMIN`, `INSTITUTE_ADMIN` — `role` was already excluded from `EDITABLE_FIELDS` before this work (pre-existing, confirmed, not a change), so this can never be used to grant any admin-tier role including `SUPER_ADMIN`. |
| `GET /users/search` | Now also accepts `SUPER_ADMIN`, `INSTITUTE_ADMIN`, and the `?role=` filter now accepts those two values too. |
| `POST /users/:id/reset-password` | Now also accepts `SUPER_ADMIN`, `INSTITUTE_ADMIN` — already institute-scoped. |

## Not yet audited (NOT TESTED — do not assume covered)

Every other route file with `requireRole("ADMIN"...)` calls: `admin.js`, `academicGroups.js`,
`attendance.js`, `certificates.js`, `challenges.js`, `classes.js`, `exports.js`, `features.js`,
`institutes.js`, `learning.js`, `moduleCoding.js`, `questions.js`, `readiness.js`,
`resultManagement.js`, `subjects.js`, `talentPools.js`, `tests.js`, and the rest. `INSTITUTE_ADMIN`
and `SUPER_ADMIN` do **not** currently work on any of these — an Institute Admin account today can
only use the `users.js` endpoints listed above. Extending coverage to the rest is ongoing work,
file by file, each verified the same way (confirm `attachRequesterInstitute` + real
institute-scoping already exists before adding the role; if it doesn't, that route needs the
scoping added first, which is separate work from adding the role name).

## Explicitly not built yet

- Dedicated Super-Admin "Manage Institute Admins" UI (spec section 9) — the backend now supports
  creating/listing/editing/resetting/deactivating Institute Admin accounts via the existing
  `users.js` endpoints above (with `role=INSTITUTE_ADMIN`), but no dedicated frontend screen for it.
- Institute Admin dashboard/sidebar (sections 7, 33, 34).
- Frontend route guards for `/super-admin/*`, `/institute-admin/*` (section 23) — backend
  authorization is authoritative regardless, but the frontend doesn't yet redirect by role.
- Super Admin impersonation (section 25 — explicitly marked optional in the spec).
- Institute creation/deactivation flows re-audited for the new roles (sections 29-30).
