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

## Speech-to-text, Exit button and navigation (2026-10-29)

**Speech-to-text ("Record answer").** The old inline implementation appended the recognised text to the answer as it was when recording *started* (so every later phrase replaced the earlier ones, and anything typed meanwhile was lost), wrote into whichever question the click had captured, never stopped on unmount or when the student moved on, had no `onerror` (a blocked microphone or a lost connection looked like nothing happening, or an `alert()`), silently stopped after silence, and let "Next" save before the last words arrived. It is replaced by `utils/dictationEngine.js` (framework-free, tested) wrapped by `hooks/useAnswerDictation.js`:
- a checked lifecycle: IDLE, REQUESTING_PERMISSION, READY, RECORDING, PROCESSING_TRANSCRIPT, TRANSCRIPT_READY, plus PERMISSION_DENIED, UNSUPPORTED, DEVICE_UNAVAILABLE, RECOGNITION_ERROR, NETWORK_ERROR, RECOVERY_REQUIRED; invalid transitions are ignored; one recording at a time;
- only FINAL results are committed, each once (by result position within one recognition instance); interim text is only shown ("Hearing: ..."); a phrase replayed by the next instance right after a restart is dropped;
- the commit goes to the question the recording started on, added after the existing text through a functional update (never overwriting what was typed); the Phase 1 autosave then saves it;
- recognition runs one phrase at a time and is restarted when it ends by itself (with a restart-loop guard); `stop()` resolves after the last words arrive; "Next", "Skip", "Previous", the numbered buttons, submit and round advance all finish a running recording first and save the latest text (`draftsRef`);
- named errors with accurate messages; text already recognised is never discarded; "Transcription ready" is shown only when at least one phrase was committed, otherwise "No speech was recognized";
- language: `en-IN` by default, `session.config.speechLang` overrides; it needs a secure (HTTPS) page and a browser with `SpeechRecognition`/`webkitSpeechRecognition` (Chrome and Edge send the audio to their own service, so it needs internet; Safari needs Siri and Dictation on).
- Not done: a server-side transcription provider. The browser engine is enough for the typed-answer flow, and a second engine would be a second thing able to modify the same answer.

**No Exit button in a formal proctored interview.** For PROCTORED sessions (mock, company round, talent pool) that are in progress the Exit button is not rendered, the page header (`Navbar locked`) shows only the logo (no home link, search, menus, Back or breadcrumbs), and the browser Back button is absorbed (`hooks/useExamNavigationGuard.js`: a marker history entry; the student is told the interview is still running; logged as `NAVIGATION_ATTEMPT`, severity INTERRUPTION, never a strike). Practice sessions (category drills, resume-based) keep Exit. This is a safeguard against accidents, not a lock: the student can still reload (the same server session and timer resume), close the tab, or use the address bar. There is no student route to terminate or reset a formal attempt.

**Evaluation.** Answers are scored by the server at `/answer` (rule-based keyword scoring for HR/Technical, hidden test cases for coding); the AI narrative is generated later, on request. The answer that is scored is now always the final text including the last dictated words.

Tests: `frontend/scripts/dictationRegression.mjs` (state machine, interim vs final, duplicates, errors, restart, long answers, cleanup, question binding), `frontend/e2e/tests/interviewExam.spec.js` (no Exit, locked header, Back absorbed, refresh resumes the same session, no duplicate attempt, another student refused, submitted interview immutable), `backend/test/interviewViolationPolicy.test.js` (the new event type is never penalised). `frontend/e2e/tests/fullscreen.spec.js` now drives a practice session for its Exit-based checks.
