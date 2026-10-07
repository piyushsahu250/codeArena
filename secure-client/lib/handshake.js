// Client side of the secure-session handshake. MUST stay byte-compatible with backend/src/utils/secureExam.js
// (clientSignature / canonicalCaps); test/handshake.test.js proves it against the real backend module.
"use strict";
const crypto = require("crypto");

const CAPABILITIES = ["kiosk", "appRestriction", "browserRestriction", "networkRestriction", "clipboard", "fullscreen", "devtoolsDisabled", "screenCaptureProtection"];

const canonicalCaps = (caps) => JSON.stringify(CAPABILITIES.map((k) => [k, !!(caps && caps[k])]));

function signSession(deviceSecret, { nonce, clientVersion, clientKind, capabilities }) {
  return crypto.createHmac("sha256", deviceSecret).update(`session|${nonce}|${clientVersion}|${clientKind}|${canonicalCaps(capabilities)}`).digest("hex");
}

// Full handshake against the API using the student's CodeArena bearer token (obtained when they log in inside the client).
async function establishSession({ apiUrl, studentToken, deviceId, deviceSecret, clientVersion, capabilities, fetchImpl = fetch }) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${studentToken}` };
  const ch = await fetchImpl(`${apiUrl}/secure-exam/challenge`, { method: "POST", headers, body: JSON.stringify({ deviceId }) });
  const chBody = await ch.json().catch(() => ({}));
  if (!ch.ok) throw Object.assign(new Error(chBody.error || "challenge refused"), { code: chBody.code, status: ch.status });
  const clientKind = "ELECTRON";
  const sig = signSession(deviceSecret, { nonce: chBody.nonce, clientVersion, clientKind, capabilities });
  const res = await fetchImpl(`${apiUrl}/secure-exam/session`, { method: "POST", headers, body: JSON.stringify({ deviceId, nonce: chBody.nonce, sig, clientVersion, clientKind, capabilities }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || "session refused"), { code: body.code, status: res.status });
  return body; // { token, heartbeatSec, expiresInSec, capabilities }
}

module.exports = { CAPABILITIES, canonicalCaps, signSession, establishSession };
