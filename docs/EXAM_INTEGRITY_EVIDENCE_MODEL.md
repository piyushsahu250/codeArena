# Exam integrity: what a browser event can and cannot prove

Status: audit of the formal-test (`TestAttempt`) proctoring path, plus the labelling layer that ships with it. The penalty and auto-submit rules are described
here but were **not** changed; the changes that would alter them are listed under "Decisions needed".

## 1. Current event flow (formal tests)

```
browser event (TestTaking.jsx / hooks/useProctoring.js)
  -> reportViolation(type)            client debounce 1.5 s, only { type } is sent
  -> POST /tests/attempts/:id/violation   (student, own attempt only, 40 requests/min/user)
  -> tests.attempts.service.recordViolation
       type = uppercase, first 40 chars of whatever was sent        (client-supplied, untrusted)
       proctoringSeverity.classifyViolation(type, priorSuspiciousCount)
       -> TestViolation row { type, severity, penalized, createdAt }
       -> if penalized: tabSwitchCount += 1; at 3 strikes the attempt is auto-submitted
  -> staff: GET /tests/admin/attempts/:id/violations  (institute + ownership checked)
```

Counting rule today (`utils/proctoringSeverity.js`, unchanged):

| Severity | Types | Effect |
|---|---|---|
| CONFIRMED_VIOLATION | TAB_SWITCH, FULLSCREEN_EXIT, CAMERA_DROPPED, MIC_DROPPED | strike on the first occurrence |
| SUSPICIOUS | DRAG_ATTEMPT, POSSIBLE_EXTERNAL_ASSISTANT, DEVTOOLS, COPY, PASTE, CUT, RIGHT_CLICK, MULTI_MONITOR, PRINT_SCREEN_ATTEMPT, TAB_SWITCH_BRIEF, SPLIT_SCREEN_SUSPECTED | every 3rd one is a strike |
| INTERRUPTION | BROWSER_SHORTCUT, SCREEN_OVERLAY_DETECTED, FACE_MISSING, MULTIPLE_FACES, NETWORK_LOSS, REFRESH_ATTEMPT, ORIENTATION_CHANGE, anything unknown | never a strike |

Three strikes auto-submit the attempt. The pre-start screen tells students this.

## 2. Findings

| # | Finding | Risk |
|---|---|---|
| F1 | Browser-only signals (tab switch, fullscreen exit, camera/mic drop) are stored with severity `CONFIRMED_VIOLATION` and the staff screen displayed that label. | A heuristic is presented to a reviewer as a finding. **Fixed (labelling).** |
| F2 | Weak signals combine: nine SUSPICIOUS events (drags, devtools size guesses, focus loss, blocked copy) cost three strikes and auto-submit the attempt. | A hidden accumulation rule can end an exam on ambiguous evidence. **Not changed, needs a decision.** |
| F3 | The page cancels and reports every `dragstart`, including Monaco's own drag of selected text inside the editor. | A legitimate editing gesture counts toward F2. **Not changed, needs a decision.** |
| F4 | Only `{ type }` is sent. No client timestamp, duration, policy id or rule id is stored; the server has only `createdAt`. | Reviewers cannot tell a 3-second blip from a 3-minute absence. **Needs a migration.** |
| F5 | There is no review workflow for `TestViolation` (no reviewer, reason, decision, appeal or history); `ExamSecurityEvent` has one but serves secure-client sessions. | Nobody can confirm or dismiss an event with a recorded reason. **Needs a migration.** |
| F6 | The `severity` column defaults to `CONFIRMED_VIOLATION`. | A row written without a classification reads as confirmed. **Needs a migration to change the default.** |
| F7 | The server does not de-duplicate. The client debounces repeats for 1.5 s, but two tabs or a replayed request each create a row. | Possible double counting. **Needs a decision.** |

Not found: any handler that blocks or reports ordinary printable keys (A/S/D, Shift, Caps Lock). Shortcut handling is modifier-gated and
`BROWSER_SHORTCUT` is already never counted.

## 3. What each of the five signals can honestly show

| Signal | What the browser actually observes | What it cannot show |
|---|---|---|
| DRAG_ATTEMPT | A `dragstart`/`drop` on the page. | Whether anything left the page, or whether it was a selection, an editor text move or a stray gesture. |
| POSSIBLE_EXTERNAL_ASSISTANCE (`POSSIBLE_EXTERNAL_ASSISTANT`) | The window stayed visible but lost focus for longer than a grace period. | Which app, which device, or whether an assistant exists. Notifications, system dialogs and input methods give the same signal. |
| BROWSER_SHORTCUT | A `keydown` with a modifier that matches a listed combination. | That the browser or OS action completed. Editors use many of the same combinations. |
| DEVTOOLS | A large gap between window and page size. | Whether DevTools is open. Docked panels, snapped windows, zoom and toolbars look the same. |
| TAB_SWITCH | The page was hidden past the grace window, or left fullscreen. | Which app or tab, or what was viewed. Calls, lock screens, minimise and throttling look the same. |

A managed client (Electron kit, Android managed mode) can report stronger, device-attested events through the separate secure-exam path
(`routes/secureExam.js`, `ExamSecurityEvent`). That path is not changed here and is kept distinct from browser-only evidence.

## 4. Classification matrix (implemented in `utils/evidenceClassification.js`)

| Class | Meaning | Produced automatically from browser events? |
|---|---|---|
| OBSERVED_EVENT | A raw event was received. | Yes. |
| SUSPECTED_ACTIVITY | A repeated pattern worth a human look. | Yes, at the ceiling. |
| POLICY_VIOLATION | An objective, server-verifiable breach of a documented rule. | No browser-reported type reaches it. |
| CONFIRMED_VIOLATION | Confirmed by an authorised reviewer with a reason. | **Never.** |
| INCONCLUSIVE | The browser cannot tell what happened, or the type is unknown. | Yes. |

| Type | 1st occurrence | Becomes SUSPECTED_ACTIVITY at |
|---|---|---|
| TAB_SWITCH, FULLSCREEN_EXIT | OBSERVED_EVENT | 2 |
| TAB_SWITCH_BRIEF, BROWSER_SHORTCUT, PRINT_SCREEN_ATTEMPT | OBSERVED_EVENT | never |
| DRAG_ATTEMPT, POSSIBLE_EXTERNAL_ASSISTANT, SPLIT_SCREEN_SUSPECTED, COPY, PASTE, CUT, RIGHT_CLICK | OBSERVED_EVENT | 3 |
| CAMERA_DROPPED, MIC_DROPPED | OBSERVED_EVENT | 2 |
| DEVTOOLS, MULTI_MONITOR | INCONCLUSIVE | 2 |
| FACE_MISSING, MULTIPLE_FACES, NETWORK_LOSS, SCREEN_OVERLAY_DETECTED, unknown types | INCONCLUSIVE | never |

This layer labels what reviewers see. It does not change which events count as strikes.

## 5. What shipped in this change (additive, no migration)

* `backend/src/utils/evidenceClassification.js`: the matrix above, with a hard ceiling no browser type can exceed.
* `GET /tests/admin/attempts/:id/violations`: each event now has `evidence` (category, classification, occurrence count, limits, rationale,
  `confirmed: false`) and the response has an `evidenceNote`. The legacy `severity` and `penalized` fields are unchanged.
* The staff results screen shows the evidence label and the limits instead of presenting a browser signal as a confirmed violation.
* `backend/test/evidenceClassification.test.js`.

## 6. Decisions needed (not done: each changes live exam behaviour or the database)

1. **Stop auto-submitting on browser-only signals (F1/F2).** Options: (a) keep as is; (b) keep strikes and warnings but replace auto-submit with a
   "flagged for review" state and let staff decide; (c) require corroboration. The pre-start screen text would change with it. This is a policy change.
2. **Drag inside the editor (F3).** Stop reporting a drag that starts and ends inside the code editor (still blocked if the policy says so).
3. **Migration (F4–F6).** Additive columns on `TestViolation`: client timestamp, duration, rule id, policy id/version, correlation id, evidence class,
   review status, reviewer, review reason, reviewed-at, plus an append-only history table; change the `severity` default. Backwards compatible
   (nullable or defaulted), reversible by dropping the columns. It needs an approved schema push on production.
4. **Review and appeal workflow.** Staff endpoints to mark an event confirmed / dismissed / inconclusive with a mandatory reason, role- and
   institute-scoped, audit-logged, with a student-facing explanation. Depends on 3.
5. **De-duplication (F7).** Server-side correlation id per lifecycle event.

## 7. Not tested

Physical devices, real tab switching on mobile, screen lock, and managed-client (Electron/Android) event paths were not exercised here.

## 8. Rollback

The change is additive: reverting the commit removes the `evidence` field and the reviewer-screen labels. No schema or data is touched.
