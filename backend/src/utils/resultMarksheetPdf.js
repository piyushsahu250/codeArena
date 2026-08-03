const PDFDocument = require("pdfkit");
const { drawReportLogoBadge, drawInstituteLogo } = require("./pdfBranding");

// One student's digital marksheet for a manually-entered (offline) examination result. Modeled on
// certificatePdf.js / placementPdf.js's layout conventions (logo badge, centered title, labeled
// rows). `institute.logoUrl` is drawn via the already-existing drawInstituteLogo helper — no new
// branding infrastructure needed, this is the same data URL already used for certificates.
function generateMarksheetPdf({ examination, entry, student, institute, department, division }, res) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);

  drawReportLogoBadge(doc);
  if (institute?.logoUrl) drawInstituteLogo(doc, institute.logoUrl, { x: 40, y: 30, logoWidth: 60 });

  doc.moveDown(institute?.logoUrl ? 3 : 1.5);
  doc.font("Helvetica-Bold").fontSize(18).text(institute?.name || "Institute", { align: "center" });
  doc.font("Helvetica").fontSize(11).fillColor("#666").text("Examination Marksheet", { align: "center" });
  doc.fillColor("#000");
  doc.moveDown(1.2);

  doc.font("Helvetica-Bold").fontSize(14).text(examination.title, { align: "center" });
  if (examination.description) {
    doc.font("Helvetica").fontSize(10).fillColor("#666").text(examination.description, { align: "center" });
    doc.fillColor("#000");
  }
  doc.moveDown(1);

  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#ccc").stroke();
  doc.moveDown(0.6);

  function row(label, value) {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).text(label, 40, y, { width: 160 });
    doc.font("Helvetica").fontSize(10).text(String(value ?? "—"), 210, y, { width: 345 });
    doc.moveDown(0.6);
  }

  row("Student Name", student.name);
  row("Roll Number / PRN", student.rollNumber || student.registrationNumber);
  row("Department", department || "—");
  row("Division", division || "—");
  row("Batch", examination.batch || "—");
  row("Examination Date", new Date(examination.examDate).toLocaleDateString());
  row("Published Date", examination.publishedAt ? new Date(examination.publishedAt).toLocaleDateString() : "—");

  doc.moveDown(0.4);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#ccc").stroke();
  doc.moveDown(0.6);

  row("Obtained Marks", entry.obtainedMarks);
  row("Total Marks", examination.totalMarks);
  row("Percentage", `${Math.round(entry.percentage * 100) / 100}%`);
  if (entry.grade) row("Grade", entry.grade);
  row("Result", entry.passed ? examination.passLabel : examination.failLabel);

  doc.moveDown(1.5);
  doc.font("Helvetica").fontSize(9).fillColor("#666").text(`Generated ${new Date().toLocaleString()}`, { align: "right" });
  doc.fillColor("#000");

  doc.end();
}

module.exports = { generateMarksheetPdf };
