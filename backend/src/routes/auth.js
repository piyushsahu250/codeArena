const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../prisma");
const { dbRateLimit } = require("../utils/dbRateLimit");
const { getClientIp } = require("../utils/clientIp");
const { sendMail, sendMailLogged, wrapBranded } = require("../utils/mailer");
const { createSession, endSession } = require("../utils/sessions");
const { logAudit, parseDevice, AUDIT_ACTIONS } = require("../utils/auditLog");
const { validatePasswordComplexity, isPasswordReused, recordPasswordChange, isPasswordExpired } = require("../utils/password");
const { authenticate } = require("../middleware/auth");
const { computeMandatoryCompletion } = require("../utils/studentProfileCompletion");
const { decryptProfile } = require("../utils/piiEncryption");

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena-app.vercel.app";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// A syntactically valid but unowned bcrypt hash (the well-known "password" fixture from bcrypt's
// own test suite) — compared against on a login attempt for an email that doesn't exist, so the
// route does genuine bcrypt work either way. Without this, "no such account" would return faster
// than "wrong password" (skips the compare entirely), which is itself a timing side-channel an
// attacker could use to enumerate valid emails even with an identical response body.
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

// Keyed by IP+email (not just IP) so a shared campus/lab IP doesn't get one collective lockout
// budget shared across every student behind it, while still capping how fast any single email can
// be brute-forced from one source. The global limiter in index.js (600/5min) is far too loose to
// stop credential-stuffing against one account. skipSuccessful means a legitimate user logging in
// a few times in a row (multiple devices, a page refresh) never eats into their own failed-attempt
// budget — only non-2xx responses (wrong password, account not found, etc.) count.
//
// Backed by the database (dbRateLimit), not express-rate-limit's in-memory store: live testing
// against the deployed backend showed the in-memory version's remaining-attempts count resetting
// mid-window across sequential requests — see dbRateLimit.js for the full explanation.
const loginLimiter = dbRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessful: true,
  keyGenerator: (req) => `login:${getClientIp(req)}:${String(req.body?.email || "").toLowerCase()}`,
  message: { error: "Too many login attempts. Please try again later." },
});

// Separate from loginLimiter deliberately — different abuse shape (triggering unwanted emails to
// a real inbox, not credential guessing) and a much tighter threshold makes sense here regardless
// of what email was requested, so this is IP-only (no per-email keying). skipSuccessful is
// deliberately NOT set here: this route always returns 200 by design (enumeration protection), so
// "skip successful" would mean nothing is ever counted — every request must count.
const forgotPasswordLimiter = dbRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `forgot-password:${getClientIp(req)}`,
  message: { error: "Too many password reset requests. Please try again later." },
});

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

// Self-registration is disabled — all accounts (including students) are
// created by an admin via POST /api/users. This route is kept only to give
// anyone hitting it directly a clear, consistent message.
router.post("/register", async (req, res) => {
  res.status(403).json({ error: "User registration is managed by the administrator. Please contact your institute administrator to receive your login credentials." });
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email }, include: { institute: true } });

    // Both "no such account" and "wrong password" run through bcrypt.compare (against the real
    // hash if the account exists, DUMMY_HASH otherwise) and return the exact same message, so
    // neither the response text nor its timing tells a caller whether a given email is registered.
    // isActive is deliberately checked AFTER the password, not before: it only fires once someone
    // has already proven they know the correct password for a real account, so a deactivated
    // account's status is never revealed to someone who's just guessing.
    const valid = await bcrypt.compare(password || "", user ? user.passwordHash : DUMMY_HASH);
    if (!user || !valid) {
      if (user) {
        // Fire-and-forget (logAudit already catches its own errors) — the response to a wrong
        // password doesn't need to wait on an audit-log write, and this is one fewer DB round-trip
        // held open during a login burst.
        logAudit({ req, action: AUDIT_ACTIONS.LOGIN_FAILED, actorId: user.id, actorName: user.name, actorRole: user.role, studentId: user.id, instituteId: user.instituteId, details: { email } });
      }
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (!user.isActive) return res.status(403).json({ error: "This account has been deactivated. Contact your administrator." });

    // Sequential, not Promise.all: this platform's Prisma pool is deliberately small
    // (connection_limit — see prisma.js), and every simultaneous query in a login request
    // checks out its own connection at once. Under a burst of concurrent logins (a whole class/
    // batch signing in within the same minute), stacking parallel queries multiplies the peak
    // connections needed per request and was the direct cause of "Transaction API error: unable
    // to start a transaction in the given time." These two reads are cheap and independent, so
    // running them one after another costs a few extra ms of latency in exchange for materially
    // less pool contention during exactly the bursts that were failing.
    const priorSessionCount = await prisma.loginSession.count({ where: { userId: user.id } });
    const deviceSeenBefore = await prisma.loginSession.findFirst({ where: { userId: user.id, browser: parseDevice(req.headers["user-agent"]).browser, os: parseDevice(req.headers["user-agent"]).os } });
    const isFirstLogin = priorSessionCount === 0;
    const isNewDevice = !isFirstLogin && !deviceSeenBefore;

    const token = await createSession({ user, req, singleSessionOnly: !!user.institute?.singleSessionOnly });

    // Password-expiry is computed live rather than only trusted from the stored flag, so a
    // newly-expired password is caught the moment the institute's policy window elapses, not
    // only from whatever value happened to be persisted at account creation/last reset.
    const expired = isPasswordExpired(user, user.institute?.passwordExpiryDays);
    const mustChangePassword = user.mustChangePassword || expired;
    if (expired && !user.mustChangePassword) {
      // Fire-and-forget — the response already carries the correct mustChangePassword value
      // (computed above from `expired`, not from this write), so the client doesn't need to wait
      // on this persisting before proceeding.
      prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } }).catch(() => {});
    }

    // Fire-and-forget (logAudit already catches its own errors) — trims one more DB round-trip
    // off the login critical path during a login burst; the audit record still lands, just not
    // before the response is sent.
    logAudit({ req, action: AUDIT_ACTIONS.LOGIN, actorId: user.id, actorName: user.name, actorRole: user.role, studentId: user.id, instituteId: user.instituteId, details: { isFirstLogin, isNewDevice } });
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
      // Sequential for the same pool-contention reason as the session lookups above.
      const studentProfile = await prisma.studentProfile.findUnique({ where: { studentId: user.id } });
      const resume = await prisma.resume.findUnique({ where: { studentId: user.id }, select: { education: true, fullName: true, email: true } });
      const documents = await prisma.studentDocument.findMany({ where: { studentId: user.id }, select: { id: true } });
      profileComplete = computeMandatoryCompletion(user, decryptProfile(studentProfile), resume, documents).unlocked;
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
router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
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
    // The hash write and the passwordChangedAt/PasswordHistory write must succeed or fail
    // together — a crash between them would leave a changed password with no expiry stamp and
    // no reuse-history record, silently breaking both password-expiry enforcement and reuse
    // prevention for this account.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, resetTokenHash: null, resetTokenExpiry: null },
      });
      await recordPasswordChange(tx, user.id, passwordHash, user.institute?.passwordHistoryDepth);
    });

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
