# Learning Management (LMS)

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/learning.js` · **Frontend:** `LearningHub.jsx`, `CourseOverview.jsx`, `LessonView.jsx` (student), `LearningManagement.jsx` (admin CMS)

## Hierarchy
`Course` → `CourseModule` → `Chapter` → `Lesson` (with optional `PracticeQuestion`s, and `isModuleTest`-flagged lessons that gate module progression). See [DATABASE.md](DATABASE.md).

## Visibility Rule (critical)
**New courses are invisible by default.** A course must be both (a) in a visible `status` and (b) explicitly assigned via `CourseInstituteAssignment` or `CourseAcademicGroupAssignment` before any student can see it. See [BUSINESS_RULES.md](BUSINESS_RULES.md) §4. Enforced by `backend/src/utils/courseEligibility.js`/`courseLock.js`.

## Access Model
- **STUDENT**: read-only, eligibility-filtered.
- **STAFF**: read-only across the entire CMS (courses/modules/chapters/lessons/practice questions) — confirmed zero `STAFF` in any write-route `requireRole(...)` in `learning.js`. **One exception**: resetting a student's Module Coding Test attempts (a `moduleCoding.js` route, not `learning.js` — see [CODING_ASSESSMENT.md](CODING_ASSESSMENT.md)).
- **ADMIN**: full CRUD + publish + institute/group assignment.
- **CLERK**: no access at all.

## Module Locking
`getModuleLockMap()` (`backend/src/utils/learningLock.js`) computes which modules a student can currently access based on prior module completion — a module-test lesson (`isModuleTest`) gates progression to the next module.

## Certificates
Course completion issues a `Certificate` (unified model, QR-verifiable) — see [CERTIFICATE_MANAGEMENT.md](CERTIFICATE_MANAGEMENT.md).

## Coding Assessments
Module-level graded coding tests are a related-but-separate model (`ModuleCodingTest`) — see [CODING_ASSESSMENT.md](CODING_ASSESSMENT.md).

## Content Status
Per project history, only the Java course has substantial authored content across all modules; most other listed courses (Python, C++, DSA, SQL, etc.) are stub/placeholder content awaiting authoring — treat course content completeness as **NOT VERIFIED to be comprehensive** across all subjects without checking the specific course.

## Related
[BUSINESS_RULES.md](BUSINESS_RULES.md) §4, [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md), [CODING_ASSESSMENT.md](CODING_ASSESSMENT.md), [CERTIFICATE_MANAGEMENT.md](CERTIFICATE_MANAGEMENT.md).
