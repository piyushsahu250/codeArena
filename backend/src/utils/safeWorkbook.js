// The one way uploaded spreadsheets are read. An .xlsx is a ZIP of XML, so a few kilobytes of upload (the multer limit is 5 MB) can describe gigabytes of cells; the
// spreadsheet library inflates everything into memory inside the API process, which also serves exam traffic. This reader refuses such a file BEFORE it is parsed:
//  * a ZIP-based workbook is checked by inflating every part with a hard output ceiling (the sizes a ZIP header declares are only a claim),
//  * the row count is capped (a legitimate import is thousands of rows, not millions),
// and anything over a limit is rejected with one clear error instead of being truncated silently. CSV and other non-ZIP inputs only get the row cap.
const zlib = require("zlib");
const AdmZip = require("adm-zip");
const XLSX = require("xlsx");

const MAX_PART_BYTES = 64 * 1024 * 1024; // one inflated XML part (a worksheet)
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // all parts together
const MAX_PARTS = 2000;
const DEFAULT_MAX_ROWS = 50000;

class WorkbookTooLargeError extends Error {
  constructor(message) { super(message); this.name = "WorkbookTooLargeError"; this.code = "WORKBOOK_TOO_LARGE"; }
}

const isZip = (buf) => buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;

// Real inflated size of one ZIP part, or Infinity when it exceeds `max`. Never allocates more than `max` bytes. 0 for a part this check cannot interpret (the library then
// reports it as unreadable).
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

function assertSafeZip(buffer) {
  let zip;
  try { zip = new AdmZip(buffer); } catch { throw new WorkbookTooLargeError("Could not read this file. Please upload a valid .xlsx or .csv file."); }
  const parts = zip.getEntries().filter((e) => !e.isDirectory);
  if (parts.length > MAX_PARTS) throw new WorkbookTooLargeError("This spreadsheet is too large to import.");
  let total = 0;
  for (const part of parts) {
    const size = inflatedSize(part, MAX_PART_BYTES);
    total += size === Infinity ? MAX_PART_BYTES + 1 : size;
    if (size === Infinity || total > MAX_TOTAL_BYTES) throw new WorkbookTooLargeError("This spreadsheet is too large to import once unpacked. Split it into smaller files.");
  }
}

// Same result as XLSX.read(buffer, { type: "buffer" }), or throws. `maxRows` counts rows per sheet, header included.
function readWorkbook(buffer, { maxRows = DEFAULT_MAX_ROWS } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error("A file buffer is required");
  if (isZip(buffer)) assertSafeZip(buffer);
  const workbook = XLSX.read(buffer, { type: "buffer", sheetRows: maxRows + 1 });
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const full = sheet && sheet["!fullref"]; // set by the library when sheetRows cut the sheet short
    if (full && XLSX.utils.decode_range(full).e.r + 1 > maxRows) throw new WorkbookTooLargeError(`This spreadsheet has more than ${maxRows} rows. Split it into smaller files.`);
  }
  return workbook;
}

module.exports = { readWorkbook, WorkbookTooLargeError, MAX_PART_BYTES, MAX_TOTAL_BYTES, DEFAULT_MAX_ROWS };
