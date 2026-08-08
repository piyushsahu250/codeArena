# Question Bank

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/questions.js` (1387 lines, largest single-concern route file after attendance/interview) · **Frontend:** `QuestionBank.jsx`, `CreateQuestion.jsx`

## Isolation Model (confirmed clean — this session's audit)
Two layers:
1. **Institute isolation** — every list/search/get/folder/export/bulk route filters through `questionVisibilityWhere()` (`backend/src/utils/questionVisibility.js`). A question created under Institute A is never visible to Institute B.
2. **Staff-private ownership** — within one institute, a question with `createdById` set is private to that Staff member; `createdById: null` means shared/legacy. `ownsQuestionRow()` enforces this on every single-row route (get/patch/delete) and every bulk/folder operation including recursive folder-delete and merge. A different Staff member at the same institute cannot see, edit, or delete another's private questions via any route. **ADMIN is exempt from the ownership restriction** (sees everything in their institute/platform).

**This isolation model does NOT extend to the Interview Question Bank** — see [MOCK_INTERVIEW.md](MOCK_INTERVIEW.md) and [KNOWN_ISSUES.md](KNOWN_ISSUES.md) KI-001. Do not assume the two "question bank" concepts share guarantees.

## Structure
`Question` (MCQ/TRUE_FALSE/MULTISELECT/CODING/SQL) → `TestCase` (hidden/visible, for CODING/SQL) organized in a hierarchical, self-referential `QuestionFolder` tree (parentId, category, description).

## Access
`requireRole("ADMIN","STAFF")` on every route — parity at the route level, differentiated by the ownership filter above.

## Operations
Create/View/Edit/Delete, folder CRUD (including merge, clear, delete-preview), bulk move/delete/copy, bulk import (CSV/XLSX, both MCQ-style and coding-specific templates with duplicate detection), export (institute/creator-scoped), starter-code preview for FUNCTION-mode coding questions.

## Duplicate Detection
Confirmed present on both create and both bulk-import paths (per project history) — checks by normalized description/title within the requester's visibility scope.

## Related
[BUSINESS_RULES.md](BUSINESS_RULES.md) §5, [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md), [BULK_UPLOAD.md](BULK_UPLOAD.md), [MOCK_INTERVIEW.md](MOCK_INTERVIEW.md) (contrast case).
