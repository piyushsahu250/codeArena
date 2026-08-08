# CodeArena — Platform Documentation

**Documentation Version:** 1.0.0
**Last Updated:** 2026-08-08
**Platform Revision:** `d67d7ef` (backend, deployed) / `d67d7ef` (frontend, deployed)
**Last Code Review:** 2026-08-08 (this documentation pass)

This is the master index for CodeArena's platform documentation. Start here, then read [AI_HANDOVER.md](AI_HANDOVER.md) if you are an AI assistant picking up this project cold.

---

## 1. Platform Name & Purpose

**CodeArena** is a coding-education and campus-placement platform for engineering institutes. It combines:
- Formal coding/MCQ assessments with a self-hosted compiler/judge
- A structured Learning Management System (courses → modules → chapters → lessons, with graded coding assessments)
- AI-assisted mock interview practice (HR/Technical/Aptitude/Coding/System Design/Behavioral/Managerial/Company-Round)
- Institute-wide attendance tracking
- Placement/Talent Pool management and document verification
- Result/marksheet publishing with QR verification
- Gamification (XP, badges, streaks, leaderboards, daily/weekly challenges)

## 2. Target Users

Four roles (see [USER_ROLES.md](USER_ROLES.md) and [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md) for full detail):
- **STUDENT** — takes tests/courses/interviews, builds a resume, tracks attendance/results/placement.
- **STAFF** — teaches: manages Question Bank content (own + shared), attendance for assigned subjects, mock-interview review, some Learning Management read access plus explicitly-permitted coding-assessment attempt resets.
- **CLERK** — Placement Cell operator: student search, placement/offer verification, document verification, results, company master, audit log. No Learning/Test Management access.
- **ADMIN** — full platform administration. Can be *unscoped* (platform-wide "Super Admin", no `instituteId`) or *institute-scoped* (tied to one institute — most administrative actions are then restricted to that institute).

## 3. Main Modules

See the module list in the `/docs` folder — one file per module (Student Profile, Attendance, Learning Management, Question Bank, Coding Assessment, Mock Interview, Daily/Weekly Challenges, Document Verification, Certificates, Placement, Talent Pool, Result Management, Bulk Upload, Search, Notifications, Audit Log, and more).

## 4. Technology Stack

| Layer | Technology | Version (from package.json) |
|---|---|---|
| Frontend | React (SPA, client-rendered), React Router | React 19.2.7, react-router-dom 7.18.1 |
| Frontend build | Vite | 8.1.1 |
| Frontend UI | Hand-rolled CSS (no component library), lucide-react icons, recharts (charts), Monaco Editor (code editor), TensorFlow.js + BlazeFace (in-browser face detection for proctoring), DOMPurify (sanitizing lesson HTML) | — |
| Backend | Node.js, Express | Express 4.19.2 |
| ORM / DB | Prisma Client → PostgreSQL | `@prisma/client` 5.19.1 |
| Auth | JSON Web Tokens (`jsonwebtoken`), `bcryptjs` password hashing | jsonwebtoken 9.0.2 |
| File generation | `pdfkit` (PDFs: certificates, marksheets, reports), `docx` (resume export), `xlsx` (bulk upload/export), `qrcode` (certificate/marksheet QR codes) | — |
| Document parsing | `pdf-parse`, `mammoth` (DOCX) — resume upload/parsing | — |
| Coding judge | Self-hosted, spawns `gcc`/`g++`/`javac`/`java`/`python3` as child processes inside the backend container; `better-sqlite3` for the SQL question type | NOT VERIFIED beyond `backend/src/utils/judge.js` |
| AI | Anthropic Claude API (`backend/src/utils/aiClient.js`) — question generation, resume review/rewrite, interview feedback, learning hints | Requires `ANTHROPIC_API_KEY` |
| Email | `backend/src/utils/mailer.js` — see [ENVIRONMENT.md](ENVIRONMENT.md) for provider details (NOT VERIFIED which provider without reading that file in full) |
| Rate limiting / hardening | `express-rate-limit`, `helmet`, `compression`, custom CORS allowlist | — |
| Deployment (backend) | Docker container on Render (free tier — see [DEPLOYMENT.md](DEPLOYMENT.md)) | — |
| Deployment (frontend) | Vercel | — |
| Database hosting | Render-managed PostgreSQL (inferred from `pg_dump`/`postgresql-client` usage; NOT VERIFIED beyond that) | — |

## 5. Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full data-flow diagram and component breakdown. In short: React SPA → Express REST API (`/api/*`) → JWT auth + role/institute-scoping middleware → Prisma → PostgreSQL. No server-side rendering; all pages are client-rendered.

## 6. Database

76 Prisma models (`backend/prisma/schema.prisma`, ~2,382 lines) + numerous enums. No formal migrations folder — schema changes ship via `prisma db push --accept-data-loss` on every deploy (see [DATABASE.md](DATABASE.md) for why, and the real risk this carries). Full model index in [DATABASE.md](DATABASE.md) and [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

## 7. Authentication

JWT bearer tokens, `HS256` only (explicit algorithm allowlist), issued on login/register, verified by `authenticate` middleware on protected routes. See [AUTHENTICATION.md](AUTHENTICATION.md).

## 8. Deployment

- **Backend**: Docker container → Render (`sanjivani-codearena-backend-docker.onrender.com`), free tier (0.1 vCPU / 512MB, cold-starts on idle — an accepted, known limitation, not something in progress to fix).
- **Frontend**: Vercel (`codearena-app.vercel.app`).
- See [DEPLOYMENT.md](DEPLOYMENT.md) and [DEVOPS.md](DEVOPS.md).

## 9. External Integrations

- **Anthropic Claude API** — AI question generation, resume AI review/rewrite, interview feedback, learning hints, interview draft generation. Gated by `ANTHROPIC_API_KEY`; features degrade gracefully (return a "not configured" error) if unset — NOT VERIFIED beyond `backend/src/utils/aiClient.js`'s `isConfigured` check referenced in `index.js`.
- **Email provider** — see [ENVIRONMENT.md](ENVIRONMENT.md). NOT VERIFIED which provider without a dedicated read of `backend/src/utils/mailer.js`.
- No other third-party integrations (payment, SMS, cloud storage) were found in this documentation pass. If one exists and isn't listed here, treat this line as **NOT VERIFIED** rather than authoritative.

## 10. Current Development Status

This platform has gone through an extensive, incremental build-out (600+ discrete increments recorded in this session's task history alone). Most core modules are **ACTIVE**. See [FEATURE inventory sections in each module doc] for per-feature status, and [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for what's explicitly incomplete or flagged.

Notable **NOT fully built** items (confirmed absent, not just undocumented):
- **Continuous absence alerts** (3-consecutive-day/subject absence notifications) — no scheduler, no alert model exists anywhere in the codebase.
- **Interview Question Bank institute/creator isolation** — `InterviewQuestion`/`CompanyInterviewProfile` have no `instituteId`/`createdById` columns; this bank is platform-wide by current design (see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for why this may be intentional vs. an oversight).
- Several LMS content-authoring and admin-UI items are still `pending` per the project's own task tracker (course content for most languages beyond Java, an admin coverage matrix, weekly-challenge analytics panel) — these are feature backlog, not bugs.

## 11. Important Business Rules

Full detail in [BUSINESS_RULES.md](BUSINESS_RULES.md). Headline rules:
- **Registration Number (PRN)** is the platform's sole permanent, system-wide unique student identifier (`@@unique([registrationNumber])` on `User`).
- **Roll Number** is derived from the last 3 characters of PRN by default, capped at 3 characters, and must be unique only within one Academic Group (Institute+Batch+Department+Section) — duplicates across different groups are expected and allowed.
- **Profile completion** unlocks full platform access at **80%**, not 100%.
- **Course visibility**: new courses are unassigned/hidden by default; must be explicitly assigned to an institute (or academic group) before students there can see them.
- **Question Bank isolation**: institute-scoped, and Staff-authored questions are private to that Staff member unless explicitly shared/unowned.

## 12. Important Security Rules

Full detail in [SECURITY.md](SECURITY.md). Headline: role-based access control is enforced **server-side** on every protected route (never trust the frontend hiding a button); institute-scoping is enforced via `attachRequesterInstitute` + explicit ownership checks, not just by role; passwords are bcrypt-hashed; JWTs are verified with an explicit `algorithms: ["HS256"]` allowlist; PII fields on `StudentProfile` are encrypted at rest.

## 13. Current Known Issues

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for the full, dated list. As of this documentation pass, the two items above (continuous absence alerts, Interview Question Bank isolation) are the significant open items; a handful of smaller cosmetic/UX items are also tracked there.

## 14. Documentation Map

| File | Contents |
|---|---|
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | Expanded version of this README |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Data flow, component breakdown |
| [DATABASE.md](DATABASE.md) | Model index, relationships, by domain |
| [DATA_DICTIONARY.md](DATA_DICTIONARY.md) | Field-level reference per model |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | All 394 backend endpoints, method/path/role |
| [AUTHENTICATION.md](AUTHENTICATION.md) | Login/JWT/session lifecycle |
| [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md) | Full permission matrix |
| [USER_ROLES.md](USER_ROLES.md) | Role definitions and scoping rules |
| [STUDENT_MODULE.md](STUDENT_MODULE.md) / [STAFF_MODULE.md](STAFF_MODULE.md) / [CLERK_MODULE.md](CLERK_MODULE.md) / [ADMIN_MODULE.md](ADMIN_MODULE.md) | Per-role feature surface |
| [INSTITUTE_MANAGEMENT.md](INSTITUTE_MANAGEMENT.md), [ACADEMIC_GROUPS.md](ACADEMIC_GROUPS.md) | Institute/Batch/Dept/Section structure |
| [ATTENDANCE.md](ATTENDANCE.md) | Attendance workflow and rules |
| [LEARNING_MANAGEMENT.md](LEARNING_MANAGEMENT.md), [QUESTION_BANK.md](QUESTION_BANK.md), [CODING_ASSESSMENT.md](CODING_ASSESSMENT.md) | LMS, question bank, coding tests |
| [MOCK_INTERVIEW.md](MOCK_INTERVIEW.md), [DAILY_WEEKLY_CHALLENGES.md](DAILY_WEEKLY_CHALLENGES.md) | AI interview prep, challenges |
| [DOCUMENT_VERIFICATION.md](DOCUMENT_VERIFICATION.md), [CERTIFICATE_MANAGEMENT.md](CERTIFICATE_MANAGEMENT.md) | Docs, certificates |
| [PLACEMENT.md](PLACEMENT.md), [TALENT_POOL.md](TALENT_POOL.md) | Placement Cell, Talent Pools |
| [RESULT_MANAGEMENT.md](RESULT_MANAGEMENT.md), [MARKSHEET.md](MARKSHEET.md), [REPORTS.md](REPORTS.md) | Results, marksheets, exports |
| [BULK_UPLOAD.md](BULK_UPLOAD.md) | Every bulk-upload template |
| [NOTIFICATIONS.md](NOTIFICATIONS.md), [AUDIT_LOG.md](AUDIT_LOG.md), [SEARCH.md](SEARCH.md) | Cross-cutting systems |
| [FILE_STORAGE.md](FILE_STORAGE.md) | Uploads and file handling |
| [SECURITY.md](SECURITY.md), [PERFORMANCE.md](PERFORMANCE.md) | Security posture, performance architecture |
| [DEVOPS.md](DEVOPS.md), [DEPLOYMENT.md](DEPLOYMENT.md), [ENVIRONMENT.md](ENVIRONMENT.md) | Infra, deploy process, env vars |
| [TESTING.md](TESTING.md) | Automated test coverage (spoiler: minimal — see file) |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md), [FIXED_ISSUES.md](FIXED_ISSUES.md) | Bug tracker |
| [BUSINESS_RULES.md](BUSINESS_RULES.md) | Canonical business-rule reference |
| [CHANGELOG.md](CHANGELOG.md) | Dated change log |
| [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) | What backup exists (and doesn't) |
| [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) | How to work on this codebase safely |
| [AI_HANDOVER.md](AI_HANDOVER.md) | **Read this first if you're a new AI session** |
| [platform-manifest.json](platform-manifest.json) | Machine-readable summary |

## 15. Documentation Accuracy Policy

Every statement in this documentation set is either (a) directly verified against the current codebase as of the commit noted above, or (b) explicitly marked **NOT VERIFIED**. Nothing is invented. If the code changes, this documentation may go stale — check [CHANGELOG.md](CHANGELOG.md)'s date against the platform's latest commit before trusting anything here as current.
