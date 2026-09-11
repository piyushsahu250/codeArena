// Extracts the images bundled alongside a bulk-question-upload spreadsheet — a staff member fills
// in an "Image File Name" column (e.g. "triangle.png") and uploads a matching ZIP of the actual
// image files. Used by questions.js's runQuizBulkImport/runCodingBulkImport, never called
// directly from a route.
const AdmZip = require("adm-zip");
const { sniffImageMime } = require("./questionImages");

// Zip-bomb / resource-exhaustion guards. A real question-image ZIP for even a large bulk upload
// (hundreds of diagrams) is nowhere near these — they exist purely to bound how much memory/CPU
// an uploaded ZIP can make this process spend, since AdmZip fully decompresses in memory.
const MAX_ENTRIES = 2000;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024; // 100MB across every image combined
const MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024; // matches questionImages.js's own per-image cap

// Returns { filesByName: Map<lowercase-basename, Buffer>, error } — filesByName is keyed by the
// entry's basename only (a "diagrams/triangle.png" path inside the zip still matches an "Image
// File Name" cell of just "triangle.png"), lowercased so the match is case-insensitive the same
// way every other bulk-import column match on this platform already is. `error` is a single,
// user-readable string set only when the ZIP itself couldn't be processed at all (corrupt file,
// too many/too-large entries) — matching the "reject unsafe or malformed files gracefully, never
// crash the backend" requirement.
function extractImageZip(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return { filesByName: null, error: "Could not read the uploaded images ZIP. Please check it isn't corrupted." };
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length > MAX_ENTRIES) {
    return { filesByName: null, error: `The images ZIP has too many files (${entries.length}, max ${MAX_ENTRIES}).` };
  }

  const filesByName = new Map();
  let totalBytes = 0;
  for (const entry of entries) {
    // AdmZip's own header exposes the DECLARED uncompressed size before actually inflating it —
    // checked first so a maliciously crafted entry claiming a huge size is rejected without ever
    // calling getData() (which would do the actual, expensive decompression).
    const declaredSize = entry.header?.size || 0;
    if (declaredSize > MAX_SINGLE_FILE_BYTES) continue; // skip oversized entries silently -- surfaced per-row as "image not found" if referenced
    totalBytes += declaredSize;
    if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      return { filesByName: null, error: `The images ZIP is too large once extracted (over ${Math.round(MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024))}MB total).` };
    }
    // entryName can contain a folder path ("figures/triangle.png") -- only the basename is ever
    // matched against a spreadsheet cell, so a staff member's own folder structure inside the zip
    // never matters.
    const basename = entry.entryName.split("/").pop().split("\\").pop();
    if (!basename) continue;
    const key = basename.toLowerCase();
    // First entry with a given basename wins -- a zip with two files that happen to share a name
    // in different folders is a staff-side authoring mistake, not something to guess about; the
    // second is simply never reachable by any "Image File Name" cell, same as if it weren't there.
    if (filesByName.has(key)) continue;
    let data;
    try {
      data = entry.getData();
    } catch {
      continue; // a genuinely corrupt individual entry -- treated as "not present," not a hard failure of the whole zip
    }
    if (data.length > MAX_SINGLE_FILE_BYTES) continue;
    filesByName.set(key, data);
  }

  return { filesByName, error: null };
}

// Validates one image's bytes the exact same way the single-question image-upload route does
// (utils/questionImages.js's sniffImageMime) -- never trusts the file extension in its name.
// Returns { mime } on success or { error } naming exactly what's wrong, for a clear per-row error.
function validateZipImage(buffer, displayName) {
  if (!buffer) return { error: `Image "${displayName}" was not found in the uploaded ZIP (or was skipped for being too large/corrupted).` };
  const mime = sniffImageMime(buffer);
  if (!mime) {
    return { error: `Image "${displayName}" isn't a recognized image format — use PNG, JPEG, GIF, or WebP.` };
  }
  return { mime };
}

module.exports = { extractImageZip, validateZipImage, MAX_SINGLE_FILE_BYTES };
