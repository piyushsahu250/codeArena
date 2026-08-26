const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { drawCertificateLogo } = require("./pdfBranding");

// Streams an "Interview Ready" certificate with an embedded QR code linking to the public
// verification endpoint — same landscape layout style as the Learning Module certificate.
async function generateInterviewCertificatePdf({ studentName, averageScore, certificateCode, issuedAt, verifyUrl }, res) {
  const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 0 });
  doc.pipe(res);

  const { width, height } = doc.page;

  doc.rect(0, 0, width, height).fill("#FBF9F4");
  doc.lineWidth(3).strokeColor("#E8A33D").rect(24, 24, width - 48, height - 48).stroke();
  doc.lineWidth(1).strokeColor("#C7852A").rect(34, 34, width - 68, height - 68).stroke();

  doc.fillColor("#1C1B18");
  drawCertificateLogo(doc, { width, y: 15, logoWidth: 90 });
  doc.font("Helvetica").fontSize(12).fillColor("#6B6A5F").text("Interview Preparation", 0, 113, { align: "center" });

  doc.font("Helvetica-Bold").fontSize(26).fillColor("#1C1B18").text("Interview Ready Certificate", 0, 140, { align: "center" });

  doc.font("Helvetica").fontSize(13).fillColor("#6B6A5F").text("This certifies that", 0, 196, { align: "center" });
  doc.font("Helvetica-Bold").fontSize(24).fillColor("#4F9D6E").text(studentName, 0, 219, { align: "center" });
  doc.font("Helvetica").fontSize(13).fillColor("#6B6A5F")
    .text(`has demonstrated interview readiness with an average score of ${averageScore}%`, 0, 260, { align: "center" });

  doc.font("Helvetica").fontSize(11).fillColor("#6B6A5F").text(`Issued: ${new Date(issuedAt).toLocaleDateString()}`, 0, 310, { align: "center" });
  doc.text(`Certificate ID: ${certificateCode}`, 0, 326, { align: "center" });

  try {
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 140 });
    doc.image(qrDataUrl, width - 180, height - 175, { width: 110, height: 110 });
    doc.fontSize(8).fillColor("#6B6A5F").text("Scan to verify", width - 180, height - 60, { width: 110, align: "center" });
  } catch (e) {
    console.error("QR code generation failed", e);
  }

  // Same small, bottom-left platform attribution as the Learning Module certificate — never
  // collides with the QR block, which always sits bottom-right.
  doc.font("Helvetica").fontSize(8).fillColor("#A8A69C")
    .text("Powered by Acrosoft Webtech Solution Pvt. Ltd.", 60, height - 60, { width: 260, align: "left" });

  doc.end();
}

module.exports = { generateInterviewCertificatePdf };
