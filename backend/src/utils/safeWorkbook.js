// The one way uploaded spreadsheets are read. An .xlsx is a ZIP of XML, so a few kilobytes of upload (the multer limit is 5 MB) can describe gigabytes of cells; the
// spreadsheet library inflates everything into memory inside the API process, which also serves exam traffic. This reader refuses such a file BEFORE it is parsed:
//  * a ZIP-based workbook is checked by inflating every part with a hard output ceiling (the sizes a ZIP header declares are only a claim),
//  * the row count is capped (a legitimate import is thousands of rows, not millions),
// and anything over a limit is rejected with one clear error instead of being truncated silently. CSV and other non-ZIP inputs only get the row cap.
const XLSX = require("xlsx");
const { checkZip } = require("./safeZip");

const MAX_PART_BYTES = 64 * 1024 * 1024; // one inflated XML part (a worksheet)
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // all parts together
const MAX_PARTS = 2000;
const DEFAULT_MAX_ROWS = 50000;

class WorkbookTooLargeError extends Error {
  constructor(message) { super(message); this.name = "WorkbookTooLargeError"; this.code = "WORKBOOK_TOO_LARGE"; }
}

const isZip = (buf) => buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;

// The archive check itself is shared with the .docx resume upload (utils/safeZip.js); this only words the errors for a spreadsheet.
function assertSafeZip(buffer) {
  const problem = checkZip(buffer, { maxPartBytes: MAX_PART_BYTES, maxTotalBytes: MAX_TOTAL_BYTES, maxParts: MAX_PARTS });
  if (problem === "unreadable") throw new WorkbookTooLargeError("Could not read this file. Please upload a valid .xlsx or .csv file.");
  if (problem === "too-many-parts") throw new WorkbookTooLargeError("This spreadsheet is too large to import.");
  if (problem) throw new WorkbookTooLargeError("This spreadsheet is too large to import once unpacked. Split it into smaller files.");
}

const isCfb = (buf) => buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0; // legacy binary .xls

// CSV and other text input: the library ignores its row limit for these, so the lines are counted directly (a cheap scan, no parsing).
function assertTextRows(buffer, maxRows) {
  let lines = 0;
  for (let i = buffer.indexOf(10); i !== -1; i = buffer.indexOf(10, i + 1)) {
    if (++lines > maxRows + 1) throw new WorkbookTooLargeError(`This spreadsheet has more than ${maxRows} rows. Split it into smaller files.`);
  }
}

// Same result as XLSX.read(buffer, { type: "buffer" }), or throws. `maxRows` counts rows per sheet, header included.
function readWorkbook(buffer, { maxRows = DEFAULT_MAX_ROWS } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error("A file buffer is required");
  if (isZip(buffer)) assertSafeZip(buffer);
  else if (!isCfb(buffer)) assertTextRows(buffer, maxRows);
  const workbook = XLSX.read(buffer, { type: "buffer", sheetRows: maxRows + 1 });
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const full = sheet && sheet["!fullref"]; // set by the library when sheetRows cut the sheet short
    if (full && XLSX.utils.decode_range(full).e.r + 1 > maxRows) throw new WorkbookTooLargeError(`This spreadsheet has more than ${maxRows} rows. Split it into smaller files.`);
  }
  return workbook;
}

module.exports = { readWorkbook, WorkbookTooLargeError, MAX_PART_BYTES, MAX_TOTAL_BYTES, DEFAULT_MAX_ROWS };
