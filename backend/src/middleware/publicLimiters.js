const rateLimit = require("express-rate-limit");

// Public (unauthenticated) verification endpoints return a holder's name/institute for a certificate or marksheet code. Codes follow
// a readable pattern (year / institute / programme / sequence), so without a tight per-IP budget they can be enumerated. 30 lookups a
// minute per IP is far above any human use (a verifier checks a handful of codes) and far below useful scraping. These endpoints are
// not behind login, so the budget is per IP (the global limiter's per-user keying cannot apply).
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { valid: false, error: "Too many verification requests. Please wait a minute and try again." },
});

module.exports = { verifyLimiter };
