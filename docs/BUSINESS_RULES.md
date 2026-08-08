# Business Rules — Canonical Reference

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

These rules have each been the subject of at least one dedicated implementation or bug-fix pass. Treat this file as authoritative over any assumption or prior memory — if code and this file disagree, the code is current truth and this file needs updating (see [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) for the update process), but do not casually change the *rule itself* without understanding why it exists.

## 1. Registration Number (PRN)

- **Sole permanent, system-wide unique student identifier.** Enforced at the database level: `@@unique([registrationNumber])` on `User`.
- Alphanumeric, 9–12 characters (`REGISTRATION_NUMBER_RE` in `backend/src/utils/studentIdentifiers.js`).
- Stored exactly as entered — never modified, never prefixed.
- Required at student account creation (single-create and bulk-upload both reject a student row with no PRN).

## 2. Roll Number

- **Derived from the last 3 characters of PRN by default**, only when the Roll Number field is left blank (`initRollNumberFromRegistration()` — verbatim `slice(-3)`, not smarter digit-extraction).
- **Maximum 3 characters** (`ROLL_NUMBER_MAX_LENGTH = 3`).
- **Unique only within one Academic Group** (Institute + Batch + Department + Section) — duplicates **are expected and allowed** across different groups.
- On a same-group collision during auto-derivation, the platform slides the 3-character window backward across the rest of the PRN (e.g. tries positions `[-4:-1)`, then `[-5:-2)`, etc.) until a non-colliding value is found — **never** appends a "DUP" prefix or any marker. If the entire PRN is exhausted (astronomically rare), it falls back to the plain last-3 value rather than blocking account creation.
- Manual entry (an admin explicitly typing/editing a Roll Number) is **hard-rejected** on a same-group collision with a specific error message — this is a deliberate different behavior from auto-derivation, because a manual entry is an explicit human action.
- Enforced at: `backend/src/routes/users.js` (create, PATCH, bulk-upload — all three call sites), `backend/src/utils/studentIdentifiers.js` (shared derivation logic). **Not** enforced at the database level (no `@@unique` scoped to `[academicGroupId, rollNumber]` — the check is entirely application-level, added in this session's QA pass; see [FIXED_ISSUES.md](FIXED_ISSUES.md)).
- Sort order for display: numeric roll numbers sort ascending numerically (not lexicographically), non-numeric/blank sort last, ties break by name (`compareRollNumbers()`).

## 3. Profile Completion & Unlock

- Institute-level toggle: `Institute.requireProfileCompletion`.
- When enabled, a STUDENT whose profile is incomplete is redirected to `/profile` for every route except `/profile` and `/resume` (both are reachable simultaneously because mandatory fields span both pages — Personal/Academic on Profile, Education on Resume Builder).
- **Unlocks at 80% completion (`UNLOCK_THRESHOLD_PERCENT = 80`), not 100%.**
- Completion percentage: `MANDATORY_FIELD_CHECKS` is a single array of (currently 17) checks, used identically as both numerator and denominator — `percent = round(((total - missing.length) / total) * 100)`. No optional field can dilute the percentage because optional fields are never in this array.
- 100% is genuinely reachable when every mandatory field (including "at least one uploaded document") is present.
- Server-side authoritative calculation: `backend/src/utils/studentProfileCompletion.js`. The frontend's `StudentProfile.jsx` has a client-side `livePercent()` preview (16 checks, missing the document-upload check) used only before the server value loads — a cosmetic-only mismatch, not a real bug, since the server value always wins once loaded.

## 4. Course Visibility

- **New courses are unassigned/hidden by default.** A `Course`'s mere existence does not make it visible to any student.
- Must be explicitly assigned via `CourseInstituteAssignment` (whole institute) or `CourseAcademicGroupAssignment` (a specific academic group within an institute) before students there can see it.
- Course `status` (`CourseStatus` enum — published/draft/etc.) is a second, independent gate: a course must be both assigned AND in a visible status.
- When an already-assigned course is updated, the update auto-applies to everyone it's assigned to (no per-student re-sync needed) — this is the natural consequence of visibility being computed from the assignment + course-status join at read time, not denormalized per-student.
- Enforced by `backend/src/utils/courseEligibility.js` / `courseLock.js`.

## 5. Question Bank Isolation

- **Institute-level isolation**: a question created under Institute A's Question Bank is never visible to Institute B, at the route level (`questionVisibilityWhere()` in `backend/src/utils/questionVisibility.js`, applied on every list/search/get/folder/export/bulk route in `questions.js`).
- **Staff-private questions**: within one institute, a STAFF-authored question (`Question.createdById` set) is private to that staff member unless `createdById` is `null` (shared/legacy). A different Staff member at the same institute cannot see, edit, or delete another staff member's private questions via any route — confirmed via `ownsQuestionRow()` used consistently, including on recursive folder-delete/merge operations.
- **ADMIN has no such restriction** — an Admin sees everything within their institute (or platform-wide if unscoped).
- **This isolation model does NOT extend to the Interview Question Bank** (`InterviewQuestion`/`CompanyInterviewProfile`) — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md). Do not assume the two "question bank" concepts share the same isolation guarantees; they are architecturally different (no `instituteId`/`createdById` columns exist on the interview models at all).

## 6. Attendance

- One `StaffClassAssignment` = one staff member assigned to one Academic Group **for one subject** — `@@unique([academicGroupId, subject])`, deliberately **not** `[academicGroupId, staffId]`. This is what allows multiple different staff to be assigned to the same group (one per subject they teach).
- A `LecturePlan` belongs to exactly one assignment; an `AttendanceSession` belongs to exactly one `LecturePlan` (`@@unique` on `planId`) — this chain makes cross-subject overwrite structurally impossible, not just policy-enforced.
- `AttendanceRecord` has `@@unique([sessionId, studentId])` plus a transactional delete-then-recreate save pattern — duplicate attendance records for the same student/session are structurally impossible.
- Status values: PRESENT / ABSENT / LATE / LEAVE (plain string field, validated in the route handler, not a Prisma enum).
- **Continuous absence alerts (3 consecutive working-day absences, 3 consecutive subject absences, excluding holidays/approved leave) do not exist as a feature at all** — no scheduler, no alert model. Confirmed absent, not a bug (nothing partially built). Building it is a scoped feature decision, not a fix.

## 7. Institute Scoping (Multi-Tenancy)

- An institute-scoped account (Admin/Staff/Clerk with `instituteId` set) must never read or write another institute's data.
- Enforced per-route via `attachRequesterInstitute` middleware (loads `req.requesterInstituteId`) plus an explicit comparison in the handler (`req.requesterInstituteId !== target.instituteId` → 403).
- **This exact check has been missing on newly-added routes multiple times historically** — most recently on `institutes.js`'s `PATCH /:id`, `DELETE /:id`, and `GET /:id/course-analytics` (fixed in this session's QA pass; the pattern to follow is the same file's own `GET /:id/profile-completion-stats`, which had it correct from the start).
- An **unscoped** account (`instituteId = null`) is a "Super" account and is intentionally unrestricted — do not "fix" this by forcing scoping onto null-instituteId accounts; that would break the intended platform-admin capability.

## 8. Coding Assessment Attempts

- Formal Tests and Module Coding Tests both cap the number of attempts a student gets (attempt-limit logic exists in both `tests.js`'s reattempt route and `moduleCoding.js`'s attempt-reset route).
- **Staff may reset a student's attempts for their own institute** — an explicitly-permitted exception to Staff's otherwise read-only Learning Management access (see [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md)).
- The exact numeric attempt limit is configured per-test/per-module-coding-test, not a single hardcoded platform constant — NOT VERIFIED as a fixed "3 attempts" without reading the specific test's configuration; do not assume a universal number.

## 9. Error Messages

- User-facing error messages must be specific and actionable, never generic ("Something went wrong") and never leak raw database/Prisma internals (schema/field/table names) — enforced via a shared `safeErrorMessage()` helper (`backend/src/utils/errors.js`, added in this session's QA pass) that only forwards an error's own `.message` when it's NOT a Prisma-originated error.
- Never log or return passwords, tokens, API keys, or other secrets in any error response or audit log entry.

## 10. Audit Logging

- Key admin/security actions are recorded to `AuditLog` with actor id/name/role, action type, target, institute, a `details` JSON blob, and timestamp.
- Never log passwords, tokens, or secrets inside `details`.
- Audit log writes are fire-and-forget in some high-traffic paths (e.g. login) specifically to avoid adding latency/failure-coupling to the primary action — confirmed intentional per this session's history ("login-burst hardening").

## 11. Data Correction Policy

- When cleaning up or auditing data, **never delete a record just because it looks unused or orphaned** — determine whether it's historical/audit/academic/legally-relevant first.
- Only correct data when the invalid relationship is *confirmed* invalid and the correction can be made with zero data loss.
- This mirrors the platform's own stated cleanup philosophy (see [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) and [AI_HANDOVER.md](AI_HANDOVER.md) §14) — "when in doubt, do not delete."
