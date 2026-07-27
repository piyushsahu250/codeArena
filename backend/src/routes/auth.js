const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../prisma");
const { sendMail, sendMailLogged, wrapBranded } = require("../utils/mailer");
const { createSession, endSession } = require("../utils/sessions");
const { logAudit, parseDevice, AUDIT_ACTIONS } = require("../utils/auditLog");
const { validatePasswordComplexity, isPasswordReused, recordPasswordChange, isPasswordExpired } = require("../utils/password");
const { authenticate } = require("../middleware/auth");
const { computeMandatoryCompletion } = require("../utils/studentProfileCompletion");

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena-app.vercel.app";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Best-effort, non-blocking — a login alert failing to send must never fail or slow the login
// itself. Fires for the account's very first login ever, or a login from a device/browser
// combination this account hasn't used before (a coarse but useful "new device" signal given
// this platform has no persistent device-fingerprint cookie).
async function maybeSendLoginAlert(user, req, isFirstLogin, isNewDevice) {
  if (!isFirstLogin && !isNewDevice) return;
  const { summary } = parseDevice(req.headers["user-agent"]);
  const reason = isFirstLogin ? "This was your first login to CodeArena." : "This login was from a device we haven't seen on your account before.";
  await sendMailLogged(prisma, {
    to: user.email,
    name: user.name,
    emailType: "LOGIN_ALERT",
    studentId: user.role === "STUDENT" ? user.id : null,
    subject: isFirstLogin ? "Welcome — first login to your CodeArena account" : "New device signed in to your CodeArena account",
    html: wrapBranded(`
      <p>Hi ${user.name},</p>
      <p>${reason}</p>
      <p><strong>Device:</strong> ${summary}<br/><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      <p>If this wasn't you, reset your password immediately and contact your administrator.</p>
    `),
  }).catch((err) => console.error("[auth] login alert email failed:", err.message));
}

// Self-registration is disabled — all accounts (including students) are
// created by an admin via POST /api/users. This route is kept only to give
// anyone hitting it directly a clear, consistent message.
router.post("/register", async (req, res) => {
  res.status(403).json({ error: "User registration is managed by the administrator. Please contact your institute administrator to receive your login credentials." });
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email }, include: { institute: true } });
    if (!user) return res.status(401).json({ error: "Email not found." });
    if (!user.isActive) return res.status(403).json({ error: "This account has been deactivated. Contact your administrator." });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await logAudit({ req, action: AUDIT_ACTIONS.LOGIN_FAILED, actorId: user.id, actorName: user.name, actorRole: user.role, studentId: user.role === "STUDENT" ? user.id : null, instituteId: user.instituteId, details: { email } });
      return res.status(401).json({ error: "Incorrect password." });
    }

    const [priorSessionCount, deviceSeenBefore] = await Promise.all([
      prisma.loginSession.count({ where: { userId: user.id } }),
      prisma.loginSession.findFirst({ where: { userId: user.id, browser: parseDevice(req.headers["user-agent"]).browser, os: parseDevice(req.headers["user-agent"]).os } }),
    ]);
    const isFirstLogin = priorSessionCount === 0;
    const isNewDevice = !isFirstLogin && !deviceSeenBefore;

    const token = await createSession({ user, req, singleSessionOnly: !!user.institute?.singleSessionOnly });

    // Password-expiry is computed live rather than only trusted from the stored flag, so a
    // newly-expired password is caught the moment the institute's policy window elapses, not
    // only from whatever value happened to be persisted at account creation/last reset.
    const expired = isPasswordExpired(user, user.institute?.passwordExpiryDays);
    const mustChangePassword = user.mustChangePassword || expired;
    if (expired && !user.mustChangePassword) {
      await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } }).catch(() => {});
    }

    await logAudit({ req, action: AUDIT_ACTIONS.LOGIN, actorId: user.id, actorName: user.name, actorRole: user.role, studentId: user.role === "STUDENT" ? user.id : null, instituteId: user.instituteId, details: { isFirstLogin, isNewDevice } });
    maybeSendLoginAlert(user, req, isFirstLogin, isNewDevice); // fire-and-forget — see comment above

    // Student Profile Completion gating — mirrors mustChangePassword's shape exactly (a boolean
    // the frontend checks on every protected-route render). Only ever true for STUDENT accounts
    // at an institute that has opted in; every other role/institute combination is unaffected.
    // Uses `unlocked` (>= UNLOCK_THRESHOLD_PERCENT), not `complete` (100%) — students reach the
    // rest of the platform once most of the checklist is done rather than being blocked on the
    // very last field or two; the missing-fields checklist keeps nudging them toward 100% anyway.
    let requireProfileCompletion = false;
    let profileComplete = true;
    if (user.role === "STUDENT" && user.institute?.requireProfileCompletion) {
      requireProfileCompletion = true;
      const [studentProfile, resume] = await Promise.all([
        prisma.studentProfile.findUnique({ where: { studentId: user.id } }),
        prisma.resume.findUnique({ where: { studentId: user.id }, select: { education: true, fullName: true, email: true } }),
      ]);
      profileComplete = computeMandatoryCompletion(user, studentProfile, resume).unlocked;
    }

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, instituteId: user.instituteId, mustChangePassword, requireProfileCompletion, profileComplete } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/logout", authenticate, async (req, res) => {
  try {
    await endSession(req.user.jti);
    await logAudit({ req, action: AUDIT_ACTIONS.LOGOUT, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, studentId: req.user.role === "STUDENT" ? req.user.id : null, details: {} });
    res.json({ message: "Logged out" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Logout failed" });
  }
});

// Request a password reset — always responds the same way whether or not the
// email exists, so this endpoint itself doesn't leak account existence (the
// login endpoint already does, per product requirement, but no need to widen
// that surface here too).
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      await prisma.user.update({
        where: { id: user.id },
        data: { resetTokenHash: hashToken(token), resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      });

      const resetLink = `${FRONTEND_URL}/reset-password?token=${token}`;
      await sendMail({
        to: user.email,
        subject: "Reset your CodeArena password",
        html: wrapBranded(`<p>Hi ${user.name},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can ignore this email.</p>`),
      });
    }

    res.json({ message: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process request" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: "token and newPassword are required" });
    const complexityError = validatePasswordComplexity(newPassword);
    if (complexityError) return res.status(400).json({ error: complexityError });

    const user = await prisma.user.findFirst({ where: { resetTokenHash: hashToken(token) }, include: { institute: true } });
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return res.status(400).json({ error: "This reset link is invalid or has expired" });
    }

    if (await isPasswordReused(prisma, user.id, newPassword, user.institute?.passwordHistoryDepth)) {
      return res.status(400).json({ error: `You've used this password recently. Choose a password you haven't used in your last ${user.institute?.passwordHistoryDepth ?? 3} passwords.` });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetTokenHash: null, resetTokenExpiry: null },
    });
    await recordPasswordChange(prisma, user.id, passwordHash, user.institute?.passwordHistoryDepth);

    sendMail({
      to: user.email,
      subject: "Your CodeArena password was changed",
      html: wrapBranded(`<p>Hi ${user.name},</p><p>Your password was just changed via the "forgot password" link. If this wasn't you, contact your administrator immediately.</p>`),
    }).catch((err) => console.error("[auth] password-change alert email failed:", err.message));

    res.json({ message: "Password updated. You can now sign in." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

module.exports = router;
