// Institute-configurable grading scale (spec sections 11/12: "The exact grading scale must be
// configurable according to institute requirements", "Backend must be the source of truth").
// An institute with no ResultGradeBand rows has "no configured scale" — computeGrade returns null
// in that case, and the caller (resultManagement.js) falls back to the pre-existing plain
// admin-entered `grade` field, exactly the behavior before this file existed. This never
// fabricates a grading policy the institute hasn't actually configured.
//
// Same short-TTL-plus-explicit-invalidation cache shape as featureAccess.js, for the same
// reason: grade computation runs on every entry save/bulk-import row, so a fresh DB read per call
// would be wasteful, but a stale scale must never survive past an admin's own edit.
const prisma = require("../prisma");

const TTL_MS = 30_000;
const cache = new Map(); // instituteId -> { bands: [...], expiresAt }

function invalidateGradeCache(instituteId) {
  if (instituteId) cache.delete(instituteId);
}

async function getGradeBands(instituteId) {
  if (!instituteId) return [];
  const cached = cache.get(instituteId);
  if (cached && cached.expiresAt > Date.now()) return cached.bands;
  const bands = await prisma.resultGradeBand.findMany({ where: { instituteId }, orderBy: { order: "asc" } });
  cache.set(instituteId, { bands, expiresAt: Date.now() + TTL_MS });
  return bands;
}

// Returns the configured grade for `percentage`, or null if this institute has no scale
// configured, or if no configured band actually covers this percentage (a gap in the admin's own
// bands — surfaced as "no grade", never guessed).
async function computeGrade(instituteId, percentage) {
  const bands = await getGradeBands(instituteId);
  if (!bands.length) return null;
  const match = bands.find((b) => percentage >= b.minPercent && percentage <= b.maxPercent);
  return match ? match.grade : null;
}

module.exports = { computeGrade, invalidateGradeCache };
