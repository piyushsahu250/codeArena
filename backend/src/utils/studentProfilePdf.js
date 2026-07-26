const PDFDocument = require("pdfkit");
const { drawReportLogoBadge } = require("./pdfBranding");

function row(doc, label, value) {
  doc.font("Helvetica-Bold").fontSize(10).text(`${label}: `, { continued: true }).font("Helvetica").text(value || "—");
}

// Streams a one-page Student Profile report — identity + StudentProfile fields + education
// history, the same data ADMIN/STAFF/CLERK see on StudentPerformance.jsx's Profile section.
// Modeled on placementPdf.js's layout conventions (logo badge, section headings, row helper).
function generateStudentProfilePdf({ user, studentProfile, instituteName, education }, res) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);
  drawReportLogoBadge(doc);

  doc.font("Helvetica-Bold").fontSize(18).text("Student Profile Report", { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor("#666").text(`Generated ${new Date().toLocaleString()}`, { align: "center" });
  doc.fillColor("#000");
  doc.moveDown(1.2);

  doc.font("Helvetica-Bold").fontSize(13).text("Identity");
  doc.moveDown(0.3);
  row(doc, "Name", user.name);
  row(doc, "Roll Number", user.rollNumber);
  row(doc, "Registration Number", user.registrationNumber);
  row(doc, "Institute", instituteName);
  row(doc, "Official Email", user.email);
  row(doc, "Mobile", user.mobile);
  row(doc, "Gender", user.gender);
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(13).text("Personal Details");
  doc.moveDown(0.3);
  row(doc, "Personal Email", studentProfile?.personalEmail);
  row(doc, "Date of Birth", studentProfile?.dob ? new Date(studentProfile.dob).toLocaleDateString() : null);
  row(doc, "Address", studentProfile?.address);
  row(doc, "State", studentProfile?.state);
  row(doc, "District", studentProfile?.district);
  row(doc, "Pincode", studentProfile?.pincode);
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(13).text("Parent / Guardian Details");
  doc.moveDown(0.3);
  row(doc, "Father's Name", studentProfile?.fatherName);
  row(doc, "Father's Contact", studentProfile?.fatherContact);
  row(doc, "Mother's Name", studentProfile?.motherName);
  row(doc, "Mother's Contact", studentProfile?.motherContact);
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(13).text("Coding Profile Handles");
  doc.moveDown(0.3);
  row(doc, "LeetCode", studentProfile?.leetcodeHandle);
  row(doc, "HackerRank", studentProfile?.hackerrankHandle);
  row(doc, "StopStalk", studentProfile?.stopstalkHandle);
  row(doc, "AMCAT ID", studentProfile?.amcatId);
  row(doc, "CoCubes ID", studentProfile?.cocubesId);
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(13).text("Education");
  doc.moveDown(0.3);
  if (!education || education.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor("#666").text("No education records added yet.");
    doc.fillColor("#000");
  } else {
    doc.font("Helvetica").fontSize(10);
    for (const e of education) {
      if (doc.y > 760) { doc.addPage({ margin: 40, size: "A4" }); doc.y = 40; }
      doc.font("Helvetica-Bold").fontSize(10).text(`${e.degree || "—"}${e.specialization ? ` (${e.specialization})` : ""}`);
      doc.font("Helvetica").fontSize(9).fillColor("#444").text(`${e.institution || "—"} · ${e.board || "—"} · ${e.startYear || "—"}–${e.endYear || "—"} · Score: ${e.score || "—"} · ${e.status || "—"}`);
      doc.fillColor("#000");
      doc.moveDown(0.5);
    }
  }

  doc.end();
}

module.exports = { generateStudentProfilePdf };
