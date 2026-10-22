// Bounded reading of ZIP-based uploads (.xlsx spreadsheets, .docx resumes). The sizes a ZIP header declares are only a claim: a few kilobytes of upload can inflate to gigabytes, and
// the libraries that read these formats (SheetJS, mammoth) inflate every part into memory inside the API process, which also serves exam traffic. checkZip inflates each part itself
// with a hard output ceiling and says whether the archive is safe to hand to such a library; it never allocates more than the ceiling for any one part.
const zlib = require("zlib");
const AdmZip = require("adm-zip");

// Real inflated size of one ZIP part, or Infinity when it exceeds `max`. 0 for a part this check cannot interpret (the library then reports it as unreadable).
function inflatedSize(entry, max) {
  const method = entry.header && entry.header.method;
  let raw;
  try { raw = entry.getCompressedData(); } catch { return 0; }
  if (!raw) return 0;
  if (method === 0) return raw.length > max ? Infinity : raw.length;
  if (method !== 8) return 0;
  try {
    return zlib.inflateRawSync(raw, { maxOutputLength: max }).length;
  } catch (err) {
    if (err && (err.code === "ERR_BUFFER_TOO_LARGE" || err instanceof RangeError)) return Infinity;
    return 0; // corrupt stream: the library will say so
  }
}

// null when the archive is within the limits; otherwise "unreadable" (not an archive this check can open), "too-many-parts" or "too-large". Each caller words its own error.
function checkZip(buffer, { maxPartBytes, maxTotalBytes, maxParts }) {
  let zip;
  try { zip = new AdmZip(buffer); } catch { return "unreadable"; }
  const parts = zip.getEntries().filter((entry) => !entry.isDirectory);
  if (parts.length > maxParts) return "too-many-parts";
  let total = 0;
  for (const part of parts) {
    const size = inflatedSize(part, maxPartBytes);
    total += size === Infinity ? maxPartBytes + 1 : size;
    if (size === Infinity || total > maxTotalBytes) return "too-large";
  }
  return null;
}

module.exports = { checkZip, inflatedSize };
