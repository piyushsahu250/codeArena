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

## Phase 1 hardening (2026-10-29): strikes, event validation, answer autosave

Plan and findings: `docs/MOCK_INTERVIEW_GAP_ANALYSIS_2026-10-29.md`. What changed in `routes/interview.js` and the session page:

- **Strikes are atomic.** `POST /interview/sessions/:id/violation` runs in one transaction that holds a row lock on the session (`SELECT ... FOR UPDATE`). The strike count is an atomic increment (the old read-then-write lost a strike when two penalised events raced), de-duplication and the SUSPICIOUS escalation count see every earlier event, and the strike that reaches `MAX_INTERVIEW_VIOLATIONS` (3) sets `status = TERMINATED` in that same commit. The report is written right after; if the process stops in between, `GET /interview/sessions/:id` writes the missing report (30 s after `submittedAt`).
- **Finalize is safe to repeat.** `finalizeSession` claims the session with `updateMany(where status = IN_PROGRESS)`; exactly one concurrent caller writes the report, sends the e-mail and the audit row. The other gets the current session back (`alreadyFinalized`).
- **Events are validated.** Only types in `proctoringSeverity.js`'s `VIOLATION_SEVERITY` are stored; anything else is `400`. The same type again within 2 s (30 s for `WINDOW_NOT_FILLING_SCREEN`) is acknowledged but not stored (`deduplicated: true`). At most 300 event rows per session. 60 requests per minute per student. Rules live in `utils/interviewViolationPolicy.js`.
- **Typed answers autosave.** `POST /sessions/:id/questions/:qid/text-draft` stores the text of HR / Technical / Behavioral / Managerial / System Design answers in `CodeDraft` (`contextType = INTERVIEW_TEXT`, no migration); `GET /sessions/:id/text-drafts` returns drafts newer than the answer saved with Next. Both refuse a closed session or one past its deadline; the POST also refuses an unassigned question and over 20,000 characters. The page sends through `utils/saveQueue.js`: one request in flight per question, the newest text always last, retries with growing delays on network failures, `Saved` shown only after the server confirmed the text that is in the box.
- The coding-draft endpoint now also refuses a closed or overdue session and a question the session was not given.
- **Not done yet (Phase 4):** revision numbers on answers (the queue prevents out-of-order saves from one tab; the server does not yet check a revision), a server-side sweep that closes overdue sessions, and a status transition table.
- **Known pre-existing issue, not changed here:** the page-hide handler for CODING drafts registers once per question and sends the code as it was then; the text handler reads a ref, so it sends the current text.
- Tests: `test/interviewViolationPolicy.test.js` (unit), `test/interviewPhase1.integration.test.js` (concurrent strikes, de-duplication, unknown types, another student, closed sessions, draft save/restore/limits, double finalize; skipped when no server is running), `frontend/scripts/saveQueueRegression.mjs`.
