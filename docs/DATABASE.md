# Database

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08
**Source of truth:** `backend/prisma/schema.prisma` (76 models, ~2,382 lines as of commit `d67d7ef`). This document is an organized index over that file — for exact field types, defaults, and relation attributes, always cross-check the schema file directly; it is authoritative over this summary.

## 1. Migration Strategy — Read This Before Touching the Schema

**There is no formal Prisma Migrate history.** `backend/prisma/migrations/` does not exist in this repository. Every deploy runs:

```
npx prisma db push --skip-generate --accept-data-loss
```

as part of the Docker `CMD` chain, **before** a sequence of one-time/idempotent Node backfill scripts, before `npm start` (see `backend/Dockerfile`). This means:

- Every schema edit becomes live in production the moment the Docker image rebuilds — there is **no staging gate, no review step, no rollback mechanism** beyond redeploying an older commit.
- `--accept-data-loss` means Prisma will **silently apply destructive changes** (dropping a column, narrowing a type, etc.) without prompting, if the new schema implies data loss.
- **Additive changes are low-risk**: new nullable columns, new models, new indexes, new `@@unique`/`@@index` constraints. These are the correct pattern for schema changes going forward.
- **Renaming or dropping an existing column, changing a column's type, or removing a model that still has data is high-risk** and must be treated as a real production data-loss event, not a routine edit.

See [AI_HANDOVER.md](AI_HANDOVER.md) §13 and [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) before making any non-additive schema change.

## 2. Multi-Tenancy Model

Institute-level isolation is enforced at the **application layer**, not the database layer. Most models carry an `instituteId` (directly, or transitively via a relation like `AcademicGroup.instituteId`). Every route that should be institute-scoped uses the `attachRequesterInstitute` middleware plus an explicit comparison against the requester's own `instituteId` in the handler. There is no PostgreSQL row-level security policy — a bug in a route handler's scoping check is a real security gap (see [SECURITY.md](SECURITY.md) for the class of bug this has caused historically, and how it's been fixed each time it's found).

## 3. Model Index by Domain

### Identity & Institute Structure
| Model | Purpose |
|---|---|
| `Institute` | One engineering institute/college tenant. Holds settings (`requireProfileCompletion`, `singleSessionOnly`, `passwordExpiryDays`, `passwordHistoryDepth`, `aiHintsEnabled`, `marksheetSignatories`, `isActive`, branding). |
| `User` | Every human account: STUDENT/STAFF/CLERK/ADMIN, one shared table (`role` enum discriminates). Carries `registrationNumber` (PRN, `@@unique`), `rollNumber`, `instituteId` (nullable → unscoped/Super account), `academicGroupId` (students), `employeeId`/`designation` (staff/clerk), `accountStatus`, auth fields (`passwordHash`, `mustChangePassword`). |
| `Class` | Legacy/parallel class construct — largely superseded by `AcademicGroup` per this session's history (Phase A–F migration); still referenced by some older relations. Treat as **NOT VERIFIED** whether still actively written to without checking `classes.js` directly. |
| `Department`, `Division` | Institute's academic department/division hierarchy, feeding into `AcademicGroup`. |
| `AcademicGroup` | The canonical grouping unit: **Institute + Batch + Department + Section**. Auto-created (find-or-create) whenever a student is assigned one via `resolveAcademicGroup()`. Roll Number uniqueness is scoped to this model. |

### Assessments (Formal Tests)
| Model | Purpose |
|---|---|
| `Test` | A formal test/exam definition: duration, question-selection mode (fixed/random), shuffle settings, proctoring config, `attendanceMandatory` flag, publish state, `company` (for Company Coding Tests). |
| `TestClass`, `TestAcademicGroup` | Join tables assigning a `Test` to specific classes/academic groups. |
| `Question` | A question in the institute/staff-scoped Question Bank — MCQ/TRUE_FALSE/MULTISELECT/CODING/SQL, with `instituteId`, `createdById` (staff ownership), `evaluationType`/`functionSignature` for FUNCTION-mode coding questions. |
| `QuestionFolder` | Hierarchical (self-referential `parentId`) folder structure for organizing the Question Bank. |
| `TestCase` | Hidden/visible test cases for a CODING/SQL `Question`. |
| `TestQuestion` | Join table: which questions belong to which `Test`, with per-question order/time-limit overrides. |
| `TestAttempt` | One student's attempt at a `Test` — start/submit timestamps, status, stored `questionOrder`/`optionOrder` (for shuffled tests), total score. |
| `Submission` | One student's answer to one question within an attempt — verdict, score, passed/total test cases, execution time/memory. |

### Learning Management (LMS)
| Model | Purpose |
|---|---|
| `Course` | Top-level course (e.g. "Java Programming"). `status` (`CourseStatus` enum) gates visibility; not visible to students until explicitly assigned to their institute/group. |
| `CoursePrerequisite` | Course-to-course prerequisite links. |
| `CourseInstituteAssignment`, `CourseAcademicGroupAssignment` | Explicit assignment of a course to an institute or a specific academic group — the mechanism that makes a course visible to students (see [BUSINESS_RULES.md](BUSINESS_RULES.md)). |
| `CourseModule` | A module within a course (e.g. "Module 1: Basics"). |
| `Chapter` | A chapter within a module (additive schema layer added later per project history). |
| `Lesson` | A single lesson (content + optional quiz), `isModuleTest` flag marks module-gating lessons. |
| `LessonProgress` | Per-student progress/completion state per lesson. |
| `PracticeQuestion` | In-lesson practice question (separate from the formal Question Bank `Question` model). |
| `PracticeRunLog` | Coding-practice run history, feeds gamification streaks. |
| `CodeDraft` | Autosaved in-progress code for practice/lesson coding questions. |

### Module Coding Tests (per-module graded coding assessment)
| Model | Purpose |
|---|---|
| `ModuleCodingTest` | A graded coding assessment attached to a course module. |
| `ModuleCodingAttempt` | A student's attempt (max-attempt-limited — see [CODING_ASSESSMENT.md](CODING_ASSESSMENT.md)). |
| `ModuleCodingAttemptQuestion` | Per-question state within an attempt. |
| `ModuleCodingSubmission` | Per-question submission/verdict within an attempt. |
| `ProctoringViolation` | Recorded proctoring violation events (tab-switch, face-not-detected, etc.) for a monitored attempt. |

### Gamification
| Model | Purpose |
|---|---|
| `XpRule` | Configurable XP amount per activity type. |
| `XpEvent` | Log of XP awarded to a student. |
| `Badge`, `StudentBadge` | Badge definitions and per-student earned badges. |
| `StudentStreak` | Daily-activity streak tracking. |
| `DailyChallenge`, `DailyChallengeSubmission`, `WeeklyChallenge`, `WeeklyChallengeSubmission` | Scoped (platform-wide, per-institute, or per-academic-group) daily/weekly coding challenges and student submissions. |

### Resume / Placement Prep
| Model | Purpose |
|---|---|
| `Resume` | Student's resume content (structured sections). |
| `ResumeVersion` | Snapshot history of a resume. |
| `ResumeFieldConfig` | Admin-configurable field visibility/requirements for the resume form. |
| `ResumeFeedback` | Staff/AI feedback on a submitted resume. |
| `StudentProfile` | Personal/academic profile fields separate from `User` — PII-encrypted at rest (see [SECURITY.md](SECURITY.md)). Feeds the 80%-unlock completion calculation. |
| `Company` | Company Master — shared dropdown list used by Resume Builder, Placement Offers, Talent Pools. |

### Placement & Documents
| Model | Purpose |
|---|---|
| `PlacementOffer` | A placement offer a student has received — company, package, verification status (`OfferVerificationStatus`). |
| `StudentDocument` | An uploaded (externally-linked) verification document — type, `verificationStatus` (`DocumentVerificationStatus`), verifier identity, rejection reason. |

### Mock Interview (AI-assisted)
| Model | Purpose |
|---|---|
| `InterviewQuestion` | Question bank for mock interviews — **platform-wide, no institute/creator scoping** (see [KNOWN_ISSUES.md](KNOWN_ISSUES.md)). Categories via `InterviewCategory` enum (HR/TECHNICAL/APTITUDE/CODING/SYSTEM_DESIGN/BEHAVIORAL/MANAGERIAL). |
| `InterviewQuestionDraft`, `CompanyPatternNote` | AI-generated draft questions/company-pattern notes awaiting admin approval (`DraftStatus` enum) before becoming live. |
| `CompanyInterviewProfile` | Per-company interview round configuration (rotation, elimination rules). |
| `InterviewSession` | One student's mock interview session — type, round state, status. |
| `InterviewViolation` | Proctoring violations during a session. |
| `InterviewAnswer` | Per-question answer + AI/heuristic evaluation. |
| `InterviewReport` | Generated post-session report/analysis. |
| `InterviewCertificate` | Certificate issued on session completion (separate from the unified `Certificate` model — NOT VERIFIED why these weren't consolidated; flag as a documentation question, not a confirmed bug). |

### Attendance
| Model | Purpose |
|---|---|
| `StaffClassAssignment` | Assigns a staff member to an academic group **for one subject** (`@@unique([academicGroupId, subject])` — this is what allows multiple staff on the same group, one per subject). |
| `LecturePlan` | A scheduled lecture (date, slot, subject, type) under one assignment. Can auto-generate from a Talent Pool's attendance-mandatory tests (`testId` link). |
| `AttendanceSession` | The "roll call taken" record for one `LecturePlan` (1:1, `@@unique` on `planId`). Tracks who marked it and when, plus edit history (`updatedBy`/`updatedAt`). |
| `AttendanceRecord` | Per-student status (PRESENT/ABSENT/LATE/LEAVE) within one session. |

### Certificates
| Model | Purpose |
|---|---|
| `Certificate` | Unified certificate model (Learning Module completion, Coding Assessment, manual issuance) with QR verification code and `CertificateStatus`. |

### Result Management
| Model | Purpose |
|---|---|
| `ResultExamination` | An examination definition (name, term, status via `ResultExaminationStatus`, publish state). |
| `ResultExaminationDepartment` | Which departments an examination applies to. |
| `ResultEntry` | One student's result row within an examination (`ResultEntrySource` tracks manual vs. bulk-import origin). |

### Talent Pool
| Model | Purpose |
|---|---|
| `TalentPool` | A cross-institute or institute-scoped placement-eligibility pool. |
| `TalentPoolInstitute` | Which institutes participate in a pool. |
| `TalentPoolMember` | Student membership in a pool. |
| `TalentPoolAutoRule` | Auto-selection rule (criteria-based) for pool membership. |
| `TalentPoolTest` | Tests linked to a pool (for eligibility/attendance-mandatory tracking). |
| `TalentPoolInterviewConfig` | Interview-round configuration scoped to a pool. |

### Security & Audit
| Model | Purpose |
|---|---|
| `AuditLog` | Platform-wide admin/security action log — actor, role, action, target, institute, details (JSON), timestamp. Extended with `studentId`/`instituteId` for filtering per project history. |
| `PasswordHistory` | Password-reuse prevention (`passwordHistoryDepth` per institute). |
| `LoginSession` | Active session/device tracking, supports forced logout and `singleSessionOnly` enforcement. |
| `EmailLog` | Delivery status log for every outbound email (root-caused a "false success" email bug historically — see [FIXED_ISSUES.md](FIXED_ISSUES.md)). |
| `Notification` | In-app notification (bell icon) per user. |

## 4. Enums

`Role`, `AccountStatus`, `Difficulty`, `CourseStatus`, `QuestionType`, `EmailStatus`, `CertificateType`, `CertificateStatus`, `OfferVerificationStatus`, `DocumentVerificationStatus`, `InterviewCategory`, `AptitudeCategory`, `DraftStatus`, `FrequencyTag`, `PackageBand`, `ExperienceLevel`, `ResultExaminationStatus`, `ResultEntrySource`, `LectureType`. Exact values for each: read the corresponding `enum` block in `schema.prisma` directly — not reproduced here to avoid drift from the source of truth.

## 5. Indexes

Indexing has been the subject of multiple dedicated passes (see [FIXED_ISSUES.md](FIXED_ISSUES.md) and [PERFORMANCE.md](PERFORMANCE.md)) — including a fix in this session adding `@@index([createdById])` to `LecturePlan` and `@@index([markedById])` to `AttendanceSession`. Do not assume a query path is indexed without checking the model's `@@index`/`@@unique` declarations directly; several historical bugs were exactly this (a full-table-scan query with no supporting index).

## 6. Data Safety

See [AI_HANDOVER.md](AI_HANDOVER.md) §14 and [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md). In short: this schema holds real student PII, attendance, results, and placement data. Never drop a model or column without first grepping every route file for references to it, and never assume `--accept-data-loss` "probably won't lose anything" — verify.
