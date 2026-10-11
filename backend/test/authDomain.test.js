const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/modules/auth/auth.domain");

const day = 86400000;

test("tokens are hashed with sha256 and are 64 hex characters long", () => {
  assert.equal(d.hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.match(d.newResetToken(), /^[0-9a-f]{64}$/);
  assert.notEqual(d.newResetToken(), d.newResetToken());
});

test("an unknown account is compared against the dummy hash, a known one against its own", () => {
  assert.equal(d.hashToCompare(null), d.DUMMY_HASH);
  assert.equal(d.hashToCompare({ passwordHash: "h" }), "h");
});

test("a deactivated account or institute is refused with 403, an active one is not", () => {
  assert.equal(d.loginRefusal({ isActive: true, institute: null }), null);
  assert.equal(d.loginRefusal({ isActive: true, institute: { isActive: true } }), null);
  assert.deepEqual(d.loginRefusal({ isActive: false, institute: null }), { status: 403, message: d.MESSAGES.accountDeactivated });
  assert.deepEqual(d.loginRefusal({ isActive: true, institute: { isActive: false } }), { status: 403, message: d.MESSAGES.instituteDeactivated });
  assert.equal(d.loginRefusal({ isActive: false, institute: { isActive: false } }).message, d.MESSAGES.accountDeactivated, "the account is reported first");
});

test("password state: expiry is computed live and only persisted when the flag was not already set", () => {
  const old = new Date(Date.now() - 3 * day);
  const stale = { mustChangePassword: false, passwordChangedAt: old, institute: { passwordExpiryDays: 1 } };
  assert.deepEqual(d.passwordState(stale), { expired: true, mustChangePassword: true, persistFlag: true });
  assert.deepEqual(d.passwordState({ ...stale, mustChangePassword: true }), { expired: true, mustChangePassword: true, persistFlag: false });
  assert.deepEqual(d.passwordState({ ...stale, institute: { passwordExpiryDays: null } }), { expired: false, mustChangePassword: false, persistFlag: false });
  assert.deepEqual(d.passwordState({ mustChangePassword: true, passwordChangedAt: new Date(), institute: null }), { expired: false, mustChangePassword: true, persistFlag: false });
});

test("only students of an institute that opted in are held to profile completion", () => {
  assert.equal(d.requiresProfileCompletion({ role: "STUDENT", institute: { requireProfileCompletion: true } }), true);
  assert.equal(d.requiresProfileCompletion({ role: "STUDENT", institute: { requireProfileCompletion: false } }), false);
  assert.equal(d.requiresProfileCompletion({ role: "STAFF", institute: { requireProfileCompletion: true } }), false);
  assert.equal(d.requiresProfileCompletion({ role: "STUDENT", institute: null }), false);
});

test("device signals: first login ever, or a device not seen before", () => {
  assert.deepEqual(d.deviceSignals(0, null), { isFirstLogin: true, isNewDevice: false });
  assert.deepEqual(d.deviceSignals(3, null), { isFirstLogin: false, isNewDevice: true });
  assert.deepEqual(d.deviceSignals(3, { id: "s" }), { isFirstLogin: false, isNewDevice: false });
});

test("the login response carries the institute branding, or null", () => {
  const user = { id: "u", name: "N", email: "e", role: "STUDENT", instituteId: "i", emailVerified: false, pendingEmail: null, institute: { name: "I", logoUrl: "l", secret: "x" } };
  const flags = { mustChangePassword: false, requireProfileCompletion: false, profileComplete: true };
  const out = d.loginResponse("t", user, flags);
  assert.deepEqual(out.user.institute, { name: "I", logoUrl: "l" });
  assert.equal(out.token, "t");
  assert.equal(d.loginResponse("t", { ...user, institute: null }, flags).user.institute, null);
  assert.ok(!("passwordHash" in out.user));
});

test("a reset or verification token is expired when it has no expiry or the expiry has passed", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  assert.equal(d.tokenExpired(null, now), true);
  assert.equal(d.tokenExpired(new Date("2026-01-01T11:59:59Z"), now), true);
  assert.equal(d.tokenExpired(new Date("2026-01-01T12:00:01Z"), now), false);
});

test("the reset link and the reuse message", () => {
  assert.equal(d.resetLink("https://x.test", "tok"), "https://x.test/reset-password?token=tok");
  assert.match(d.passwordReusedMessage(5), /last 5 passwords/);
  assert.match(d.passwordReusedMessage(undefined), /last 3 passwords/);
});
