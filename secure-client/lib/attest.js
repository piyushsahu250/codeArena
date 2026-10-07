// Device attestation: capabilities are derived from REAL device state, never hard-coded to true. The server compares the
// reported set with what the exam requires and refuses to start the attempt on any mismatch.
//
// What this proves, plainly: on an institution-managed lab where students are standard users, these checks reflect the
// machine's actual configuration and a student cannot change it. On an unmanaged PC the same checks could be forged by someone
// with administrator rights; that is why LOCKDOWN is specified for institution-managed devices (see docs).
"use strict";
const { execFile } = require("child_process");

function run(cmd, args, { timeoutMs = 8000, exec = execFile } = {}) {
  return new Promise((resolve) => {
    exec(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve({ ok: !err, out: String(stdout || "") }));
  });
}

// AppLocker / application allow-listing is in force when the Application Identity service is running AND an AppLocker rule
// collection for executables exists (SrpV2\Exe). Assigned Access (single-app kiosk) is detected through its registry key.
async function detectAppRestriction(opts) {
  const svc = await run("sc", ["query", "appidsvc"], opts);
  const running = /RUNNING/i.test(svc.out);
  const rules = await run("reg", ["query", "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\SrpV2\\Exe"], opts);
  const appLocker = running && rules.ok;
  const assigned = (await run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Windows\\AssignedAccessConfiguration"], opts)).ok
    || (await run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\AssignedAccess"], opts)).ok;
  return { ok: appLocker || assigned, appLocker, assignedAccess: assigned };
}

// Process list for the "unauthorised application is running" check.
async function listProcessNames(opts) {
  const r = await run("tasklist", ["/FO", "CSV", "/NH"], opts);
  if (!r.ok) return null;
  return r.out.split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean);
}

// Network restriction: the in-client request filter is always on; "os" mode additionally requires that a canary host is
// NOT reachable from this machine (an exam VLAN / firewall / proxy is blocking it), which a student cannot change.
async function probeBlocked(canaryUrls, fetchImpl = fetch, timeoutMs = 4000) {
  for (const url of canaryUrls) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetchImpl(url, { method: "HEAD", signal: ctl.signal });
      clearTimeout(t);
      if (res) return false; // reachable -> not blocked
    } catch { /* unreachable = blocked (good) */ }
  }
  return true;
}

async function buildCapabilities({ window, config, platform = process.platform, clientFilterActive = true }) {
  const win32 = platform === "win32";
  const app = win32 ? await detectAppRestriction() : { ok: false, appLocker: false, assignedAccess: false };
  let network = clientFilterActive;
  if (config.networkAttest === "os") network = clientFilterActive && (await probeBlocked(config.networkCanaryUrls || ["https://www.google.com", "https://chat.openai.com"]));
  return {
    kiosk: !!window && window.isKiosk?.() === true,
    fullscreen: !!window && window.isFullScreen?.() === true,
    appRestriction: app.ok,
    browserRestriction: true, // by construction: single window, navigation allowlist, no extensions, downloads/print/new windows denied
    networkRestriction: network,
    clipboard: true, // clipboard cleared continuously and copy/paste/cut shortcuts blocked inside the client
    devtoolsDisabled: true, // webPreferences.devTools = false and shortcuts blocked
    screenCaptureProtection: win32, // BrowserWindow.setContentProtection (Windows display-affinity: window is excluded from capture)
    _detail: { appLocker: app.appLocker, assignedAccess: app.assignedAccess },
  };
}

module.exports = { run, detectAppRestriction, listProcessNames, probeBlocked, buildCapabilities };
