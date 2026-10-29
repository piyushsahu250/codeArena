# Section-wise examination (Aptitude, Technical, Coding, AI Mock Interview)

Date: 2026-10-29. Status: **implemented on branch `feat/exam-sections` (pushed as `ci/exam-sections`); not merged, not deployed.** Deploying adds seven tables to the database (see section 7).

## 1. What it is

One formal attempt per eligible student, made of four sections taken in order: **A Aptitude, B Technical, C Coding, D AI Mock Interview**. Each section has its own status, answers, score and (optionally) timer. One server-side clock, one consolidated report. Practice attempts use the same engine but are unofficial, repeatable and never appear in official results.

## 2. Decisions that were taken

1. **Section D reuses the existing interview question bank and rule-based scoring.** There is no second interview engine and no second formal attempt. Answers are saved as text (typed, or dictated with the browser's free speech-to-text and then editable). Evaluation is `RULES` by default (no AI needed); `AI` is optional, queued, retried (3 tries, backoff) and, when unavailable, leaves the answer **PENDING / FAILED, never zero**.
2. **Aptitude questions come from the existing `InterviewQuestion` bank (category APTITUDE), technical from `Question` (by subject), coding from `Question` (CODING/SQL) through the existing judge.** Institute isolation uses the same visibility rule as the rest of the platform (own institute + global). If a bank does not hold enough valid questions, publishing is refused with the exact shortage (422 `NOT_ENOUGH_QUESTIONS`); nothing is generated or invented. Questions without a valid answer key are excluded and counted. Answer keys, explanations, hidden test cases and reference solutions are never in a student payload.
3. **All four sections run in one attempt**, under the rules in section 4.

## 3. What was reused

`InterviewQuestion`, `Question` + `TestCase` + `Subject`, `judgeGateway.judgeSubmission`, `interviewEvaluation`, `aiService`, `proctoringSeverity.classifyViolation`, `logAudit`, `useProctoring`, `ReadinessChecklist`, `Navbar locked`, `useExamSession` (one active tab), `useExamNavigationGuard`, `useAnswerDictation`, `saveQueue`, `ProblemStatement`, `CodeResultBlock`, Monaco, `instituteWhere`.

## 4. Rules the system enforces (server-side; the browser only displays)

- **One formal attempt**: database unique `(examId, studentId, attemptKey)`; `attemptKey` is `FORMAL` or `PRACTICE-n`. Refresh, a new tab, a new login and 8 concurrent starts all resolve to the same row.
- **Server clock only.** `startedAt` is stored on the server; deadlines derive from it. Refreshing or changing the computer clock cannot move them. The overdue attempt or section is closed by the server on the next request and by a 60 s sweep, and scored from what was saved.
- **Sections in order, one open at a time, never reopened.** Conditional updates (`WHERE status = expected`) make this safe under concurrency. Unauthorised sections are refused (409 `SECTION_ORDER`, `ANOTHER_SECTION_OPEN`, `ALREADY_COMPLETED`).
- **Versioned answers.** A write carries the version it saw; a stale write loses (409 `STALE_VERSION`) and the newer answer is kept. A section cannot be completed over answers the server has not confirmed (409 `UNSAVED_ANSWERS`). Navigation (`FREE`/`FORWARD_ONLY`) and editing (`EDITABLE_UNTIL_SECTION_SUBMIT`/`LOCKED_AFTER_SAVE`/`LOCKED_AFTER_NEXT`) are enforced per section.
- **One active session.** `X-Exam-Session`; a second tab gets 409 `SESSION_REPLACED` and must explicitly take over.
- **Readiness** (camera, microphone, fullscreen, browser, connectivity) is recorded and required checks refuse the start. It is a guard, not proof; people review proctoring events.
- **Judge and AI failures are never wrong answers.** A busy or failed judge stores the submission as PENDING and it is graded again when the section is submitted. A failed or pending AI evaluation is PENDING/FAILED.
- **No final score while anything is pending.** The result is `provisional` (no pass/fail) until all four sections are final, and cannot be published while pending or while required review is open.
- **Unanswered, skipped, failed, pending** are distinct states in the report. Unanswered earns 0 (or the configured negative mark where allowed); pending/failed are not counted as 0.
- **Proctoring events are observations.** Only a reviewer-confirmed event counts as a violation. Nothing ends or fails an attempt automatically. Reaching the warning limit flags the attempt for review.
- **Practice is separate.** Different `attemptKey`, `mode = PRACTICE`, excluded from analytics, exports and official results, capped per student.
- **Invalidation** is administrator-only, needs a reason (5+ characters) and is audited.
- **Isolation.** Another institute's exam and attempts answer 404 (existence is not confirmed). Students cannot reach any `/admin` route.

## 5. Where things are

Backend (`backend/src`):
- `utils/examBlueprint.js`, `examSources.js` — configuration validation (marks add up in hundredths, timing consistency, per-section sources, locked fields once attempts exist).
- `utils/examStateMachine.js`, `examScoring.js`, `examQuestions.js`, `examReport.js` — pure, unit-tested rules.
- `modules/exams/exams.core.js` (pools, availability, manifest), `exams.attempts.js` (start/resume, begin, claim, open/complete section, versioned save, run/submit code, expiry, finalize, events), `exams.interviewEval.js` (optional AI worker), `exams.view.js` (student view and consolidated report), `exams.admin.js` (CRUD, publish, analytics, CSV, review, invalidate), `exams.routes.js` (mounted at `/api/exams`).
- `prisma/schema.prisma`: `ExamDefinition`, `ExamVersion`, `ExamAcademicGroup`, `ExamAttempt`, `ExamAttemptSection`, `ExamAnswer`, `ExamEvent` (all additive).

Frontend (`frontend/src`):
- Student: `/exams` (`ExamHub`), `/exams/attempt/:id` (`ExamSession`: readiness, resume gate, section bar, server-clock timers, save status, proctoring, locked navbar, back guard, no exit in a proctored attempt), `/exams/attempt/:id/report`.
- Components: `components/exam/ExamMcqQuestion`, `ExamCodingProblem`, `ExamInterviewQuestion`, `ExamReportView`.
- Administration: `/exam-admin` (list), `/exam-admin/new` and `/:id/edit` (editor with server validation and availability), `/:id/results` (analytics, attempts, CSV, publish), `/exam-admin/attempt/:id` (report with answer review, event timeline, review/publish/retry/withdraw).
- Helpers: `utils/examAnswerSaver.js`, `examClock.js`, `examProgress.js`.

## 6. The consolidated report

Student, PRN, institute, department/batch, exam and attempt id, start/end/duration, per-section marks (obtained / maximum / percentage, final or provisional, time taken, how the section ended), total, pass/fail with the criterion, strongest and weakest section, topic strengths and weaknesses (aptitude, technical), coding results per problem (verdict, tests passed/total, language, submissions; code and answer review for administrators only), interview per-question feedback and rubric averages, proctoring summary (counts, warnings, confirmed, awaiting review; full timeline for administrators), pending/failed indicators, recommendations tied to the evidence. Printable (browser print / save as PDF) and exportable as CSV (formula-safe).

## 7. Deployment requirements

- Run `prisma db push` (additive; creates the seven new tables; no existing table is altered). The deploy script's schema guard applies. **Deploy backend/schema before the frontend** — the new pages call new endpoints.
- No new environment variables. AI evaluation is only used when an exam sets `evaluationMode: "AI"` and the existing AI configuration is available; the default is the rule-based rubric.
- Rollback: stop using the routes; the new tables can be dropped without touching anything else.

## 8. Limits that stay true

- Browser proctoring is not tamper-proof; a tab switch, camera loss or network loss is a signal for review, not proof.
- Interview scores come from a fixed rubric applied to the answer text. They do not measure accent, speaking style or appearance and are one input, not a full assessment of a person.
- No concurrency figure is promised: no load test has been run against the deployment.
- The exam flow has been exercised end-to-end through the HTTP API in CI. The UI has syntax-checked, build-checked and smoke-tested pages; it has not been driven by a person on real devices (laptop, Android, iPhone, Mac) with a real camera, microphone and speech engine. That needs a live trial.
- Sections B and C pools are only as good as the banks: an exam cannot be published until each pool holds enough valid questions.
