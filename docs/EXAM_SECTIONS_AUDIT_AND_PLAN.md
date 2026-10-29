# Section-wise examination (Aptitude, Technical, Coding, AI Interview): audit and plan

Date: 2026-10-29. Status: **Phase 1 (rules, no database change) is implemented and unit-tested; Phases 2-8 are not started.** Nothing in this document is deployed.

## 1. What already exists (reuse, do not rebuild)

| Need | Existing piece | Notes |
|---|---|---|
| A formal exam with schedule, eligibility, duration, proctoring policy | `Test` (+ `TestAcademicGroup`, `TalentPoolTest`, `securityLevel`, `securityPolicy`, `version`) | eligibility rules in `testEligibility.js`; no concept of sections |
| One attempt per student | `TestAttempt` `@@unique([testId, studentId])` | plus `TestReattemptGrant` for authorised re-attempts |
| Randomised selection | `Test.questionSelectionMode`, `randomBankFolder`, `difficultyDistribution`, `shuffleQuestions/Options`, `TestAttempt.questionOrder/optionOrder` | per-attempt manifest in `utils/attemptManifest.js` |
| Question banks with institute isolation | `Question`, `QuestionFolder`, `Subject/Unit/Topic`, `InterviewQuestion` (aptitude/HR/technical/coding), visibility in `interviewQuestionVisibility.js` | answer keys already kept server-side |
| Coding judge | `utils/judgeGateway.js`, `judge.js`, `sqlJudge.js`, `Submission`, `gradeAttempt.js` | hidden test cases never leave the server |
| Proctoring and evidence | `useProctoring`, `utils/proctoringSeverity.js`, `ExamSecurityEvent`, `SecureExamSession`, `TestViolation`, `InterviewViolation` | unified evidence model already exists (kind TEST / INTERVIEW / AI_INTERVIEW ...) |
| Multi-stage session with strict order | `InterviewSession` company rounds: `roundPlanSnapshot`, `currentRoundNumber`, `/rounds/advance`, round elimination | the closest existing pattern to "sections" |
| Interview | `/interview` (rule-based scoring of HR/Technical free text, hidden-case scoring for coding), `/ai-interview` (adaptive, LLM) | two engines: see decision 1 |
| Results and reports | `ResultExamination`, `InterviewReport`, `AiInterviewReport`, PDF generators | no consolidated multi-section report |
| Audit | `AuditLog`, `logAudit` | |

Not present: a section layer on `Test`, per-section state and timers, a unified result across the four kinds, versioned immutable published definitions, per-answer versioning on tests, a server expiry sweep for formal attempts.

## 2. Proposed architecture (to confirm before Phase 2)

- **Definition:** `ExamDefinition` plus `ExamVersion` (an immutable JSON snapshot of the validated blueprint, `utils/examBlueprint.js`). Publishing creates a version; attempts point at the version they started under, so later edits never change a running attempt.
- **Assignment and one-attempt rule:** `ExamAttempt` with `@@unique([examId, studentId, attemptKey])`, where `attemptKey = "FORMAL"` for the single proctored attempt and `"PRACTICE-<n>"` for practice attempts. A plain unique constraint (no partial index) gives the concurrency-safe "one formal attempt" guarantee and keeps practice fully separate from official results. Refresh, new tab or re-login resolve to the same row.
- **Sections:** `ExamAttemptSection` (attempt, section key, status LOCKED/IN_PROGRESS/COMPLETED, started/completed timestamps, completed-by). Transitions are conditional updates (`WHERE status = <expected>`), backed by `utils/examStateMachine.js`.
- **Answers:** `ExamAnswer` (attempt, section, item, `version` integer, payload JSON, server receipt time) with `@@unique([attemptId, itemRef])`; a write carries the version it saw and loses if it is stale (optimistic concurrency). Coding submissions go through the existing judge and are stored with the judge result; interview answers keep the answer text and a separate evaluation record (status DONE / PENDING / FAILED, rubric version, model).
- **Scoring and result:** `utils/examScoring.js` (this branch). One `ExamResult` row per attempt built from the four section summaries; status EVALUATION_PENDING / UNDER_REVIEW / COMPLETED / PUBLISHED / INVALIDATED.
- **Proctoring:** reuse `ExamSecurityEvent` with a new kind `EXAM` and a `sectionKey`; events are observations, review status PENDING / DISMISSED / CONFIRMED.
- **Migrations:** additive tables only (the project applies the schema with `prisma db push`; nothing existing is altered), so rollback is "stop using the new routes and drop the new tables".

## 3. Decisions needed from you

1. **Section D engine.** (a) the rule-based `/interview` flow (no AI quota, keyword scoring, weaker for open answers), or (b) the adaptive `/ai-interview` (LLM, uses the Gemini quota). Recommendation: reuse the `/interview` question flow for delivery and add an optional LLM evaluation step that is queued, retried and may be PENDING; the exam never waits on it to save answers.
2. **Aptitude source.** `InterviewQuestion` (APTITUDE) or the `Question` bank (MCQ with subjects/units/topics)? Technical (Section B) should come from the `Question` bank.
3. **Practice mode.** Same tables with `attemptKey = PRACTICE-n` (recommended) or a separate set.
4. **Result visibility.** Default for students: hidden until published, with provisional marks never shown.

## 4. Phases

1. **Rules (done on branch `feat/exam-sections-foundation`):** blueprint validation, the attempt and section state machines, deadline rules, scoring, result aggregation, proctoring summary. Pure code, 100+ unit tests in `backend/test/exam*.test.js`.
2. Schema (additive) and the admin configuration API: validate on every save, publish only a valid blueprint, versioning, audit, locked fields once attempts exist.
3. Attempt engine: start/resume (unique), readiness, open section, save answer (versioned), complete section, submit, server expiry sweep; every route calls the Phase 1 rules and uses conditional updates.
4. Delivery of the four sections (aptitude/technical from banks without keys in the payload, coding through the existing judge, interview through the chosen engine) and the evaluation queue.
5. Proctoring linkage and the human review workflow.
6. Consolidated report, PDF/CSV export, admin analytics (paginated aggregation queries and indexes).
7. Frontend: admin configuration screen, the exam shell with section navigation, timers and save status, result page.
8. Integration, end-to-end, failure-recovery and load tests against the real application; measured numbers only.

## 4a. What Phase 1 guarantees (by tests, run in CI)

- A blueprint cannot be published unless all four sections exist, marks add up exactly (in hundredths), timing is consistent (no section duration under an overall-only policy, section durations not above the total, duration fits the window), passing criteria are unambiguous, negative marking is only on multiple-choice sections and never exceeds a right answer, the interview section is fully and consistently configured, and proctoring settings are in range; a published version is locked for running attempts (`lockedFieldsChanged`).
- An attempt cannot skip a state, a section cannot be opened out of order or reopened, only one section is open at a time, a section completes only when no answer is unconfirmed (and, if required, all are answered), a student can never invalidate an attempt, and the deadline is computed from the stored server start time only (a refresh cannot move it).
- A judge failure is never a wrong answer; an AI evaluation that failed or is pending is never a zero; a malformed score is rejected, not clamped; the result is provisional (no pass/fail) until every section is final and is never publishable while pending or under required review; only a reviewer-confirmed event counts as a confirmed violation.

## 5. Limits that stay true

- Browser proctoring is not tamper-proof; a tab switch, camera loss or network loss is a signal for review, not proof.
- No concurrency figure is promised until a load test has run against the real deployment.
- Phase 1 changes no behaviour of the running platform: the new modules are not called by any route yet.
