const PDFDocument = require("pdfkit");
const { drawReportLogoBadge } = require("./pdfBranding");

// Streams a one-page Placement Summary — registration + offer + department breakdown, the exact
// same three datasets the Clerk Dashboard already shows (see routes/placementOffers.js's
// /analytics/registration, /analytics/offers, /analytics/department). Modeled on
// attendancePdf.js's layout conventions (logo badge, centered title, table with a colX layout).
function generatePlacementPdf({ registration, offers, department }, res) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);
  drawReportLogoBadge(doc);

  doc.font("Helvetica-Bold").fontSize(18).text("Placement Summary Report", { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor("#666").text(`Generated ${new Date().toLocaleString()}`, { align: "center" });
  doc.fillColor("#000");
  doc.moveDown(1.2);

  doc.font("Helvetica-Bold").fontSize(13).text("Registration Overview");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10);
  doc.text(`Total Students: ${registration.total}`);
  doc.text(`Registered: ${registration.registered}   Not Registered: ${registration.notRegistered}   (${registration.percentRegistered}%)`);
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(13).text("Offer Analytics");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10);
  doc.text(`Placed: ${offers.placed}   Unplaced: ${offers.unplaced}   Active Offers: ${offers.activeOffers}   Multiple Offers: ${offers.multipleOffers}`);
  doc.text(`Total Offers: ${offers.totalOffers}   Avg Offers / Student: ${offers.averageOffersPerStudent}`);
  doc.text(`On-Campus: ${offers.onCampus}   Off-Campus: ${offers.offCampus}`);
  doc.text(`Highest Package: ${offers.highestPackage} LPA   Average Package: ${offers.averagePackage} LPA`);
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(13).text("Department-wise Placement Status");
  doc.moveDown(0.4);

  const colX = [40, 190, 250, 320, 390, 460, 530];
  const headers = ["Department", "Total", "Registered", "Not Reg.", "Dept Elig.", "Cell Elig."];
  doc.font("Helvetica-Bold").fontSize(9);
  headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: (colX[i + 1] || 555) - colX[i] - 4 }));
  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#ccc").stroke();
  doc.moveDown(0.3);

  doc.font("Helvetica").fontSize(9);
  for (const d of department) {
    if (doc.y > 760) { doc.addPage({ margin: 40, size: "A4" }); doc.y = 40; }
    const y = doc.y;
    doc.text(d.department, colX[0], y, { width: colX[1] - colX[0] - 4 });
    doc.text(String(d.total), colX[1], y, { width: colX[2] - colX[1] - 4 });
    doc.text(String(d.registered), colX[2], y, { width: colX[3] - colX[2] - 4 });
    doc.text(String(d.notRegistered), colX[3], y, { width: colX[4] - colX[3] - 4 });
    doc.text(String(d.deptEligible), colX[4], y, { width: colX[5] - colX[4] - 4 });
    doc.text(String(d.clerkEligible), colX[5], y, { width: 555 - colX[5] });
    doc.moveDown(0.5);
  }
  if (department.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor("#666").text("No students yet.");
  }

  doc.end();
}

module.exports = { generatePlacementPdf };
