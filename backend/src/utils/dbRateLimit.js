const prisma = require("../prisma");

// A Postgres-backed rate limiter for the handful of low-traffic, abuse-sensitive auth endpoints
// (login, forgot-password) where correctness matters more than raw throughput. Chosen over
// express-rate-limit's in-memory store after live testing against the deployed backend showed the
// remaining-attempts count resetting mid-window across sequential requests — consistent with more
// than one backend process each holding its own independent in-memory Map, which no in-memory
// store can protect against. The database every deployment already has is correct regardless of
// how many app processes handle a given request, with no new service/account to set up.
//
// `skipSuccessful: true` mirrors express-rate-limit's skipSuccessfulRequests — the hit is recorded
// only after the response is known, and only if it was a failure (status >= 400). Without it, every
// request (success or failure) counts, which is what forgot-password needs (it always returns 200
// by design, for enumeration protection, so skipSuccessful there would mean nothing is ever counted).
function dbRateLimit({ windowMs, max, keyGenerator, message, skipSuccessful = false }) {
  return async function (req, res, next) {
    let key;
    try {
      key = keyGenerator(req);
      const windowStart = new Date(Date.now() - windowMs);
      // Cleanup + count + (for the non-skipSuccessful path) the insert all run inside one
      // transaction — same connection for the whole check, so there's no gap where a count on one
      // pooled connection could miss a create that just committed on another. Two rapid requests
      // hitting this concurrently still can't both slip through under the limit: Postgres serializes
      // writes to the same key's rows, so the second transaction's count always sees the first's
      // committed insert once it commits.
      const allowed = await prisma.$transaction(async (tx) => {
        await tx.rateLimitHit.deleteMany({ where: { key, createdAt: { lt: windowStart } } });
        const count = await tx.rateLimitHit.count({ where: { key, createdAt: { gte: windowStart } } });
        if (count >= max) return false;
        if (!skipSuccessful) await tx.rateLimitHit.create({ data: { key } });
        return true;
      });
      if (!allowed) {
        res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
        return res.status(429).json(message);
      }
    } catch (err) {
      // A rate-limiter outage must never take down login/password-reset entirely — fail open.
      console.error("[dbRateLimit] check failed, allowing request through:", err.message);
      return next();
    }

    if (skipSuccessful) {
      res.on("finish", () => {
        if (res.statusCode >= 400) {
          prisma.rateLimitHit.create({ data: { key } }).catch((err) => console.error("[dbRateLimit] record failed:", err.message));
        }
      });
    }
    next();
  };
}

module.exports = { dbRateLimit };
