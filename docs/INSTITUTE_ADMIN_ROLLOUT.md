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

## Routes updated (round 2 — `questions.js`, `tests.js`, `challenges.js`)

All three files checked for uniformity first (every `requireRole("ADMIN"...)` call site already
paired with `attachRequesterInstitute`, and the actual scoping logic — `questionVisibilityWhere`/
`ownsQuestionRow` in `questions.js`, plain `req.requesterInstituteId` checks in `tests.js`,
`instituteScopedWhere`/`ownsChallengeRow` in `challenges.js` — is written role-agnostically
(`role !== "STAFF"` rather than `role === "ADMIN"`, or plain instituteId comparison), so it
already treats any institute-scoped account correctly regardless of role name. Confirmed this
before bulk-editing each file, not assumed.

- `questions.js`: all 33 `requireRole("ADMIN", "STAFF")` call sites (Question Bank CRUD, folders,
  bulk import/export/move/copy/delete, sharing) now also accept `SUPER_ADMIN`, `INSTITUTE_ADMIN`.
- `tests.js`: all 9 `requireRole("ADMIN", "STAFF")` sites plus the one `requireRole("ADMIN")`-only
  `DELETE /:id` (deliberately staff-excluded already; now also accepts the two new roles).
- `challenges.js`: all 16 `/admin/daily|weekly` routes — 6 read/preview/analytics routes
  (`ADMIN`+`STAFF`) and 10 write routes (`ADMIN`-only, staff deliberately excluded) — now also
  accept `SUPER_ADMIN`, `INSTITUTE_ADMIN`.

## Round 3 (`attendance.js`, `readiness.js`) — and an urgent unplanned round

- `attendance.js`: all 23 `requireRole("ADMIN"...)` call sites (12 `ADMIN`-only management
  routes — departments/rules/staff-assignments — plus 11 `ADMIN`+`STAFF` shared routes). Checked
  first: every one already pairs with `attachRequesterInstitute`, and the file's own
  requester-role checks are all `role === "STAFF"` (positive, to apply an *extra* restriction on
  top of the institute boundary), never a hardcoded `=== "ADMIN"` — so any non-STAFF institute-
  scoped account, including the two new roles, already falls through to the correct unrestricted
  path.
- `readiness.js`: all 14 call sites (13 `ADMIN`+`STAFF`, 1 `ADMIN`+`STAFF`+`CLERK` for
  `/placement/overview`). Same check performed first — `staffAcademicGroupIds()`/
  `isSubjectOwner()` both key off `role !== "STAFF"`, same safe convention as
  `questionVisibility.js`.

**Unplanned but done same-day:** a real production incident — `sahupiyush250@gmail.com` got
migrated to `SUPER_ADMIN` on rollout day but the *frontend* didn't know that role existed yet
(login redirect map, route guard, sidebar menu), and separately `admin.js`/`institutes.js`/
`gamification.js`'s `/admin/stats`, `/institutes`, `/gamification/admin/stats` — everything
`AdminDashboard.jsx` loads on mount — hadn't been extended yet either. Net effect: the real Super
Admin account was locked out of its own dashboard for part of a day. Both fixed and verified
against the live account (see commit history around 2026-08-25). `institutes.js` deliberately
still excludes `INSTITUTE_ADMIN` — creating/editing/deleting institutes stays Super-Admin-only.

## Not yet audited (NOT TESTED — do not assume covered)

`academicGroups.js`, `certificates.js`, `classes.js`, `exports.js`, `features.js`, `learning.js`,
`moduleCoding.js`, `resultManagement.js`, `subjects.js`, `talentPools.js`, and the rest.
`INSTITUTE_ADMIN`/`SUPER_ADMIN` do **not** currently work on any of these. Extending coverage is
ongoing work, file by file, each verified the same way (confirm `attachRequesterInstitute` + real
institute-scoping already exists — and that no requester-role check is hardcoded to literal
`"ADMIN"` — before adding the role; if either isn't true yet, that route needs fixing first,
separate from adding the role name).

## Explicitly not built yet

- Dedicated Super-Admin "Manage Institute Admins" UI (spec section 9) — the backend now supports
  creating/listing/editing/resetting/deactivating Institute Admin accounts via the existing
  `users.js` endpoints above (with `role=INSTITUTE_ADMIN`), but no dedicated frontend screen for it.
- Institute Admin dashboard/sidebar (sections 7, 33, 34).
- Frontend route guards for `/super-admin/*`, `/institute-admin/*` (section 23) — backend
  authorization is authoritative regardless, but the frontend doesn't yet redirect by role.
- Super Admin impersonation (section 25 — explicitly marked optional in the spec).
- Institute creation/deactivation flows re-audited for the new roles (sections 29-30).
