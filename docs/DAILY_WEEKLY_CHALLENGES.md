# Daily / Weekly Challenges

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/challenges.js` · **Frontend:** `DailyChallenge.jsx`, `WeeklyChallenge.jsx` (student), `ChallengeAdmin.jsx`

## What It Is
A single coding question scheduled as "today's challenge" / "this week's challenge," scopeable to the whole platform, one institute, or one academic group (`instituteId`/`academicGroupId` nullable on `DailyChallenge`/`WeeklyChallenge` — a null-tolerant compound key resolved via `findFirst` + explicit create/update since Prisma rejects `null` inside a compound-unique `where` selector).

## Student Flow
`GET /daily/today` / `/weekly/current` → `POST .../run` (sample cases, rate-limited) → `POST .../submit` (hidden cases, rate-limited). Feeds gamification (streaks, XP) and `DailyChallengeSubmission`/`WeeklyChallengeSubmission` history.

## Admin/Staff
View scheduled challenges: ADMIN/STAFF. Schedule/edit/toggle/delete: **ADMIN only**.

## Scope Resolution
`backend/src/utils/challengeScoping.js`'s `resolveMostSpecificChallenge()`/`loadStudentScope()` pick the most specific applicable challenge for a student (academic-group-scoped over institute-scoped over platform-wide, presumably — read the util directly for exact precedence; **NOT independently re-verified in this documentation pass**).

## Background Scheduler
`ENABLE_CHALLENGE_SCHEDULER` (see [ENVIRONMENT.md](ENVIRONMENT.md)) — an in-process `setInterval` job, not an external cron service.

## Related
[CODING_ASSESSMENT.md](CODING_ASSESSMENT.md) (shared judge/Run-Submit pattern), [PERFORMANCE.md](PERFORMANCE.md) (scheduler architecture note).
