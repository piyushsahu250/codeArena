# CodeArena Exam (Android managed client)

Status: **source only. NOT BUILT, NOT RUN, NOT TESTED on any device.** The machine this was written on has no JDK, Gradle or Android SDK, so no APK exists and
none is claimed. Every behaviour below is a design target until it is verified on an enrolled physical device (see `docs/ANDROID_MANAGED_EXAM_MODE.md`).

## What it is

A dedicated-device exam app for **institution-owned** Android devices. It is a device-owner (DevicePolicyManager) app that runs one WebView, confined to the
CodeArena hosts, inside Lock Task Mode, and registers a secure session with the CodeArena server (`clientKind = ANDROID_MANAGED`) using the existing
`/api/secure-exam/*` handshake. The server stays the authority for the timer, attempts, warnings, locking and submission; the app holds no answers, keys or
hidden tests.

It reports only observable facts (exam window lost focus, screen off/on, navigation refused, lock task ended, capability regression). It never says an
assistant such as Gemini was used.

## Why this design (and not the alternatives)

| Option | Verdict |
|---|---|
| Browser / PWA | Cannot see or stop Home, Power or assistant gestures. Already covered by the web modes. |
| Lock Task Mode, custom device-owner app (this project) | Chosen: a supported API, one small app, no per-device licence, reuses the existing server handshake. Needs institution-owned, factory-reset-enrolled devices. |
| Android Enterprise EMM (Intune, Workspace ONE, Hexnode, Scalefusion, Google zero-touch + an EMM) | Recommended for **operating** a fleet (enrolment, policy push, remote wipe, unenrol). It still needs this app as the kiosk app. Per-device subscription cost. |
| Custom DPC without an EMM | Works for a handful of test devices; every enrolment and recovery is manual. |
| Root, Accessibility service, overlay tricks | Not used and not acceptable. |

Ongoing costs: per-device enrolment (factory reset), OS/OEM re-verification on each Android upgrade, key custody for signing, and an invigilator PIN process.

## What it enforces (when the device is device owner) and what is read back

| Capability reported | How it is obtained |
|---|---|
| deviceOwner | `isDeviceOwnerApp` |
| lockTask / kiosk | `ActivityManager.lockTaskModeState` and the lock-task allow-list contains only this app |
| homeBlocked, overviewBlocked, globalActionsBlocked, notificationsBlocked | `getLockTaskFeatures` read back after `setLockTaskFeatures(NONE)` |
| assistantUnavailable | every package in `blocked_packages` is hidden (`setApplicationHidden`) or not installed |
| screenCaptureProtection | `getScreenCaptureDisabled` (and `FLAG_SECURE` on the window) |
| browserRestriction | the WebView navigation allow-list is installed (code-attested) |
| clipboard | **not claimed** (best-effort clearing only) |

A device that is not device owner reports `false` for these and the server refuses any exam whose policy requires them. There is no silent downgrade.

**Not promised:** Lock Task Mode does not by itself block every Power-button or emergency/OEM action, and assistant behaviour differs by Android version and
manufacturer. Hiding the Google app can affect other Google features on that device. Test every model/OS pair (compatibility matrix in the docs).

## Permissions and dependencies (review)

* Permissions: `INTERNET`, `ACCESS_NETWORK_STATE`. No camera, microphone, storage, location, accessibility or overlay permission.
* `usesCleartextTraffic=false`, `allowBackup=false`, release build not debuggable, minified.
* Dependencies: `androidx.core:core-ktx 1.13.1`, `androidx.appcompat:appcompat 1.7.0`; tests: `junit 4.13.2`. No networking, JSON or crypto libraries beyond the platform.
* minSdk 28 (Android 9) because `setLockTaskFeatures` needs it; targetSdk 34.

## Managed configuration (pushed by the EMM; never compiled in)

`app_url`, `api_url`, `device_id`, `device_secret` (shown once when an admin registers the device in CodeArena: `POST /api/secure-exam/devices`),
`allowed_hosts`, `blocked_packages`, `invigilator_pin_hash` (`saltHex:hashHex`, PBKDF2-HMAC-SHA256, 120000 iterations, 32-byte hash).

## Build (needs JDK 17 and the Android SDK; run on a machine that has them)

```
cd android-exam-client
./gradlew testDebugUnitTest      # HandshakeTest: server signature vector and PIN check
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk (applicationId com.codearena.exam.debug)
```

A Gradle wrapper is not committed (it needs a JDK to generate): run `gradle wrapper --gradle-version 8.7` once, or open the folder in Android Studio.

### Release signing (your key)

Create `keystore.properties` in this folder (git-ignored) with `storeFile`, `storePassword`, `keyAlias`, `keyPassword` pointing at a keystore **you** generate and keep
offline, then `./gradlew assembleRelease`. Without that file the release build is unsigned. Never commit the keystore or the properties file.

## Provisioning (needs authorisation per device: it factory-resets / enrols hardware)

Not performed by anyone yet. Options, from least to most operational effort:

1. **EMM with zero-touch or QR enrolment** (recommended for a fleet): create a dedicated-device policy, add this app as the only kiosk app, push the managed configuration.
2. **QR provisioning with a custom DPC**: factory-reset device, tap the welcome screen six times, scan a QR code carrying the APK download URL, its SHA-256 checksum and
   the admin component `com.codearena.exam/.ExamDeviceAdminReceiver`.
3. **adb, test devices only**, on a factory-fresh device with no accounts: `adb shell dpm set-device-owner com.codearena.exam/.ExamDeviceAdminReceiver`.

Then: register the device in CodeArena (admin), push the config, set the test's security profile (below), and run the on-device test matrix.

## CodeArena configuration for a strict Android exam

On the test, set the security level to `LOCKDOWN` and the overrides to (the server drops unknown keys):

```json
{ "allowedClientKinds": ["ANDROID_MANAGED"],
  "requiredCapabilities": ["deviceOwner", "lockTask", "kiosk", "homeBlocked", "overviewBlocked", "globalActionsBlocked", "notificationsBlocked", "assistantUnavailable", "screenCaptureProtection"],
  "exitAction": "LOCK", "graceSec": 120 }
```

The default LOCKDOWN profile accepts only the desktop client. A phone browser, a desktop client, or an unmanaged Android device cannot start such a test:
the server answers `SECURE_CLIENT_REQUIRED`, `CLIENT_KIND_NOT_ALLOWED` or `SECURE_CAPABILITY_MISSING`.
Applies to the coding-attempt engine (module coding tests, chapter Levels, Java Practice). The formal MCQ/Test engine, readiness and mock interviews do not
use the secure-session engine yet (see the coverage table in `docs/ANDROID_MANAGED_EXAM_MODE.md`).

## Recovery and rollback

* **Locked exam** (heartbeat lost, capability regression): the server locks the attempt; staff unlock it (`POST /api/secure-exam/attempts/:attemptId/unlock`); timer and answers are preserved.
* **Exit** (end of exam, wrong device, emergency): invigilator PIN in the app. "Exit" undoes every restriction the app applied. "Exit and remove management" also relinquishes device owner.
* **Lost PIN or broken app**: unenrol through the EMM, or factory reset the device. There is no back door by design.
* **Roll back a release**: re-publish the previous signed APK through the EMM; `versionCode` must increase, so re-sign the old build with a higher `versionCode`.
* **Server side**: removing `ANDROID_MANAGED` from a test's `allowedClientKinds` immediately stops accepting these devices for that test.
