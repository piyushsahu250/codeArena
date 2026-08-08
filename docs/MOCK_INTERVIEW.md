# Mock Interview (AI-Assisted)

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/interview.js` + `interviewDrafts.js` (63 endpoints combined, largest module) · **Frontend:** `InterviewHub.jsx`, `InterviewSession.jsx`, `InterviewReport.jsx`, `InterviewAdmin.jsx`, `InterviewDraftReview.jsx`

## Session Types
HR, Technical, Aptitude, Coding, System Design, Behavioral, Managerial, Company-Round (`InterviewCategory` enum) — company-round sessions compose difficulty/rounds from `CompanyInterviewProfile`.

## Student Flow
`POST /sessions` (start) → per-question `run-code`/draft/`answer` → `rounds/advance` → `finalize` → `report/pdf`. Proctored (violation reporting, auto-terminate on repeated violations — per project history). Anti-repeat window (`INTERVIEW_ANTI_REPEAT_DAYS`) avoids re-serving the same question to the same student too soon.

## ⚠️ No Institute/Creator Isolation
**Unlike the main Question Bank**, `InterviewQuestion` and `CompanyInterviewProfile` have no `instituteId`/`createdById` columns at all — confirmed against the schema. Any STAFF account (ADMIN too, naturally) can edit/delete any interview question or company profile platform-wide, regardless of which institute originally authored it. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) KI-001 for the full detail and the open scoping question (intentional shared bank vs. oversight).

## AI Draft Pipeline
`interviewDrafts.js` — Claude generates candidate questions/company-pattern notes (`InterviewQuestionDraft`/`CompanyPatternNote`, `DraftStatus` enum), an Admin/Staff reviews and approves/rejects before a draft becomes a live, student-visible question. Rate-limited (`draftGenLimiter`) since these are real, billed Claude API calls. An opt-in scheduled auto-refresh job can generate drafts automatically (`ENABLE_AI_AUTO_REFRESH` — see [ENVIRONMENT.md](ENVIRONMENT.md)), but a human still approves before anything goes live.

## Certification
Completing a mock interview issues an `InterviewCertificate` (a **separate model** from the unified `Certificate` used elsewhere — NOT VERIFIED why these weren't consolidated; flagged as a documentation observation, not a confirmed bug).

## Admin/Staff Analytics
Session lists, weak-topics analysis, per-student session history, PDF/Excel report export — all ADMIN/STAFF +Institute (the analytics/session-viewing routes ARE institute-scoped, in contrast to the question-bank-management routes above which are not).

## Related
[KNOWN_ISSUES.md](KNOWN_ISSUES.md) KI-001, [QUESTION_BANK.md](QUESTION_BANK.md) (contrast case), [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md).
