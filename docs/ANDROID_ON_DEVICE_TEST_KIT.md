# Android managed exam mode: on-device test kit

Purpose: turn the empty compatibility matrix in `docs/ANDROID_MANAGED_EXAM_MODE.md` (section 6) into evidence, one device model at a time. Nothing in the repository has been run on a
physical device. **Do not copy a result into the matrix without the evidence files listed here.** "Expected" below is the design target, not a promise.

## 0. Rules for claiming a result

* **PASS**: the scenario was run on this exact model + Android version + build of the app, the observed behaviour matches, and the evidence files exist.
* **FAIL**: it behaved differently. A FAIL is a finding, not an embarrassment; record exactly what happened.
* **PARTIAL**: it worked in some conditions (say which).
* **BLOCKED**: the scenario could not be run (say why).
* **NOT TESTED**: not attempted.
* A result applies to one row: manufacturer, model, Android version, security patch level, app version. Another model or OS update needs its own row.
* Never write "blocked" or "prevented" without the screen recording and the log for that scenario.

## 1. What you need

| Item | Notes |
|---|---|
| An institution-owned Android device per model under test | Factory reset, **no Google or other accounts added** (device-owner enrolment fails otherwise). Personal phones cannot be made strict. |
| Authorisation to enrol it | Enrolment factory-resets the device and makes the app the device owner. Record who approved it. |
| The app build | A signed build from your own keystore (see `android-exam-client/README.md`), or the CI debug build (`applicationId com.codearena.exam.debug`) for a lab device only. Record the version. |
| A computer with `adb` and USB debugging enabled on the device | For the log and state captures below. |
| A CodeArena test account, a student account, an administrator account | Use disposable accounts, never real students. |
| A second person | Someone to watch the screen and run the stopwatch, so results are not only the tester's memory. |

## 2. Prepare the CodeArena side

1. As an administrator, register the device: `POST /api/secure-exam/devices` (the admin screen does this). Save the device id; the secret is shown once and goes to the device through managed configuration or the lab setup.
2. Create a throwaway module-coding assessment and set its security level to `LOCKDOWN` with:
   `{ "allowedClientKinds": ["ANDROID_MANAGED"], "requiredCapabilities": ["deviceOwner","lockTask","kiosk","homeBlocked","overviewBlocked","globalActionsBlocked","notificationsBlocked","assistantUnavailable","screenCaptureProtection"], "exitAction": "LOCK", "graceSec": 120 }`
3. Publish it to the student account only.
4. Note the test id, the student id and the time.

## 3. Enrol the device (test devices only)

Factory-fresh device, no accounts, USB debugging on:

```
adb shell dpm set-device-owner com.codearena.exam/.ExamDeviceAdminReceiver
```

Expected: a success message. If it fails ("already several users", "accounts present", "not allowed"), record the exact message as BLOCKED with the reason.
For fleets use an EMM or QR provisioning instead (see the README, "Provisioning").

Capture, and keep with the results (these show the device state, they do not prove blocking):

```
adb shell getprop ro.product.manufacturer
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.security_patch
adb shell dumpsys device_policy
adb shell dumpsys package com.codearena.exam | findstr versionName
```

## 4. Scenarios

Run each one on a fresh attempt unless it says otherwise. For every scenario record: the exact action, what the screen showed, whether the exam stayed visible, the time,
and the server's security events for the attempt (section 5). Take a **screen recording of the physical device** (a phone camera on a stand is acceptable) in addition to any
screenshots. Screenshots taken by the device itself may be blocked by design.

| # | Scenario | Action | Design target (verify, do not assume) |
|---|---|---|---|
| 1 | Start | Open the app, sign in as the student, open the assessment | The capability check shows every required item as passed; the exam starts only if all pass |
| 2 | Unsupported device | Run the same test on a device that is NOT device owner | The start is refused; the student sees which item failed; no silent downgrade |
| 3 | Home, short press | Press Home | The exam stays on screen |
| 4 | Home, long press | Hold Home (or the gesture for your Android version) | No assistant or Google overlay appears |
| 5 | Assistant gesture | Use the manufacturer's assistant gesture (side-button hold, corner swipe, "Circle to search" gesture, voice trigger) | No assistant appears. Record separately for each gesture the model offers |
| 6 | Power, short press | Press Power once | Screen turns off; on wake the exam is still the only thing available and the attempt resumes |
| 7 | Power, long press | Hold Power | Record exactly what appears (power menu, assistant, nothing). **Lock Task does not by itself guarantee this is blocked; the manufacturer decides** |
| 8 | Notification shade | Swipe down from the top edge | Not available |
| 9 | Recents / app switch | Use the recents gesture or button | Not available; no other app can be opened |
| 10 | Emergency / system dialogs | Trigger the emergency call, a low-battery dialog, a system update prompt | Record what appears and whether the student can leave the exam |
| 11 | Screen off and resume | Lock, wait 30 s, wake | Same attempt resumes; the server timer was not paused; an interruption event exists |
| 12 | Network loss | Turn off Wi-Fi for 60 s, then on | Work is kept; the attempt continues; events show the gap |
| 13 | Rotation | Rotate the device | No loss of answers; no false violation |
| 14 | Reboot | Restart the device mid-attempt | Record whether the app returns to the exam and whether the attempt can be resumed |
| 15 | Safe mode / USB / settings | Try to open Settings, enable developer options, boot to safe mode | Record what is reachable. Safe mode and recovery are usually outside the app's control |
| 16 | Screenshot and screen recording | Press the screenshot combination | Blocked or blacked-out content, per the capability |
| 17 | Capability regression | Change a policy so lock task ends while the exam runs (lab only) | The server records a policy failure and refuses further exam calls until it is restored |
| 18 | Exit | Use the invigilator PIN to leave | All restrictions are removed; the event is recorded |
| 19 | Recovery | Lock the attempt (lost heartbeat), then unlock it as staff | The same attempt resumes with the same server clock and preserved warnings |
| 20 | Override | See `docs/ANDROID_MANAGED_EXAM_MODE.md` section 4: an administrator grants a start override for one student and one test | The student can start once on an unmanaged device; the override is audited; a phone is still refused |

## 5. Evidence to capture per scenario

* The screen recording file name and the time range.
* `adb logcat -d > logcat-<scenario>.txt` right after the scenario (look for the app's own tag and for lock-task messages; do not paste secrets).
* The attempt's security timeline from CodeArena (staff screen, or `GET /api/exam-security/...` as an administrator): copy the event types and times. Expected event names are
  observable facts only (for example an interruption or a capability regression). **The system never records that an assistant was used.**
* `adb shell dumpsys activity activities` and `adb shell dumpsys device_policy` saved before and after, to compare lock-task and policy state.

## 6. Results template (one block per device row)

```
Device: <manufacturer> <model>      Android: <version>      Patch: <date>      App: <versionName>      Enrolled by/approved by: <name>      Date: <date>
Enrolment method: adb dpm / EMM <name> / QR        Result: <message or BLOCKED reason>

| # | Scenario                | Result (PASS/FAIL/PARTIAL/BLOCKED/NOT TESTED) | What actually happened | Evidence files | Server events seen |
|---|-------------------------|-----------------------------------------------|------------------------|----------------|--------------------|
| 1 | Start                   |                                               |                        |                |                    |
| ... |                       |                                               |                        |                |                    |
```

Then add one line to the matrix in `docs/ANDROID_MANAGED_EXAM_MODE.md` section 6 **only** from a completed block:

```
| <manufacturer / model> | <Android> | <enrolment method> | Home/assistant: <PASS/FAIL/PARTIAL> | Power menu: <PASS/FAIL/PARTIAL> | <date, tester> |
```

## 7. After the run

* Any FAIL on scenarios 3 to 7 means the model is **not** suitable for strict exams until a fix is verified. Say so in the matrix.
* A device that passes today is not certified for tomorrow: repeat the run after an Android or app update.
* Do not publish the matrix as proof that "Gemini is blocked". It shows what a specific, enrolled configuration did on a specific day.
* Unenrol or factory reset the lab device when finished and record that you did.

## 8. Remaining limits (unchanged)

A second phone, notes, another person, a different room, and anything outside the device policy are outside this test. Hiding Google apps can affect other Google features on the device.
Behaviour of power and emergency actions depends on the manufacturer. A device that is not institution-owned cannot be trusted to report its own state honestly.
