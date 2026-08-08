# Fixed Issues

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

This log covers issues with **verified detail available at the time of this first documentation pass** (2026-08-08). This platform has an extensive prior development history (600+ incremental work items) predating this documentation set; older fixes are not individually re-itemized here unless their detail was directly available during this pass — see the "Pre-existing fixes (summary only)" section at the end for what's known to have happened but isn't broken out per-issue. Going forward, every fix should be logged here with full detail per [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)'s update checklist.

---

### FI-001 — Institute-scoped Admin cross-institute IDOR
- **Date:** 2026-08-08
- **Module:** Institute Management
- **Problem:** An Admin account scoped to one institute could `PATCH`/`DELETE` a *different* institute's settings, or view its course-analytics, by supplying that institute's id in the URL.
- **Root cause:** `institutes.js`'s `PATCH /:id`, `DELETE /:id`, and `GET /:id/course-analytics` had no `attachRequesterInstitute` middleware and no ownership comparison — the route's own sibling route (`GET /:id/profile-completion-stats`) had the correct pattern all along, it just wasn't applied to these three.
- **Fix:** Added `attachRequesterInstitute` + `req.requesterInstituteId !== req.params.id` → 403 check to all three routes, mirroring the existing correct pattern.
- **Files changed:** `backend/src/routes/institutes.js`
- **Database changes:** None.
- **Testing:** Code-reviewed against the existing correct sibling route's pattern; deployed and health-checked.
- **Status:** Fixed and deployed (commit `e4bf8a1`).
- **Verification date:** 2026-08-08

### FI-002 — Roll Number uniqueness within Academic Group not enforced
- **Date:** 2026-08-08
- **Module:** Student Identity / Bulk Upload
- **Problem:** The platform spec requires no duplicate Roll Numbers within the same Institute+Batch+Department+Section, but the code had three separate explicit comments stating this was "intentionally NOT unique."
- **Root cause:** Original design decision predating the current uniqueness-within-group requirement; never revisited.
- **Fix:** Added a shared `resolveRollNumberAvoidingCollisions()` helper (`backend/src/utils/studentIdentifiers.js`) that slides the 3-character PRN window on collision (never a "DUP" tag); wired into single-create, PATCH, and bulk-upload paths in `users.js`. Manual entry hard-rejects a same-group collision with a specific error message; auto-derivation silently resolves it.
- **Files changed:** `backend/src/utils/studentIdentifiers.js`, `backend/src/routes/users.js`
- **Database changes:** None (application-level enforcement only, no new `@@unique` constraint added).
- **Testing:** Code-reviewed for all three call sites' collision-handling paths; deployed and health-checked.
- **Status:** Fixed and deployed (commit `e4bf8a1`).
- **Verification date:** 2026-08-08

### FI-003 — Raw Prisma error messages leaked to client on ~20 routes
- **Date:** 2026-08-08
- **Module:** Cross-cutting (tests, interview, questions, learning, interviewDrafts, challenges, attendance, moduleCoding)
- **Problem:** A common `res.json({ error: err.message || "Failed to X" })` fallback pattern forwarded any thrown error's raw message to the client — including raw Prisma error text (which can expose schema/field/table names) on an unexpected DB failure.
- **Root cause:** No shared safe-fallback utility existed; each route's catch-all evolved independently.
- **Fix:** Added `safeErrorMessage(err, fallback)` (`backend/src/utils/errors.js`) — returns the fallback for any error whose `.name` starts with `"Prisma"`, otherwise forwards the error's own message (safe for app-thrown validation errors with hand-written messages). Applied across ~20 call sites.
- **Files changed:** `backend/src/utils/errors.js` (new), `backend/src/routes/{tests,interview,interviewDrafts,learning,questions,challenges,attendance,moduleCoding}.js`
- **Database changes:** None.
- **Testing:** Code-reviewed each call site to confirm the fallback text was preserved/improved, not weakened; deployed and health-checked.
- **Status:** Fixed and deployed (commit `e4bf8a1`).
- **Verification date:** 2026-08-08

### FI-004 — Generic one-word errors on the exam-taking path
- **Date:** 2026-08-08
- **Module:** Coding Assessment / Submissions
- **Problem:** `submissions.js`'s `/run`, `/autosave`, `/submit-code`, `/submit`, and `/finalize` routes all returned bare one-word messages ("Execution failed", "Autosave failed", "Submission failed") on any unexpected error — no signal to a student mid-exam about whether to retry or whether their answer was saved.
- **Root cause:** Original catch-all messages predated the platform's later "specific, actionable error messages" standard.
- **Fix:** Replaced each with specific, actionable text (e.g. "Failed to save your code — your latest changes may not be saved. Please try again.") wrapped in `safeErrorMessage()`.
- **Files changed:** `backend/src/routes/submissions.js`
- **Database changes:** None.
- **Testing:** Code-reviewed; deployed and health-checked.
- **Status:** Fixed and deployed (commit `e4bf8a1`).
- **Verification date:** 2026-08-08

### FI-005 — Multer file-size-limit errors returned raw HTML, not JSON
- **Date:** 2026-08-08
- **Module:** Bulk Upload (8 routes across attendance, interview, moduleCoding ×2, questions ×2, resultManagement, users, talentPools)
- **Problem:** No shared multer error-handling middleware existed; `backend/src/index.js` had no 4-arg Express error handler at all. A `LIMIT_FILE_SIZE` error thrown by Multer before a route's own try/catch ever ran fell through to Express's default handler, returning non-JSON HTML/plain-text the frontend couldn't parse.
- **Root cause:** Only `resume.js` had manually wrapped its upload middleware to catch this; the other 8 bulk-upload routes used the unwrapped router-level pattern.
- **Fix:** Added a global 4-arg error-handling middleware in `backend/src/index.js`, mounted after every route, that catches `LIMIT_FILE_SIZE` (413, clean message) and any other `MulterError` or forwarded error, returning JSON instead of Express's default page.
- **Files changed:** `backend/src/index.js`
- **Database changes:** None.
- **Testing:** Confirmed via code review that all 8 flagged routes use router-level (unwrapped) Multer middleware, so the new global handler catches their `next(err)` calls; deployed and health-checked.
- **Status:** Fixed and deployed (commit `e4bf8a1`).
- **Verification date:** 2026-08-08

### FI-006 — Missing indexes on admin delete-safety-check queries
- **Date:** 2026-08-08
- **Module:** Performance / User Management
- **Problem:** `users.js`'s admin-delete-account safety check runs `prisma.lecturePlan.count({ where: { createdById } })` and `prisma.attendanceSession.count({ where: { markedById } })` — neither field was indexed, causing a full-table scan on every staff/clerk/admin account deletion.
- **Root cause:** Indexes were never added when these safety checks were introduced.
- **Fix:** Added `@@index([createdById])` to `LecturePlan` and `@@index([markedById])` to `AttendanceSession`.
- **Files changed:** `backend/prisma/schema.prisma`
- **Database changes:** Additive index creation (via `prisma db push` on next deploy) — no data modified.
- **Testing:** Deployed and health-checked; index creation is low-risk/additive.
- **Status:** Fixed and deployed (commit `e4bf8a1`).
- **Verification date:** 2026-08-08

### FI-007 — Unbounded `companies.js` list query
- **Date:** 2026-08-08
- **Module:** Performance / Company Master
- **Problem:** `GET /api/companies` had no `take` limit — an every-authenticated-role, high-traffic list query (Resume Builder dropdown) with no cap.
- **Root cause:** Never capped when originally written; table growth is admin/clerk-gated so it hadn't yet caused a real problem, but had no safety margin.
- **Fix:** Added `take: 2000`.
- **Files changed:** `backend/src/routes/companies.js`
- **Database changes:** None.
- **Status:** Fixed and deployed (commit `e4bf8a1`).
- **Verification date:** 2026-08-08

### FI-008 — Missing required-field markers on Student Profile
- **Date:** 2026-08-08
- **Module:** Student Profile
- **Problem:** 4 mandatory fields (Father's/Mother's Name/Contact, Short Description) had no `*` marker, unlike every other mandatory field on the same page.
- **Root cause:** UI oversight when these fields were added to `MANDATORY_FIELD_CHECKS`.
- **Fix:** Added `*` to each label in `StudentProfile.jsx`.
- **Files changed:** `frontend/src/pages/StudentProfile.jsx`
- **Database changes:** None.
- **Status:** Fixed and deployed (commit `994c5b5`, Vercel).
- **Verification date:** 2026-08-08

### FI-009 — Unused `uuid` npm dependency
- **Date:** 2026-08-08
- **Module:** Cleanup / Dependencies
- **Problem:** `uuid` was listed as a backend dependency with zero `require("uuid")` calls anywhere in the codebase — Prisma's `@default(uuid())` is a separate, unrelated schema built-in.
- **Fix:** Removed from `backend/package.json`.
- **Database changes:** None.
- **Status:** Fixed and deployed (commit `d67d7ef`).
- **Verification date:** 2026-08-08

### FI-010 — 4 unused static frontend assets
- **Date:** 2026-08-08
- **Module:** Cleanup / Frontend Assets
- **Problem:** `favicon.svg`, `icons.svg` (icon duties consolidated onto `branding/logo.png` at some earlier point), `hero.png` (Landing page's hero section is pure CSS), and `vite.svg` (default Vite scaffold leftover) had zero references anywhere — verified via full-repo string search plus an independent agent audit that found no other unused files anywhere in the codebase.
- **Fix:** Deleted all 4 files.
- **Database changes:** None (not database-related).
- **Status:** Fixed and deployed (commit `d67d7ef`).
- **Verification date:** 2026-08-08

---

## Pre-existing fixes (summary only — predates this documentation pass, detail not independently re-verified here)

The project's own task history records a large number of earlier fixes, including (non-exhaustive, names as recorded, not re-verified in this documentation pass — treat each as **NOT VERIFIED** until independently re-confirmed against current code):
- Monaco Editor CDN-loading hang in the in-browser compiler
- Prisma `upsert`-with-null-compound-key crashes (Daily/Weekly Challenge)
- Bulk-upload template header self-rejection (3 instances)
- A Clerk academic-groups RBAC gap
- `sessionStorage` filter-persistence bug in `StudentSearch.jsx`
- `AdminDashboard.jsx` layout bug (stacked instead of side-by-side)
- A DB connection-pool-exhaustion bug class across multiple routes (login, attendance, tests, grading)
- Login-burst hardening (fire-and-forget audit writes, pool-timeout tuning)
- A "locked question order" bug (student saw fewer test questions than assigned after a test was edited post-start)
- Judge child-process environment-variable leakage (secrets exfiltration risk)
- SSRF in the student-document download proxy
- Missing login rate limit + user-enumeration in login error messages
- Institute-scoping gap on `POST /users` and bulk-upload (an earlier instance of the IDOR class fixed again in FI-001 above, on a different route)
- Unsanitized `dangerouslySetInnerHTML` in `LessonView.jsx`
- Missing file-type/MIME validation on bulk-upload Multer routes
- JWT verification missing an explicit algorithm allowlist
- `StudentProfile` PII fields not encrypted at rest

For any of these, confirm current status by reading the referenced file directly before relying on "fixed" as still true — this summary is a pointer to prior work, not a re-verified guarantee.
