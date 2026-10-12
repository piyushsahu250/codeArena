const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const S = require("../src/utils/secureExam");
const X = require("../src/utils/examSecurity");

const SECRET = "device-secret-for-tests";
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest("hex");

test("the Electron signature format is unchanged: eight capabilities in the original order", () => {
  const caps = { kiosk: true, appRestriction: true, browserRestriction: true, networkRestriction: true, clipboard: true, fullscreen: true, devtoolsDisabled: true, screenCaptureProtection: false, deviceOwner: true };
  const legacy = JSON.stringify(["kiosk", "appRestriction", "browserRestriction", "networkRestriction", "clipboard", "fullscreen", "devtoolsDisabled", "screenCaptureProtection"].map((k) => [k, !!caps[k]]));
  const expected = hmac(SECRET, `session|n1|1.0.0|ELECTRON|${legacy}`);
  assert.equal(S.clientSignature(SECRET, { nonce: "n1", clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: caps }), expected, "an Android-only key must not change what a desktop client signs");
});

test("an Android signature covers the Android capability list and cannot be replayed as an Electron one", () => {
  const caps = { deviceOwner: true, lockTask: true, kiosk: true, homeBlocked: true, overviewBlocked: true, globalActionsBlocked: true, notificationsBlocked: true, assistantUnavailable: true };
  const payload = { nonce: "n2", clientVersion: "1.0.0", clientKind: "ANDROID_MANAGED", capabilities: caps };
  const sig = S.clientSignature(SECRET, payload);
  assert.ok(S.verifyClientSignature(SECRET, payload, sig));
  assert.ok(!S.verifyClientSignature(SECRET, { ...payload, clientKind: "ELECTRON" }, sig), "the kind is part of what is signed");
  assert.ok(!S.verifyClientSignature(SECRET, { ...payload, capabilities: { ...caps, assistantUnavailable: false } }, sig), "upgrading or downgrading a claim breaks the signature");
  assert.ok(!S.verifyClientSignature("another-secret", payload, sig));
});

test("a requirement a client kind cannot attest always fails instead of disappearing", () => {
  const policy = { requiredCapabilities: ["lockTask", "assistantUnavailable"] };
  const desktop = S.capabilityChecks(policy, { lockTask: true, assistantUnavailable: true, kiosk: true }, "ELECTRON");
  assert.deepEqual(S.failedRequired(desktop).map((c) => c.key).sort(), ["assistantUnavailable", "lockTask"], "a desktop session cannot satisfy Android-only requirements even if it claims them");
  const phone = S.capabilityChecks(policy, { lockTask: true, assistantUnavailable: true }, "ANDROID_MANAGED");
  assert.equal(S.failedRequired(phone).length, 0);
  const missing = S.capabilityChecks(policy, { lockTask: true }, "ANDROID_MANAGED");
  assert.deepEqual(S.failedRequired(missing).map((c) => c.key), ["assistantUnavailable"]);
});

test("the default LOCKDOWN policy accepts only the desktop client; the Android client is an explicit admin choice", () => {
  assert.deepEqual(X.resolvePolicy({ securityLevel: "LOCKDOWN" }).allowedClientKinds, ["ELECTRON"]);
  assert.deepEqual(X.resolvePolicy({ securityLevel: "STANDARD" }).allowedClientKinds, ["ELECTRON"]);
  const p = X.resolvePolicy({ securityLevel: "LOCKDOWN", securityPolicy: { allowedClientKinds: ["ANDROID_MANAGED"], requiredCapabilities: ["deviceOwner", "lockTask"] } });
  assert.deepEqual(p.allowedClientKinds, ["ANDROID_MANAGED"]);
  assert.deepEqual(p.requiredCapabilities, ["deviceOwner", "lockTask"]);
  assert.deepEqual(X.resolvePolicy({ securityLevel: "LOCKDOWN", securityPolicy: { allowedClientKinds: ["NOPE"] } }).allowedClientKinds, ["ELECTRON"], "unknown kinds are dropped");
});

test("admin input is sanitised to known kinds and capabilities", () => {
  const out = X.sanitizePolicyOverrides({ allowedClientKinds: ["ANDROID_MANAGED", "ANDROID_MANAGED", "x"], requiredCapabilities: ["lockTask", "bogus"] });
  assert.deepEqual(out.allowedClientKinds, ["ANDROID_MANAGED"]);
  assert.deepEqual(out.requiredCapabilities, ["lockTask"]);
});

test("phones are refused unless the policy mandates a secure session AND accepts the Android managed client", () => {
  const phone = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";
  const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126";
  const lock = X.resolvePolicy({ securityLevel: "LOCKDOWN" });
  assert.equal(X.mobileRefused(lock, phone), true);
  assert.equal(X.mobileRefused(lock, desktop), false);
  const android = X.resolvePolicy({ securityLevel: "LOCKDOWN", securityPolicy: { allowedClientKinds: ["ELECTRON", "ANDROID_MANAGED"] } });
  assert.equal(X.mobileRefused(android, phone), false, "the Android app is a phone WebView; the secure-session check still has to pass");
  assert.equal(android.secureBrowserRequired, true);
  const proctored = X.resolvePolicy({ securityLevel: "PROCTORED", securityPolicy: { mobileAllowed: false, allowedClientKinds: ["ANDROID_MANAGED"] } });
  assert.equal(X.mobileRefused(proctored, phone), true, "no secure session is required for PROCTORED, so the exemption does not apply");
});

test("Android interruption events are observable facts, reportable by a secure client only, and never a verdict", () => {
  for (const t of ["SYSTEM_UI_INTERRUPTION", "SCREEN_OFF_RESUME"]) {
    assert.ok(X.SECURE_CLIENT_REPORTABLE.has(t));
    assert.ok(!X.CLIENT_REPORTABLE.has(t), "a plain browser page must not be able to report it");
    assert.ok(X.EVENT_SEVERITY[t]);
  }
  assert.ok(X.WEIGHTS.SYSTEM_UI_INTERRUPTION <= 2, "one focus loss is a small risk contribution, never an accusation");
  for (const t of Object.keys(X.EVENT_SEVERITY)) assert.ok(!/GEMINI|CHEAT|AI_USE/i.test(t), `${t} must not claim an application or intent`);
});

test("the Android signature vector matches the one asserted in android-exam-client HandshakeTest.kt (computed independently with openssl)", () => {
  const caps = { deviceOwner: true, lockTask: true, kiosk: true, homeBlocked: true, overviewBlocked: true, globalActionsBlocked: true, notificationsBlocked: true, assistantUnavailable: true, screenCaptureProtection: true, appRestriction: true, browserRestriction: true, fullscreen: true, devtoolsDisabled: true, clipboard: false };
  assert.equal(S.clientSignature("test-device-secret", { nonce: "nonce-123", clientVersion: "1.0.0", clientKind: "ANDROID_MANAGED", capabilities: caps }), "6d8d636c32ce078a76aa28b8aad65833e587c9a2df0a0b6509e0bfb9c45a3634");
});
