// CodeArena Secure Exam Client -- Electron main process.
//
// Role: a controlled execution environment for LOCKDOWN exams. One kiosk window that can only show CodeArena; no tabs, no
// extensions, no devtools, no downloads, no printing, no copy/paste, excluded from screen capture, a navigation + request
// allowlist, continuous attestation of the device's real security state, and an authenticated heartbeat to the server that
// runs in THIS process (page JavaScript cannot silence it).
//
// It is not the authority: the CodeArena server decides whether an attempt may start or continue (see
// backend/src/routes/secureExam.js). Application allow-listing and network restriction are enforced by the OS/exam network
// (Assigned Access / AppLocker, firewall or proxy); this client attests to and reports on them.
"use strict";
const { app, BrowserWindow, session, clipboard, dialog, globalShortcut, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { establishSession } = require("./lib/handshake");
const { isAllowedUrl, findBlockedProcesses, DEFAULT_BLOCKED_PROCESSES } = require("./lib/allowlist");
const { buildCapabilities, listProcessNames } = require("./lib/attest");

const CLIENT_VERSION = require("./package.json").version;
const CONFIG_PATH = process.env.CODEARENA_SECURE_CONFIG || path.join(process.env.ProgramData || "C:\\ProgramData", "CodeArenaSecureExam", "config.json");

function loadConfig() {
  const c = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  for (const k of ["appUrl", "apiUrl", "deviceId", "deviceSecret"]) if (!c[k]) throw new Error(`config.json is missing "${k}"`);
  c.allowedHosts = c.allowedHosts && c.allowedHosts.length ? c.allowedHosts : [new URL(c.appUrl).hostname, new URL(c.apiUrl).hostname];
  c.heartbeatSec = c.heartbeatSec || 15;
  c.networkAttest = c.networkAttest || "client"; // "client" | "os"
  c.blockedProcesses = c.blockedProcesses || DEFAULT_BLOCKED_PROCESSES;
  c.killBlockedProcesses = !!c.killBlockedProcesses;
  return c;
}

let config, win;
let secure = { token: null, heartbeatTimer: null, studentToken: null };
let pendingEvents = [];
let quitting = false;
const queueEvent = (type, metadata) => { if (pendingEvents.length < 40) pendingEvents.push({ type, metadata }); };

function verifyInvigilatorPin(pin) {
  if (!config.invigilatorPinHash) return false; // no PIN configured -> nobody can quit from the UI (power-off / policy only)
  const [salt, hash] = String(config.invigilatorPinHash).split(":");
  const test = crypto.scryptSync(String(pin), Buffer.from(salt, "hex"), 32).toString("hex");
  return test.length === hash.length && crypto.timingSafeEqual(Buffer.from(test), Buffer.from(hash));
}

function lockDownSession() {
  const ses = session.defaultSession;
  // Network layer inside the client: only allowlisted hosts. (The exam network blocks everything else at the firewall.)
  ses.webRequest.onBeforeRequest((details, cb) => {
    const ok = isAllowedUrl(details.url, config.allowedHosts);
    if (!ok) queueEvent("EXTERNAL_NAVIGATION", { host: (() => { try { return new URL(details.url).hostname; } catch { return "?"; } })() });
    cb({ cancel: !ok });
  });
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    // only what a proctored exam needs, and only for the CodeArena origin
    const allowed = ["media", "fullscreen"].includes(permission) && isAllowedUrl(wc.getURL(), config.allowedHosts);
    cb(allowed);
  });
  ses.on("will-download", (e) => { e.preventDefault(); queueEvent("EXTERNAL_NAVIGATION", { reason: "download blocked" }); });
}

function createWindow() {
  win = new BrowserWindow({
    kiosk: true, fullscreen: true, frame: false, alwaysOnTop: true, autoHideMenuBar: true, show: false, backgroundColor: "#ffffff",
    webPreferences: { devTools: false, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, preload: path.join(__dirname, "preload.js") },
  });
  win.removeMenu();
  if (process.platform === "win32") win.setContentProtection(true); // excluded from screenshots / screen recording / remote capture
  win.setAlwaysOnTop(true, "screen-saver");
  win.once("ready-to-show", () => win.show());

  const wc = win.webContents;
  wc.setWindowOpenHandler(() => { queueEvent("WINDOW_ATTEMPT"); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => { if (!isAllowedUrl(url, config.allowedHosts)) { e.preventDefault(); queueEvent("EXTERNAL_NAVIGATION", { host: (() => { try { return new URL(url).hostname; } catch { return "?"; } })() }); } });
  wc.on("devtools-opened", () => { wc.closeDevTools(); queueEvent("DEVTOOLS_ATTEMPT"); });
  wc.on("context-menu", (e) => e.preventDefault());

  // Keyboard: only these explicit combinations are intercepted (the same rule as the web app: letters alone are never touched).
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta, key = String(input.key || "");
    const block = key === "F12" || key === "F11" || key === "F5" || (ctrl && input.shift && ["I", "J", "C", "T"].includes(key.toUpperCase()))
      || (ctrl && ["U", "S", "P", "W", "N", "T", "R", "L", "O"].includes(key.toUpperCase())) || (input.alt && ["F4", "ArrowLeft", "ArrowRight", "Home"].includes(key))
      || (ctrl && ["C", "V", "X"].includes(key.toUpperCase()) && !(ctrl && input.shift));
    if (block) {
      event.preventDefault();
      if (key === "F12" || (ctrl && input.shift)) queueEvent("DEVTOOLS_ATTEMPT");
      else if (["C", "V", "X"].includes(key.toUpperCase())) queueEvent("CLIPBOARD_ATTEMPT");
      else if (ctrl && ["T", "N"].includes(key.toUpperCase())) queueEvent(key.toUpperCase() === "T" ? "TAB_ATTEMPT" : "WINDOW_ATTEMPT");
    }
    if (key === "PrintScreen") queueEvent("SCREEN_CAPTURE_ATTEMPT");
  });

  win.on("leave-full-screen", () => { if (!quitting) { queueEvent("KIOSK_EXIT", { how: "leave-full-screen" }); win.setFullScreen(true); win.setKiosk(true); } });
  win.on("blur", () => { if (!quitting) { queueEvent("FOCUS_LOSS"); setTimeout(() => { if (win && !win.isDestroyed()) win.focus(); }, 50); } });
  win.on("minimize", (e) => { e.preventDefault(); queueEvent("WINDOW_ATTEMPT", { how: "minimize" }); win.restore(); });
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); queueEvent("KIOSK_EXIT", { how: "close-attempt" }); } });

  // After each page load, hand the page its secure-session token so API calls carry X-Secure-Session.
  wc.on("did-finish-load", () => injectSessionToken());
  win.loadURL(config.appUrl);
}

function injectSessionToken() {
  if (!win || win.isDestroyed()) return;
  const code = secure.token ? `try{sessionStorage.setItem("ca_secure_session",${JSON.stringify(secure.token)})}catch(e){}` : `try{sessionStorage.removeItem("ca_secure_session")}catch(e){}`;
  win.webContents.executeJavaScript(code).catch(() => {});
}

// The student logs in inside the client (the normal CodeArena login page). The main process reads the resulting bearer token,
// performs the signed challenge/response handshake and then keeps the session alive.
async function maybeEstablish() {
  if (secure.token || !win || win.isDestroyed()) return;
  let student;
  try { student = await win.webContents.executeJavaScript(`localStorage.getItem("token")`); } catch { return; }
  if (!student) return;
  try {
    const capabilities = await buildCapabilities({ window: win, config });
    const { _detail, ...caps } = capabilities;
    const res = await establishSession({ apiUrl: config.apiUrl, studentToken: student, deviceId: config.deviceId, deviceSecret: config.deviceSecret, clientVersion: CLIENT_VERSION, capabilities: caps });
    secure.token = res.token; secure.studentToken = student;
    injectSessionToken();
    startHeartbeat(res.heartbeatSec || config.heartbeatSec);
    win.webContents.send("secure:status", { ok: true });
  } catch (e) {
    win.webContents.send("secure:status", { ok: false, code: e.code || "ERROR", message: e.message });
  }
}

function startHeartbeat(sec) {
  clearInterval(secure.heartbeatTimer);
  secure.heartbeatTimer = setInterval(async () => {
    try {
      const { _detail, ...caps } = await buildCapabilities({ window: win, config });
      const names = await listProcessNames();
      if (names) {
        const bad = findBlockedProcesses(names, config.blockedProcesses, path.basename(process.execPath));
        if (bad.length) queueEvent("APPLICATION_POLICY_FAILURE", { processes: bad.slice(0, 5).join(",") });
      }
      const events = pendingEvents.splice(0, 20);
      const res = await fetch(`${config.apiUrl}/secure-exam/heartbeat`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secure.studentToken}`, "X-Secure-Session": secure.token },
        body: JSON.stringify({ capabilities: caps, events }),
      });
      if (!res.ok) { pendingEvents.unshift(...events); const b = await res.json().catch(() => ({})); win?.webContents.send("secure:status", { ok: false, code: b.code, message: b.error }); if (res.status === 403) { secure.token = null; injectSessionToken(); } }
    } catch { /* offline: the server notices missing heartbeats; events stay queued */ }
  }, sec * 1000);
}

// Clipboard hygiene: nothing copied before or during the exam can be pasted into it.
function startClipboardGuard() { setInterval(() => { try { clipboard.clear(); } catch { /* ignore */ } }, 500); }

// Optional enforcement-in-client for blocked processes (off by default; AppLocker/Assigned Access are the real control).
async function maybeKillBlocked() {
  if (!config.killBlockedProcesses) return;
  const names = await listProcessNames(); if (!names) return;
  for (const p of findBlockedProcesses(names, config.blockedProcesses, path.basename(process.execPath))) require("child_process").execFile("taskkill", ["/F", "/IM", p], { windowsHide: true }, () => {});
}

ipcMain.handle("secure:invigilator-exit", async (_e, pin) => {
  if (!verifyInvigilatorPin(pin)) { queueEvent("SECURE_CLIENT_STOPPED", { attempt: "bad-pin" }); return false; }
  quitting = true;
  try { await fetch(`${config.apiUrl}/secure-exam/end`, { method: "POST", headers: { Authorization: `Bearer ${secure.studentToken}`, "X-Secure-Session": secure.token } }); } catch { /* ignore */ }
  app.quit();
  return true;
});

if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(() => {
  try { config = loadConfig(); } catch (e) { dialog.showErrorBox("CodeArena Secure Exam", `Configuration error: ${e.message}`); app.quit(); return; }
  lockDownSession();
  createWindow();
  startClipboardGuard();
  setInterval(maybeEstablish, 3000);
  setInterval(maybeKillBlocked, 10000);
  // Reserved shortcuts removed so nothing opens a second window (Alt+Tab / Win key are OS-level: Assigned Access handles those).
  globalShortcut.registerAll(["CommandOrControl+Shift+I", "F12", "Alt+F4"], () => queueEvent("DEVTOOLS_ATTEMPT"));
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => { if (quitting) app.quit(); });
