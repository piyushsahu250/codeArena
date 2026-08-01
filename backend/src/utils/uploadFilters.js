const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);

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

module.exports = { spreadsheetFileFilter };
