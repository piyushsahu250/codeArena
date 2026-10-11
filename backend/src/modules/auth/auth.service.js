// Authentication rules: login, logout, password reset and e-mail verification. No req/res: the controller passes `req` only where an audit entry or a
// device lookup needs the client address and user agent.
// Behaviour, status codes and messages are those of the routes this replaced (see backend/test/snapshots/auth-contract.json).
const bcrypt = require("bcryptjs");
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { sendMailLogged, wrapBranded } = require("../../utils/mailer");
const { createSession, endSession, revokeAllSessions } = require("../../utils/sessions");
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
      <p>Hi ${user.name},</p>
      <p>${reason}</p>
      <p><strong>Device:</strong> ${summary}<br/><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      <p>If this wasn't you, reset your password immediately and contact your administrator.</p>
    `),
  }).catch((err) => console.error("[auth] login alert email failed:", err.message));
}

// ---- login ----
async function login(req, { email, password }) {
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

  // Sequential, not Promise.all: the Prisma pool is deliberately small, and parallel queries per login multiply the peak connections needed during a login burst
  // (the cause of "unable to start a transaction in the given time").
  const priorSessionCount = await repo.countSessions(user.id);
  const device = parseDevice(req.headers["user-agent"]);
  const deviceSeenBefore = await repo.findSessionOnDevice(user.id, device.browser, device.os);
  const { isFirstLogin, isNewDevice } = d.deviceSignals(priorSessionCount, deviceSeenBefore);

  const token = await createSession({ user, req, singleSessionOnly: !!user.institute?.singleSessionOnly });

  const pw = d.passwordState(user);
  // Fire-and-forget: the response already carries the right value, the client need not wait for it to persist.
  if (pw.persistFlag) repo.markMustChangePassword(user.id).catch(() => {});

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

  return d.loginResponse(token, user, { mustChangePassword: pw.mustChangePassword, requireProfileCompletion, profileComplete });
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
        await sendMailLogged(prisma, {
          to: user.email,
          name: user.name,
          studentId: user.id,
          emailType: "PASSWORD_RESET",
          subject: "Reset your CodeArena password",
          html: wrapBranded(`<p>Hi ${user.name},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email.</p>`),
        });
        // sendMailLogged never throws on a delivery failure (that lands in the EmailLog row), so reaching here means the request was queued and the claim stands.
        auditFor(req, user, AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED, {});
      } catch (sendErr) {
        // Nothing was queued: release the claim so an infrastructure hiccup does not cost the user their one request for 24h.
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
    html: wrapBranded(`<p>Hi ${user.name},</p><p>Your password was just changed via the "forgot password" link, and any devices you were previously signed in on have been signed out. If this wasn't you, contact your administrator immediately.</p>`),
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

module.exports = { login, permissions, logout, forgotPassword, resetPassword, verifyEmail, registrationDisabled: () => d.MESSAGES.registrationDisabled };
