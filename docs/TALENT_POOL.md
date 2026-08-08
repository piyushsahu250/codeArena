# Talent Pool

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/talentPools.js` (largest single-concern route file besides attendance/interview) · **Frontend:** `TalentPools.jsx` (admin), `MyTalentPools.jsx` (student)

## What It Is
Cross-department/batch student groupings for placement-drive eligibility — deliberately a separate model from `AcademicGroup` (which is the *academic* enrollment unit). A pool can span **multiple institutes** (`TalentPoolInstitute` join table), unlike almost everything else on the platform which is single-institute-scoped.

## Membership
Manual add/remove (`TalentPoolMember`), bulk import (matches by Institute + Registration Number/PRN — never creates new accounts, only links existing students — Roll Number is never a bulk-import column here, consistent with platform-wide convention), student transfer (move/copy between pools), and rule-based auto-selection (`TalentPoolAutoRule` — preview before run, ADMIN only).

## Test Eligibility
`TalentPoolTest` links formal tests to a pool for eligibility purposes; `TalentPoolInterviewConfig` does the same for mock-interview round configuration scoped to a pool.

## Attendance Integration
A pool can have attendance-mandatory tests; Staff can **self-claim** attendance ownership for their own institute's participation in a pool (`POST /:id/attendance-owners`, self-service, no Admin intervention needed) — this auto-generates `LecturePlan` rows (`syncTalentPoolPlans`) linked via `LecturePlan.testId`. See [ATTENDANCE.md](ATTENDANCE.md).

## Leaderboard
`GET /:id/leaderboard` — uniquely accessible to STUDENT (own pool) as well as ADMIN/STAFF, +Institute.

## Related
[ATTENDANCE.md](ATTENDANCE.md), [PLACEMENT.md](PLACEMENT.md), [BULK_UPLOAD.md](BULK_UPLOAD.md), [DATABASE.md](DATABASE.md).
