# Data Dictionary

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08
**Scope:** Field-level detail for the models most likely to be referenced by future development — not all 76 models exhaustively (see [DATABASE.md](DATABASE.md) for the full model index by domain). `backend/prisma/schema.prisma` is always the canonical source; this file is a curated reference, not a copy.

## `User` (full)

The shared account table for all four roles.

| Field | Type | Notes |
|---|---|---|
| `id` | String (uuid) | PK |
| `name`, `email` (unique), `passwordHash` | String | — |
| `role` | `Role` enum | STUDENT/STAFF/CLERK/ADMIN, default STUDENT |
| `rollNumber` | String? | Students only. Indexed (`@@index`), **not** database-unique — see below. |
| `registrationNumber` | String? | Students only. **`@@unique`** — the sole permanent identifier, see [BUSINESS_RULES.md](BUSINESS_RULES.md). |
| `department`, `mobile`, `gender`, `program`, `batchYear`, `section` | String? | Free-text; `department`/`batchYear`/`section` also drive `AcademicGroup` resolution. |
| `isActive` | Boolean | `false` blocks login. |
| `profilePhotoUrl` | String? | Stored as a data URL — no external file storage for this field. |
| `mustChangePassword` | Boolean | Forces `/change-password` redirect. |
| `passwordChangedAt` | DateTime? | Drives per-institute password-expiry. |
| `accountStatus` | `AccountStatus` enum | Staff/Clerk dashboard status, separate concept from `isActive`. |
| `employeeId`, `designation` | String? | Staff/Clerk. `employeeId` is `@@unique([instituteId, employeeId])`. |
| `lastLoginAt` | DateTime? | Denormalized from `LoginSession` for cheap sort/filter. |
| `instituteId`, `classId`, `academicGroupId` | String? (FKs) | `classId` is a legacy field kept populated for rollback safety but no longer read by current code; `academicGroupId` is the real enrollment mechanism. |
| `resetTokenHash`, `resetTokenExpiry` | String?/DateTime? | Password-reset flow. |

**Indexes/constraints**: `@@unique([registrationNumber])`, `@@unique([instituteId, employeeId])`, plus plain indexes on `instituteId`, `classId`, `academicGroupId`, `role`, `department`, `[role, instituteId]`, `accountStatus`, `rollNumber`.

**⚠️ Stale in-code comment note**: the schema's own comment above `rollNumber` says it is "deliberately NOT unique... duplicates across departments/institutes are expected and allowed by design" — this is still true for the **database-level** constraint (correct, no `@@unique` on `rollNumber` alone), but it predates this session's **application-level** fix that now enforces uniqueness *within one Academic Group* (see [BUSINESS_RULES.md](BUSINESS_RULES.md) §2, [FIXED_ISSUES.md](FIXED_ISSUES.md) FI-002). Treat [BUSINESS_RULES.md](BUSINESS_RULES.md) as current truth over this specific in-schema comment.

## `AcademicGroup` (full)

The Institute+Batch+Department+Section grouping unit.

| Field | Type | Notes |
|---|---|---|
| `id` | String (uuid) | PK |
| `instituteId`, `departmentId` | String (FK, cascade delete) | |
| `batch` | String | e.g. "2025-2028", or "Unassigned" |
| `section` | String | e.g. "Section A" |
| `isActive` | Boolean | |
| `createdAt` | DateTime | |

**Constraint**: `@@unique([instituteId, batch, departmentId, section])` — this is the group-identity constraint; find-or-create via `resolveAcademicGroup()` in `backend/src/routes/users.js`.

## Other Key Models — Field Summary (not exhaustive; read `schema.prisma` for full detail)

| Model | Key fields worth knowing |
|---|---|
| `Institute` | `name`, `code`, `isActive`, `requireProfileCompletion`, `singleSessionOnly`, `passwordExpiryDays`, `passwordHistoryDepth`, `aiHintsEnabled`, `marksheetSignatories` (JSON), branding fields. |
| `StudentProfile` | Separate from `User`; PII-encrypted fields (see [SECURITY.md](SECURITY.md)); feeds the 80%-unlock completion calculation via `backend/src/utils/studentProfileCompletion.js`. |
| `Test` | `title`, `durationMin`, `isPublished`, question-selection mode fields, `shuffleQuestions`/`shuffleOptions`, `attendanceMandatory`, `company` (Company Coding Tests), `createdById`, `instituteId`. |
| `TestAttempt` | `studentId`, `testId`, `status`, `startedAt`/`submittedAt`, `questionOrder`/`optionOrder` (JSON, persisted per-student shuffle), `totalScore`. |
| `Question` | `instituteId`, `createdById` (Staff-ownership scoping), `questionType`, `difficulty`, `evaluationType`/`functionSignature` (FUNCTION-mode coding). |
| `Course` | `slug`, `status` (`CourseStatus`), visibility computed via `CourseInstituteAssignment`/`CourseAcademicGroupAssignment`, not a direct field. |
| `StaffClassAssignment` | `academicGroupId`, `staffId`, `subject` — `@@unique([academicGroupId, subject])`, the key that allows multiple staff on one group. |
| `LecturePlan` | `assignmentId`, `lectureNumber`, `subject`, `scheduleDate`, `slotLabel`, `lectureType`, optional `testId` (Talent Pool auto-generated plans). |
| `AttendanceSession` | `planId` (`@@unique`, 1:1 with `LecturePlan`), `markedById`/`markedAt`, `updatedById`/`updatedAt`. |
| `AttendanceRecord` | `sessionId`, `studentId`, `status` (plain String: PRESENT/ABSENT/LATE/LEAVE) — `@@unique([sessionId, studentId])`. |
| `PlacementOffer` | `studentId`, `companyId` (unindexed — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) KI-004), `verificationStatus` (`OfferVerificationStatus`). |
| `StudentDocument` | `studentId`, `documentType`, `documentLink` (external URL, not a binary upload), `verificationStatus` (`DocumentVerificationStatus`), `verifiedByUserId`/`verifiedByName`/`verifiedAt`, `rejectionReason`. |
| `Certificate` | `studentId`, `type` (`CertificateType`), `status` (`CertificateStatus`), QR verification code, `courseId` (indexed). |
| `ResultExamination` / `ResultEntry` | Examination-level `status`/publish state; entry-level `source` (`ResultEntrySource`: manual vs. bulk-import). |
| `AuditLog` | `action`, `adminId`/`adminName`, `studentId`, `instituteId`, `details` (JSON — never passwords/tokens), `createdAt`. |
| `InterviewQuestion` / `CompanyInterviewProfile` | **No `instituteId`/`createdById`** — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) KI-001. |

## Enums Quick Reference

`Role` (STUDENT/STAFF/CLERK/ADMIN), `AccountStatus`, `Difficulty`, `CourseStatus`, `QuestionType`, `EmailStatus`, `CertificateType`, `CertificateStatus`, `OfferVerificationStatus`, `DocumentVerificationStatus`, `InterviewCategory`, `AptitudeCategory`, `DraftStatus`, `FrequencyTag`, `PackageBand`, `ExperienceLevel`, `ResultExaminationStatus`, `ResultEntrySource`, `LectureType` — read the corresponding `enum` block in `schema.prisma` for exact values; not reproduced here to avoid drift.

## For Everything Else

The remaining ~60 models are indexed by domain (with one-line purpose each) in [DATABASE.md](DATABASE.md) §3. For exact fields on any of them, read the model block in `backend/prisma/schema.prisma` directly — it is extensively commented in this codebase's own house style, often explaining *why* a field exists, not just its type.
