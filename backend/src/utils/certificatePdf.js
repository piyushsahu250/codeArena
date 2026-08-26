const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { drawCertificateLogo, drawInstituteLogo } = require("./pdfBranding");

const TYPE_SUBTITLE = {
  LEARNING_MODULE: "Learning Module",
  CODING_ASSESSMENT: "Coding Assessment",
  MANUAL: "Certificate of Achievement",
};

// Unified landscape certificate for the Certificate model (LEARNING_MODULE / CODING_ASSESSMENT /
// MANUAL types — see schema.prisma). Streams directly to `res`. Distinct from
// interviewCertificatePdf.js, which keeps its own separate layout for the InterviewCertificate
// model (a working feature this unification deliberately left untouched — see certificates.js
// module comment).
async function generateCertificatePdf({ studentName, title, programName, certificateCode, issuedAt, status, verifyUrl, instituteName, instituteLogoUrl }, res) {
  const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 0 });
  doc.pipe(res);

  const { width, height } = doc.page;

  doc.rect(0, 0, width, height).fill("#FBF9F4");
  doc.lineWidth(3).strokeColor("#E8A33D").rect(24, 24, width - 48, height - 48).stroke();
  doc.lineWidth(1).strokeColor("#C7852A").rect(34, 34, width - 68, height - 68).stroke();

  drawCertificateLogo(doc, { width, y: 22, logoWidth: 100 });
  if (instituteLogoUrl) drawInstituteLogo(doc, instituteLogoUrl, { x: width - 140, y: 40, logoWidth: 70 });

  doc.font("Helvetica").fontSize(12).fillColor("#6B6A5F").text(instituteName || "CodeArena", 0, 128, { align: "center" });

  doc.font("Helvetica-Bold").fontSize(28).fillColor("#1C1B18").text("Certificate of Completion", 0, 158, { align: "center" });

  doc.font("Helvetica").fontSize(13).fillColor("#6B6A5F").text("This is to certify that", 0, 215, { align: "center" });
  doc.font("Helvetica-Bold").fontSize(26).fillColor("#4F9D6E").text(studentName, 0, 240, { align: "center" });
  doc.font("Helvetica").fontSize(13).fillColor("#6B6A5F")
    .text(`has successfully completed`, 0, 285, { align: "center" });
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#1C1B18").text(programName || title, 0, 307, { align: "center" });

  doc.font("Helvetica").fontSize(11).fillColor("#6B6A5F")
    .text(`Completion Date: ${new Date(issuedAt).toLocaleDateString()}`, 0, 365, { align: "center" });
  doc.font("Helvetica").fontSize(11).fillColor("#6B6A5F")
    .text(`Certificate ID: ${certificateCode}`, 0, 383, { align: "center" });

  if (verifyUrl) {
    try {
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 130 });
      doc.image(qrDataUrl, width - 170, height - 165, { width: 100, height: 100 });
      doc.fontSize(8).fillColor("#6B6A5F").text("Scan to verify", width - 170, height - 58, { width: 100, align: "center" });
    } catch (e) {
      console.error("QR code generation failed", e);
    }
  }

  // Small, separate platform attribution — deliberately distinct from the institute branding
  // above (instituteName/instituteLogoUrl), never replacing it. Bottom-left so it never collides
  // with the QR code block, which always sits bottom-right.
  doc.font("Helvetica").fontSize(8).fillColor("#A8A69C")
    .text("Powered by Acrosoft Webtech Solution Pvt. Ltd.", 60, height - 58, { width: 260, align: "left" });

  if (status === "REVOKED") {
    doc.save();
    doc.rotate(-25, { origin: [width / 2, height / 2] });
    doc.fillOpacity(0.35).font("Helvetica-Bold").fontSize(64).fillColor("#C83232")
      .text("REVOKED", 0, height / 2 - 40, { align: "center", width });
    doc.fillOpacity(1);
    doc.restore();
  }

  doc.end();
}

module.exports = { generateCertificatePdf, TYPE_SUBTITLE };
