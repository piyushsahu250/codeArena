// Configurable result remarks/tags (spec section 5): "expand this functionality to support at
// least three configurable result remarks/tags based on marks, percentage, or ranges." An
// examination with zero ResultRemarkBand rows has no configured tags — computeResultTag returns
// null in that case, and every caller falls back to the pre-existing passLabel/failLabel display
// entirely (unchanged behavior for every exam that predates this feature, and for any exam maker
// who simply never opens the tag-configuration UI).
//
// Same short-TTL-plus-explicit-invalidation cache shape as resultGrading.js, for the same
// reason: tag computation runs on every entry save/bulk-import row.
const prisma = require("../prisma");

const TTL_MS = 30_000;
const cache = new Map(); // examinationId -> { bands: [...], expiresAt }

function invalidateTagCache(examinationId) {
  if (examinationId) cache.delete(examinationId);
}

async function getRemarkBands(examinationId) {
  if (!examinationId) return [];
  const hit = cache.get(examinationId);
  if (hit && hit.expiresAt > Date.now()) return hit.bands;
  const bands = await prisma.resultRemarkBand.findMany({ where: { examinationId }, orderBy: { order: "asc" } });
  cache.set(examinationId, { bands, expiresAt: Date.now() + TTL_MS });
  return bands;
}

// Every band has EITHER a percent range OR a marks range (never both — validated at save time in
// resultManagement.js), so this checks whichever pair is actually set on this band.
function bandMatches(band, obtainedMarks, percentage) {
  if (band.minPercent != null || band.maxPercent != null) {
    if (band.minPercent != null && percentage < band.minPercent) return false;
    if (band.maxPercent != null && percentage > band.maxPercent) return false;
    return true;
  }
  if (band.minMarks != null || band.maxMarks != null) {
    if (band.minMarks != null && obtainedMarks < band.minMarks) return false;
    if (band.maxMarks != null && obtainedMarks > band.maxMarks) return false;
    return true;
  }
  return false; // a malformed band with neither range set never matches anything
}

// Returns the configured tag label for this PRESENT entry, or null if this exam has no bands
// configured, or if no configured band actually covers this mark/percentage (a gap in the exam
// maker's own bands — surfaced as "no tag", never guessed). Bands are evaluated in `order`;
// the first match wins, so an exam maker who wants a specific priority between overlapping ranges
// controls it via ordering.
async function computeResultTag(examinationId, obtainedMarks, percentage) {
  const bands = await getRemarkBands(examinationId);
  if (!bands.length) return null;
  const match = bands.find((b) => bandMatches(b, obtainedMarks, percentage));
  return match ? match.label : null;
}

// Validates a proposed band list before it's saved (spec: "the system should allow the examination
// maker to configure the comparison/range criteria... minimum/maximum marks or percentage").
// Returns an error string, or null if the list is valid.
function validateRemarkBands(bands) {
  if (!Array.isArray(bands)) return "bands must be an array";
  for (const b of bands) {
    if (!b.label || !String(b.label).trim()) return "Every tag needs a label";
    const hasPercent = b.minPercent != null || b.maxPercent != null;
    const hasMarks = b.minMarks != null || b.maxMarks != null;
    if (hasPercent && hasMarks) return `Tag "${b.label}": set either a percentage range or a marks range, not both`;
    if (!hasPercent && !hasMarks) return `Tag "${b.label}": set a percentage range or a marks range`;
    if (hasPercent) {
      if (b.minPercent != null && b.maxPercent != null && Number(b.minPercent) > Number(b.maxPercent)) {
        return `Tag "${b.label}": minimum percentage cannot exceed maximum percentage`;
      }
    }
    if (hasMarks) {
      if (b.minMarks != null && b.maxMarks != null && Number(b.minMarks) > Number(b.maxMarks)) {
        return `Tag "${b.label}": minimum marks cannot exceed maximum marks`;
      }
    }
  }
  return null;
}

module.exports = { computeResultTag, invalidateTagCache, validateRemarkBands };
