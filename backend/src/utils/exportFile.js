const XLSX = require("xlsx");
const { safeRow } = require("./spreadsheetSafe");

// Sends `rows` (array of flat, already-labeled objects — keys become column headers) in the
// requested format. Reuses the `xlsx` package already used elsewhere on this platform for
// bulk-upload templates, so no new dependency for CSV/XLSX; JSON is just res.json.
//
// Every text cell goes through safeRow(): a value beginning with = + - @ would otherwise be run as a
// formula by Excel/Sheets when the file is opened (a student named `=HYPERLINK(...)` attacking
// whoever downloads the export). JSON is left untouched -- it's data, not a spreadsheet. CSV carries a
// UTF-8 BOM so Excel renders non-ASCII names (Devanagari etc.) correctly instead of as mojibake.
function sendExport(res, { rows, filenameBase, format }) {
  const fmt = String(format || "csv").toLowerCase();

  if (fmt === "json") {
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.json"`);
    return res.json(rows);
  }

  const ws = XLSX.utils.json_to_sheet(rows.map(safeRow));

  if (fmt === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Export");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buf);
  }

  const csv = XLSX.utils.sheet_to_csv(ws);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
  res.send("﻿" + csv);
}

module.exports = { sendExport };
