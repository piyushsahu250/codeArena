# Student Module

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## Feature Surface
Dashboard (`/dashboard`), Profile (`/profile`), Test-taking (`/test/:id`), Learning Hub (`/learning`), Achievements/Gamification, Daily/Weekly Challenges, Resume Builder, Mock Interview, Attendance (own record), Document upload, Placement Offers, Talent Pool membership, Certificates, Results/Marksheets. See `frontend/src/App.jsx`'s route table for the complete, current list of student-facing routes.

## Access Model
Every student-facing backend route scopes to `req.user.id` — confirmed clean of IDOR issues (this session's audit). A student can never read or act on another student's data via any observed route.

## Key Gates
- **`mustChangePassword`** — blocks everything until cleared.
- **Profile completion (80% unlock)** — blocks everything except `/profile` and `/resume` until the mandatory-field threshold is met (institute-toggleable). See [BUSINESS_RULES.md](BUSINESS_RULES.md) §3.
- **Course visibility** — a student only sees courses explicitly assigned to their institute/academic group. See [BUSINESS_RULES.md](BUSINESS_RULES.md) §4.
- **Test eligibility** — a formal test only appears if the student's academic group (or class) is assigned to it.

## Cross-References
[STUDENT_PROFILE / BUSINESS_RULES.md](BUSINESS_RULES.md), [LEARNING_MANAGEMENT.md](LEARNING_MANAGEMENT.md), [CODING_ASSESSMENT.md](CODING_ASSESSMENT.md), [MOCK_INTERVIEW.md](MOCK_INTERVIEW.md), [ATTENDANCE.md](ATTENDANCE.md), [PLACEMENT.md](PLACEMENT.md), [TALENT_POOL.md](TALENT_POOL.md), [RESULT_MANAGEMENT.md](RESULT_MANAGEMENT.md), [CERTIFICATE_MANAGEMENT.md](CERTIFICATE_MANAGEMENT.md), [DAILY_WEEKLY_CHALLENGES.md](DAILY_WEEKLY_CHALLENGES.md), full endpoint list in [API_DOCUMENTATION.md](API_DOCUMENTATION.md) (every row marked `STUDENT`).
