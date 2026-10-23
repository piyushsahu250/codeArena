// /api/auth: URLs, authentication and rate limits only. The rules live in auth.service.js.
// The limiters are backed by the database (dbRateLimit), not an in-memory store: live testing showed an in-memory count resetting mid-window across requests.
const express = require("express");
const { dbRateLimit } = require("../../utils/dbRateLimit");
const { getClientIp } = require("../../utils/clientIp");
const { authenticate } = require("../../middleware/auth");
const c = require("./auth.controller");

const router = express.Router();

// Keyed by IP+email (not just IP) so a shared campus or lab address does not share one lockout budget across every student behind it, while still capping how fast
// one email can be brute-forced from one source. skipSuccessful: only failed attempts count, so a user logging in several times in a row never eats their own budget.
const loginKey = (req) => `login:${getClientIp(req)}:${String(req.body?.email || "").toLowerCase()}`;
const loginLimiter = dbRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessful: true,
  keyGenerator: loginKey,
  message: { error: "Too many login attempts. Please try again later." },
});

// The first-login password change checks the temporary password exactly as the login does, so it draws on the SAME budget (same key: a second endpoint must not double the
// number of guesses an attacker gets). Only a rejected credential (401) counts: a rejected NEW password (400) comes after the credential was proved right, and the page
// stops most of those before they are sent, so they must not lock a student out of the very step that lets them in.
const changeTemporaryPasswordLimiter = dbRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessful: true,
  isFailure: (res) => res.statusCode === 401,
  keyGenerator: loginKey,
  message: { error: "Too many login attempts. Please try again later." },
});

// A different abuse shape (unwanted e-mail to a real inbox, not credential guessing), so a tighter, IP-only limit. Every request counts: the route always answers
// 200 by design, so "skip successful" would mean nothing is ever counted.
const forgotPasswordLimiter = dbRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `forgot-password:${getClientIp(req)}`,
  message: { error: "Too many password reset requests. Please try again later." },
});

// Defense in depth for redeeming a token: the token has 256 bits of entropy so guessing is not practical, but this caps automated probing and replay of a leaked one.
// IP-keyed (keying by the secret being tested would defeat the point) and generous enough for a few retries after a rejected password.
const resetPasswordLimiter = dbRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `reset-password:${getClientIp(req)}`,
  message: { error: "Too many password reset attempts. Please try again later." },
});

const verifyEmailLimiter = dbRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `verify-email:${getClientIp(req)}`,
  message: { error: "Too many verification attempts. Please try again later." },
});

router.post("/register", c.register);
router.post("/login", loginLimiter, c.login);
router.post("/change-temporary-password", changeTemporaryPasswordLimiter, c.changeTemporaryPassword);
router.get("/permissions", authenticate, c.permissions);
router.post("/logout", authenticate, c.logout);
router.post("/forgot-password", forgotPasswordLimiter, c.forgotPassword);
router.post("/reset-password", resetPasswordLimiter, c.resetPassword);
router.post("/verify-email", verifyEmailLimiter, c.verifyEmail);

module.exports = router;
