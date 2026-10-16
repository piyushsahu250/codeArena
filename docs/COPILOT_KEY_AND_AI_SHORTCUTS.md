# Copilot key and AI-assistant shortcut signals

## What a web page can and cannot do

A normal website cannot disable the Windows Copilot key, and cannot stop Windows, keyboard firmware, a browser extension or another application from opening
an assistant. It only receives the key events the browser chooses to pass on. Windows usually handles shell shortcuts (anything with the Windows key) before
the browser sees them, and the page is never told which application a key opened. So:

* **Blocking** is best effort: the page cancels the event when the browser says it is cancelable. The OS may still act.
* **Detection** is a signal: "this key combination reached the page". It is not evidence that an assistant was opened, and it is never called a confirmed violation.

## What is implemented

| Piece | Where |
|---|---|
| Detector (pure, rule list) | `frontend/src/utils/keyboardShortcuts.js` (`AI_SHORTCUT_RULES`, `detectAiAssistantKey`) |
| Listener (capture phase, one per enabled period, cleaned up on unmount) | `frontend/src/hooks/useAiShortcutSignals.js`, used by `TestTaking.jsx` |
| Per-test switch (default off) | `securityPolicy.blockAiShortcuts`; checkbox in the test editor (`CreateTest.jsx`) |
| Server intake | `POST /api/exam-security/test-events` in `backend/src/routes/examSecurity.js` |
| Storage and review | `ExamSecurityEvent` rows with `attemptKind = "TEST"`, shown in the existing staff security timeline and review workflow |

### The one signature detected

The dedicated Copilot key on Windows keyboards is sent as **Win + Shift + F23** (Microsoft's documented mapping): `key`/`code` `F23` with `metaKey` and
`shiftKey`. `LaunchApplication1` is a different key (commonly a calculator or launcher key) and is **not** treated as the Copilot key. A lone Windows key,
F23 alone, Win+F23 and Shift+F23 do not match. No other assistant shortcut is registered: no vendor-documented combination for other assistants was
verified, so none is claimed. To add one, add a rule to `AI_SHORTCUT_RULES` that requires a modifier, and add its test to `frontend/scripts/aiShortcutRegression.mjs`.

Ordinary typing (A/S/D, Shift, Caps Lock, AltGr characters), editor shortcuts (Ctrl+Space, Ctrl+/, Ctrl+Z, Tab, Enter) and Mac Cmd combinations never match.

## When it is active

Activation is decided by the server, not the page. The browser listens only while the exam page is running and the test's policy (sent by the server) has the switch
on, but the **server** accepts an event only if all of these hold: the caller is a student, the attempt is theirs, the attempt is `IN_PROGRESS`, and the test's own
policy has `blockAiShortcuts` on. Otherwise it answers `accepted: 0` and stores nothing. After submission or expiry the listener is removed, and any late report is
ignored by the server.

## What is recorded

One row per report, written by the server: attempt id, test id, institute id, the student id **from the authenticated session** (never from the request), the
type, a fixed `LOW` severity, the server receipt time (`createdAt`), and a small allow-listed metadata object: `code`, `key`, `metaKey`, `shiftKey`, `ctrlKey`,
`altKey`, `cancelable`, `defaultPrevented`, `cancelAttempted`, `count`, `clientAt` (client clock, untrusted). Unknown keys are dropped and strings clipped to 200
characters. Repeats within 3 seconds are one report with a count. The server cuts a batch to 10 events and stops storing after 200 per attempt.

Labels reviewers should use:

| Label | Meaning |
|---|---|
| Copilot-key signal detected (`COPILOT_KEY_SIGNAL`) | The Win+Shift+F23 signature reached the page. |
| Prohibited shortcut detected (`AI_SHORTCUT_DETECTED`) | Reserved for a future vendor-documented rule; no rule produces it yet. |
| Focus lost | Existing `POSSIBLE_EXTERNAL_ASSISTANT` signal: the page stayed visible but lost focus. |
| Assistant launch confirmed | **Never produced.** There is no reliable browser evidence for it. |

These signals are not penalised, never add to the risk score, never auto-submit an attempt and never create a confirmed violation. They are for a human reviewer.
Existing review statuses (`PENDING`, `REVIEWED`, `LEGITIMATE`, `SUSPICIOUS`, `ESCALATED`) apply.

## Browsers and systems

| Environment | Expected behaviour | Tested |
|---|---|---|
| Chromium (desktop), synthetic `KeyboardEvent` | signal captured, event cancelled, one report with a count | Yes, in CI (`aiShortcuts.spec.js`) |
| Windows keyboard with a physical Copilot key | The OS may open its assistant before the browser sees anything; if the key reaches the page, it is reported | **NOT TESTED** (no device) |
| Firefox, Safari | same listener; behaviour of F23 and Windows-key combinations differs | **NOT TESTED** |
| macOS, Linux, phones, tablets | no Copilot key; nothing is expected to match | **NOT TESTED** on devices |

If the browser never passes the key to the page, nothing is recorded: an absence of events does not show that the key was not pressed.

## Stronger enforcement (not provided by the web app)

If an institution needs the key actually disabled, that has to be done outside the web page, on devices it controls:

* **Remap or disable the key in the operating system.** Windows lets an administrator change what the Copilot key does (for example, launch a different app or do
  nothing) through settings or device management on managed Windows 11 PCs. Check the exact setting against the Windows version in use.
* **A kiosk configuration.** Windows kiosk / Assigned Access and, on Enterprise or Education editions, the Keyboard Filter feature can restrict which keys and
  combinations work on a dedicated exam computer. Whether a particular edition can block the Copilot key must be confirmed on the institution's own devices; it is
  not verified here.
* **The CodeArena secure exam client** (`LOCKDOWN`, see `docs/SECURE_EXAM_ARCHITECTURE.md`) is the existing managed-client option. It reports its own device-attested
  events, kept separate from browser-only signals. Its handling of the Copilot key has not been tested.

Do not describe a browser-only exam as having the Copilot key disabled.

## Not done / decisions

* The test-editor audit entry records that a test was updated, but not the policy difference. Adding the policy diff to the audit details changes a recorded
  audit contract and needs a decision.
* Retention follows the existing `ExamSecurityEvent` retention (180 days by default, `EXAM_SECURITY_RETENTION_DAYS`); events marked `ESCALATED` are kept.
* The staff timeline shows the raw type name for these two types; friendlier labels are a UI follow-up.
* Module-coding assessments and the interview flows use a separate hook (`useProctoring`); this change covers formal tests only.
