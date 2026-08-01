const jwt = require("jsonwebtoken");
const { isSessionActive } = require("../utils/sessions");

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    // A syntactically valid, unexpired token can still be dead: forced logout from another
    // device, or replaced by a newer login under Institute.singleSessionOnly. Tokens issued
    // before session tracking existed have no jti and are grandfathered in as always-active.
    if (payload.jti && !(await isSessionActive(payload.jti))) {
      return res.status(401).json({ error: "This session has been signed out. Please log in again." });
    }
    req.user = payload; // { id, role, email, jti }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
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
