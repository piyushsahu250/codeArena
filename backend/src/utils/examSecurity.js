// Exam-security policy engine shared by every assessment that runs on the coding-attempt engine (module coding tests,
// chapter Levels, Java Practice). See docs/EXAM_SECURITY.md for the honest limits of each layer.
//
//   frontend protections  = detection and convenience (a student can modify the JavaScript)
//   this file + routes    = authority: policy resolution, session control, evidence, risk, secure-browser check
//   managed browser/kiosk = the only real enforcement of extensions, other apps, OS screenshots, networks
//
// Nothing here claims to detect Copilot, ChatGPT or any extension. It records what a web page can actually observe
// (large code insertions that did not come from typing, focus/visibility loss, fullscreen exits, a second session ...)
// and turns that into reviewable evidence with a LOW/MEDIUM/HIGH/CRITICAL risk band -- never an automatic punishment.
const crypto = require("crypto");

// Level presets. STANDARD deliberately equals what the platform already did, so existing assessments are unchanged.
const PRESETS = {
  STANDARD: {
    blockCopy: true, blockPaste: true, blockCut: true, blockContextMenu: true, blockDrag: true,
    requireFullscreen: null, // null = follow the test's own requireFullscreen column
    multiSession: "FLAG", // FLAG | BLOCK
    mobileAllowed: true, secureBrowserRequired: false, requiredCapabilities: [], exitAction: "WARNING", graceSec: 120,
    insertionCharThreshold: 400, insertionLineThreshold: 25,
  },
  PROCTORED: {
    blockCopy: true, blockPaste: true, blockCut: true, blockContextMenu: true, blockDrag: true,
    requireFullscreen: true, multiSession: "BLOCK", mobileAllowed: true, secureBrowserRequired: false, requiredCapabilities: [], exitAction: "WARNING", graceSec: 120,
    insertionCharThreshold: 250, insertionLineThreshold: 15,
  },
  // LOCKDOWN = a controlled execution environment. The attempt can only start, and only continue, inside an authenticated
  // secure-client session on an institution-registered device that attests the capabilities below (utils/secureExam.js).
  // The policy always comes from the server; nothing the browser sends can lower it.
  LOCKDOWN: {
    blockCopy: true, blockPaste: true, blockCut: true, blockContextMenu: true, blockDrag: true,
    requireFullscreen: true, multiSession: "BLOCK", mobileAllowed: false, secureBrowserRequired: true,
    requiredCapabilities: ["kiosk", "appRestriction", "browserRestriction", "networkRestriction", "clipboard", "fullscreen", "devtoolsDisabled"],
    exitAction: "LOCK", graceSec: 120,
    insertionCharThreshold: 150, insertionLineThreshold: 10,
  },
};
const LEVELS = Object.keys(PRESETS);
const BOOLEAN_KEYS = ["blockCopy", "blockPaste", "blockCut", "blockContextMenu", "blockDrag", "requireFullscreen", "mobileAllowed", "secureBrowserRequired"];
const NUMBER_KEYS = ["insertionCharThreshold", "insertionLineThreshold"];
const SecureExamCaps = require("./secureExam");
const sanitizeCaps = (arr) => (Array.isArray(arr) ? arr.filter((k, i) => SecureExamCaps.CAPABILITIES.includes(k) && arr.indexOf(k) === i) : null);

function resolvePolicy(test) {
  const level = LEVELS.includes(test?.securityLevel) ? test.securityLevel : "STANDARD";
  const base = { ...PRESETS[level] };
  const o = test?.securityPolicy && typeof test.securityPolicy === "object" ? test.securityPolicy : {};
  for (const k of BOOLEAN_KEYS) if (typeof o[k] === "boolean") base[k] = o[k];
  for (const k of NUMBER_KEYS) if (Number.isFinite(o[k]) && o[k] > 0) base[k] = Math.min(100000, Math.floor(o[k]));
  if (["FLAG", "BLOCK"].includes(o.multiSession)) base.multiSession = o.multiSession;
  const caps = sanitizeCaps(o.requiredCapabilities);
  if (caps) base.requiredCapabilities = caps;
  if (SecureExamCaps.EXIT_ACTIONS.includes(o.exitAction)) base.exitAction = o.exitAction;
  if (Number.isFinite(o.graceSec)) base.graceSec = Math.min(900, Math.max(30, Math.floor(o.graceSec)));
  if (base.requireFullscreen === null) base.requireFullscreen = test?.requireFullscreen !== false;
  return { level, ...base };
}

// Admin input -> the only shape we persist (unknown keys dropped, types checked).
function sanitizePolicyOverrides(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const k of BOOLEAN_KEYS) if (typeof input[k] === "boolean") out[k] = input[k];
  for (const k of NUMBER_KEYS) if (Number.isFinite(Number(input[k])) && Number(input[k]) > 0) out[k] = Math.min(100000, Math.floor(Number(input[k])));
  if (["FLAG", "BLOCK"].includes(input.multiSession)) out.multiSession = input.multiSession;
  const caps = sanitizeCaps(input.requiredCapabilities);
  if (caps) out.requiredCapabilities = caps;
  if (SecureExamCaps.EXIT_ACTIONS.includes(input.exitAction)) out.exitAction = input.exitAction;
  if (Number.isFinite(Number(input.graceSec))) out.graceSec = Math.min(900, Math.max(30, Math.floor(Number(input.graceSec))));
  return out;
}

// Event catalogue. The reporting client sends only `type` and small metadata; the SERVER decides the severity.
const EVENT_SEVERITY = {
  PAGE_HIDDEN: "LOW", NETWORK_DISCONNECT: "LOW", NETWORK_RECONNECT: "LOW", UNUSUAL_ACTIVITY: "LOW",
  CLIPBOARD_ATTEMPT: "MEDIUM", COPY_ATTEMPT: "MEDIUM", PASTE_ATTEMPT: "MEDIUM", EXTERNAL_NAVIGATION_ATTEMPT: "MEDIUM",
  SUSPICIOUS_CODE_INSERTION: "MEDIUM", MULTIPLE_SESSION: "HIGH", SCREEN_SHARE_STOPPED: "MEDIUM",
  SECURE_BROWSER_MISSING: "HIGH", SESSION_REPLACED: "MEDIUM",
  // Secure-client (LOCKDOWN) events, reported by the client main process over its authenticated session or raised by the server.
  SECURE_CLIENT_STARTED: "LOW", SECURE_CLIENT_STOPPED: "HIGH", KIOSK_EXIT: "HIGH", APPLICATION_POLICY_FAILURE: "HIGH", BROWSER_POLICY_FAILURE: "HIGH",
  NETWORK_POLICY_FAILURE: "HIGH", EXTERNAL_NAVIGATION: "MEDIUM", TAB_ATTEMPT: "MEDIUM", WINDOW_ATTEMPT: "MEDIUM", DEVTOOLS_ATTEMPT: "MEDIUM",
  SCREEN_CAPTURE_ATTEMPT: "MEDIUM", FOCUS_LOSS: "LOW", CAMERA_FAILURE: "MEDIUM", MIC_FAILURE: "MEDIUM", SCREEN_SHARE_FAILURE: "MEDIUM",
  HEARTBEAT_LOST: "MEDIUM", HEARTBEAT_RESTORED: "LOW", SESSION_TAMPERING: "CRITICAL", DEVICE_MISMATCH: "CRITICAL", VERSION_MISMATCH: "HIGH",
  MULTIPLE_PERSON: "HIGH", PHONE_DETECTED: "HIGH", FACE_MISSING: "MEDIUM", EXAM_LOCKED: "HIGH", EXAM_UNLOCKED: "LOW",
};
const CLIENT_REPORTABLE = new Set(["PAGE_HIDDEN", "NETWORK_DISCONNECT", "NETWORK_RECONNECT", "UNUSUAL_ACTIVITY", "SUSPICIOUS_CODE_INSERTION", "EXTERNAL_NAVIGATION_ATTEMPT", "SCREEN_SHARE_STOPPED", "FOCUS_LOSS", "CAMERA_FAILURE", "MIC_FAILURE", "SCREEN_SHARE_FAILURE", "MULTIPLE_PERSON", "PHONE_DETECTED", "FACE_MISSING"]);
// Reportable ONLY by an authenticated secure-client session (never from a plain browser page).
const SECURE_CLIENT_REPORTABLE = new Set(["CLIPBOARD_ATTEMPT", "SECURE_CLIENT_STARTED", "SECURE_CLIENT_STOPPED", "KIOSK_EXIT", "APPLICATION_POLICY_FAILURE", "BROWSER_POLICY_FAILURE", "NETWORK_POLICY_FAILURE", "EXTERNAL_NAVIGATION", "TAB_ATTEMPT", "WINDOW_ATTEMPT", "DEVTOOLS_ATTEMPT", "SCREEN_CAPTURE_ATTEMPT", "FOCUS_LOSS", "CAMERA_FAILURE", "MIC_FAILURE", "SCREEN_SHARE_FAILURE"]);
// Server-originated only (a client must not be able to forge evidence of a different kind).
const SERVER_ONLY = new Set(["MULTIPLE_SESSION", "SECURE_BROWSER_MISSING", "SESSION_REPLACED", "CLIPBOARD_ATTEMPT", "COPY_ATTEMPT", "PASTE_ATTEMPT"]);

// Bounded metadata: never store arbitrary client blobs (privacy + storage control).
function cleanMetadata(meta) {
  if (!meta || typeof meta !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(meta).slice(0, 12)) {
    if (typeof v === "number" && Number.isFinite(v)) out[String(k).slice(0, 30)] = v;
    else if (typeof v === "boolean") out[String(k).slice(0, 30)] = v;
    else if (typeof v === "string") out[String(k).slice(0, 30)] = v.slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

// --- risk score ---------------------------------------------------------------------------------------------
// Weighted from the evidence on one attempt. The bands are guidance for a human reviewer, not a verdict; a row a
// reviewer marked LEGITIMATE no longer counts. Classic proctoring strikes (tab switch, fullscreen exit ...) come from
// the existing ProctoringViolation table and are passed in as { type, penalized, severity }.
const WEIGHTS = {
  PAGE_HIDDEN: 1, NETWORK_DISCONNECT: 0, NETWORK_RECONNECT: 0, UNUSUAL_ACTIVITY: 2, EXTERNAL_NAVIGATION_ATTEMPT: 4,
  CLIPBOARD_ATTEMPT: 3, COPY_ATTEMPT: 3, PASTE_ATTEMPT: 3, SUSPICIOUS_CODE_INSERTION: 6, MULTIPLE_SESSION: 10, SESSION_REPLACED: 4,
  SCREEN_SHARE_STOPPED: 5, SECURE_BROWSER_MISSING: 10,
  SECURE_CLIENT_STARTED: 0, SECURE_CLIENT_STOPPED: 8, KIOSK_EXIT: 8, APPLICATION_POLICY_FAILURE: 8, BROWSER_POLICY_FAILURE: 8, NETWORK_POLICY_FAILURE: 6,
  EXTERNAL_NAVIGATION: 4, TAB_ATTEMPT: 3, WINDOW_ATTEMPT: 3, DEVTOOLS_ATTEMPT: 4, SCREEN_CAPTURE_ATTEMPT: 5, FOCUS_LOSS: 1, CAMERA_FAILURE: 4, MIC_FAILURE: 3,
  SCREEN_SHARE_FAILURE: 4, HEARTBEAT_LOST: 4, HEARTBEAT_RESTORED: 0, SESSION_TAMPERING: 20, DEVICE_MISMATCH: 20, VERSION_MISMATCH: 8,
  MULTIPLE_PERSON: 8, PHONE_DETECTED: 10, FACE_MISSING: 3, EXAM_LOCKED: 0, EXAM_UNLOCKED: 0,
  TAB_SWITCH: 6, TAB_SWITCH_BRIEF: 1, FULLSCREEN_EXIT: 5, CAMERA_DROPPED: 5, MIC_DROPPED: 4, DEVTOOLS: 4, COPY: 2, PASTE: 3, CUT: 2,
  RIGHT_CLICK: 1, DRAG_ATTEMPT: 2, PRINT_SCREEN_ATTEMPT: 3, MULTI_MONITOR: 4, REFRESH_ATTEMPT: 1, BROWSER_SHORTCUT: 1,
};
function riskLevel(score) {
  if (score >= 30) return "CRITICAL";
  if (score >= 16) return "HIGH";
  if (score >= 6) return "MEDIUM";
  return "LOW";
}
function computeRisk(events) {
  let score = 0;
  const byType = {};
  for (const e of events) {
    if (e.reviewStatus === "LEGITIMATE") continue;
    const w = WEIGHTS[e.type] ?? 1;
    // a repeat of the same type counts with diminishing weight so one noisy signal cannot dominate
    const n = (byType[e.type] = (byType[e.type] || 0) + 1);
    score += n <= 3 ? w : Math.max(1, Math.round(w / 2));
  }
  return { score, level: riskLevel(score), byType };
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;
const isMobileUserAgent = (ua) => MOBILE_UA.test(String(ua || ""));

// Subset the browser needs to apply the policy (nothing secret).
function clientPolicy(policy) {
  return {
    level: policy.level, blockCopy: policy.blockCopy, blockPaste: policy.blockPaste, blockCut: policy.blockCut,
    blockContextMenu: policy.blockContextMenu, blockDrag: policy.blockDrag, requireFullscreen: policy.requireFullscreen,
    multiSession: policy.multiSession, mobileAllowed: policy.mobileAllowed, secureBrowserRequired: policy.secureBrowserRequired,
    requiredCapabilities: policy.requiredCapabilities, exitAction: policy.exitAction, graceSec: policy.graceSec,
    insertionCharThreshold: policy.insertionCharThreshold, insertionLineThreshold: policy.insertionLineThreshold,
  };
}

module.exports = {
  PRESETS, LEVELS, resolvePolicy, sanitizePolicyOverrides, clientPolicy,
  EVENT_SEVERITY, CLIENT_REPORTABLE, SECURE_CLIENT_REPORTABLE, SERVER_ONLY, cleanMetadata,
  WEIGHTS, riskLevel, computeRisk,
  isMobileUserAgent,
};
