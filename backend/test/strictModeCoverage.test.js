const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/utils/testExamSecurity");
const X = require("../src/utils/examSecurity");

const req = (ua) => ({ get: (h) => (h.toLowerCase() === "user-agent" ? ua : undefined) });
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126";
const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36";

// Engines other than the coding-attempt engine (formal Tests, readiness, mock interviews, AI/voice interviews) all start through
// testExamSecurity.startRequirementFailure(policyOf(...)). They have no secure-session engine, so strict mode must fail closed there.

test("a stored LOCKDOWN level is refused on every non-coding engine instead of silently running as STANDARD", () => {
  const p = T.policyOf({ securityLevel: "LOCKDOWN" });
  assert.equal(p.strictUnsupported, true);
  for (const ua of [DESKTOP, PHONE]) assert.equal(T.startRequirementFailure(req(ua), p).code, "STRICT_MODE_UNSUPPORTED");
  assert.equal(T.policyOf({ securityLevel: "LOCKDOWN", securityPolicy: { allowedClientKinds: ["ANDROID_MANAGED"] } }).strictUnsupported, true, "opting into a client kind does not make these engines strict-capable");
});

test("ordinary web exams are untouched: STANDARD and PROCTORED behave exactly as before", () => {
  const std = T.policyOf({ securityLevel: "STANDARD" });
  assert.equal(std.strictUnsupported, false);
  assert.equal(T.startRequirementFailure(req(DESKTOP), std), null);
  assert.equal(T.startRequirementFailure(req(PHONE), std), null, "phones remain allowed on STANDARD");
  const prc = T.policyOf({ securityLevel: "PROCTORED" });
  assert.equal(T.startRequirementFailure(req(DESKTOP), prc), null);
  assert.equal(T.startRequirementFailure(req(PHONE), prc).code, "MOBILE_NOT_SUPPORTED", "PROCTORED still refuses phones unless explicitly allowed");
  assert.equal(T.policyOf(undefined).strictUnsupported, false);
  assert.equal(T.policyOf({ securityLevel: "WEIRD" }).strictUnsupported, false, "unknown levels keep the old STANDARD fallback");
});

test("the client policy payload of these engines is unchanged (no new field leaks to the browser)", () => {
  const keys = Object.keys(X.clientPolicy(T.policyOf({ securityLevel: "PROCTORED" }))).sort();
  assert.ok(!keys.includes("strictUnsupported") && !keys.includes("allowedClientKinds"));
});

test("admin input for these engines rejects LOCKDOWN and drops the secure-client keys", () => {
  assert.match(T.parseSecurityInput({ securityLevel: "LOCKDOWN" }).error, /LOCKDOWN needs the secure exam client/);
  const out = T.parseSecurityInput({ securityPolicy: { secureBrowserRequired: true, requiredCapabilities: ["kiosk"], requireScreenShare: true, blockPaste: false } });
  assert.deepEqual(out.data.securityPolicy, { blockPaste: false });
});

test("the coding-attempt engine is the only one with a secure-session check", () => {
  // Static guard: if another route starts enforcing secure sessions, this list must be updated on purpose, together with a coverage test for it.
  const fs = require("node:fs"), path = require("node:path");
  const routes = path.join(__dirname, "..", "src", "routes");
  const users = fs.readdirSync(routes).filter((f) => f.endsWith(".js") && /evaluateSecureSession|x-secure-session/i.test(fs.readFileSync(path.join(routes, f), "utf8")));
  assert.deepEqual(users.sort(), ["moduleCoding.js", "secureExam.js"]);
});
