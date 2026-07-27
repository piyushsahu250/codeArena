const PDFDocument = require("pdfkit");
const { drawReportLogoBadge } = require("./pdfBranding");

// Streams a portrait member-roster + ranking report directly to `res`. Modeled on
// attendancePdf.js's colX + doc.y pagination pattern, portrait since a roster has far fewer
// columns than an attendance sheet. `rows` is the exact same flat array the Excel/CSV export
// builds (see exports.js's talentPools entity) — same "one row shape feeds both formats" convention.
function generateTalentPoolPdf(pool, rows, res) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);
  drawReportLogoBadge(doc);

  doc.font("Helvetica-Bold").fontSize(18).text(`Talent Pool Report — ${pool.name}`, { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor("#666").text(`Generated ${new Date().toLocaleString()} · ${rows.length} member(s)`, { align: "center" });
  doc.fillColor("#000");
  doc.moveDown(1);

  const colX = [40, 110, 260, 380, 440, 500];
  const headers = ["Roll No.", "Name", "Added Via", "Rank", "Score %", "Attendance %"];
  doc.font("Helvetica-Bold").fontSize(9);
  headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: (colX[i + 1] || 555) - colX[i] - 4 }));
  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#ccc").stroke();
  doc.moveDown(0.3);

  doc.font("Helvetica").fontSize(8);
  for (const r of rows) {
    if (doc.y > 750) { doc.addPage({ margin: 40, size: "A4" }); doc.y = 40; }
    const y = doc.y;
    doc.text(r.rollNumber || "—", colX[0], y, { width: colX[1] - colX[0] - 4 });
    doc.text(r.name || "—", colX[1], y, { width: colX[2] - colX[1] - 4 });
    doc.text(r.addedVia || "—", colX[2], y, { width: colX[3] - colX[2] - 4 });
    doc.text(r.rank != null ? `${r.rank}/${r.totalStudents}` : "—", colX[3], y, { width: colX[4] - colX[3] - 4 });
    doc.text(r.scorePercent != null ? `${r.scorePercent}%` : "—", colX[4], y, { width: colX[5] - colX[4] - 4 });
    doc.text(r.attendancePercent != null ? `${r.attendancePercent}%` : "—", colX[5], y, { width: 555 - colX[5] });
    doc.moveDown(0.5);
  }

  if (rows.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor("#666").text("This Talent Pool has no members yet.");
  }

  doc.end();
}

module.exports = { generateTalentPoolPdf };
