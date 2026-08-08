# Bulk Upload

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## Universal Rule
**Registration Number (PRN) is the student-identity column on every bulk-upload template that identifies a student** — Roll Number is never a template input column anywhere on the platform; it is always server-derived from the PRN. See [BUSINESS_RULES.md](BUSINESS_RULES.md) §1–2.

## Templates (by route)

| Template | Route | Uploader Role | Identity Column |
|---|---|---|---|
| Student accounts | `POST /api/users/bulk-upload` | ADMIN | PRN (creates new accounts) |
| Lecture plans | `POST /api/attendance/assignments/:id/plans/bulk-upload` | ADMIN, STAFF | — (plan/schedule data, not student identity) |
| Question Bank (MCQ-style) | `POST /api/questions/bulk-import` | ADMIN, STAFF | — (questions, not students) |
| Question Bank (coding) | `POST /api/questions/bulk-import-coding` | ADMIN, STAFF | — |
| Interview questions | `POST /api/interview/admin/questions/import` | ADMIN, STAFF | — |
| Module Coding Test questions | `POST /api/module-coding/admin/tests/:id/questions/bulk-import` | ADMIN | — |
| Talent Pool members | `POST /api/talent-pools/:id/bulk-import` | ADMIN | PRN (matches existing students, never creates accounts) |
| Result entries | `POST /api/results/admin/examinations/:id/bulk-import` | ADMIN, STAFF, CLERK | PRN (matches existing students) |

Every route above is Multer-based (`upload.single("file")`, 5MB limit, spreadsheet-only file filter). A file-size-limit error on any of these 8 now returns clean JSON (fixed this session — see [FIXED_ISSUES.md](FIXED_ISSUES.md) FI-005); file-type rejection was already handled gracefully pre-existing.

## Common Validation Pattern
Row-level validation (name/PRN/email/institute presence and format) happens **before** any database write — invalid rows are collected into an `errors`/`duplicates` report and skipped, never partially written. Duplicate detection checks both the existing database and rows already seen earlier in the same file (`seenEmails`/`seenRegNumbers` sets). **An invalid row never corrupts existing student data** — confirmed via this pattern across every template.

## Roll Number Handling During Bulk Upload
As of this session's fix, the student bulk-upload path resolves Roll Number collisions **within each row's target Academic Group**, using an in-memory per-group cache (avoids one extra query per row) — see [FIXED_ISSUES.md](FIXED_ISSUES.md) FI-002.

## Institute Scoping
An institute-scoped Admin/Staff/Clerk can only bulk-upload into their own institute — every template's route enforces this (a row targeting a different institute is rejected, not silently redirected).

## Related
[BUSINESS_RULES.md](BUSINESS_RULES.md), [ACADEMIC_GROUPS.md](ACADEMIC_GROUPS.md), [QUESTION_BANK.md](QUESTION_BANK.md), [TALENT_POOL.md](TALENT_POOL.md), [RESULT_MANAGEMENT.md](RESULT_MANAGEMENT.md).
