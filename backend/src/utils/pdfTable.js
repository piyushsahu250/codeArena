// Minimal, dependency-free-beyond-pdfkit table PDF used by report exports: title, note lines, a header row repeated on every page, wrapped-free (truncated)
// cells so a long value can never overflow the page. Streams to the response; nothing is written to disk.
const PDFDocument = require("pdfkit");

function sendPdfTable(res, { title, meta = [], rows, filenameBase, maxRows = 5000 }) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28, info: { Title: title } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
  doc.pipe(res);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const pageW = doc.page.width - 56;
  const colW = columns.length ? pageW / columns.length : pageW;
  const fit = (v, w) => { const s = String(v ?? ""); const max = Math.max(4, Math.floor(w / 4.2)); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

  doc.fontSize(15).font("Helvetica-Bold").text(title);
  doc.moveDown(0.3).fontSize(8).font("Helvetica").fillColor("#555555");
  meta.forEach((m) => doc.text(m, { width: pageW }));
  doc.fillColor("#000000").moveDown(0.6);

  const header = () => {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(7.5);
    columns.forEach((c, i) => doc.text(fit(c, colW), 28 + i * colW, y, { width: colW - 4, lineBreak: false }));
    doc.moveTo(28, y + 11).lineTo(28 + pageW, y + 11).strokeColor("#999999").lineWidth(0.5).stroke();
    doc.y = y + 15;
  };
  header();
  doc.font("Helvetica").fontSize(7.5);
  rows.slice(0, maxRows).forEach((r) => {
    if (doc.y > doc.page.height - 44) { doc.addPage(); header(); doc.font("Helvetica").fontSize(7.5); }
    const y = doc.y;
    columns.forEach((c, i) => doc.text(fit(r[c], colW), 28 + i * colW, y, { width: colW - 4, lineBreak: false }));
    doc.y = y + 11;
  });
  if (rows.length > maxRows) doc.moveDown().text(`Showing the first ${maxRows} of ${rows.length} rows. Use CSV or XLSX for the full set.`);
  doc.end();
}

module.exports = { sendPdfTable };
