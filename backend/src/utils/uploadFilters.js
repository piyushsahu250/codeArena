const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);
const SPREADSHEET_OR_TEXT_EXTENSIONS = new Set(["xlsx", "xls", "csv", "txt"]);

// multer fileFilter for the platform's bulk-import routes (all of which pass the buffer straight
// to XLSX.read). Rejects by extension before the buffer is ever parsed — cb(null, false) (not an
// Error) so multer just leaves req.file undefined instead of throwing, letting each route's
// existing "No file uploaded" check handle the rejection without needing new error-handling
// middleware. Extension-only, like the platform's other upload check (resume.js) — XLSX.read's
// existing try/catch is still the real backstop against a malformed/renamed file.
function spreadsheetFileFilter(req, file, cb) {
  const ext = String(file.originalname || "").toLowerCase().split(".").pop();
  cb(null, SPREADSHEET_EXTENSIONS.has(ext));
}

// Same as spreadsheetFileFilter but also accepts .txt — used only by the two question bulk-import
// routes, which branch on extension to run the Notepad-format parser (bulkQuestionParser.js)
// instead of XLSX.read for a .txt file. Kept as a separate filter (not a widened
// spreadsheetFileFilter) so every other bulk-upload route on the platform is unaffected.
function spreadsheetOrTextFileFilter(req, file, cb) {
  const ext = String(file.originalname || "").toLowerCase().split(".").pop();
  cb(null, SPREADSHEET_OR_TEXT_EXTENSIONS.has(ext));
}

module.exports = { spreadsheetFileFilter, spreadsheetOrTextFileFilter };
