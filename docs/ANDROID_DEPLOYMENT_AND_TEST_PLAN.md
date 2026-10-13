# Android managed exam client: build setup, deployment plan, signing and device test plan

Nothing in this document has been executed against production or any device. It is a plan for approval. Companion documents:
[ANDROID_MANAGED_EXAM_MODE.md](ANDROID_MANAGED_EXAM_MODE.md) (design, report), [../android-exam-client/README.md](../android-exam-client/README.md).

## 1. Build toolchain (the authoring machine has none of it)

Checked 2026-10-13 on the authoring machine: no `java`/`javac`, no `JAVA_HOME`, no `ANDROID_HOME`/`ANDROID_SDK_ROOT`, no `gradle`, no `adb`, no Android Studio folders. The project has
no Gradle wrapper committed (generating one needs a JDK). So `./gradlew testDebugUnitTest assembleDebug` was **not run**: there is no exit code to report.

Setup on a machine that will build it (Windows, macOS or Linux):

1. Install JDK 17 (Temurin 17). Check: `java -version` shows 17.x.
2. Install Android Studio (Koala or newer) or only the command-line tools, then with the SDK manager install `platforms;android-34` and `build-tools;34.0.0`.
   Set `ANDROID_HOME` to the SDK folder (or write `sdk.dir=...` into `android-exam-client/local.properties`, which is git-ignored).
3. Install Gradle 8.7 once, then create the wrapper and commit it: `cd android-exam-client && gradle wrapper --gradle-version 8.7`.
4. Run:

```
cd android-exam-client
./gradlew testDebugUnitTest assembleDebug
```

Expected: unit tests in `HandshakeTest` pass (signature vector shared with the server, PIN check), debug APK at `app/build/outputs/apk/debug/app-debug.apk`.
Compatibility notes to watch on first build: AGP 8.5.2 needs Gradle 8.7+ and JDK 17; Kotlin 1.9.24; `compileSdk 34`. Send the first failing output back and it will be fixed at the root.

## 2. Backend change review (commit 24f8cb8 and the earlier ac26b51)

| Question | Finding |
|---|---|
| Database / migrations | None: `git diff 7e2c1e6..HEAD -- backend/prisma` is empty. The deploy script's schema guard would also stop on any destructive diff. The `secureExamSession.clientKind` column already exists as a string. |
| New environment variables | None. `SECURE_BROWSER_SECRET` is already set on the host (checked read-only: a value of 16+ characters is present in `container.env`; the value was not read). |
| Inactive by default | Yes. `allowedClientKinds` defaults to `["ELECTRON"]`; only a test whose stored `securityPolicy` explicitly lists `ANDROID_MANAGED` changes behaviour. STANDARD and PROCTORED tests do not read it. The client policy payload sent to the browser is unchanged (a contract snapshot caught an earlier attempt to add a field, which was removed). |
| Desktop client | The Electron signature format is unchanged (unit test builds the legacy string independently). |
| Authentication / authorization | Unchanged routes. Device registration is still admin only, institute-scoped. Sessions are still bound to student, institute and registered device. |
| Phone exemption | `mobileRefused` allows a phone only when the policy mandates a secure session AND lists ANDROID_MANAGED; the start still needs a verified session of that kind and the required capabilities. |
| Rollback | (a) per test: remove `ANDROID_MANAGED` from `allowedClientKinds` (takes effect on the next request); (b) whole change: the deploy script keeps a rollback image and rolls back automatically if health fails; manual: `git checkout 7e2c1e6` on the host and rerun the deploy script. |

Automated tests added: `backend/test/secureAndroidClient.test.js` (unit, runs in `npm test`) and `backend/scripts/verifySecureAndroid.js` (database-backed, now part of the CI
verification loop with a CI-only `SECURE_BROWSER_SECRET`). The latter covers: opt-out (a STANDARD web exam still starts and its payload is unchanged), no opt-in (a default LOCKDOWN exam refuses phones and Android sessions),
opt-in (phone without a session refused; Electron session refused; forged kind refused; missing capability refused; another student's session refused; verified Android session starts the exam; plain browser cannot continue; hidden
tests absent), server-assigned event severity, an invented "Gemini detected" event dropped, lock-task regression refused until restored, and rollback by policy.
CI result: all checks of `verifySecureAndroid` PASS in the integration job on the disposable CI database (run for branch commit `c8a0c69`). That is the only pre-production validation available; there is no separate staging environment.

## 3. Deployment checklist (production NOT touched; needs your explicit go-ahead for this exact deployment)

| Item | Value |
|---|---|
| Target | AWS EC2 `i-02bedc5ba41539f46`, region `ap-south-1`, repo at `/opt/codearena`, containers `codearena-backend` and `codearena-judge` |
| Currently running | commit `7e2c1e6` (health: `{"status":"ok","service":"CodeArena API","commit":"7e2c1e6"}`) |
| Candidate | `main` after CI is green for its exact SHA (the deploy script's release gate enforces this) |
| Secrets | none to add or change |
| Migration effect | none (no schema change) |
| Frontend | already deployed from main by Vercel (overlay notice); this change adds no frontend change |
| Steps | `git pull --ff-only origin main` then `nohup bash scripts/deploy-aws-host.sh` on the host (via SSM) |
| Health checks | `GET /api/health` reports the new commit; run `verifySecureAndroid.js` is NOT run against production (CI is the staging); smoke: a STANDARD test still starts |
| Rollback | the script restores the previous image automatically if health fails; manual: checkout `7e2c1e6`, rerun the script |
| Expected downtime | the container restart (about 30 seconds of boot) |

Staging: no separate staging environment is configured; the CI integration job (disposable database, same code) is the only pre-production validation.

## 4. Release signing (no keystore exists; none is created here)

Debug and release signing are separate: the debug build uses the Android debug key automatically and has a different application id (`com.codearena.exam.debug`), so a debug build can never replace the release app.

Generate and protect a release key **on your own machine**, never in this repository:

```
keytool -genkeypair -v -keystore codearena-exam-release.jks -alias codearena-exam -keyalg RSA -keysize 4096 -validity 10000
```

* Choose strong, different passwords for the store and the key; keep them in a password manager, not in a file in the repository.
* Back the `.jks` up in at least two offline locations (an encrypted drive plus a second custodian). If it is lost the app can never be updated under the same signature.
* Provide the secrets to Gradle without committing them: either a git-ignored `keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`), or environment variables set in your shell/CI secret store
  and read by a local, uncommitted properties file. `.gitignore` already excludes `*.jks`, `*.keystore` and `keystore.properties`.
* Enable Play App Signing only if you publish through Play; for EMM/private distribution keep the key offline and sign locally.
* Rotating: publish a new version signed by the same key; changing the key requires uninstalling the old app (a re-provision on dedicated devices).

## 5. Device test plan (one institution-owned physical device per target manufacturer)

Rules: no factory reset, enrolment or device-management change without your explicit authorisation for that device. Emulator results are labelled EMULATOR and never stand in for a device result.

Per device record: manufacturer, model, Android version, security patch level, how it was enrolled, app version, tester, date, and PASS/FAIL/NOT TESTED with a note or photo.

| # | Test | Where it can run |
|---|---|---|
| 1 | Unit tests and debug build pass | build machine |
| 2 | Not device owner: the app shows "Lockdown NOT active" and the server refuses a strict exam | EMULATOR or device |
| 3 | Device-owner enrolment succeeds; the app starts lock task | emulator (test only) and PHYSICAL |
| 4 | Home button does nothing while the exam runs | PHYSICAL |
| 5 | Long-press Home / assistant gesture / Circle to Search does not open an assistant | PHYSICAL (Android version and OEM dependent) |
| 6 | Power button short press: screen off; resume returns to the exam; `SCREEN_OFF_RESUME` recorded | PHYSICAL |
| 7 | Power button long press: no power menu and no assistant; record exactly what appears | PHYSICAL |
| 8 | Gesture navigation (swipe up, side swipe back) and the recents screen do nothing | PHYSICAL |
| 9 | Notification shade and quick settings cannot be pulled down | PHYSICAL |
| 10 | Incoming call / system dialog: exam window loses focus; `SYSTEM_UI_INTERRUPTION` recorded; exam recovers | PHYSICAL |
| 11 | Emergency / SOS gesture: record what the OEM does (cannot be assumed blocked) | PHYSICAL |
| 12 | Gemini / Google app hidden: not launchable; other required Google features still work | PHYSICAL |
| 13 | Screenshot and screen recording blocked | PHYSICAL |
| 14 | Keyboard input in the code editor (letters A/S/D, symbols, IME), rotation does not reset the exam | PHYSICAL |
| 15 | Network off/on: events queue and flush; attempt continues; timer follows the server | PHYSICAL |
| 16 | Heartbeat lost beyond grace: the attempt locks; staff unlock; answers preserved | PHYSICAL |
| 17 | Two devices, one student: the older session is refused (`409 SESSION_REPLACED` / session rules) | PHYSICAL |
| 18 | API tampering (replayed challenge, modified signature, other student's token) refused | any (also covered in CI) |
| 19 | Invigilator PIN exit restores normal device behaviour; wrong PIN is recorded | PHYSICAL |
| 20 | "Exit and remove management" leaves a normal device; re-enrolment documented | PHYSICAL |
| 21 | App update (higher `versionCode`) keeps device-owner status and configuration | PHYSICAL |

## 6. What remains blocked, and the exact next action

| Blocker | Why it matters | Next action |
|---|---|---|
| No JDK / Android SDK on the authoring machine | The app has never been compiled | Install per section 1 and send the output of `./gradlew testDebugUnitTest assembleDebug` |
| No physical Android devices enrolled | No Home / Power / assistant behaviour can be claimed | Authorise one test device per manufacturer and run section 5 |
| No release keystore | No release APK can be signed | Generate it locally per section 4 |
| Production deployment | Server change is inactive by default but not live | Approve the plan in section 3 for the exact commit |
| Start-time administrator override with audit log | A strict exam currently cannot be started by an override | Decide whether to build it (not built) |
| Formal MCQ/Test engine, readiness, mock interviews, LMS quizzes | They do not use secure sessions | Decide whether to move them onto the secure-session model |

## 7. Update 2026-10-13: CI build, coverage audit, EMM prerequisites

**CI build.** `.github/workflows/android.yml` installs JDK 17, Android SDK (platform 34, build-tools 34.0.0) and Gradle 8.7 on a clean runner and runs `gradle testDebugUnitTest assembleDebug`.
It is deliberately not one of the checks the release gate requires (the backend deploys independently). The first run failed with three real compile errors (a wrong `SecretKeySpec` import, a KDoc
containing `/*` that opened a nested comment, and layout calls); all were fixed at the cause. The latest run: unit tests and `assembleDebug` succeeded and the debug APK (about 2.7 MB, Android debug
signature) is kept as a workflow artifact. That is a compile and unit-test result only: nothing has been installed on a device. The earlier "Gradle wrapper missing" note still applies to local builds.

**Coverage.** See the matrix in [ANDROID_MANAGED_EXAM_MODE.md](ANDROID_MANAGED_EXAM_MODE.md) section 8. Strict mode exists only in the coding-attempt engine. The other engines now fail closed on a stored LOCKDOWN level.

**Android Enterprise / EMM prerequisites (needed before any physical test):**
* Institution-owned devices running Android 9 or newer (API 28+), supporting fully managed / dedicated-device enrolment (zero-touch, QR or EMM).
* An EMM that supports dedicated devices, managed app configuration and private app distribution (any Android Enterprise EMM), or manual QR provisioning for a pilot.
* Devices that are factory-reset before enrolment and have no personal Google account added.
* Network access from the device to `codearena.site` and `api-aws.codearena.site` over https.
* A CodeArena device registration per device (`POST /api/secure-exam/devices`), and its one-time secret entered as the managed configuration `device_secret`.
* The invigilator PIN hash from `android-exam-client/tools/make-pin.js`, delivered as `invigilator_pin_hash`.
* A signing key you control for release builds (section 4).

No claim that Gemini or any other assistant is blocked may be made until section 5 tests 4, 5, 7, 8 and 12 pass on the enrolled device model.
