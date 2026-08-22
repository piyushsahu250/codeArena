const prisma = require("../prisma");
const { isFeatureEnabled } = require("../utils/featureAccess");

// Institute-wise feature enforcement (Section 7 of the feature-visibility spec): rejects the
// request server-side if `featureKey` is disabled for the AUTHENTICATED user's own institute.
// Always re-derives instituteId from the DB via req.user.id — never from req.body/req.query/a
// route param — so a student can't get a different institute's feature state by sending an
// instituteId of their choosing. Works whether or not attachRequesterInstitute already ran
// earlier in the chain (reuses req.requesterInstituteId if present, to avoid a duplicate query).
function requireFeature(featureKey) {
  return async function (req, res, next) {
    try {
      let instituteId = req.requesterInstituteId;
      if (instituteId === undefined) {
        const requester = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true } });
        instituteId = requester?.instituteId || null;
      }
      const enabled = await isFeatureEnabled(instituteId, featureKey);
      if (!enabled) {
        return res.status(403).json({ error: "Feature not available for your institute.", featureDisabled: true, featureKey });
      }
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to verify feature access" });
    }
  };
}

module.exports = { requireFeature };
