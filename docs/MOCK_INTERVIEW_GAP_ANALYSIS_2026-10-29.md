# Mock Interview (`/interview`): what exists, what is missing, and the plan

Scope: the **`/interview` module** (company rounds such as HCL, "Record answer (speech-to-text)"), not the separate adaptive `/ai-interview` module. Read on 2026-10-29: `backend/src/routes/interview.js` (routes, `/violation`, `/finalize`), `prisma/schema.prisma` (`InterviewSession`, `InterviewViolation`, `InterviewAnswer`, `InterviewReport`), `frontend/src/pages/InterviewSession.jsx` (session, timer, autosave, proctoring wiring). Not yet read: `utils/interviewEvaluation.js`, `useProctoring.js` internals, the speech code (`InterviewSession.jsx` ~line 659), `utils/proctoringSeverity.js`, the question-selection code in `POST /sessions`.

## Already in place (do not rebuild)

- Server sets `securityLevel` from the session type; the client cannot choose it.
- One-active-session claim (`SecX.enforceInterviewSession`), institute scoping on admin routes, audit log on penalised violations.
- Server-side violation classification into 4 severities (`classifyViolation`); the client sends only a type.
- Timer derived from `startedAt + config.durationMin` plus a server-clock offset; resumes after refresh; `/finalize` refuses a premature "time expired" from a fast client clock.
- Coding-answer drafts autosave (debounced + `keepalive` on page hide); resume after refresh.
- Readiness checklist, fullscreen/camera/microphone through `useProctoring`; round-elimination for company rounds; admin violation review and report routes.

## Confirmed gaps and defects (from the code read)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| 1 | **No Practice vs Proctored choice.** `useProctoring` is called with `requireFullscreen/requireWebcam/requireMicrophone: true` for every session, whatever `securityLevel` says. | `InterviewSession.jsx` ~324-330 | A student without a camera cannot practise. |
| 2 | **Lost strikes under concurrency.** The violation count is read, incremented in JS and written back (`session.violationCount + 1`), not an atomic increment. Two events arriving together count once. | `interview.js` ~1110-1118 | Strikes can be undercounted; termination can be skipped. |
| 3 | **Termination is not atomic with the last strike.** The strike transaction commits, then `finalizeSession` runs separately. | `interview.js` ~1115-1133 | A crash between them leaves a session at the limit but still IN_PROGRESS. |
| 4 | **Violation endpoint has no rate limit, no dedup, no event allow-list.** Any string up to 40 characters is stored; every call writes a row. | `interview.js` ~1097-1122 | Unbounded rows from tab-switch spam or a hostile client; arbitrary types in the log. |
| 5 | **Events carry no event id, client timestamp, source, review status or action taken.** Only `type, severity, penalized, createdAt`. | `InterviewViolation` model | Cannot dedupe retries, order events, or review fairly. |
| 6 | **Text answers have no autosave.** Only CODING drafts autosave; HR/Technical text is saved when the student clicks Next. | `InterviewSession.jsx` ~203-239 | A refresh or crash loses typed HR/Technical answers. |
| 7 | **No revision check on answers.** `InterviewAnswer` is unique on (session, question) and overwritten; no version number. | `InterviewAnswer` model | A delayed older request can overwrite a newer answer. |
| 8 | **Expiry is client-driven.** Finalisation on time-up is triggered by the browser; if the student closes the tab, nothing in the routes I read ends the session at the deadline. | `InterviewSession.jsx` ~185-194, `/finalize` | Sessions can stay IN_PROGRESS past their deadline. (To confirm: whether a server sweep exists elsewhere.) |
| 9 | **Session status is a free string** (IN_PROGRESS, COMPLETED, TERMINATED); no CREATED, READINESS_CHECK, EXPIRED, ABANDONED, INVALIDATED, and no transition table. | `InterviewSession.status` | Invalid transitions are not rejected centrally. |
| 10 | **No configurable policy per assessment.** The strike limit is a constant (`MAX_INTERVIEW_VIOLATIONS`); no policy version stored on the session. | `interview.js` | Cannot vary rules or prove which rules a session ran under. |
| 11 | **No review workflow.** No endpoint for staff review notes or confirm/dismiss on an event. | route list | Events cannot move from "detected" to "reviewed". |

## Not yet audited (could hide more bugs)

Speech-to-text start/stop and transcript insertion, camera lifecycle and blank-preview handling inside `useProctoring`, face detection accuracy, question-selection fit for HCL, rule-based answer scoring (`interviewEvaluation.js`), and query performance. These need reading before I claim fixes.

## Plan, smallest safe step first

Each phase: a branch, additive database changes only (nullable or defaulted, existing rows keep today's behaviour), tests, CI green on the exact commit, then your explicit "merge and deploy".

1. **Correctness fixes, no schema change:** atomic strike increment and termination in one transaction (2, 3); event-type allow-list, per-session rate limit and dedup window (4); text-answer autosave with explicit Saving/Saved/Failed state (6). Backend unit tests plus concurrency tests.
2. **Modes (additive migration, default keeps today's behaviour):** `InterviewSession.mode` (PRACTICE | PROCTORED), chosen on a mode-selection screen and fixed once the session starts; camera, microphone and fullscreen follow the mode; Proctored never downgrades silently (1).
3. **Policy and events:** a small `InterviewPolicy` (camera, mic, fullscreen, strike limit, grace period, navigation, editing, retention) with a version stored on each session and an audit trail; event fields eventId, clientAt, source, reviewStatus (5, 10).
4. **Server-owned lifecycle:** status transition table, idempotent create and finalize, a server sweep that expires overdue sessions, answer revision numbers (7, 8, 9).
5. **Review and reports:** staff review notes with audit, student result visibility policy, event timeline in the report (11).
6. **Audit and fix** the unread areas above, then load tests and end-to-end tests against the real app.

## Limits to state honestly

- Browser proctoring is not tamper-proof: a second device or computer is invisible to it. Tab switch, blur, camera loss and network loss are signals for review, not proof.
- Face detection (TensorFlow/BlazeFace is already a dependency) is unreliable in poor light and for some faces; keep it as a reviewable signal and say when it is unavailable.
- Video and audio are not recorded or stored; this must stay so unless a privacy policy is written.
- No concurrency figure is promised until a load test is run against the real deployment.
- This PC has no Node, so tests run in CI only; camera and microphone behaviour needs real-device testing.
