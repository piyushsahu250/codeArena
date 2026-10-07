const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { signSession, canonicalCaps, establishSession } = require("../lib/handshake");

// In a monorepo checkout, prove the client and the backend produce the identical signature.
const backendPath = path.join(__dirname, "..", "..", "backend", "src", "utils", "secureExam.js");
test("client signature equals the backend signature byte for byte", { skip: !fs.existsSync(backendPath) }, () => {
  process.env.SECURE_BROWSER_SECRET = "unit-test-master-secret-1234567890";
  const S = require(backendPath);
  const caps = { kiosk: true, appRestriction: true, browserRestriction: true, networkRestriction: false, clipboard: true, fullscreen: true, devtoolsDisabled: true, screenCaptureProtection: false };
  const secret = S.deriveDeviceSecret("inst-1", "LAB3-PC14");
  const payload = { nonce: "n.1.abc", clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: caps };
  assert.strictEqual(signSession(secret, payload), S.clientSignature(secret, payload));
  assert.strictEqual(canonicalCaps(caps), S.canonicalCaps(caps));
  assert.ok(S.verifyClientSignature(secret, payload, signSession(secret, payload)));
});

test("changing any reported capability or the version changes the signature", () => {
  const base = { nonce: "n", clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: { kiosk: false } };
  assert.notStrictEqual(signSession("s", base), signSession("s", { ...base, capabilities: { kiosk: true } }));
  assert.notStrictEqual(signSession("s", base), signSession("s", { ...base, clientVersion: "9.9.9" }));
});

test("establishSession runs challenge then session with the signed payload", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (url.endsWith("/challenge")) return { ok: true, json: async () => ({ nonce: "n.2.def" }) };
    const body = JSON.parse(opts.body);
    assert.strictEqual(body.sig, signSession("secret", { nonce: "n.2.def", clientVersion: "1.0.0", clientKind: "ELECTRON", capabilities: { kiosk: true } }));
    return { ok: true, json: async () => ({ token: "tok", heartbeatSec: 15 }) };
  };
  const r = await establishSession({ apiUrl: "http://x/api", studentToken: "jwt", deviceId: "d", deviceSecret: "secret", clientVersion: "1.0.0", capabilities: { kiosk: true }, fetchImpl });
  assert.strictEqual(r.token, "tok");
  assert.deepStrictEqual(calls, ["http://x/api/secure-exam/challenge", "http://x/api/secure-exam/session"]);
});

test("a refused challenge surfaces the server code", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ code: "DEVICE_NOT_ALLOWED", error: "not registered" }) });
  await assert.rejects(establishSession({ apiUrl: "http://x", studentToken: "j", deviceId: "d", deviceSecret: "s", clientVersion: "1", capabilities: {}, fetchImpl }), (e) => e.code === "DEVICE_NOT_ALLOWED");
});
