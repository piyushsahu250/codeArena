const jwt = require("jsonwebtoken");
const { isSessionActive } = require("../utils/sessions");

// `authExpired: true` on every 401 this middleware produces is a deliberate discriminator for the
// frontend's global axios interceptor (see frontend/src/api.js) — it needs to force a re-login
// when the token/session itself is dead, but must NOT do that for the platform's other, unrelated
// 401s (e.g. "Incorrect password" when an admin re-confirms their own password before deleting an
// academic group, or a wrong current-password on the change-password flow) which are just a normal
// inline form error, not a dead session. Without this flag, the interceptor would have no reliable
// way to tell those apart and would incorrectly force-logout a user who simply mistyped a password.
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header", authExpired: true });
  }
  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    // A syntactically valid, unexpired token can still be dead: forced logout from another
    // device, or replaced by a newer login under Institute.singleSessionOnly. Tokens issued
    // before session tracking existed have no jti and are grandfathered in as always-active.
    if (payload.jti && !(await isSessionActive(payload.jti))) {
      return res.status(401).json({ error: "This session has been signed out. Please log in again.", authExpired: true });
    }
    req.user = payload; // { id, role, email, jti }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token", authExpired: true });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
