// Authentication rules that need no database: token hashing, the constants the reset flow depends on, and the decisions the login makes about an account.
// Behaviour and messages are those of the routes this replaced (see backend/test/snapshots/auth-contract.json).
const crypto = require("crypto");
const { isPasswordExpired } = require("../../utils/password");

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 request per rolling 24h per account

// A syntactically valid but unowned bcrypt hash (the well-known "password" fixture from bcrypt's own test suite) compared against when an email does not
// exist, so the route does genuine bcrypt work either way. Without it "no such account" would answer faster than "wrong password": a timing side-channel for
// enumerating valid emails even with an identical response body.
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const MESSAGES = {
  registrationDisabled: "User registration is managed by the administrator. Please contact your institute administrator to receive your login credentials.",
  badCredentials: "Invalid email or password.",
  loginRequestInvalid: "Invalid request. Send your email address and password as text.",
  accountDeactivated: "This account has been deactivated. Contact your administrator.",
  instituteDeactivated: "Your institute's access has been deactivated. Contact the platform administrator.",
  emailRequired: "Email is required",
  resetRequested: "If that email is registered, a reset link has been sent.",
  resetFieldsRequired: "token and newPassword are required",
  resetLinkInvalid: "This reset link is invalid or has expired",
  resetDone: "Password updated. Please sign in again with your new password.",
  verifyTokenRequired: "token is required",
  verifyLinkInvalid: "This verification link is invalid or has expired",
  verifyEmailTaken: "This email address was registered to another account in the meantime. Please request the change again with a different address.",
  verifyDone: "Email address confirmed. You can now sign in with your new email.",
  loggedOut: "Logged out",
};

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const newResetToken = () => crypto.randomBytes(32).toString("hex");

const resetLink = (frontendUrl, token) => `${frontendUrl}/reset-password?token=${token}`;
const passwordReusedMessage = (depth) => `You've used this password recently. Choose a password you haven't used in your last ${depth ?? 3} passwords.`;

// Which hash the password is compared with: the real one, or the dummy when there is no such account.
const hashToCompare = (user) => (user ? user.passwordHash : DUMMY_HASH);

// Checked AFTER the password, so a deactivated account or institute is only ever revealed to someone who already proved they know the right password.
// Returns { status, message } to refuse, or null to let the login proceed.
// The shape a login request must have BEFORE any database lookup: an email that is text, and a password that is absent or text. A missing password stays a
// 401 (as before); a body that is not an object, a non-text email or a non-text password is a 400 with a fixed message (it used to reach Prisma and surface as a 500).
function loginRequestProblem(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return MESSAGES.loginRequestInvalid;
  if (typeof body.email !== "string") return MESSAGES.loginRequestInvalid;
  if (body.password !== undefined && body.password !== null && typeof body.password !== "string") return MESSAGES.loginRequestInvalid;
  return null;
}

function loginRefusal(user) {
  if (!user.isActive) return { status: 403, message: MESSAGES.accountDeactivated };
  if (user.institute && user.institute.isActive === false) return { status: 403, message: MESSAGES.instituteDeactivated };
  return null;
}

// Password expiry is computed live rather than trusted from the stored flag, so a newly expired password is caught the moment the policy window elapses.
function passwordState(user) {
  const expired = isPasswordExpired(user, user.institute?.passwordExpiryDays);
  return { expired, mustChangePassword: user.mustChangePassword || expired, persistFlag: expired && !user.mustChangePassword };
}

// Only students of an institute that has opted in are held to profile completion; everyone else is unaffected.
const requiresProfileCompletion = (user) => user.role === "STUDENT" && !!user.institute?.requireProfileCompletion;

// First login ever, or a browser/OS combination this account has not used before.
function deviceSignals(priorSessionCount, deviceSeenBefore) {
  const isFirstLogin = priorSessionCount === 0;
  return { isFirstLogin, isNewDevice: !isFirstLogin && !deviceSeenBefore };
}

function loginResponse(token, user, { mustChangePassword, requireProfileCompletion, profileComplete }) {
  return {
    token,
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role, instituteId: user.instituteId, mustChangePassword, requireProfileCompletion, profileComplete,
      emailVerified: user.emailVerified, pendingEmail: user.pendingEmail,
      institute: user.institute ? { name: user.institute.name, logoUrl: user.institute.logoUrl } : null,
    },
  };
}

const tokenExpired = (expiry, now = new Date()) => !expiry || expiry < now;

module.exports = {
  RESET_TOKEN_TTL_MS, RESET_REQUEST_COOLDOWN_MS, DUMMY_HASH, MESSAGES,
  hashToken, newResetToken, resetLink, passwordReusedMessage, hashToCompare, loginRequestProblem, loginRefusal, passwordState, requiresProfileCompletion, deviceSignals, loginResponse, tokenExpired,
};
