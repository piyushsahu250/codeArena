// Secure exam environment (LOCKDOWN): device registration, challenge/response handshake, scoped session tokens, heartbeat
// state and capability checks. See docs/SECURE_EXAM_ARCHITECTURE.md for the architecture and the guarantee matrix.
//
// Trust model, stated plainly:
//   * The SERVER is the authority. A secure-client session is a *claim backed by a device secret*; it is accepted only
//     for an institution-registered device, only for the student it was issued to, only for the attempt it is bound to,
//     and only while heartbeats keep arriving.
//   * Capabilities (kiosk, app restriction, ...) are ATTESTED BY THE CLIENT from real device state (registry/policy reads,
//     network probes). On an institution-managed lab where students are not local administrators that is strong evidence;
//     on an unmanaged PC a determined user could forge it. Enforcement itself is done by the OS/device policy and the
//     network, not by this file. Nothing here is a fake "AI detector".
const crypto = require("crypto");

// Client kinds. ELECTRON is the Windows secure client; ANDROID_MANAGED is the dedicated-device Android exam app (android-exam-client/). Each kind signs its
// own canonical capability list, so the Electron signature format is byte-for-byte what it always was.
const CLIENT_KINDS = ["ELECTRON", "ANDROID_MANAGED"];
const ELECTRON_CAPABILITIES = ["kiosk", "appRestriction", "browserRestriction", "networkRestriction", "clipboard", "fullscreen", "devtoolsDisabled", "screenCaptureProtection"];
// Android: every entry is read by the app from real device state (DevicePolicyManager / ActivityManager), never from a setting the student can change.
const ANDROID_CAPABILITIES = ["deviceOwner", "lockTask", "kiosk", "homeBlocked", "overviewBlocked", "globalActionsBlocked", "notificationsBlocked", "assistantUnavailable",
  "screenCaptureProtection", "appRestriction", "browserRestriction", "fullscreen", "devtoolsDisabled", "clipboard"];
const CAPABILITY_SETS = { ELECTRON: ELECTRON_CAPABILITIES, ANDROID_MANAGED: ANDROID_CAPABILITIES };
const CAPABILITIES = [...new Set([...ELECTRON_CAPABILITIES, ...ANDROID_CAPABILITIES])];
const CAPABILITY_LABELS = {
  kiosk: "Kiosk mode", appRestriction: "Application restriction", browserRestriction: "Browser restriction (no tabs, extensions or navigation)",
  networkRestriction: "Network restriction", clipboard: "Clipboard restriction", fullscreen: "Fullscreen", devtoolsDisabled: "Developer tools restricted",
  screenCaptureProtection: "Screen-capture protection",
  deviceOwner: "Institution-managed device (device owner)", lockTask: "Lock task mode active", homeBlocked: "Home button disabled", overviewBlocked: "Recent-apps screen disabled",
  globalActionsBlocked: "Power-button menu disabled", notificationsBlocked: "Notifications and status bar disabled", assistantUnavailable: "Assistant and search apps unavailable",
};
const EXIT_ACTIONS = ["WARNING", "PAUSE", "LOCK", "REQUIRE_INVIGILATOR", "AUTO_SUBMIT"];

const NONCE_TTL_MS = 2 * 60 * 1000;
const sessionTtlMs = () => Math.max(30, Number(process.env.SECURE_SESSION_TTL_MIN) || 240) * 60 * 1000;
const master = () => process.env.SECURE_BROWSER_SECRET || "";
const configured = () => master().length >= 16;
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest("hex");
const safeEqualHex = (a, b) => {
  try { const x = Buffer.from(String(a), "hex"), y = Buffer.from(String(b), "hex"); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); } catch { return false; }
};

// Per-device secret: HMAC(master, "device|<institute>|<deviceId>"). Never stored; shown once at registration. A device in
// institute A cannot sign for institute B because the institute id is part of the derivation.
function deriveDeviceSecret(instituteId, deviceId) {
  if (!configured()) return "";
  return hmac(master(), `device|${instituteId}|${deviceId}`);
}

// Stateless, student- and device-bound challenge: "<ts>.<rand>.<mac>". One-time use is enforced by nonceHash UNIQUE on the
// session row; the 2-minute TTL bounds the window.
function makeNonce(studentId, instituteId, deviceId) {
  const ts = Date.now(), rand = crypto.randomBytes(12).toString("hex");
  const mac = hmac(master() || "unset", `nonce|${studentId}|${instituteId}|${deviceId}|${ts}|${rand}`);
  return `${ts}.${rand}.${mac}`;
}
function verifyNonce(nonce, studentId, instituteId, deviceId) {
  if (!configured()) return false;
  const [ts, rand, mac] = String(nonce || "").split(".");
  if (!ts || !rand || !mac) return false;
  const age = Date.now() - Number(ts);
  if (!(age >= 0 && age <= NONCE_TTL_MS)) return false;
  return safeEqualHex(mac, hmac(master(), `nonce|${studentId}|${instituteId}|${deviceId}|${ts}|${rand}`));
}

// What the client signs: nonce + version + the exact capability set it reports, so a man-in-the-middle cannot upgrade the claims.
const canonicalCaps = (caps, kind = "ELECTRON") => JSON.stringify((CAPABILITY_SETS[kind] || ELECTRON_CAPABILITIES).map((k) => [k, !!(caps && caps[k])]));
function clientSignature(deviceSecret, { nonce, clientVersion, clientKind, capabilities }) {
  return hmac(deviceSecret, `session|${nonce}|${clientVersion}|${clientKind}|${canonicalCaps(capabilities, clientKind)}`);
}
function verifyClientSignature(deviceSecret, payload, sig) {
  if (!deviceSecret) return false;
  return safeEqualHex(sig, clientSignature(deviceSecret, payload));
}

const newToken = () => crypto.randomBytes(32).toString("base64url");

// semver-ish compare of "a.b.c"
function versionAtLeast(have, min) {
  const p = (v) => String(v || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const a = p(have), b = p(min);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return true;
}
const minClientVersion = () => process.env.SECURE_CLIENT_MIN_VERSION || "1.0.0";

// Connection state from heartbeat age. Never submits or punishes by itself; the policy decides what a LOST session means.
function connectionState(session, { heartbeatSec = 15, graceSec = 120 } = {}, now = Date.now()) {
  if (session.endedAt || session.state === "ENDED") return "ENDED";
  const age = (now - new Date(session.lastHeartbeatAt).getTime()) / 1000;
  if (age <= heartbeatSec * 3) return "CONNECTED";
  if (age <= graceSec) return "TEMPORARILY_DISCONNECTED";
  return "SECURITY_SESSION_LOST";
}

// Compare reported capabilities with the capabilities a policy requires. Returns the per-check list the exam page shows.
// The list shows the client kind's own capabilities PLUS anything the policy requires that this kind cannot attest (so a requirement a client kind has no way
// to meet always fails, never silently disappears).
function capabilityChecks(policy, capabilities, kind = "ELECTRON") {
  const required = new Set(policy.requiredCapabilities || []);
  const keys = [...new Set([...(CAPABILITY_SETS[kind] || ELECTRON_CAPABILITIES), ...required])];
  return keys.map((key) => ({ key, label: CAPABILITY_LABELS[key] || key, required: required.has(key), ok: !!(capabilities && capabilities[key]) && (CAPABILITY_SETS[kind] || ELECTRON_CAPABILITIES).includes(key) }));
}
const failedRequired = (checks) => checks.filter((c) => c.required && !c.ok);

module.exports = {
  CLIENT_KINDS, CAPABILITY_SETS, CAPABILITIES,CAPABILITY_LABELS, EXIT_ACTIONS, NONCE_TTL_MS, sessionTtlMs, configured, sha256,
  deriveDeviceSecret, makeNonce, verifyNonce, clientSignature, verifyClientSignature, newToken,
  versionAtLeast, minClientVersion, connectionState, capabilityChecks, failedRequired, canonicalCaps,
};
