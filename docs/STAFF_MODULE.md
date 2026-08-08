# Staff Module

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## Feature Surface
`/staff` dashboard, Learning Management (read-only), Question Bank (own-scoped), Test creation/management, Attendance (assigned subjects only), Mock Interview admin/CMS, Resume review, Talent Pool (member/attendance management), Result Management (entry), Student Search, Certificates (view/manual issue), Export Center, Audit Log (view), Password Reset (for students), Challenge admin.

## Defining Characteristic: Read-Only Learning Management
Staff has **zero write access** to Learning Management (courses/modules/chapters/lessons/practice questions) — confirmed via `requireRole("ADMIN")`-only on every create/edit/delete route in `learning.js`. The **one explicit exception**: resetting a student's Module Coding Test attempts (`DELETE /api/module-coding/admin/tests/:id/students/:studentId/attempts`, `requireRole("ADMIN","STAFF")` +Institute). This is intentional, not an oversight — see [BUSINESS_RULES.md](BUSINESS_RULES.md) §8.

## Question Bank: Full Access, Own-Scoped
Unlike Learning Management, Staff has full CRUD parity with Admin on the Question Bank — but restricted to questions they created (or unowned/legacy ones). See [QUESTION_BANK.md](QUESTION_BANK.md).

## Attendance: Subject-Scoped
A Staff member only manages attendance for the academic group + subject combinations they've been explicitly assigned (`StaffClassAssignment`). See [ATTENDANCE.md](ATTENDANCE.md).

## Cross-References
[RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md) for the full matrix, [QUESTION_BANK.md](QUESTION_BANK.md), [ATTENDANCE.md](ATTENDANCE.md), [CODING_ASSESSMENT.md](CODING_ASSESSMENT.md), [MOCK_INTERVIEW.md](MOCK_INTERVIEW.md), [RESULT_MANAGEMENT.md](RESULT_MANAGEMENT.md), [TALENT_POOL.md](TALENT_POOL.md).
