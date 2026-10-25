// Authentication rules: login, logout, password reset and e-mail verification. No req/res: the controller passes `req` only where an audit entry or a
// device lookup needs the client address and user agent.
// Behaviour, status codes and messages are those of the routes this replaced (see backend/test/snapshots/auth-contract.json).
const bcrypt = require("bcryptjs");
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { sendMailLogged, wrapBranded, escapeHtml } = require("../../utils/mailer");
// `sessions.createSession` is called through the module object (not destructured) so that a verification script can make session creation fail and prove that a
// password change which succeeded is never reported as a failure (see changeTemporaryPassword).
const sessions = require("../../utils/sessions");
const { endSession, revokeAllSessions } = sessions;
const { logAudit, parseDevice, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { validatePasswordComplexity, isPasswordReused, recordPasswordChange } = require("../../utils/password");
const { computeMandatoryCompletion } = require("../../utils/studentProfileCompletion");
const { decryptProfile } = require("../../utils/piiEncryption");
const d = require("./auth.domain");
const repo = require("./auth.repository");

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena.site";

const auditFor = (req, user, action, details, extra = {}) => logAudit({ req, action, actorId: user.id, actorName: user.name, actorRole: user.role, studentId: user.id, instituteId: user.instituteId, details, ...extra });

// Best-effort and non-blocking: a login alert failing to send must never fail or slow the login itself.
async function maybeSendLoginAlert(user, req, isFirstLogin, isNewDevice) {
  if (!isFirstLogin && !isNewDevice) return;
  const { summary } = parseDevice(req.headers["user-agent"]);
  const reason = isFirstLogin ? "This was your first login to CodeArena." : "This login was from a device we haven't seen on your account before.";
  await sendMailLogged(prisma, {
    to: user.email,
    name: user.name,
    emailType: "LOGIN_ALERT",
    studentId: user.id,
    subject: isFirstLogin ? "Welcome — first login to your CodeArena account" : "New device signed in to your CodeArena account",
    html: wrapBranded(`
      <p>Hi ${escapeHtml(user.name)},</p>
      <p>${escapeHtml(reason)}</p>
      <p><strong>Device:</strong> ${escapeHtml(summary)}<br/><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      <p>If this wasn't you, reset your password immediately and contact your administrator.</p>
    `),
  }).catch((err) => console.error("[auth] login alert email failed:", err.message));
}

// ---- login ----
async function login(req, body) {
  const problem = d.loginRequestProblem(body);
  if (problem) throw new ServiceError(400, problem);
  const { email, password } = body;
  const user = await repo.findUserForLogin(email);

  // Both "no such account" and "wrong password" run through bcrypt.compare and return the same message, so neither the text nor the timing tells a caller whether
  // an email is registered.
  const valid = await bcrypt.compare(password || "", d.hashToCompare(user));
  if (!user || !valid) {
    // Fire-and-forget (logAudit catches its own errors): the answer to a wrong password need not wait on an audit write.
    if (user) auditFor(req, user, AUDIT_ACTIONS.LOGIN_FAILED, { email });
    throw new ServiceError(401, d.MESSAGES.badCredentials);
  }
  const refusal = d.loginRefusal(user);
  if (refusal) throw new ServiceError(refusal.status, refusal.message);

  // An account whose SERVER-SIDE state says "choose a new password first" (an administrator-issued or reset password, or an elapsed institute expiry window) is given no
  // session and no token here. The correct credentials only unlock the password-change step (changeTemporaryPassword), so the requirement cannot be skipped by editing
  // the page, replaying the response or calling any other API: there is nothing to call it with. Expiry is computed live, so a newly expired password is caught here.
  const pw = d.passwordState(user);
  if (pw.mustChangePassword) {
    // Fire-and-forget: the response already says so, the client need not wait for the stored flag to persist.
    if (pw.persistFlag) repo.markMustChangePassword(user.id).catch(() => {});
    return d.passwordChangeRequiredResponse(pw);
  }

  return signIn(req, user);
}

// Opens a session for an account that is allowed in and builds the login response: records the sign-in, sends the first-login / new-device alert and applies the
// student profile-completion gate. Shared by the normal login and by a completed first-login password change.
async function signIn(req, user) {
  // Sequential, not Promise.all: the Prisma pool is deliberately small, and parallel queries per login multiply the peak connections needed during a login burst
  // (the cause of "unable to start a transaction in the given time").
  const priorSessionCount = await repo.countSessions(user.id);
  const device = parseDevice(req.headers["user-agent"]);
  const deviceSeenBefore = await repo.findSessionOnDevice(user.id, device.browser, device.os);
  const { isFirstLogin, isNewDevice } = d.deviceSignals(priorSessionCount, deviceSeenBefore);

  const token = await sessions.createSession({ user, req, singleSessionOnly: !!user.institute?.singleSessionOnly });

  auditFor(req, user, AUDIT_ACTIONS.LOGIN, { isFirstLogin, isNewDevice });
  maybeSendLoginAlert(user, req, isFirstLogin, isNewDevice);

  // Student profile completion gating mirrors mustChangePassword's shape. It uses `unlocked` (the threshold), not 100%, so students are not blocked on the last field.
  let requireProfileCompletion = false;
  let profileComplete = true;
  if (d.requiresProfileCompletion(user)) {
    requireProfileCompletion = true;
    const studentProfile = await repo.findStudentProfile(user.id);
    const resume = await repo.findResumeSummary(user.id);
    const documents = await repo.listDocumentIds(user.id);
    profileComplete = computeMandatoryCompletion(user, decryptProfile(studentProfile), resume, documents).unlocked;
  }

  return d.loginResponse(token, user, { mustChangePassword: false, requireProfileCompletion, profileComplete });
}

// ---- first login: replace the temporary (or expired) password ----
// Public, because the account has no session yet: the caller proves who they are with the temporary password in the request itself, so nothing can be forged by
// changing frontend state. It is a password-change route ONLY for an account whose stored state requires one; for any other account it answers exactly as for a wrong
// password (it must not become a way to change a password without signing in). Every check is repeated here: the page's own validation is a convenience.
//   success       -> the same body as a login (token + user), with the password already changed and a fresh session open
//   half success  -> { passwordChanged: true, signedIn: false }: the password changed but the session could not be opened; the caller signs in with the new password
async function changeTemporaryPassword(req, body) {
  const problem = d.changeRequestProblem(body);
  if (problem) throw new ServiceError(400, problem);
  const { email, temporaryPassword, newPassword, confirmPassword } = body;

  // Checks that need no account come first: they say nothing about whether the e-mail is registered.
  if (newPassword !== confirmPassword) throw new ServiceError(400, d.MESSAGES.passwordsDoNotMatch);
  const complexityError = validatePasswordComplexity(newPassword);
  if (complexityError) throw new ServiceError(400, complexityError);

  const user = await repo.findUserForLogin(email);
  // The same bcrypt work whether or not the account exists, and the same message and status for "no such account", "wrong password" and "nothing to change".
  const valid = await bcrypt.compare(temporaryPassword, d.hashToCompare(user));
  if (!user || !valid) {
    if (user) auditFor(req, user, AUDIT_ACTIONS.LOGIN_FAILED, { email, step: "first_login_password_change" });
    throw new ServiceError(401, d.MESSAGES.badCredentials);
  }
  const refusal = d.loginRefusal(user);
  if (refusal) throw new ServiceError(refusal.status, refusal.message);
  const pw = d.passwordState(user);
  if (!pw.mustChangePassword) throw new ServiceError(401, d.MESSAGES.badCredentials);
  const reason = d.passwordChangeReason(pw);

  if (newPassword === temporaryPassword) throw new ServiceError(400, d.MESSAGES.sameAsCurrent);
  const depth = user.institute?.passwordHistoryDepth;
  if (await isPasswordReused(prisma, user.id, newPassword, depth)) throw new ServiceError(400, d.passwordReusedMessage(depth));

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const swapped = await repo.replaceTemporaryPassword(user.id, user.passwordHash, passwordHash, (tx) => recordPasswordChange(tx, user.id, passwordHash, depth));
  // Someone got there first with the same temporary password (a second tab, a double click, a replay): it has just stopped being valid.
  if (!swapped) throw new ServiceError(401, d.MESSAGES.badCredentials);

  // From here on the password HAS changed, so nothing below may turn into an error response that tells the person it failed.
  const changed = { ...user, passwordHash, mustChangePassword: false };
  // Whoever held the temporary password (the person, or someone who saw it) is signed out everywhere before the new session is opened.
  try { await revokeAllSessions(user.id); } catch (err) { console.error("[auth] could not close the sessions of an account whose password just changed:", err.message); }
  auditFor(req, changed, AUDIT_ACTIONS.PASSWORD_CHANGED, { self: true, via: reason === "TEMPORARY_PASSWORD" ? "first_login_temporary_password" : "expired_password", sessionsRevoked: true });
  sendMailLogged(prisma, {
    to: changed.email,
    name: changed.name,
    emailType: "LOGIN_ALERT",
    studentId: changed.role === "STUDENT" ? changed.id : null,
    subject: "Your CodeArena password was changed",
    html: wrapBranded(`<p>Hi ${escapeHtml(changed.name)},</p><p>You just replaced your ${reason === "TEMPORARY_PASSWORD" ? "temporary" : "expired"} CodeArena password with a new one of your own. If this wasn't you, contact your administrator immediately.</p>`),
  }).catch((err) => console.error("[auth] password-change alert email failed:", err.message));

  try {
    return await signIn(req, changed);
  } catch (err) {
    console.error("[auth] password changed but the new session could not be opened:", err.message);
    return { passwordChanged: true, signedIn: false, message: d.MESSAGES.passwordChangedSignInFailed };
  }
}

async function permissions(user) {
  const { permissionsFor } = require("../../utils/permissions");
  return { role: user.role, permissions: await permissionsFor(user) };
}

async function logout(req) {
  const user = req.user;
  await endSession(user.jti);
  await logAudit({ req, action: AUDIT_ACTIONS.LOGOUT, actorId: user.id, actorName: user.name, actorRole: user.role, studentId: user.role === "STUDENT" ? user.id : null, details: {} });
  return { message: d.MESSAGES.loggedOut };
}

// ---- forgot password ----
// Always answers the same way whether the email exists, was blocked by the 24h cooldown, or succeeded, so the route never leaks account existence; the cooldown is
// enforced silently.
async function forgotPassword(req, { email }) {
  if (!email) throw new ServiceError(400, d.MESSAGES.emailRequired);

  const user = await repo.findUserByEmail(email);
  if (user) {
    const now = new Date();
    const claim = await repo.claimResetCooldown(user.id, now, new Date(now.getTime() - d.RESET_REQUEST_COOLDOWN_MS));
    if (claim.count > 0) {
      const token = d.newResetToken();
      try {
        await repo.storeResetToken(user.id, d.hashToken(token), new Date(now.getTime() + d.RESET_TOKEN_TTL_MS));
        const link = d.resetLink(FRONTEND_URL, token);
        // The mail is sent in the background: the answer below is the same whatever happens to it, and waiting for the mail server made this request take 1.4 s at the median and up
        // to 16 s (measured on the live request log), and let anyone tell a registered address from an unknown one by how long the answer took.
        const sending = sendMailLogged(prisma, {
          to: user.email,
          name: user.name,
          studentId: user.id,
          emailType: "PASSWORD_RESET",
          subject: "Reset your CodeArena password",
          html: wrapBranded(`<p>Hi ${escapeHtml(user.name)},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email.</p>`),
        });
        // sendMailLogged never throws on a delivery failure (that lands in the EmailLog row), so it settling means the request was queued and the claim stands.
        sending
          .then(() => auditFor(req, user, AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED, {}))
          .catch(async (sendErr) => {
            // Nothing was queued: release the claim so an infrastructure hiccup does not cost the user their one request for 24h.
            console.error("[auth] forgot-password: failed before email was queued, releasing cooldown claim:", sendErr.message);
            await repo.releaseResetCooldown(user.id).catch(() => {});
          });
      } catch (sendErr) {
        // The token could not be stored: release the claim for the same reason.
        console.error("[auth] forgot-password: failed before email was queued, releasing cooldown claim:", sendErr.message);
        await repo.releaseResetCooldown(user.id).catch(() => {});
      }
    } else {
      auditFor(req, user, AUDIT_ACTIONS.PASSWORD_RESET_BLOCKED, { reason: "24h_cooldown" });
    }
  }
  return { message: d.MESSAGES.resetRequested };
}

// ---- reset password ----
async function resetPassword(req, { token, newPassword }) {
  if (!token || !newPassword) throw new ServiceError(400, d.MESSAGES.resetFieldsRequired);
  const complexityError = validatePasswordComplexity(newPassword);
  if (complexityError) throw new ServiceError(400, complexityError);

  const user = await repo.findUserByResetToken(d.hashToken(token));
  if (!user || d.tokenExpired(user.resetTokenExpiry)) {
    // Logged only when the token matched a real account (so it can be attributed); a token that matches nothing is not logged.
    if (user) auditFor(req, user, AUDIT_ACTIONS.PASSWORD_RESET_FAILED, { reason: "expired_or_used_token" });
    throw new ServiceError(400, d.MESSAGES.resetLinkInvalid);
  }

  const depth = user.institute?.passwordHistoryDepth;
  if (await isPasswordReused(prisma, user.id, newPassword, depth)) {
    auditFor(req, user, AUDIT_ACTIONS.PASSWORD_RESET_FAILED, { reason: "password_reused" });
    throw new ServiceError(400, d.passwordReusedMessage(depth));
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await repo.replacePasswordFromReset(user.id, passwordHash, (tx) => recordPasswordChange(tx, user.id, passwordHash, depth));

  // Close every session the account already had: a JWT's signature cannot know its issuing password was superseded.
  await revokeAllSessions(user.id).catch(() => {});

  auditFor(req, user, AUDIT_ACTIONS.PASSWORD_RESET, { via: "self_service_forgot_password", sessionsRevoked: true });

  sendMailLogged(prisma, {
    to: user.email,
    name: user.name,
    studentId: user.id,
    emailType: "OTHER_SYSTEM_EMAIL",
    subject: "Your CodeArena password was changed",
    html: wrapBranded(`<p>Hi ${escapeHtml(user.name)},</p><p>Your password was just changed via the "forgot password" link, and any devices you were previously signed in on have been signed out. If this wasn't you, contact your administrator immediately.</p>`),
  }).catch((err) => console.error("[auth] password-change alert email failed:", err.message));

  return { message: d.MESSAGES.resetDone };
}

// ---- verify e-mail ----
// Public and token-based: the link may be opened on a different device than the one the change was requested from.
async function verifyEmail(req, { token }) {
  if (!token) throw new ServiceError(400, d.MESSAGES.verifyTokenRequired);

  const user = await repo.findUserByPendingEmailToken(d.hashToken(token));
  if (!user || d.tokenExpired(user.pendingEmailTokenExpiry) || !user.pendingEmail) throw new ServiceError(400, d.MESSAGES.verifyLinkInvalid);

  // Someone else may have registered the pending address since the link was sent: re-check at redemption, and clear the stale state either way.
  const conflict = await repo.findUserByEmail(user.pendingEmail);
  if (conflict && conflict.id !== user.id) {
    await repo.clearPendingEmail(user.id);
    throw new ServiceError(409, d.MESSAGES.verifyEmailTaken);
  }

  await repo.confirmPendingEmail(user.id, user.pendingEmail);
  auditFor(req, user, AUDIT_ACTIONS.EMAIL_VERIFIED, { newEmail: user.pendingEmail }, { studentId: user.role === "STUDENT" ? user.id : null });
  return { message: d.MESSAGES.verifyDone };
}

module.exports = { login, changeTemporaryPassword, permissions, logout, forgotPassword, resetPassword, verifyEmail, registrationDisabled: () => d.MESSAGES.registrationDisabled };
