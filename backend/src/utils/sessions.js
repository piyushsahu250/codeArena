const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma");
const { parseDevice } = require("./auditLog");
const cache = require("./cache");
const { getClientIp } = require("./clientIp");

const TOKEN_TTL = "12h";
// isSessionActive runs on every authenticated request platform-wide — caching it turns "one DB
// query per request" into "one DB query per active session per 15s", trading a small worst-case
// delay on forced-logout takeoff for a large reduction in per-request DB load. Explicit
// revocation (endSession) bypasses the delay by invalidating the cache entry directly.
const SESSION_CACHE_TTL_MS = 15000;

// Issues a JWT carrying a random `jti` and writes the matching LoginSession row in the same
// call, so every live token always has exactly one session record to check revocation against.
// When `singleSessionOnly` is set (Institute.singleSessionOnly), every other active session for
// this user is closed first — "single active session" means the new login wins, not the old one.
async function createSession({ user, req, singleSessionOnly }) {
  const jti = crypto.randomBytes(16).toString("hex");
  const token = jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name, jti }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });

  if (singleSessionOnly) {
    const toClose = await prisma.loginSession.findMany({ where: { userId: user.id, isActive: true }, select: { token: true } });
    await prisma.loginSession.updateMany({
      where: { userId: user.id, isActive: true },
      data: { isActive: false, logoutAt: new Date() },
    });
    for (const s of toClose) cache.invalidate(`session-active:${s.token}`);
  }

  const { browser, os, device } = parseDevice(req.headers["user-agent"]);
  await prisma.$transaction([
    prisma.loginSession.create({
      data: { userId: user.id, token: jti, ip: getClientIp(req) || null, device, browser, os },
    }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ]);

  return token;
}

// Used by the authenticate middleware after JWT signature/expiry verification passes — a
// syntactically valid token can still be dead if its session was revoked (forced logout from
// another device, or replaced by a newer single-session login). Missing session row = token
// predates this feature and is treated as still valid rather than force-logging out everyone.
async function isSessionActive(jti) {
  if (!jti) return true;
  return cache.cached(`session-active:${jti}`, SESSION_CACHE_TTL_MS, async () => {
    const session = await prisma.loginSession.findUnique({ where: { token: jti } });
    return !session || session.isActive;
  });
}

async function endSession(jti) {
  if (!jti) return;
  await prisma.loginSession.updateMany({ where: { token: jti }, data: { isActive: false, logoutAt: new Date() } });
  cache.invalidate(`session-active:${jti}`);
}

// Closes every currently-active session for a user — used when their password changes via an
// admin-triggered reset, so a device that was already logged in (possibly the very reason the
// reset was needed, e.g. a suspected-compromised account) doesn't stay authenticated on the old
// credential until its 12h token naturally expires. Same close-and-invalidate pattern
// createSession() already uses for its singleSessionOnly branch, just applied unconditionally
// here rather than only when that institute setting is on. Not wired into the student's own
// self-service forgot-password flow — that's a separate, pre-existing gap left alone here since
// it wasn't part of what this change touches.
async function revokeAllSessions(userId) {
  const toClose = await prisma.loginSession.findMany({ where: { userId, isActive: true }, select: { token: true } });
  if (toClose.length === 0) return;
  await prisma.loginSession.updateMany({ where: { userId, isActive: true }, data: { isActive: false, logoutAt: new Date() } });
  for (const s of toClose) cache.invalidate(`session-active:${s.token}`);
}

module.exports = { createSession, isSessionActive, endSession, revokeAllSessions };
