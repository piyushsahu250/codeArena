# Secure Exam — test report (what was actually run)

Status vocabulary: **VERIFIED** (executed against the live backend or unit-tested, passing) · **IMPLEMENTED** (code exists, not exercised on real lab hardware) · **PARTIAL** · **NOT IMPLEMENTED** · **BLOCKED** (needs an environment this session does not have) · **NOT APPLICABLE**.
Nothing is marked PASS merely because an event was detected; the acceptance test is *blocked / restricted / escalated / logged with an enforceable control*.

Environment: production backend (Docker on AWS EC2, 2 vCPU / 7.7 GB, PostgreSQL on RDS), disposable accounts and devices that were deleted afterwards. **No Windows lab PC and no built Electron installer were available in this session**, so everything that must happen on a lab PC is IMPLEMENTED or BLOCKED, not VERIFIED.

## 1. Suites executed

| Suite | Result |
|---|---|
| `backend/scripts/verifySecureExam.js` (72 checks: device registration, handshake abuse, capability enforcement, binding, heartbeat states, lock/pause/auto-submit, unlock, downgrade, monitor) | **VERIFIED — all pass** |
| `backend/scripts/verifyExamSecurity.js` (policy engine, session control, evidence intake, monitor RBAC/IDOR, retention) | **VERIFIED — all pass** |
| `secure-client` unit tests (14: allow-list incl. look-alike hosts and AI sites, blocked-process detection, attestation logic, client↔server signature equality) | **VERIFIED — 14/14** |
| `frontend/scripts/keyboardRegression.mjs` (every letter incl. A/S/D, digits, symbols, Tab/Enter/Backspace/arrows never intercepted; insertion classifier false-positive checks) | **VERIFIED — all pass** |
| `verifyJavaPractice.js`, `verifyPublishHierarchy.js`, `verifyFourLanguages.js` (existing exams/LMS/compilers still work) | **VERIFIED — all pass** |
| Frontend production build | **VERIFIED** |

## 2. The 35-item controlled attack list

The server-side items were run by script. Items that depend on the lab PC are marked with exactly what is in place and what was not exercised.

| # | Attempt | Result | Status |
|---|---|---|---|
| 1–10 | Open Chrome / another browser / Copilot / ChatGPT / Claude / Gemini / Perplexity / VS Code / terminal / PowerShell | Prevented by **Assigned Access** (the exam account can launch only the secure client) and/or **AppLocker** (kit + XML provided). If one is seen running anyway the client reports `APPLICATION_POLICY_FAILURE` (process-scan logic unit-tested) and the device must attest `appRestriction` or the exam will not start (server enforcement verified). | **IMPLEMENTED; enforcement on a real PC BLOCKED (no Windows lab)** |
| 11 | Open another tab | The client has no tabs. For the web exam, a second tab is refused by the server (409 `SESSION_REPLACED`). | web: **VERIFIED**; client: **IMPLEMENTED** |
| 12 | Open another window | `setWindowOpenHandler` denies; event queued. | **IMPLEMENTED** |
| 13–16 | External website / Google / GitHub / Stack Overflow | Client navigation + request allow-list (12 sites incl. AI, search, code hosts, social media refused; look-alike hosts and dangerous schemes refused). Network layer: Squid/Unbound allow-list configs provided. | allow-list logic **VERIFIED**; network allow-list **IMPLEMENTED, not deployed/tested on a VLAN** |
| 17–19 | Clipboard / copy / paste | Client intercepts Ctrl/Cmd+C/V/X and clears the clipboard every 500 ms; web path blocks the events. Key classification regression-tested. | **IMPLEMENTED** (client), classification **VERIFIED** |
| 20–21 | Ctrl+Shift+I, F12 | Client has `devTools:false`, blocks the shortcuts, closes any open and reports `DEVTOOLS_ATTEMPT`. | **IMPLEMENTED**; classifier **VERIFIED** |
| 22–23 | Browser back / forward | Alt+Left/Right/Home blocked; kiosk has no browser chrome. | **IMPLEMENTED** |
| 24 | Fullscreen exit | Client re-enters fullscreen/kiosk and reports `KIOSK_EXIT`; the next heartbeat attests `fullscreen`/`kiosk` and the server refuses the exam if they are false (verified with a simulated regression → `SECURE_CAPABILITY_MISSING`). | server enforcement **VERIFIED**; client **IMPLEMENTED** |
| 25 | Kill the secure client | Heartbeats stop → `TEMPORARILY_DISCONNECTED` → (after grace) `SECURITY_SESSION_LOST`: exam calls refused (423), `HEARTBEAT_LOST` recorded once, LOCK policy locks the session; a fresh handshake cannot bypass the lock; invigilator unlock resumes the same attempt. Simulated by ageing the heartbeat timestamp; the process was not actually killed. | **VERIFIED (simulated)** |
| 26–27 | Disconnect / reconnect network | Inside the grace period the exam keeps working; beyond it the policy applies; PAUSE restores automatically on the next heartbeat (`HEARTBEAT_RESTORED`); the **same attempt resumes with the same deadline and saved code, no duplicate attempt**; AUTO_SUBMIT submits only after the grace period (a 20 s silence did not submit). Simulated via heartbeat age. | **VERIFIED (simulated)** |
| 28 | Change the system time | Timer is `startedAt + limit` on the server; a run after the deadline is refused whatever the client says. | **VERIFIED** |
| 29 | Modify browser storage | Tokens in storage are only claims: a made-up token, another student's token, a token bound to another attempt, a revoked device — all refused. Policy/"securityMode"/"proctored=false" values from the browser are ignored (start still refused). | **VERIFIED** |
| 30 | Modify API requests | Upgraded capability claims after signing, replayed challenge, expired challenge, challenge redeemed by another student, wrong device secret, forged server-only event types, oversize/forged metadata — all refused or dropped and recorded. | **VERIFIED** |
| 31–33 | Modify attempt / student / institute id | Other student's attempt → 403/404; a student of another institute cannot use this institute's device (same refusal as unknown); an institute admin cannot register into another institute or open a global test's monitor; students cannot read monitors/timelines or review evidence. | **VERIFIED** |
| 34 | Duplicate session | Web: newest session wins, older tab 409; secure client: one active secure session per attempt (older ended on rebind). | **VERIFIED** |
| 35 | Second device (phone, tablet, second laptop) | **Cannot be prevented by software.** LOCKDOWN relies on the institution's physical policy (phones away, seating, invigilator, optional camera). | **NOT APPLICABLE to software — physical policy** |

## 3. Security claims

| Claim | Status | Evidence |
|---|---|---|
| Lockdown profile exists; policy resolved only on the server | **VERIFIED** | downgrade test: `securityLevel/proctored/securityMode` in body/headers ignored |
| Secure client architecture + implementation | **IMPLEMENTED** (not built/run on Windows here) | `secure-client/` (main process, preload, libs, installer config); unit-tested libraries |
| Signed secure-session handshake, device binding, institute binding | **VERIFIED** | 17 handshake/abuse checks |
| Heartbeat + state machine + exit policies | **VERIFIED (simulated time)** | lock/pause/auto-submit/unlock tests |
| Tamper/mismatch/version detection | **VERIFIED** | `DEVICE_MISMATCH`, `SESSION_TAMPERING`, `VERSION_MISMATCH` recorded; `SECURE_CLIENT_MIN_VERSION` enforced (logic) |
| Kiosk, browser restriction, clipboard, devtools, capture protection | **IMPLEMENTED** in the client | requires lab hardware to verify |
| Application allow-list | **IMPLEMENTED** (Assigned Access XML, AppLocker XML, provisioning script) | not applied to a PC here |
| Network allow-list | **IMPLEMENTED** (Squid + Unbound + firewall design) | not deployed here |
| Hidden tests / answer keys never reach the client | **VERIFIED** | start response inspected, hidden inputs absent |
| Mobile refused for high-security exams | **VERIFIED** | `MOBILE_NOT_SUPPORTED` with a valid secure session |
| No silent downgrade | **VERIFIED** | service unconfigured → 503 `SECURE_EXAM_UNAVAILABLE`; missing/invalid session → refused |
| Live monitor + timeline + review + unlock | **VERIFIED** | monitor rows (device, connection, progress, time left), summary counters, timeline order, unlock audit |
| Randomised coding variants, per-attempt personalised hidden tests | **NOT IMPLEMENTED** | question selection from a pool exists; generating equivalent variants / per-attempt hidden data needs a question-authoring generator per problem family |
| AI object/phone detection (MULTIPLE_PERSON / PHONE_DETECTED from camera) | **NOT IMPLEMENTED** | face presence/multiple faces exist (existing blazeface); event types are accepted so a detector can plug in |
| Continuous screen-share monitoring | **NOT IMPLEMENTED** | `screenCaptureProtection` blocks capture of the client window; no screen-recording of the student is made |
| WebSocket/SSE push to the monitor | **NOT IMPLEMENTED (by design)** | batched polling every 10 s (paused when hidden) + a 5 s server-side summary cache; 5 monitor requests at 2,000 active students: p95 178 ms |

## 4. Performance (production instance: 2 vCPU, 7.7 GB; LOCKDOWN path; all students act at the same instant per step)

Each simulated student has its own registered device and runs: challenge → signed session → LOCKDOWN start → 3 heartbeats with 2 events each → 2 autosaves → (finalize). Latencies are server-observed from a single test machine; error rates are per step.

| Simultaneous students | challenge p95 | session p95 | exam start p95 | heartbeat p95 | autosave p95 | monitor p95 (5 requests) | errors in these steps | peak CPU / RAM |
|---|---|---|---|---|---|---|---|---|
| 200 (real logins) | 0.74 s | 0.85 s | 2.6 s | 0.90 s | 0.79 s | 65 ms | 0 | 200% (2 vCPU) / 507 MB |
| 500 | 1.9 s | 2.0 s | 6.5 s | 2.1 s | 1.8 s | 73 ms | 0 | 99% / 579 MB |
| 1000 | 3.4 s | 4.0 s | 12.3 s | 4.3 s | 3.5 s | 102 ms | 0 | 76% / 807 MB |
| 2000 | 6.3 s | 7.5 s | 25.4 s | 8.3 s | 7.4 s | 178 ms | 0 | 64% / 1.01 GB |

(p50/p99 are in the run output; p99 is within ~5% of p95 in every row.) Login at 200 real simultaneous logins: p50 1.7 s, p95 1.8 s, 0 errors. Above 200 the test mints tokens because one machine's logins only measure the platform's per-IP rate limiters; **login at 500+ was therefore not measured.** Database errors, pool timeouts and connection errors in the backend log: 0. Duplicate attempts: 0. Events stored: 7 per student (e.g. 14,000 for 2,000).

**Where it stops scaling.** Everything above is a single Node process on 2 vCPU, so latency grows roughly linearly with simultaneous load: a 2,000-student *simultaneous start* takes ~25 s at p95, which is workable for a staggered start but not for a click-together start. The decisive limit is the **code judge**: it runs two jobs at once, so grading a simultaneous final submit is throughput-bound — 200 finalize calls took p95 85 s (all graded after the retry fix), 500 took p95 182 s with 57 of 500 exhausting the ~2-minute retry window, 1,000 had 541 of 1,000 exhaust it. Those attempts stay IN_PROGRESS and are retryable (or auto-finalized by the scheduler); nothing is lost, but **a class of 500+ submitting in the same second needs more judge capacity**.

Before this test, a 200-student simultaneous finalize failed 117 submissions with HTTP 500 (judge queue full). That was fixed: grading now retries a busy queue with backoff (`gradeModuleCodingAttempt.js`), and the same 200-student run now grades all 200.

**Recommendations for exams of 500+:** stagger starts by room/batch; run the judge on dedicated workers or a larger instance (raise `JUDGE_CONCURRENCY` with CPU); consider moving final grading to a background queue (accept the submit immediately, grade asynchronously); put the API behind more than one container for 1,000+. Re-run `loadTestSecureExam.js` on the production sizing before an exam of that size.

## 5. Normal-student regression

* Typing: every letter, digit, symbol, Tab, Enter, Backspace and arrow key passes the classifier untouched (A/S/D explicitly); client intercepts only Ctrl/Cmd+C/V/X/…/Alt+F4 combinations. **VERIFIED (classifier)**; not typed on a real Electron window.
* Java / Python / C / C++ compile and run through the judge; MCQ/maths tests are not part of the coding engine and were not changed.
* Existing STANDARD exams: unchanged (default profile), verified by the existing suites.

## 6. Remaining limitations and BLOCKED items

1. The Electron client and the Windows kit were **not run on a Windows lab PC** (no hardware here): kiosk, request filtering, content protection, process scan, Assigned Access/AppLocker application, and the 35-item list's lab-side behaviours are IMPLEMENTED but **not verified**. Run a pilot on one PC with the attack list before a real exam.
2. Network allow-list (VLAN/proxy/DNS) designed and configs provided; not deployed here.
3. Second devices, cameras pointed at the screen, collusion: physical invigilation only.
4. Attestation is trustworthy on managed labs with standard-user students; forgeable by a local administrator on an unmanaged PC.
5. Randomised coding variants and per-attempt hidden data: NOT IMPLEMENTED.
6. Phone/object AI detection and continuous screen-share monitoring: NOT IMPLEMENTED.
7. The 3 other exam engines (formal MCQ/coding Test, Readiness, Mock Interview) keep their previous proctoring; LOCKDOWN/secure sessions are wired into the coding-attempt engine only (module coding tests, chapter Levels, JAVA Practice).
8. Heartbeat-loss AUTO_SUBMIT is evaluated by the 5-minute scheduler tick (granularity), while LOCK/PAUSE blocking is evaluated on every request.
9. Production now has `SECURE_BROWSER_SECRET` set (generated on the server; not stored in the repository).
