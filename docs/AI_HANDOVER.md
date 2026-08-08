# AI Handover — Read This First

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Platform Revision:** `d67d7ef`

If you are a new Claude (or other AI) session picking up work on CodeArena with no memory of prior conversations, read this file completely before touching any code.

---

## 1. What CodeArena Is

A coding-education + campus-placement platform for engineering institutes: coding/MCQ assessments with a self-hosted compiler, a structured Learning Management System, AI mock interviews, attendance tracking, placement/talent-pool management, document verification, results/marksheets, and gamification. Full description: [README.md](README.md).

## 2. Current Architecture (one paragraph)

React 19 SPA (Vite build, client-rendered, no SSR) talking to an Express 4 REST API over `/api/*`. Auth is JWT (HS256). Every protected route runs `authenticate` (verifies JWT) then usually `requireRole(...)` (role allowlist) and, for institute-scoped data, `attachRequesterInstitute` (loads the requester's own `instituteId` so a scoped Admin/Staff/Clerk can't reach another institute's data). Prisma ORM → PostgreSQL, 76 models. Backend deploys as a Docker container to Render; frontend deploys to Vercel. No formal Prisma migrations — schema changes ship via `prisma db push --accept-data-loss` in the Docker boot chain (see [DATABASE.md](DATABASE.md) — this is a real, standing data-loss risk pattern, not hypothetical).

## 3. Technology Stack

See [README.md](README.md) §4 for the full table. Key point for anyone writing code: **this environment typically has no local Node/npm** — verification of backend/frontend changes has historically been done by pushing to `main` and polling the Render `/api/health` endpoint (returns `{status, service, commit}`) until the deployed `commit` matches the new push, plus checking Vercel's own build success for frontend changes. Do not assume `npm install`/`npm run build`/`npm test` are runnable locally without checking first.

## 4. Complete Module List

See [README.md](README.md) §14 for the doc-per-module map. At the code level, the module boundary is one file per concern in `backend/src/routes/*.js` (31 files) mounted in `backend/src/index.js`, and one-or-more pages per module in `frontend/src/pages/*.jsx` wired into `frontend/src/App.jsx`'s route table.

## 5. User Roles

Four: `STUDENT`, `STAFF`, `CLERK`, `ADMIN` (Prisma enum `Role`). Full detail: [USER_ROLES.md](USER_ROLES.md), [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md). Critical nuance: `ADMIN` and `STAFF` and `CLERK` accounts can be **unscoped** (`instituteId = null`, platform-wide "Super Admin"/"Super Staff") or **institute-scoped** (`instituteId` set, restricted to their own institute's data on every route that calls `attachRequesterInstitute`). Do not assume every Admin is a Super Admin.

## 6. Critical Business Rules — Do Not Violate These

Full detail: [BUSINESS_RULES.md](BUSINESS_RULES.md). The ones that have caused real bugs before, so treat as load-bearing:

1. **Registration Number (PRN)** is the sole permanent, system-wide unique student identifier. `@@unique([registrationNumber])` on `User`. Never key student identity off Roll Number.
2. **Roll Number** = last 3 characters of PRN by default, max 3 characters, **unique only within one Academic Group** (Institute+Batch+Department+Section) — duplicates across different groups are correct, expected behavior, not a bug. Never prefix it with "DUP" or any marker.
3. **Profile completion unlocks the platform at 80%**, not 100%. Optional fields must never dilute the percentage — the same field list is both numerator and denominator basis.
4. **New courses are invisible by default.** A course must be explicitly assigned to an institute (or a specific academic group within it) before any student there can see it.
5. **Question Bank is institute-isolated, and Staff-authored questions are private to that Staff member** within the institute unless explicitly shared/unowned (`createdById: null`).
6. **Roll Number auto-derivation must never produce a "DUP"-style tag** — on collision within a group, the platform slides a 3-character window across the rest of the PRN instead.
7. Institute-scoped Admin accounts must **never** be able to read/write another institute's data — this exact bug class (missing `attachRequesterInstitute` + ownership check) has been found and fixed multiple times across different route files; always check for it when adding a new institute-scoped route.

## 7. Database Overview

76 models across roughly: Identity & Institute (`User`, `Institute`, `Class`, `Department`, `Division`, `AcademicGroup`), Assessments (`Test`, `Question`, `TestAttempt`, `Submission`, `TestCase`), Learning Management (`Course`, `CourseModule`, `Chapter`, `Lesson`, `PracticeQuestion`, `LessonProgress`), Module Coding Tests (`ModuleCodingTest`, `ModuleCodingAttempt`, `ModuleCodingSubmission`), Interview Prep (`InterviewSession`, `InterviewQuestion`, `InterviewReport`, `CompanyInterviewProfile`), Attendance (`StaffClassAssignment`, `LecturePlan`, `AttendanceSession`, `AttendanceRecord`), Placement (`PlacementOffer`, `StudentDocument`, `TalentPool*`), Results (`ResultExamination`, `ResultEntry`), Gamification (`XpRule`, `XpEvent`, `Badge`, `StudentStreak`), Certificates (`Certificate`, `InterviewCertificate`), Security/Audit (`AuditLog`, `PasswordHistory`, `LoginSession`, `EmailLog`). Full index: [DATABASE.md](DATABASE.md), field-level detail: [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

## 8. Current Implementation Status

Almost everything listed in [README.md](README.md)'s module map is `ACTIVE` and has been through at least one QA/audit pass. Known genuinely-missing pieces (confirmed absent, not just undocumented) are listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — read that file before assuming a feature exists.

## 9. Recently Fixed Bugs

See [FIXED_ISSUES.md](FIXED_ISSUES.md) for the dated log. Most recent significant batch (2026-08-08): institute-scoped Admin cross-institute IDOR on `institutes.js`, Roll Number uniqueness-within-group enforcement, raw Prisma error message leakage on ~20 routes, generic error messages on the exam-taking path, Multer file-size-limit errors returning non-JSON.

## 10. Current Development Priorities

NOT VERIFIED as an official roadmap — inferred from the project's own task tracker at the time of this documentation pass: LMS content authoring for languages beyond Java (Python, DSA, SQL, C, etc.), an admin coverage matrix for interview-question company/topic gaps, a weekly-challenge analytics panel, and (per this session's QA audit) a scoping decision on whether to build continuous-absence alerts and whether to add institute isolation to the Interview Question Bank. Confirm current priorities with the user before assuming any of these are "next."

## 11. Known Limitations

- **No local Node/npm in the typical dev environment** — see §3.
- **Render free tier**: 0.1 vCPU / 512MB, cold-starts after idle. User has explicitly declined migrating off it — do not re-propose this unless asked.
- **No automated test suite** — see [TESTING.md](TESTING.md). Verification is manual (deploy + browser walkthrough) or via ad-hoc QA/security audit passes.
- **No formal DB migrations** — `prisma db push --accept-data-loss` on every boot. A destructive schema change (dropping/renaming a column with data) can silently lose data on the next deploy. Always design schema changes as additive when possible.
- **Interview Question Bank has no institute/creator isolation** (unlike the main Question Bank) — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- **No continuous-absence-alert feature** exists at all.

## 12. Important Warnings

- **Never treat frontend role-gating as security.** Every sensitive action must be independently enforced server-side. This codebase has repeatedly needed this exact class of fix (institute isolation gaps) — always check for it in new code.
- **Never silently overwrite production data during "cleanup."** This platform stores real student/staff/attendance/results/document data. When in doubt, don't delete — see [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
- **`prisma db push --accept-data-loss` runs on every deploy.** Any schema edit is live in production the moment it's pushed and the Docker image rebuilds — there is no staging gate. Review schema changes very carefully.
- **Do not fabricate database backup guarantees.** As of this documentation pass, there is no automated database backup schedule configured — only an on-demand admin-triggered `pg_dump` route. See [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).

## 13. Files That Should Not Be Modified Casually

- `backend/prisma/schema.prisma` — any change here is live on the next deploy (see §12). Additive-only changes (new nullable columns, new indexes, new models) are low-risk; renaming/dropping/type-changing existing columns is high-risk.
- `backend/Dockerfile`'s `CMD` boot chain — it runs a specific ordered sequence of one-time/idempotent migration/backfill scripts before `npm start`. Removing or reordering entries can silently stop a needed backfill from running, or run something destructive against already-migrated data.
- `backend/src/middleware/auth.js`, `backend/src/middleware/institute.js` — the core of the security model. Changes here affect every protected route platform-wide.
- `backend/src/utils/judge.js` — the code-execution sandbox. Has been hardened multiple times against real security issues (env-var leakage to the sandboxed child process, privilege-drop gaps). Treat any change here as security-sensitive.

## 14. Data Safety Rules

Never delete a student/staff/clerk record, attendance record, submission, result, certificate, or uploaded document as part of a "cleanup" or "refactor" task unless the user explicitly asks for that specific deletion. Never remove a Prisma model or column that still has a live route reading/writing it. Never assume an "unused" table is safe to drop without grepping every route file for it first. See [DATABASE.md](DATABASE.md) §"Data Safety" and [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).

## 15. Deployment Information

- Backend health check: `GET https://sanjivani-codearena-backend-docker.onrender.com/api/health` → `{status, service, commit}`. Use this to confirm a push actually deployed — poll it after pushing to `main`, don't assume.
- Backend repo push target: `origin main` (GitHub, moved to `https://github.com/piyushsahu250/codeArena.git` per a recent `git push` notice — the remote URL in this checkout may show a redirect notice; that's expected).
- Frontend: Vercel auto-deploys on push to `main` (no manual health-check pattern established for it — a build failure would need to be checked in the Vercel dashboard, which this environment cannot access directly).
- Full detail: [DEPLOYMENT.md](DEPLOYMENT.md), [DEVOPS.md](DEVOPS.md), [ENVIRONMENT.md](ENVIRONMENT.md).

## 16. How to Continue Development Safely

1. Read this file, then [README.md](README.md), then the specific module doc for whatever you're working on.
2. Before changing a route's permission logic, read [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md) and confirm the intended matrix — don't guess.
3. Before changing a business rule (PRN/Roll Number, profile completion, attendance, course visibility, etc.), read [BUSINESS_RULES.md](BUSINESS_RULES.md) — these rules have been the subject of repeated bug fixes; changing them casually risks reintroducing already-fixed bugs.
4. Before adding a new institute-scoped route, mirror the `attachRequesterInstitute` + explicit `req.requesterInstituteId !== target.instituteId` check pattern used elsewhere (e.g. `institutes.js`'s `GET /:id/profile-completion-stats`) — do not skip it.
5. Make the smallest safe change. Identify dependencies and related modules before editing. Test the change and anything it touches. This mirrors the standing instruction this platform's own maintainer has given repeatedly across QA passes: no regressions, no silent scope creep.
6. After any change, update [CHANGELOG.md](CHANGELOG.md), the relevant module doc, and [KNOWN_ISSUES.md](KNOWN_ISSUES.md)/[FIXED_ISSUES.md](FIXED_ISSUES.md) as applicable — see [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) for the exact update checklist this documentation set is meant to follow.
7. Deploy and verify via the health-check/poll pattern in §15 before considering a change done.
