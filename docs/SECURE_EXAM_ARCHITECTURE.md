# CodeArena Secure Exam Architecture (LOCKDOWN)

> **Audience: administrators and technical staff.** Students see only the "CodeArena Secure Exam" check screen.
> LOCKDOWN provides the strongest *supported* technical enforcement when used on **institution-managed devices and a configured
> exam network**. It does not claim that cheating is impossible; the residual risks are listed honestly in section 9.

## 1. Audit: where exam security was enforced before this change

### Current security flow (before)

```
Any browser (student's own laptop, extensions, other apps, any network)
   |  CodeArena web page: copy/paste/cut, right-click, F12 shortcuts, tab-visibility, fullscreen, refresh warning (JavaScript)
   v
API (JWT login) --> /module-coding/level/:id/start --> attempt row (server timer, attempt limit, hidden tests stay on server)
   |  evidence: ProctoringViolation / ExamSecurityEvent, risk band, staff review
   v
Judge (isolated container) --> result
```
Strengths already in place: server-authoritative timer, attempt limit, question authorization, hidden tests never sent, institute
isolation, one-active-tab control, evidence + risk + review. **Weakness (root cause):** the exam ran inside an *uncontrolled*
environment. Everything the page could do was detection; nothing controlled which other applications, extensions or websites the
student could use. Adding more listeners to the page cannot fix that, because the page does not own the machine.

### Target security flow (now)

```
Exam network (VLAN: DNS + proxy allow-list, firewall)           <-- only CodeArena is reachable
   ^
Managed Windows PC: dedicated "ExamStudent" account
   - Assigned Access kiosk  (that account can run ONLY the secure client)   [free, built in]
   - optional AppLocker allow-list / browser policy                          [Enterprise/Education; Edge policy is free]
   ^
CodeArena Secure Exam Client (Electron, kiosk)
   - one window, navigation + request allow-list, no tabs/extensions/devtools/downloads/print, clipboard cleared,
     excluded from screen capture, continuous attestation of REAL device state, heartbeat from the main process
   |  signed challenge/response with a per-device secret  -->  secure-session token (hash stored, bound to student+institute+device)
   v
CodeArena server (authority)
   - policy comes ONLY from the server (securityLevel on the test); nothing the browser sends can lower it
   - start and every exam call require a valid secure session bound to THIS attempt, alive heartbeat, required capabilities attested
   - lost heartbeat => state machine (CONNECTED / TEMPORARILY_DISCONNECTED / SECURITY_SESSION_LOST) + policy (warn / pause / lock / require invigilator / auto-submit)
   - events, risk, live monitor, unlock, audit
   v
Judge (unchanged: hidden tests and reference data never leave the server)
```

## 2. Profiles

| | STANDARD | PROCTORED | LOCKDOWN |
|---|---|---|---|
| Environment | normal browser | normal supported browser | **secure client on a registered device** |
| Clipboard / right-click / drag | blocked + logged | blocked + logged | blocked in the client (clipboard cleared continuously) |
| Fullscreen | per test | required | kiosk, enforced and attested |
| Tabs / windows | tab flagged | one tab (server) | none exist (single kiosk window) |
| Extensions | not controlled | not controlled | none (client has no extension support) |
| External sites / AI sites | not controlled | not controlled | client allow-list + exam network |
| Other applications | not controlled | not controlled | OS policy: Assigned Access / AppLocker |
| DevTools | shortcuts blocked | shortcuts blocked | disabled in the client |
| Screen capture | not controlled | monitoring evidence | window excluded from capture (Windows) + monitoring |
| Mobile | allowed | allowed | **refused by the server** |
| Camera / mic / AI proctoring | optional | optional | optional (same engine) |
| Server session / heartbeat | no | no | **required, continuous** |
| On lost connection | n/a | n/a | configurable: warn / pause / lock / invigilator / auto-submit |

The administrator picks the profile per assessment (Learning Management → level → Exam security). The server resolves the policy; the
client only displays it.

## 3. Choice of secure-client technology

| Option | Security control | Performance / size | Windows labs | Maintenance | Cost | Verdict |
|---|---|---|---|---|---|---|
| **Electron (chosen)** | Full main-process control: request filtering, `setContentProtection` (capture exclusion), kiosk, key interception, safe storage, process checks | ~150 MB install, moderate RAM | Mature installer (NSIS), code-signing, auto-update | Same JS stack and Chromium as the web app; large community | Free | **Best fit**: strongest control for the least new skill/infrastructure |
| Tauri | Good, smaller; uses the system WebView2; fewer request-filter and capture APIs | ~10 MB, light | Good | Rust toolchain needed | Free | Not chosen: smaller attack surface is attractive, but the team would own a Rust codebase and some required controls are less mature |
| CEF | Complete control | Heavy C++ build | Good | Highest (C++ build/upgrade burden) | Free | Not chosen: maintenance cost outweighs the benefit |
| Managed Chrome/Edge kiosk (policy only) | Strong *browser* restrictions through ADMX policy; no custom code | none | Excellent, nothing to install | Lowest | Free | **Supported as a lower tier** (PROCTORED lab): cannot attest anything to the server, so it cannot satisfy LOCKDOWN |
| Existing lockdown browser (Respondus, SEB) | Strong, proven | n/a | Good | Vendor | Licence | Optional if an institution already owns it; integration would need the same signed handshake |

Decision: **Electron secure client + Windows Assigned Access / AppLocker + isolated exam network**, with managed Edge kiosk as the zero-install fallback for PROCTORED.

## 4. Free / existing Windows capability vs optional enterprise capability

| Control | Free / existing | Optional enterprise |
|---|---|---|
| Only the exam app can run | **Assigned Access single-app kiosk** (Windows 10/11 Pro, Enterprise, Education) for a dedicated standard account | Intune/MDM-managed kiosk profiles, Windows Defender Application Control (WDAC) |
| Application allow-list | AppLocker rules (Enterprise/Education) or Software Restriction Policies; the kit's `AppLocker-ExamPolicy.xml` | WDAC, Intune policies, central reporting |
| Browser restriction | Edge/Chrome ADMX policy (`ExtensionInstallBlocklist=*`, `DeveloperToolsAvailability=2`, URL allow-list) via registry/Group Policy | Intune configuration profiles |
| Network allow-list | Isolated VLAN + Squid (proxy allow-list) + Unbound (DNS allow-list) on one small VM; the kit's configs | Next-gen firewall URL filtering, Cloudflare Gateway / Zscaler / Umbrella |
| Device registration | CodeArena "Secure exam devices" page (device id + one-time secret) | Intune asset inventory feeding the same ids |
| Screen-capture block | Client `setContentProtection` (Windows display affinity) | Group Policy + endpoint DLP |

You do **not** need expensive enterprise infrastructure: Assigned Access + the secure client + a small VM for the proxy/DNS gives the core guarantees.

## 5. How the secure session works

1. **Register the device** (admin): `POST /api/secure-exam/devices` → `deviceId` + a **one-time device secret**. The secret is *derived*
   (`HMAC(SECURE_BROWSER_SECRET, institute|deviceId)`), never stored; revoking the device row invalidates it. Institute A's device cannot sign for institute B.
2. **Student logs in inside the client** (normal CodeArena login). The client's main process reads the login token and runs the handshake:
   `challenge` (server nonce bound to student + institute + device, 2-minute life, one use) → `session` with
   `sig = HMAC(deviceSecret, nonce | version | kind | capabilities)`.
   The signature covers the capability claims, so they cannot be upgraded in transit; replays, expired nonces, wrong device secret, other student's
   nonce and version below the minimum are all refused and recorded (`DEVICE_MISMATCH`, `SESSION_TAMPERING`, `VERSION_MISMATCH`).
3. The server returns an **opaque token** (only its SHA-256 is stored), valid for a limited time and scoped to student + institute + device.
   At exam start the session is **bound to the attempt and test**.
4. **Every exam call** (autosave, run, submit, finalize, violation…) for a LOCKDOWN attempt must carry a valid secure session bound to that attempt,
   a live heartbeat and the required capabilities (`X-Secure-Session` header). Policy and requirements are re-evaluated by the server each time.
5. **Heartbeat** (every 15 s, sent by the client *main process* — page JavaScript cannot stop it) carries the current attestation and a small batch of client events
   (`KIOSK_EXIT`, `EXTERNAL_NAVIGATION`, `APPLICATION_POLICY_FAILURE`, `FOCUS_LOSS`, `DEVTOOLS_ATTEMPT`, `SCREEN_CAPTURE_ATTEMPT` …). Server-only evidence types cannot be forged by a client.

### Connection states and exit policy

`CONNECTED` (heartbeat within 45 s) → `TEMPORARILY_DISCONNECTED` (inside the grace period, default 120 s; the exam keeps working) →
`SECURITY_SESSION_LOST` (beyond grace). A short network blip, sleep or Wi-Fi drop therefore never punishes anyone. What a lost session means is the test's **exit action**:

| Exit action | Effect |
|---|---|
| WARNING | recorded only |
| PAUSE | exam calls blocked until the client reconnects; the next heartbeat restores it automatically |
| LOCK (default for LOCKDOWN) | blocked until an **invigilator unlocks** it; a fresh handshake cannot bypass the lock |
| REQUIRE_INVIGILATOR | like LOCK, flagged for the invigilator |
| AUTO_SUBMIT | the scheduler submits and grades the attempt after the grace period |

On reconnect the **same attempt** resumes: same attempt id, **same deadline (the timer is never reset)**, saved code restored, no duplicate attempt.

### Fail-safe and downgrade protection

* The policy is resolved on the server from the test; request bodies, headers or query parameters such as `securityMode=standard` or `proctored=false` are ignored.
* If the secure-exam service is not configured (`SECURE_BROWSER_SECRET` missing) a LOCKDOWN exam **cannot start** (HTTP 503) — it is never silently downgraded to a normal browser.
* The client is not the authority: the server owns attempt, timer, questions, scoring, attempt limit and results. A malicious client cannot change remaining time, marks or question authorization.

## 6. What the client enforces and attests

| Capability (attested) | How it is derived from real state |
|---|---|
| kiosk / fullscreen | `BrowserWindow.isKiosk()` / `isFullScreen()` on every heartbeat; leaving fullscreen is re-entered and reported |
| appRestriction | Windows: Application Identity service running **and** AppLocker `SrpV2\Exe` rules present, **or** Assigned Access configured (registry) |
| browserRestriction | by construction: one window, navigation + request allow-list, new windows/downloads/print/devtools denied, no extension support |
| networkRestriction | in-client request filter; with `networkAttest: "os"` also requires that canary hosts (google.com, chat.openai.com) are **unreachable** from the PC |
| clipboard | cleared every 500 ms; Ctrl/Cmd+C/V/X intercepted (only those combinations: letters alone are never touched) |
| devtoolsDisabled | `webPreferences.devTools=false`, shortcuts blocked, any open is closed and reported |
| screenCaptureProtection | `setContentProtection(true)` (Windows display affinity: the window is excluded from screenshots, recording and remote capture) |

Also: a process scan every 10 s reports `APPLICATION_POLICY_FAILURE` if a browser, terminal, editor or AI app is running (optionally kills it: `killBlockedProcesses`).
**Honest note on attestation:** on an institution-managed lab where students are standard users, these readings reflect the machine's actual configuration and the student cannot change it.
On an unmanaged PC, someone with administrator rights could forge them; that is why LOCKDOWN is specified for managed devices.

## 7. Lab setup guide (college computer lab)

1. **Plan**: one dedicated exam account (`ExamStudent`, standard user) and, ideally, an isolated exam VLAN (`secure-client/network/README.md`).
2. **Register each PC** in CodeArena → *Secure exam devices* → note the device id and secret (shown once).
3. **Install the client** (`secure-client`: `npm ci && npm run dist` → NSIS installer; install per machine to `C:\Program Files\CodeArena Secure Exam`).
4. **Provision**: run `secure-client/windows/Provision-ExamPC.ps1 -DeviceId ... -DeviceSecret ... -InvigilatorPinHash ... [-ApplyAssignedAccess] [-ApplyAppLocker]` (creates the protected config, the exam account, applies the kiosk and application policies, imports the browser policy).
5. **Configure the exam network**: join the lab ports to the exam VLAN; run the DNS and proxy allow-lists (`secure-client/network`).
6. **Run the device health check**: sign in as `ExamStudent`; open the exam page — every required row must show ✓ (the *Secure devices* page also shows each device's last heartbeat and attested capabilities).
7. **Pilot**: one PC, a real test, an invigilator trying the 35-item attack list (section 10). Fix gaps before the full lab.
8. **Exam day**: assign the assessment the LOCKDOWN profile, open the *Live exam monitor*, keep invigilators for the room (phones, notes and seating are institution policy).

## 8. Second devices and physical rules

No software on the exam computer can stop a phone, tablet, second laptop or smartwatch. LOCKDOWN therefore assumes the institution's **physical policy**: phones kept away, controlled seating,
an invigilator, optionally room or seat cameras. CodeArena shows students: "Physical device rules are set and enforced by your institution." Camera/microphone proctoring evidence (face missing, multiple faces) supports but does not replace invigilation.
Phone/object detection by AI is **not implemented**; the event types exist so a detector can be added.

## 9. Security guarantee matrix (internal)

| Control | Standard | Proctored | Lockdown |
|---|---|---|---|
| Browser extensions | Not controlled | Not controlled | **Enforced**: the client has no extension support; no other browser exists for the exam account |
| Desktop AI applications (Copilot, ChatGPT, Claude, Gemini apps) | No | No | **Managed-device policy** (Assigned Access / AppLocker); client reports any seen running |
| AI / external websites | No | No | **Network allow-list** (exam network) + client allow-list |
| Clipboard | Browser-level, bypassable | Browser-level | **Client-level**, cleared continuously |
| Developer tools | Shortcuts blocked | Shortcuts blocked | **Disabled** in the client |
| Other applications | No | No | **OS policy** |
| Second device | No | Camera evidence only | **Physical institution policy** (not enforceable by software) |
| Screen capture / recording (on the PC) | No | Monitoring | **Window excluded from capture** (Windows) + monitoring |
| External screen capture (camera pointed at the screen) | No | No | No (physical policy) |
| Timer / attempt limit / scoring / hidden tests | Server | Server | Server |
| Multiple sessions | Flagged | Blocked | Blocked (+ one secure session per attempt) |

Residual risks of LOCKDOWN even when configured correctly: a second device; a camera photographing the screen; collusion in the room; a lab PC where students are local administrators
(attestation could be forged); a compromised lab image. Mitigation: standard-user exam account, signed client builds, device revocation, invigilation, evidence review.

## 10. Test evidence

See `docs/SECURE_EXAM_TEST_REPORT.md` (written from the actual runs: backend end-to-end, secure-client unit tests, load results, and the 35-item attack list with exactly what was BLOCKED, RESTRICTED, ESCALATED, LOGGED, NOT TESTED or BLOCKED-by-environment).

## 11. Configuration reference

| Setting | Where | Notes |
|---|---|---|
| `SECURE_BROWSER_SECRET` | server environment (≥ 16 chars) | master secret for device secrets and challenges; if absent LOCKDOWN cannot start |
| `SECURE_SESSION_TTL_MIN` | server env, default 240 | maximum life of a secure session |
| `SECURE_CLIENT_MIN_VERSION` | server env, default 1.0.0 | older clients are refused (`VERSION_MISMATCH`) |
| `EXAM_SECURITY_RETENTION_DAYS` | server env, default 180 | evidence and session rows older than this are deleted (ESCALATED events kept) |
| Per test: level, exit action, grace seconds, allow phones, one tab | Learning Management → level settings | LOCKDOWN adds exit action and grace |

## 12. Privacy

Collected for a secure session: device id and label (institution-assigned), client version, the list of attested capabilities, heartbeat times, and security events (type, time, small details such as
a blocked host name or process name). **Not collected**: screen contents, keystrokes, clipboard contents, files, browsing history, personal data from the PC. Visible to the institution's admins/staff and platform admins;
retention as above.
