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
| SUSPICIOUS | DRAG_ATTEMPT, POSSIBLE_EXTERNAL_ASSISTANT (see the focus-loss rule below), DEVTOOLS, COPY, PASTE, CUT, RIGHT_CLICK, MULTI_MONITOR, PRINT_SCREEN_ATTEMPT, TAB_SWITCH_BRIEF, SPLIT_SCREEN_SUSPECTED | every 3rd one is a strike |
| INTERRUPTION | BROWSER_SHORTCUT, SCREEN_OVERLAY_DETECTED, FACE_MISSING, MULTIPLE_FACES, NETWORK_LOSS, REFRESH_ATTEMPT, NAVIGATION_ATTEMPT, ORIENTATION_CHANGE, anything unknown | never a strike |

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

## 5b. Versioned exam rules and `CONFIRMED_POLICY_VIOLATION` (policy `2026-10-16.1`)

`backend/src/utils/proctoringPolicy.js` is a rule catalog. A stored event becomes **CONFIRMED_POLICY_VIOLATION** only when all three hold:
(1) the exam's own policy prohibits the action (a switch the administrator turned on, or a rule every exam publishes); (2) students are shown that rule
before they start; (3) the event is something the page directly observed. The decision uses the stored event type, the stored metadata and the
server-side `policyOf(test)`. The client cannot send a classification, rule id or "confirmed" flag: there is no such field, and an unknown type has no rule.

| Rule id | Applies to | Prohibited when | What a web page can do |
| --- | --- | --- | --- |
| `PAGE_DEPARTURE` | `TAB_SWITCH`, `FULLSCREEN_EXIT` | always (tab switches); fullscreen exit when the test requires fullscreen | **Cannot block.** It records that the page was left. |
| `AI_SHORTCUT_ATTEMPT` | `COPILOT_KEY_SIGNAL`, `AI_SHORTCUT_DETECTED` | `blockAiShortcuts` is on for the test | Asks the browser to cancel the key (`BLOCK_ATTEMPTED`, not verifiable); the OS may handle the key first. |
| `CLIPBOARD` | `COPY`, `PASTE`, `CUT` | PROCTORED test and the matching `block*` switch on | Asks the browser to cancel (`BLOCK_ATTEMPTED`, not verifiable). |

Never confirmed from the browser alone (reasons are in `NEVER_CONFIRMED` and shown to reviewers): `DEVTOOLS` (window-size inference),
`BROWSER_SHORTCUT`, `PRINT_SCREEN_ATTEMPT`, `DRAG_ATTEMPT` (the page does not record where a drag started or ended, so editor selection cannot be told apart),
`SPLIT_SCREEN_SUSPECTED`, `TAB_SWITCH_BRIEF`.

A finding says "this prohibited action was observed under rule X, policy version V". It never says that an assistant, app or extension was opened or used, never
names one, and never says a blocked action succeeded. Enforcement is reported as `BLOCK_ATTEMPTED`, `NOT_BLOCKABLE` or `OBSERVED_ONLY`.
Operating-system level blocking (assistant keys, Home/Power, other apps) needs a managed device or the dedicated exam client: see `ANDROID_MANAGED_EXAM_MODE.md`.

Staff see, per event, the rule, the policy version, the enforcement outcome, what the event shows and what it does not. Copilot-key/assistant-shortcut signals
(stored as security events, not strikes) now appear in the same log, marked "not counted". The strike counting and the three-strike auto-submit are unchanged.

**Not in this change (needs a schema migration and a decision, see section 6):** an append-only reviewer decision history, de-duplication ids,
and per-event rate limits beyond the existing intake limits. Tests: `backend/test/proctoringPolicy.test.js`.

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

## Keeping the exam page in focus (rule added 2026-10-25, policy 2026-10-25.1)

At the administrator's request the exam page losing focus while still visible (`POSSIBLE_EXTERNAL_ASSISTANT`) is no longer a "never confirmed" heuristic. It is a published exam rule, `FOCUS_LOSS`
("Keeping the exam page in focus"), for every exam:

* **Finding:** each occurrence is `CONFIRMED_POLICY_VIOLATION`, shown as "Prohibited action observed". It still says only what the page saw. It does not show which app or window took the focus, that
  an assistant was used, or why: notifications, system dialogs, phone calls and input methods send the same signal. Enforcement is `NOT_BLOCKABLE` (a web page cannot keep focus).
* **Counting (formal tests):** the **first** occurrence on an attempt is a warning and is not counted. The **second and every later** occurrence is a strike
  (`STRIKE_FROM_OCCURRENCE` in `backend/src/utils/proctoringSeverity.js`). The rest of the SUSPICIOUS family keeps the shared every-third rule. Module coding tests, readiness tests and AI interviews do
  not pass the per-type count, so their counting is unchanged.
* **Telling students:** the pre-start instructions of the test page say that clicking into another window or app is recorded, that the first time is a warning, and that each time after that counts.
  The existing in-test notice ("This didn't count this time, but repeating it will") appears at the first occurrence.
* **Existing attempts are not changed.** Attempts recorded before this rule keep the strikes they were given. The proctoring log describes each event by what the server actually did to it (a repeat that was
  not counted is shown as "recorded before repeats of this event were counted"), and the finding label shown for those older events is the current rule's.
* **Why this needs care:** one loss of focus is often innocent, which is why the first stays a warning. Reviewers should still treat the log as observations, not proof; only an authorised reviewer can confirm misconduct.

## Keeping the exam window on the full screen (rule added 2026-10-28, policy 2026-10-28.1)

Added at the administrator's request after a student's exam was seen in a small floating window over another app on a phone. Event type `WINDOW_NOT_FILLING_SCREEN`, published rule `WINDOW_FILL` ("Keeping the exam window on the full screen"), for every exam:

* **What is detected** (phones and tablets only, `frontend/src/utils/secureAssessment.js`): the exam window is measured against the screen every 2 seconds. It counts as not filling the screen when, in portrait, it is narrower than 90 % of the screen (a floating, split-screen or resized window; the on-screen keyboard never changes the width, so this holds while typing), or when it is below 62 % of the screen along the long axis while no text field has focus. Pinch-zoom is ignored. If the window also changes position by more than 24 px during the episode, the report says it was moved. A desktop browser is not judged by this rule: the page holds it in fullscreen, and leaving fullscreen is the fullscreen-exit rule.
* **When it is reported:** only after 3 measurements in a row (about 6 seconds), once per episode. An episode ends after 2 measurements that fill the screen again, so the next time it happens is a new, independent report. The page keeps a 30-second floor between reports.
* **Counting:** the server classifies the event `CONFIRMED_VIOLATION` and counts it from the **first** occurrence (the administrator chose "confirmed violation every time"); three strikes auto-submit, as for every other counted event. The client cannot choose the severity or the count. A repeat of the same event within 30 seconds (a duplicate browser event, or the page's single retry after a report whose answer was lost) is acknowledged without a second record (`DUPLICATE_WINDOW_MS`, `deduplicated: true`).
* **What the finding says:** the exam window was measured covering part of the screen, or changing position, which the exam rules prohibit. It does not show which app was beside the exam, that anything was viewed or used, or why: a foldable's cover screen, a pop-up window the operating system chose and a split screen the student did not ask for look the same. Reviewers see the percentage of the screen width in the event.
* **Telling students:** the pre-start instructions say that a floating, split-screen, resized or moved window is recorded and counts straight away; the in-test banner shows the strike and the measured reason.
* **Not changed:** the older `SPLIT_SCREEN_SUSPECTED` signal (still SUSPICIOUS) remains for the interview, module-coding and readiness pages, which share a different hook. Existing attempts keep the strikes they were given. Browser events cannot be proved tamper-proof: a student can alter the page, so this is a deterrent and an observation, not conclusive evidence.
