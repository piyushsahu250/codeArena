// Spreadsheet formula-injection guard for exports. A text cell that begins with = + - @ (or a tab /
// carriage return) is interpreted as a formula by Excel/Sheets/LibreOffice when the file is opened,
// so a student who registers with the name `=HYPERLINK(...)` would execute it on whoever downloads
// the results. Prefixing a single quote makes the application treat the cell as plain text.
// Numbers, booleans and dates pass through untouched so numeric columns stay numeric.
function safeCell(value) {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function safeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = safeCell(v);
  return out;
}

// Sends `rows` (array of plain objects, same keys per row) as an XLSX or CSV download with correct
// headers. CSV gets a UTF-8 BOM so Excel renders non-ASCII names correctly.
function sendTable(res, XLSX, { rows, sheetName, filename, format, colWidths }) {
  const safeRows = rows.map(safeRow);
  const ws = XLSX.utils.json_to_sheet(safeRows);
  if (colWidths) ws["!cols"] = colWidths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    return res.send("﻿" + csv);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  return res.send(buf);
}

module.exports = { safeCell, safeRow, sendTable };
