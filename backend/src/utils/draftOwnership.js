// Ownership rules for the shared AI-review queues and the company catalogue (audit item T-3).
//   * An institute-bound reviewer (req.requesterInstituteId set) only ever sees and acts on rows owned by THEIR institute.
//   * A platform-level reviewer (no instituteId) sees and acts on everything, including platform-owned rows (instituteId null:
//     legacy rows and scheduler output).
// Requires attachRequesterInstitute earlier in the middleware chain.
const ownerWhere = (req) => (req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {});
const ownsRow = (req, row) => !req.requesterInstituteId || (!!row && row.instituteId === req.requesterInstituteId);
const isPlatformLevel = (req) => !req.requesterInstituteId;

// Route guard for resources that only a platform-level account may touch (global configuration).
function requirePlatformLevel(req, res, next) {
  if (req.requesterInstituteId) return res.status(403).json({ error: "This is a platform-wide setting and can only be changed by a platform administrator." });
  next();
}

module.exports = { ownerWhere, ownsRow, isPlatformLevel, requirePlatformLevel };
