// A signed-in user's own account: change e-mail and/or password, re-send the verification link, and see or end their own sessions.
// A new e-mail is never written to the live column directly: it is held as pending until the link sent to the NEW address is opened (see auth.service verifyEmail),
// so a typo can never lock the owner out or misdirect future account mail. Behaviour and messages are those of the routes this replaced.
const bcrypt = require("bcryptjs");
const prisma = require("../../prisma");
const cache = require("../../utils/cache");
const { ServiceError } = require("../../utils/serviceError");
const { sendMailLogged, wrapBranded, escapeHtml } = require("../../utils/mailer");
const { createSession } = require("../../utils/sessions");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { validatePasswordComplexity, isPasswordReused, recordPasswordChange } = require("../../utils/password");
const { isValidEmail, normalizeEmail } = require("../../utils/emailValidation");
const d = require("./users.domain");
const repo = require("./users.repository");

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena.site";
const studentIdOf = (u) => (u.role === "STUDENT" ? u.id : null);

const verificationMail = (user, to, link, closing) => sendMailLogged(prisma, {
  to, name: user.name, emailType: "EMAIL_VERIFICATION", studentId: studentIdOf(user),
  subject: "Confirm your new CodeArena email address",
  html: wrapBranded(`<p>Hi ${escapeHtml(user.name)},</p><p>Click the link below to confirm this is your new sign-in email address. This link expires in 24 hours.</p><p><a href="${link}">${link}</a></p><p>Your current sign-in email stays active until you confirm this one.${closing}</p>`),
}).catch((e) => ({ ok: false, error: e.message }));

async function updateOwnAccount(req, { currentPassword, newEmail: rawNewEmail, newPassword }) {
  if (!currentPassword) throw new ServiceError(400, "currentPassword is required");
  if (!rawNewEmail && !newPassword) throw new ServiceError(400, "Provide newEmail and/or newPassword");

  const user = await repo.findUser(req.user.id);
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new ServiceError(401, "Current password is incorrect");

  const data = {};
  let newEmailNormalized = null;
  let pendingVerifyToken = null;
  if (rawNewEmail) {
    newEmailNormalized = normalizeEmail(rawNewEmail);
    if (!isValidEmail(newEmailNormalized)) throw new ServiceError(400, "Please enter a valid email address");
    if (newEmailNormalized !== user.email) {
      if (await repo.findUserByEmail(newEmailNormalized)) throw new ServiceError(409, "This email address is already associated with an account");
      pendingVerifyToken = d.newVerificationToken();
      data.pendingEmail = newEmailNormalized;
      data.pendingEmailTokenHash = d.hashToken(pendingVerifyToken);
      data.pendingEmailTokenExpiry = new Date(Date.now() + d.VERIFICATION_TOKEN_TTL_MS);
    }
  }
  const institute = user.instituteId ? await repo.findInstitute(user.instituteId) : null;
  const depth = institute?.passwordHistoryDepth;
  let newPasswordHash = null;
  if (newPassword) {
    const complexityError = validatePasswordComplexity(newPassword);
    if (complexityError) throw new ServiceError(400, complexityError);
    if (newPassword === currentPassword) throw new ServiceError(400, "New password cannot be the same as your current password");
    if (await isPasswordReused(prisma, user.id, newPassword, depth)) {
      throw new ServiceError(400, `You've used this password recently. Choose a password you haven't used in your last ${depth ?? 3} passwords.`);
    }
    newPasswordHash = await bcrypt.hash(newPassword, 10);
    data.passwordHash = newPasswordHash;
    data.mustChangePassword = false;
  }

  let updated;
  if (newPasswordHash) updated = await repo.changePassword(user.id, data, (tx) => recordPasswordChange(tx, user.id, newPasswordHash, depth));
  else if (Object.keys(data).length > 0) updated = await repo.updateUser(user.id, data);
  else updated = await repo.selectUser(user.id); // nothing changed (e.g. the new e-mail equals the current one): same shape as the update branches

  if (newPasswordHash) {
    sendMailLogged(prisma, {
      to: updated.email, name: updated.name, emailType: "LOGIN_ALERT", studentId: studentIdOf(updated),
      subject: "Your CodeArena password was changed",
      html: wrapBranded(`<p>Hi ${escapeHtml(updated.name)},</p><p>Your password was just changed from your account settings. If this wasn't you, contact your administrator immediately.</p>`),
    }).catch((err) => console.error("[users] password-change alert email failed:", err.message));
  }
  let verificationEmailSent = null; // null = no e-mail change requested
  if (pendingVerifyToken) {
    const link = `${FRONTEND_URL}/verify-email?token=${pendingVerifyToken}`;
    const result = await sendMailLogged(prisma, {
      to: newEmailNormalized, name: updated.name, emailType: "EMAIL_VERIFICATION", studentId: studentIdOf(updated),
      subject: "Confirm your new CodeArena email address",
      html: wrapBranded(`<p>Hi ${escapeHtml(updated.name)},</p><p>Click the link below to confirm this is your new sign-in email address. This link expires in 24 hours.</p><p><a href="${link}">${link}</a></p><p>Your current sign-in email stays active until you confirm this one. If you didn't request this change, you can ignore this email.</p>`),
    }).catch((e) => ({ ok: false, error: e.message }));
    verificationEmailSent = !!result.ok;
  }

  const token = await createSession({ user: updated, req, singleSessionOnly: false });
  await logAudit({ req, action: AUDIT_ACTIONS.PASSWORD_CHANGED, actorId: user.id, actorName: user.name, actorRole: user.role, studentId: studentIdOf(user), instituteId: user.instituteId, details: { self: true, emailChangeRequested: !!pendingVerifyToken, verificationEmailSent, passwordChanged: !!newPasswordHash } });

  let message = null;
  if (pendingVerifyToken) {
    message = verificationEmailSent
      ? `Verification email sent to ${newEmailNormalized}. Your sign-in email stays as ${user.email} until you confirm the new one.`
      : `Account updated, but the verification email to ${newEmailNormalized} failed to send. Please try again.`;
  }
  return { token, user: updated, message, verificationEmailSent };
}

// Shares its rate-limit budget with updateOwnAccount (both send mail to the same address for the same reason).
async function resendVerification(userId) {
  const user = await repo.findUser(userId);
  if (!user.pendingEmail) throw new ServiceError(400, "No email change is pending");

  const verifyToken = d.newVerificationToken();
  await repo.setPendingEmailToken(user.id, d.hashToken(verifyToken), new Date(Date.now() + d.VERIFICATION_TOKEN_TTL_MS));
  const link = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
  const result = await verificationMail(user, user.pendingEmail, link, "");
  return {
    message: result.ok ? `Verification email re-sent to ${user.pendingEmail}.` : `Failed to send verification email to ${user.pendingEmail}. Please try again.`,
    verificationEmailSent: !!result.ok,
  };
}

// The newest 50, a personal history view rather than an audit export.
async function mySessions(user) {
  const sessions = await repo.listSessions(user.id);
  return sessions.map((s) => ({ ...s, isCurrent: s.token === user.jti, token: undefined }));
}

// Only one's OWN other sessions: an admin cannot kill someone else's session (deactivating the account is the supported way).
async function endMySession(req, sessionId) {
  const session = await repo.findSession(sessionId);
  if (!session || session.userId !== req.user.id) throw new ServiceError(404, "Session not found");
  if (session.token === req.user.jti) throw new ServiceError(400, "Use Sign Out to end your current session");

  await repo.endSession(session.id);
  cache.invalidate(`session-active:${session.token}`);
  await logAudit({ req, action: AUDIT_ACTIONS.SESSION_REVOKED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, studentId: req.user.id, details: { revokedSessionId: session.id, device: `${session.browser} on ${session.os}` } });
  return { message: "Session signed out" };
}

module.exports = { updateOwnAccount, resendVerification, mySessions, endMySession };
