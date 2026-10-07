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
    mobileAllowed: true, secureBrowserRequired: false,
    insertionCharThreshold: 400, insertionLineThreshold: 25,
  },
  PROCTORED: {
    blockCopy: true, blockPaste: true, blockCut: true, blockContextMenu: true, blockDrag: true,
    requireFullscreen: true, multiSession: "BLOCK", mobileAllowed: true, secureBrowserRequired: false,
    insertionCharThreshold: 250, insertionLineThreshold: 15,
  },
  LOCKDOWN: {
    blockCopy: true, blockPaste: true, blockCut: true, blockContextMenu: true, blockDrag: true,
    requireFullscreen: true, multiSession: "BLOCK", mobileAllowed: false, secureBrowserRequired: true,
    insertionCharThreshold: 150, insertionLineThreshold: 10,
  },
};
const LEVELS = Object.keys(PRESETS);
const BOOLEAN_KEYS = ["blockCopy", "blockPaste", "blockCut", "blockContextMenu", "blockDrag", "requireFullscreen", "mobileAllowed", "secureBrowserRequired"];
const NUMBER_KEYS = ["insertionCharThreshold", "insertionLineThreshold"];

function resolvePolicy(test) {
  const level = LEVELS.includes(test?.securityLevel) ? test.securityLevel : "STANDARD";
  const base = { ...PRESETS[level] };
  const o = test?.securityPolicy && typeof test.securityPolicy === "object" ? test.securityPolicy : {};
  for (const k of BOOLEAN_KEYS) if (typeof o[k] === "boolean") base[k] = o[k];
  for (const k of NUMBER_KEYS) if (Number.isFinite(o[k]) && o[k] > 0) base[k] = Math.min(100000, Math.floor(o[k]));
  if (["FLAG", "BLOCK"].includes(o.multiSession)) base.multiSession = o.multiSession;
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
  return out;
}

// Event catalogue. The reporting client sends only `type` and small metadata; the SERVER decides the severity.
const EVENT_SEVERITY = {
  PAGE_HIDDEN: "LOW", NETWORK_DISCONNECT: "LOW", NETWORK_RECONNECT: "LOW", UNUSUAL_ACTIVITY: "LOW",
  CLIPBOARD_ATTEMPT: "MEDIUM", COPY_ATTEMPT: "MEDIUM", PASTE_ATTEMPT: "MEDIUM", EXTERNAL_NAVIGATION_ATTEMPT: "MEDIUM",
  SUSPICIOUS_CODE_INSERTION: "MEDIUM", MULTIPLE_SESSION: "HIGH", SCREEN_SHARE_STOPPED: "MEDIUM",
  SECURE_BROWSER_MISSING: "HIGH", SESSION_REPLACED: "MEDIUM",
};
const CLIENT_REPORTABLE = new Set(["PAGE_HIDDEN", "NETWORK_DISCONNECT", "NETWORK_RECONNECT", "UNUSUAL_ACTIVITY", "SUSPICIOUS_CODE_INSERTION", "EXTERNAL_NAVIGATION_ATTEMPT", "SCREEN_SHARE_STOPPED"]);
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

// --- secure browser / managed-device handshake ----------------------------------------------------------------
// A managed/kiosk client (or an institution's launcher) proves itself by HMAC-signing a nonce with a secret that is
// provisioned out of band (env SECURE_BROWSER_SECRET). The server verifies the signature and issues a short-lived
// token bound to the student. User-Agent, localStorage and query strings are never trusted for this.
const SECURE_TTL_MS = 6 * 60 * 60 * 1000;
function secureSecret() { return process.env.SECURE_BROWSER_SECRET || ""; }
function signHandshake(deviceId, ts) { return crypto.createHmac("sha256", secureSecret()).update(`${deviceId}.${ts}`).digest("hex"); }
function verifyHandshake({ deviceId, ts, sig }) {
  const secret = secureSecret();
  if (!secret || !deviceId || !ts || !sig) return false;
  const age = Math.abs(Date.now() - Number(ts));
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) return false; // replay window
  const expected = Buffer.from(signHandshake(String(deviceId), String(ts)), "hex");
  let given; try { given = Buffer.from(String(sig), "hex"); } catch { return false; }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
function issueSecureToken(studentId) {
  const exp = Date.now() + SECURE_TTL_MS;
  const body = `${studentId}.${exp}`;
  const mac = crypto.createHmac("sha256", secureSecret() || "unset").update(body).digest("hex");
  return Buffer.from(`${body}.${mac}`).toString("base64url");
}
function verifySecureToken(token, studentId) {
  if (!secureSecret() || !token) return false;
  let raw; try { raw = Buffer.from(String(token), "base64url").toString(); } catch { return false; }
  const [sid, exp, mac] = raw.split(".");
  if (!sid || !exp || !mac || sid !== studentId || Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac("sha256", secureSecret()).update(`${sid}.${exp}`).digest("hex");
  return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;
const isMobileUserAgent = (ua) => MOBILE_UA.test(String(ua || ""));

// Subset the browser needs to apply the policy (nothing secret).
function clientPolicy(policy) {
  return {
    level: policy.level, blockCopy: policy.blockCopy, blockPaste: policy.blockPaste, blockCut: policy.blockCut,
    blockContextMenu: policy.blockContextMenu, blockDrag: policy.blockDrag, requireFullscreen: policy.requireFullscreen,
    multiSession: policy.multiSession, mobileAllowed: policy.mobileAllowed, secureBrowserRequired: policy.secureBrowserRequired,
    insertionCharThreshold: policy.insertionCharThreshold, insertionLineThreshold: policy.insertionLineThreshold,
  };
}

module.exports = {
  PRESETS, LEVELS, resolvePolicy, sanitizePolicyOverrides, clientPolicy,
  EVENT_SEVERITY, CLIENT_REPORTABLE, SERVER_ONLY, cleanMetadata,
  WEIGHTS, riskLevel, computeRisk,
  verifyHandshake, signHandshake, issueSecureToken, verifySecureToken, isMobileUserAgent,
};
