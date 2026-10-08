> **Scope of this document:** it describes what a normal web page can and cannot do, i.e. the STANDARD and PROCTORED profiles. For high-stakes exams use the LOCKDOWN profile (secure exam client, managed device, exam network, server-side enforcement) described in [SECURE_EXAM_ARCHITECTURE.md](SECURE_EXAM_ARCHITECTURE.md); the "cannot" statements below do not apply to LOCKDOWN where the managed environment enforces them. Test evidence: [SECURE_EXAM_TEST_REPORT.md](SECURE_EXAM_TEST_REPORT.md).

# Exam security (anti-malpractice) — what it does and what it cannot do

This is a **defense-in-depth** design, not a "block everything" switch. A web page cannot see which browser
extensions are installed, cannot see other desktop applications (Copilot, ChatGPT, Claude, Gemini apps), and cannot stop
OS-level screenshots or recording. CodeArena does **not** claim otherwise, and nothing in the product says Copilot or any
extension is "detected".

## The five layers

| Layer | Who enforces it | What it gives you |
|---|---|---|
| 1. Web protections | The exam page (JavaScript) | Detection and convenience. A student can modify the page, so this is **not** a security boundary. |
| 2. Browser protections | The browser, via the page | Fullscreen, Page Visibility, clipboard events, `beforeunload`. Best effort; some shortcuts are reserved by the OS. |
| 3. Managed-device protections | The institution (device/browser policy) | The **only** real control over extensions, other apps, screenshots, printing, DevTools, networks. |
| 4. Proctoring signals | Camera / microphone / screen where required | Evidence for a human reviewer. |
| 5. Server-side enforcement | CodeArena backend | The authority: attempt limits, timer, question authorization, hidden tests, session control, secure-browser check, evidence storage. |

**Frontend anti-cheat = detection. Server = authority. Managed device = enforcement.**

## Levels (per assessment, set in Learning Management → level settings → Exam security)

| Level | Intended use | What changes |
|---|---|---|
| STANDARD | Practice and ordinary tests | Copy/paste/cut/right-click/drag blocked and logged; a second tab is **flagged** (not blocked). Same as the platform's behaviour before this feature. |
| PROCTORED | Graded, supervised-by-evidence tests | Adds: fullscreen required, **one tab only** (a second tab is refused by the server), tighter code-insertion thresholds. Use together with camera/microphone settings. |
| LOCKDOWN | High-stakes exams | Adds: **managed secure browser required** and **phones/tablets refused**, strictest insertion thresholds. The server refuses to start the attempt otherwise. |

Per-test overrides (allow phones, one-tab on/off, insertion thresholds) are stored as a small validated JSON; unknown keys are dropped.
Security controls only apply while the test's **Proctoring** switch is on (practice levels have it off).

## What the web layer actually does

* **Clipboard**: copy / paste / cut events are blocked and logged. Only Ctrl/Cmd+letter *combinations* are intercepted;
  bare letters, digits, symbols, Tab, Enter, Backspace and arrows are never touched (regression-tested by
  `frontend/scripts/keyboardRegression.mjs` for A/S/D and every other typing key).
* **Right-click, drag-and-drop, DevTools shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U), browser shortcuts**: blocked where the browser lets a page
  block them, otherwise logged. No window-size tricks, debugger loops or crashes are used — those are not security.
* **Large code insertion** (`SUSPICIOUS_CODE_INSERTION`): the editor logs a single insertion of ≥ N characters or ≥ M lines that did not come
  from typing (thresholds depend on the level). This is the pattern produced by pasted answers and by code-assistant extensions, but it is a **weak
  signal**: a student may legitimately accept a long autocomplete. It is stored as evidence with its size, never as a verdict.
* **Focus / tab / visibility, fullscreen exit, camera/microphone drop, multiple monitors**: existing proctoring signals with the four-level
  severity taxonomy (`backend/src/utils/proctoringSeverity.js`); a brief tab switch is a soft event, only a sustained one counts as a strike.
* **Network disconnect/reconnect**: logged as context so a reviewer can tell a dropped connection from other activity. Never a violation.
* **Mobile**: keyboard open/close, viewport resize and orientation change are **not** treated as malpractice. If a test is unsafe on phones the admin
  turns "Allow phones and tablets" off and the server refuses the start with a clear message — it never silently runs a weaker mode.

## What the server guarantees (and the browser cannot override)

* **Timer**: `startedAt` + the test's time limit; every run/submit/autosave is checked against the server clock. A changed device clock does nothing.
* **Attempt limit**, cooldown, "already passed": enforced at start from the database.
* **One active session** (PROCTORED/LOCKDOWN): the newest start/resume receives a random session id; every later request must carry it
  (`X-Exam-Session`). An older tab gets `409 SESSION_REPLACED` and an event is recorded. A harmless refresh simply takes over the session.
  In STANDARD mode a mismatch is allowed but recorded as `MULTIPLE_SESSION`.
* **Question authorization**: only questions drawn for the attempt can be run/submitted; students only receive sample cases. Hidden test cases,
  expected outputs, reference solutions, hints and editorials are never sent to the browser.
* **Ownership / institute isolation**: every attempt route checks the attempt belongs to the caller; chapter Levels also check the course is assigned
  to the student's institute/group; staff views are institute-scoped. Foreign IDs return 403/404 with no data.
* **Evidence intake** (`POST /api/exam-security/events`): batched (the page sends one request per ~10 s, never per keypress/mousemove/scroll),
  rate-limited, capped at 2000 events per attempt, only client-reportable types accepted, severity assigned by the server, metadata size-bounded.
* **No secrets in the browser**: no answer keys, AI/API keys or other students' data; nothing sensitive is kept in localStorage/sessionStorage
  (the only thing stored there is the secure-browser handshake token, which proves nothing about answers).

## Evidence, risk and review

* Event types: `TAB_SWITCH`, `PAGE_HIDDEN`, `FULLSCREEN_EXIT`, `CAMERA_DROPPED`, `MIC_DROPPED`, `SCREEN_SHARE_STOPPED`, `MULTIPLE_SESSION`/`SESSION_REPLACED`,
  `COPY/PASTE/CUT`, `EXTERNAL_NAVIGATION_ATTEMPT`, `SUSPICIOUS_CODE_INSERTION`, `NETWORK_DISCONNECT/RECONNECT`, `UNUSUAL_ACTIVITY`, `SECURE_BROWSER_MISSING`.
* **Risk band** LOW / MEDIUM / HIGH / CRITICAL per attempt, from weighted evidence (repeats count with diminishing weight; anything a reviewer marked
  LEGITIMATE counts for nothing). It is guidance for a person. **It never marks malpractice or fails a student by itself.**
* **Monitor** (`/staff/exam-security/:testId`, linked from the level's attempts panel): one row per attempt — student, roll/PRN, status, risk,
  strikes, event count, last event, items needing review — and a per-attempt chronological **timeline**.
* **Review**: a reviewer marks an event Reviewed / Legitimate / Suspicious / Escalated with a note; every review is audit-logged.

## Managed browser / kiosk architecture (LOCKDOWN)

CodeArena cannot enforce OS-level restrictions from a web page. For high-stakes exams the institution provides the environment; CodeArena verifies it:

1. **Device/browser policy (institution)** — managed Chrome/Edge (or a kiosk/lockdown browser) configured to: run the exam URL in kiosk/fullscreen,
   allow only the exam origin, **block all extensions** (`ExtensionInstallBlocklist: *`), disable DevTools (`DeveloperToolsAvailability: 2`),
   disable printing/screen capture where the OS supports it, disable clipboard sharing, and restrict other apps/networks (proxy/firewall allow-list).
2. **Signed handshake** — the launcher holds `SECURE_BROWSER_SECRET` (provisioned out of band, set on the server as an environment variable). It
   `POST`s `/api/exam-security/secure-session` with `{ deviceId, ts, sig }` where `sig = HMAC-SHA256(secret, deviceId + "." + ts)`. The server
   checks the signature (constant-time, 5-minute replay window) and returns a short-lived token **bound to that student**. The launcher stores it as
   `sessionStorage["ca_secure_session"]`; the page sends it as `X-Secure-Session`. User-Agent, localStorage and query parameters are never trusted.
3. **Server check** — a LOCKDOWN test refuses to start (and the pre-exam check shows ✗) unless the token verifies. If `SECURE_BROWSER_SECRET` is not
   configured, the requirement **fails closed** (nobody can start a LOCKDOWN test).

What the managed environment guarantees: no extensions, no other apps/sites, no DevTools, no printing/capture (as configured). What CodeArena itself
cannot guarantee in any mode: detecting installed extensions or desktop AI apps, preventing OS screenshots or external recording, preventing a second device.

## Privacy and retention

* **Collected**: event type, time, question id, small numeric/boolean details (e.g. characters inserted, seconds hidden), the student/attempt/test ids.
  **Not collected**: code contents of an insertion, clipboard contents, keystrokes, screenshots, browsing history, installed extensions, or any image
  (camera frames are analysed in the browser for face presence and never stored).
* **Why**: to give a human reviewer evidence about an exam attempt, and to enforce the exam rules.
* **Who can see it**: platform admins, the institute's admins and staff (institute-scoped), and the student's own attempt owner only through their
  own results — not the event log.
* **Retention**: `EXAM_SECURITY_RETENTION_DAYS` (default 180, minimum 30). A job in the 5-minute scheduler deletes older events at most hourly;
  **ESCALATED** events are kept until a person resolves them.

## Recommended configurations

| Situation | Setting |
|---|---|
| Practice (JAVA Practice, LMS exercises) | STANDARD, Proctoring OFF |
| Class test / module assessment | STANDARD or PROCTORED, Proctoring ON, fullscreen on, 3 violations |
| Graded assessment, remote students | PROCTORED + camera/microphone, phones not allowed, human review of HIGH/CRITICAL before any action |
| High-stakes / placement screening | **LOCKDOWN + managed device + kiosk/lockdown browser + institution network allow-list + server-side enforcement** |

## Scope of this release

Implemented on the shared coding-attempt engine, which serves module coding tests, chapter Levels and JAVA Practice. The formal MCQ/coding **Test**
engine (`tests.js` / `TestTaking.jsx`), Readiness and Mock Interview already have their own proctoring (violations, severity, fullscreen, webcam)
and are unchanged; moving them onto the same policy/evidence/monitor model is the next step and is **not** done yet.

## Tests

* `backend/scripts/verifyExamSecurity.js` — policy resolution, session control, evidence intake and abuse cases, monitor/timeline/review RBAC and IDOR,
  server-side timer, mobile and secure-browser enforcement, retention, setting restoration.
* `frontend/scripts/keyboardRegression.mjs` — normal typing (A/S/D and the full key set) is never intercepted; insertion classifier false-positive checks.
* `backend/scripts/verifyJavaPractice.js` — attempt limit, hidden-test protection, institute isolation on the same flow.

## Formal Test engine (MCQ / company / coding tests) — added 2026-10-08

`tests.js` + `TestTaking.jsx` now share the same policy, evidence and review model (levels **STANDARD** and **PROCTORED**; LOCKDOWN is refused here
because it needs the secure-client attempt engine).

* **Question-enumeration guard**: a student gets question content only while their attempt is IN_PROGRESS (or after the window closes for a finished
  attempt). Before start — including before `startTime`, and the whole bank in RANDOM mode — they receive an aggregate summary (count, max marks, types).
* **Phones**: PROCTORED tests refuse phone/tablet browsers at the server (`403 MOBILE_NOT_SUPPORTED`) unless the admin explicitly allows them.
* **One active session**: the newest start/resume owns `TestAttempt.sessionId`; later answers/submits carry `X-Exam-Session`; a stale tab gets `409 SESSION_REPLACED`
  (PROCTORED) and the conflict is recorded as evidence.
* **New observable signals** (never named as an application): `POSSIBLE_EXTERNAL_ASSISTANT` (page visible but not focused ≥ 2.5 s: split-screen window, floating
  assistant, app on a second monitor) and `SPLIT_SCREEN_SUSPECTED` (touch device, window < 62 % of the screen on two consecutive checks). Both are SUSPICIOUS:
  the 3rd on an attempt becomes a strike; none auto-fails a student by itself.
* **Pre-start security check** for PROCTORED tests (HTTPS, storage, fullscreen support, window size, supported device); a failed required item blocks Begin.
* **Monitor**: `/staff/exam-security/test/:testId` (risk filter, per-attempt counts, timeline with review); **overview**: `GET /api/exam-security/overview`.
* **Not covered**: the same limits as above. A web page cannot see another app or an OS overlay; on a phone the only reliable control is not allowing phones
  (or a managed device). `POST /submissions/run` is not attempt-bound (it runs sample cases of any question id the caller knows).
* Verify with `backend/scripts/verifyTestSecurity.js`.
