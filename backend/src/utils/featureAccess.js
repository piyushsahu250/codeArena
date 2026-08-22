const prisma = require("../prisma");
const { FEATURE_CATALOG, FEATURE_KEYS } = require("./featureCatalog");

// In-memory per-institute cache — Section 21 of the spec asks for changes to "become effective
// quickly" without hitting the DB on every request. Explicit invalidation (below) covers the
// normal admin-edit path; the short TTL is only a safety net for any write path that forgets to
// invalidate, and bounds staleness after a process restart wipes the cache.
const TTL_MS = 30_000;
const cache = new Map(); // instituteId -> { map: {featureKey: enabled}, expiresAt }

function invalidateFeatureCache(instituteId) {
  if (instituteId) cache.delete(instituteId);
}

function invalidateAllFeatureCaches() {
  cache.clear();
}

// Returns the full resolved feature map for an institute: every catalog key present, defaulting to
// enabled=true for any key with no explicit row. `null` instituteId (platform-level accounts with
// no institute, e.g. the seeded Platform Admin) means "unscoped" — everything enabled, since there
// is no institute to restrict against.
async function getInstituteFeatureMap(instituteId) {
  if (!instituteId) {
    const all = {};
    for (const key of FEATURE_KEYS) all[key] = true;
    return all;
  }

  const cached = cache.get(instituteId);
  if (cached && cached.expiresAt > Date.now()) return cached.map;

  const rows = await prisma.featureSetting.findMany({ where: { instituteId } });
  const byKey = new Map(rows.map((r) => [r.featureKey, r.enabled]));
  const map = {};
  for (const key of FEATURE_KEYS) map[key] = byKey.has(key) ? byKey.get(key) : true; // Section 12 Option A default

  cache.set(instituteId, { map, expiresAt: Date.now() + TTL_MS });
  return map;
}

// A feature counts as enabled only if it AND every feature it (one level) depends on are enabled —
// Section 23: a dependency being off must not leave the dependent feature silently half-working.
async function isFeatureEnabled(instituteId, featureKey) {
  const map = await getInstituteFeatureMap(instituteId);
  if (!map[featureKey]) return false;
  const entry = FEATURE_CATALOG.find((f) => f.key === featureKey);
  if (entry?.dependsOn && !map[entry.dependsOn]) return false;
  return true;
}

module.exports = { getInstituteFeatureMap, isFeatureEnabled, invalidateFeatureCache, invalidateAllFeatureCaches };
