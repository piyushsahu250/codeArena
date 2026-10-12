# Android exam security - what works today, and the managed-device client (source written, NOT BUILT, NOT TESTED on a device)

Status of this document: the **server side is implemented and unit-tested in CI** (`ANDROID_MANAGED` client kind). The **Android client source exists in `android-exam-client/` but has never been compiled or run** (no JDK/Android SDK on the authoring machine). No managed Android device has been provisioned, and every Android behaviour described below as "to verify" is untested. Nothing here may be cited as proof that a Home press, a Power-button long-press or an assistant gesture is blocked.

Related: [EXAM_SECURITY.md](EXAM_SECURITY.md) (web layers and server guarantees), [SECURE_EXAM_ARCHITECTURE.md](SECURE_EXAM_ARCHITECTURE.md) (LOCKDOWN profile, secure
session handshake), [SECURE_EXAM_TEST_REPORT.md](SECURE_EXAM_TEST_REPORT.md).

## 1. The problem, stated precisely

A student on a phone browser can hold Home or use the assistant gesture (Gemini / Google "Circle to Search" / "Ask about"), or long-press the Power button.
Those are handled by the operating system. The exam page stays visible and focused underneath: `visibilitychange`, `fullscreenchange`, `blur` and viewport
size do not change, so a web page has **no reliable signal** (confirmed by the screenshots that prompted this work: the page is full-size under the overlay).
A normal website cannot block these actions. Only the device can.

## 2. What CodeArena already does for phones (verified in code and tests, see the reports above)

| Mode | Phones | Behaviour |
|---|---|---|
| STANDARD | allowed | Honest detection and persisted events (tab hidden, fullscreen exit, focus loss, split-screen, overlay heuristic, orientation, network). Overlay/focus signals are low-confidence. |
| PROCTORED | refused by the server unless the admin allows them (`403 MOBILE_NOT_SUPPORTED`) | One active session, server timer, evidence and review. |
| LOCKDOWN | refused; secure client required | Server fails closed without a verified secure-client token; no silent downgrade. |

So today the only reliable control against assistants on a phone is: **do not allow phones for graded tests** (set the test's "Allow phones and tablets" off, or
use PROCTORED/LOCKDOWN). Events are recorded as observable facts; a Home press, app switch or overlay is never labelled "AI use".

## 3. Strict Managed Android Exam Mode — design

Goal: an institution-owned, dedicated Android device that can only run the exam app, with system actions restricted by the device owner.

Components
1. **Device Policy Controller (DPC)** — either an enterprise EMM (Android Enterprise dedicated devices / fully managed) or a custom DPC. The exam app is the only
   package in the lock-task allow-list.
2. **Exam app** — a native wrapper (WebView or Custom Tab is NOT enough; it must be the lock-task activity) that loads the exam origin only, refuses other
   origins, and performs the signed handshake.
3. **Server** — reuses the existing LOCKDOWN secure-session endpoint. A new client type (for example `ANDROID_MANAGED`) would be added so the policy can say
   "Android managed device required", with the same fail-closed rule: no verified token means the attempt cannot start. An administrator override must be an
   explicit, audit-logged action (it does not exist yet).

Android mechanisms the design relies on (each must be verified on the target device and OS version before it is claimed)
* Lock Task Mode for an allow-listed package via the device owner (`DevicePolicyManager.setLockTaskPackages`).
* `setLockTaskFeatures` (API 28+) to leave Home, Overview, Notifications, system info and the global-actions (power) menu disabled.
* Hiding or suspending assistant and search packages for the exam period (`setApplicationHidden` / `setPackagesSuspended`) and user restrictions the OEM supports.
* Screen capture disabled for the app window (`FLAG_SECURE`) and `DevicePolicyManager.setScreenCaptureDisabled`.
* Attested app identity: Play Integrity or key attestation, combined with the existing HMAC handshake, so the server can tell a provisioned exam app from a
  re-packaged one.

Known limits to document honestly (not promises)
* Lock Task Mode does not by itself guarantee that **every** Power-button behaviour or emergency / OEM system action is blocked. The OEM's implementation decides.
* Behaviour of assistant gestures and long-press Power differs by Android version and manufacturer. Each model/OS pair needs an on-device test.
* A second phone, paper notes, or another person in the room are outside any device policy. See SECURE_EXAM_ARCHITECTURE.md section 8.
* We will not use root exploits, Accessibility-service abuse, or attempt to silently disable system buttons. Provisioning requires factory-reset enrollment
  (QR / zero-touch) of institution-owned devices; personal phones cannot be made strict.

## 4. Prevent silent downgrade (rules the implementation must meet)

1. A test configured "Strict Managed Android" never starts in plain browser mode. The server decides, from a verified token, not from the User-Agent.
2. The pre-exam check shows each requirement with pass/fail and why; the student cannot proceed on a failed required item.
3. Override only by an authorised administrator, with reason, student, test and time written to the audit log.
4. Lockdown status is visible to the student for the whole attempt; leaving lock task or losing attestation raises a server-side event and applies the
   configured policy; recovery is a controlled flow (resume on the same attempt, same server clock, warnings preserved).
5. Exit: an administrator PIN or an MDM command; documented, tested and audit-logged.

## 5. Threat model (summary)

| Threat | Web mode | Managed Android mode (design target) |
|---|---|---|
| Assistant invoked by Home / gesture / Power long-press | Not detectable or blockable | Prevented only if the device policy blocks it on that model (verify) |
| App switch / notification | `visibilitychange` event, recorded | Prevented by lock task (verify) |
| Screenshot / screen recording | Not preventable | Blocked by `FLAG_SECURE` and device policy (verify) |
| Re-packaged or fake exam app | n/a | Attestation + HMAC handshake |
| Client resets warnings / timer | Rejected: server authoritative | Same |
| Second device / human help | Out of scope | Out of scope (invigilation) |
| Lost connectivity | Logged, session resumes | Same; attempt stays server-timed |

## 6. Device compatibility matrix

| Manufacturer / model | Android | Enrollment | Home/assistant blocked | Power-menu blocked | Status |
|---|---|---|---|---|---|
| (to fill after testing) | | | | | **NOT TESTED** |

No rows are filled because no managed device has been tested. Do not copy a result into this table without an on-device test log.

## 7. Report (updated)

| Item | Result | Evidence |
|---|---|---|
| Web detection of Home / assistant overlay | FAIL (not detectable by a web page) | Screenshots of 2026-10-13: the page is full-size and focused under the overlay |
| Student is told when the overlay heuristic fires | PASS (code, CI green) | commit ac26b51; not tested on a phone |
| Phones refused for PROCTORED / LOCKDOWN | PASS (existing) | verifyTestSecurity.js, verifyExamSecurity.js |
| Server-authoritative timer, attempts, session | PASS (existing) | same scripts |
| Server: `ANDROID_MANAGED` client kind, per-kind signed capability list | PASS (unit tests) | backend/test/secureAndroidClient.test.js |
| Server: Electron signature format unchanged | PASS (unit test with the legacy construction) | same file |
| Server: no silent downgrade between client kinds; unattestable requirements always fail | PASS (unit tests); end-to-end against a live DB NOT TESTED | same file; evaluateSecureSession check is in routes/secureExam.js |
| Server: phones refused unless a secure session is mandatory and Android is accepted | PASS (unit tests) | `mobileRefused` |
| Android interruption events are observable facts, reportable by a secure client only | PASS (unit test) | same file |
| Android client source (handshake, device policy, WebView, heartbeat, PIN exit) | WRITTEN, NOT BUILT | android-exam-client/ |
| Signature vector matches between server and Android code | PASS on the server side; Android side NOT RUN | same hex asserted in HandshakeTest.kt |
| Debug APK | BLOCKED | no JDK / Android SDK available; no APK exists |
| Lock Task / Home / assistant / Power-button behaviour | NOT TESTED | no managed device |
| Device-owner provisioning, EMM policy, unenrol | NOT TESTED / not performed | needs authorisation and hardware |
| Administrator override of a failed strict requirement, audit-logged | NOT BUILT (staff unlock of a locked attempt exists; a start-time override does not) | |
| Android browser / emulator automated tests | NOT TESTED | no emulator in CI |
| Device compatibility matrix | NOT TESTED | table in section 6 is empty |

## 8. Exam-type coverage

| Exam type | Secure-session engine (strict Android) | Notes |
|---|---|---|
| Module coding tests, chapter Levels, JAVA Practice | Yes (coding-attempt engine) | LOCKDOWN + `allowedClientKinds` override |
| Formal Test engine (MCQ, company tests) | No: LOCKDOWN is refused there | needs the engine moved onto the secure-session model |
| Readiness tests, mock interviews, AI interviews, LMS quizzes | No | web modes only; set phones off for graded use |

## 9. Remaining OS limitations

* Behaviour of Home, assistant gesture and Power long-press under Lock Task depends on Android version and OEM; unverified until tested per model.
* Lock Task does not guarantee that every emergency or OEM system action is blocked.
* Hiding the Google app can affect other Google services on the device.
* A second phone, notes or another person are outside any device policy.
* Capabilities are attested by the app from device state; a device that is not institution-owned cannot be trusted to attest honestly.

## 10. What is needed to proceed

1. A machine with JDK 17 and the Android SDK (or Android Studio) to run `./gradlew testDebugUnitTest assembleDebug` and report the result.
2. One institution-owned Android device per target manufacturer, factory-reset, plus your authorisation to enrol it (`dpm set-device-owner` or EMM).
3. A keystore you generate and keep, for release signing (none exists; none is created here).
4. A decision on the EMM (or manual enrolment for a pilot) and on moving the formal Test engine onto the secure-session model.
