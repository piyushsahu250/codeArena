const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { drawReportLogoBadge, drawInstituteLogo } = require("./pdfBranding");

// Palette matches the accent colors already established in certificatePdf.js (ink/muted/amber)
// plus this app's --mint (pass) / --rust (fail) CSS custom properties, so the PDF and the
// on-screen MarksheetView.jsx feel like the same document.
const INK = "#1C1B18";
const MUTED = "#6B6A5F";
const LINE = "#DAD6CC";
const CARD_BG = "#F7F5EF";
const ACCENT = "#2E7D5B"; // pass / brand green (~ --mint)
const RUST = "#C0392B";   // fail (~ --rust)
const GOLD = "#C7852A";   // header band accent (matches certificatePdf.js's border gold)

// Premium, institution-ready digital marksheet for a manually-entered (offline) examination
// result. `data` is the single payload assembled by utils/resultMarksheetData.js's
// buildMarksheetData() — this function only lays out what it's given; it never computes rank/
// class-average/attendance/verification-code itself, so the PDF, the on-screen preview, and the
// QR-embedded verification page can never disagree about what those values are.
async function generateMarksheetPdf(data, res) {
  const {
    examination, entry, student, institute, department, division,
    verifyUrl, rank, totalStudents, classAverage, attendancePercent, signatories, generatedAt,
  } = data;

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);

  const { width } = doc.page;
  const left = 40, right = width - 40, contentWidth = right - left;

  // ---- Header band ------------------------------------------------------
  doc.rect(0, 0, width, 108).fill(CARD_BG);
  doc.rect(0, 106, width, 2).fill(GOLD);
  doc.fillColor(INK);

  drawReportLogoBadge(doc, { logoWidth: 46 });
  if (institute?.logoUrl) drawInstituteLogo(doc, institute.logoUrl, { x: left, y: 24, logoWidth: 52 });

  const titleX = institute?.logoUrl ? left + 66 : left;
  const titleWidth = contentWidth - 66 - (institute?.logoUrl ? 0 : 0) - 60;
  doc.font("Helvetica-Bold").fontSize(19).fillColor(INK).text(institute?.name || "Institute", titleX, 30, { width: titleWidth });
  const subtitleParts = ["Examination Marksheet"];
  if (examination.semester) subtitleParts.push(`Semester: ${examination.semester}`);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(subtitleParts.join("  •  "), titleX, 54, { width: titleWidth });
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(examination.title, titleX, 74, { width: titleWidth });

  doc.y = 128;
  doc.fillColor(INK);

  // ---- Student info card --------------------------------------------------
  const cardTop = doc.y;
  const photoWidth = student.profilePhotoUrl ? 70 : 0;
  const infoWidth = contentWidth - photoWidth - (photoWidth ? 14 : 0);
  const infoRows = [
    ["Student Name", student.name],
    ["Registration Number (PRN)", student.registrationNumber || "—"],
    ["Roll Number", student.rollNumber || "—"],
    ["Department", department || "—"],
    ["Division / Section", division || "—"],
    ["Batch", examination.batch || "—"],
  ];
  const rowH = 18;
  const cardHeight = 14 + infoRows.length * rowH + 10;
  doc.roundedRect(left, cardTop, contentWidth, cardHeight, 4).fillAndStroke(CARD_BG, LINE);
  doc.fillColor(INK);

  let ry = cardTop + 12;
  for (const [label, value] of infoRows) {
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(MUTED).text(label, left + 14, ry, { width: 170 });
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(String(value), left + 190, ry, { width: infoWidth - 190 + 14 });
    ry += rowH;
  }
  if (photoWidth) {
    try {
      doc.image(student.profilePhotoUrl, right - photoWidth, cardTop + 12, { width: photoWidth - 14, height: cardHeight - 24, fit: [photoWidth - 14, cardHeight - 24] });
    } catch (e) {
      console.error("Student photo render failed", e);
    }
  }
  doc.y = cardTop + cardHeight + 16;

  // ---- Result summary stat cards ------------------------------------------
  const resultLabel = entry.passed ? examination.passLabel : examination.failLabel;
  const resultColor = entry.passed ? ACCENT : RUST;
  const stats = [
    { label: "Obtained / Total", value: `${entry.obtainedMarks} / ${examination.totalMarks}` },
    { label: "Percentage", value: `${Math.round(entry.percentage * 100) / 100}%` },
    { label: "Grade", value: entry.grade || "—" },
    { label: "Result", value: resultLabel, color: resultColor },
  ];
  if (typeof rank === "number") stats.push({ label: "Rank", value: totalStudents ? `${rank} of ${totalStudents}` : String(rank) });
  if (typeof classAverage === "number") stats.push({ label: "Class Average", value: `${classAverage}` });
  if (typeof attendancePercent === "number") stats.push({ label: "Attendance", value: `${attendancePercent}%` });

  doc.y = drawStatCards(doc, stats, left, doc.y, contentWidth);
  doc.y += 16;

  // ---- Subject-wise performance table --------------------------------------
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Subject-wise Performance", left, doc.y);
  doc.y += 6;
  const cols = [
    { label: "Subject", width: contentWidth * 0.42 },
    { label: "Max Marks", width: contentWidth * 0.18, align: "right" },
    { label: "Marks Obtained", width: contentWidth * 0.2, align: "right" },
    { label: "Status", width: contentWidth * 0.2, align: "right" },
  ];
  const tableTop = doc.y;
  let cx = left;
  doc.rect(left, tableTop, contentWidth, 22).fill(CARD_BG);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5);
  for (const col of cols) {
    doc.text(col.label, cx + 8, tableTop + 6, { width: col.width - 16, align: col.align || "left" });
    cx += col.width;
  }
  const rowTop = tableTop + 22;
  doc.rect(left, rowTop, contentWidth, 24).stroke(LINE);
  cx = left;
  doc.font("Helvetica").fontSize(10).fillColor(INK);
  const rowValues = [examination.title, String(examination.totalMarks), String(entry.obtainedMarks), resultLabel];
  for (let i = 0; i < cols.length; i++) {
    doc.text(rowValues[i], cx + 8, rowTop + 7, { width: cols[i].width - 16, align: cols[i].align || "left" });
    cx += cols[i].width;
  }
  doc.y = rowTop + 24 + 16;

  // ---- Remarks (admin-entered only — never fabricated) ---------------------
  if (entry.remarks) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Remarks", left, doc.y);
    doc.y += 4;
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(entry.remarks, left, doc.y, { width: contentWidth });
    doc.fillColor(INK);
    doc.y += 16;
  }

  // ---- Verification block (QR + code + timestamp) --------------------------
  const verifyTop = Math.max(doc.y, 620);
  doc.moveTo(left, verifyTop).lineTo(right, verifyTop).strokeColor(LINE).stroke();
  let qrBottom = verifyTop + 12;
  if (verifyUrl) {
    try {
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 130 });
      doc.image(qrDataUrl, left, verifyTop + 12, { width: 78, height: 78 });
      qrBottom = verifyTop + 12 + 78;
    } catch (e) {
      console.error("QR code generation failed", e);
    }
  }
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text(`Marksheet ID: ${entry.verificationCode || "—"}`, left + 96, verifyTop + 18, { width: contentWidth - 96 });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text("Scan the QR code, or visit the verification link, to confirm this marksheet is genuine.", left + 96, verifyTop + 34, { width: contentWidth - 96 });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(`Generated: ${generatedAt.toLocaleString()}`, left + 96, verifyTop + 50, { width: contentWidth - 96 });
  doc.fillColor(INK);
  doc.y = Math.max(qrBottom, verifyTop + 66) + 18;

  // ---- Signature blocks ------------------------------------------------
  if (Array.isArray(signatories) && signatories.length) {
    const capped = signatories.slice(0, 4);
    const blockWidth = contentWidth / capped.length;
    const sigTop = doc.y;
    capped.forEach((sig, i) => {
      const bx = left + i * blockWidth;
      if (sig.signatureImageUrl) {
        try {
          doc.image(sig.signatureImageUrl, bx + 8, sigTop, { width: blockWidth - 32, height: 32, fit: [blockWidth - 32, 32] });
        } catch (e) {
          console.error("Signature image render failed", e);
        }
      }
      doc.moveTo(bx + 8, sigTop + 36).lineTo(bx + blockWidth - 24, sigTop + 36).strokeColor(LINE).stroke();
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(sig.name || "", bx + 8, sigTop + 40, { width: blockWidth - 32 });
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(sig.title || "", bx + 8, sigTop + 52, { width: blockWidth - 32 });
      doc.fillColor(INK);
    });
    doc.y = sigTop + 68;
  }

  doc.end();
}

// Draws a row of equal-width bordered "stat" boxes (label + value, optionally colored), wrapping
// to a second row if there isn't room — used for the result-summary section, which can grow to 7
// entries once rank/class-average/attendance are all toggled on. Returns the y position below the
// drawn row(s).
function drawStatCards(doc, stats, left, top, contentWidth) {
  const perRow = 4;
  const gap = 10;
  const boxWidth = (contentWidth - gap * (perRow - 1)) / perRow;
  const boxHeight = 44;
  let y = top;
  for (let i = 0; i < stats.length; i++) {
    const col = i % perRow;
    if (i > 0 && col === 0) y += boxHeight + gap;
    const x = left + col * (boxWidth + gap);
    const stat = stats[i];
    doc.roundedRect(x, y, boxWidth, boxHeight, 4).fillAndStroke("#FFFFFF", LINE);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(stat.label, x + 10, y + 8, { width: boxWidth - 20 });
    doc.font("Helvetica-Bold").fontSize(13).fillColor(stat.color || INK).text(stat.value, x + 10, y + 22, { width: boxWidth - 20 });
    doc.fillColor(INK);
  }
  return y + boxHeight;
}

module.exports = { generateMarksheetPdf };
