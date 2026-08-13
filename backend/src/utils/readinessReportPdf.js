const PDFDocument = require("pdfkit");
const { drawReportLogoBadge } = require("./pdfBranding");

const BTL_LABELS = { 1: "BTL 1 — Remember", 2: "BTL 2 — Understand", 3: "BTL 3 — Apply", 4: "BTL 4 — Analyze", 5: "BTL 5 — Evaluate", 6: "BTL 6 — Create" };

function levelLabel(level) {
  return String(level || "").replace(/_/g, " ");
}

// Same section order as the student-facing ReadinessReport.jsx page (routes/readiness.js's
// buildReadinessReport is the single source of every number here — this generator only renders
// it, same "one centralized scoring engine" rule as every other report on this platform).
function generateReadinessReportPdf({ studentName, subjectName, assessmentMode, submittedAt, report }, res) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);
  drawReportLogoBadge(doc);

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#1C3D5A").text("Readiness Assessment Report");
  doc.font("Helvetica").fontSize(10).fillColor("#333");
  doc.text(`Student: ${studentName}`);
  doc.text(`Subject: ${subjectName}`);
  doc.text(`Assessment Mode: ${levelLabel(assessmentMode)}`);
  doc.text(`Date: ${submittedAt ? new Date(submittedAt).toLocaleString() : "—"}`);
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#1C3D5A").lineWidth(1.5).stroke();
  doc.moveDown(0.8);

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#1C3D5A")
    .text(`Overall Readiness: ${report.overallScore}% — ${levelLabel(report.readinessLevel)}`);
  doc.moveDown(0.6);

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#1C1B18").text("Bloom's Taxonomy Performance");
  doc.font("Helvetica").fontSize(10);
  for (const lvl of [1, 2, 3, 4, 5, 6]) {
    const b = report.btlScores?.[lvl];
    doc.text(b ? `${BTL_LABELS[lvl]}: ${b.percent}% (${b.correct}/${b.attempted} correct)` : `${BTL_LABELS[lvl]}: Not assessed`);
  }
  doc.moveDown(0.5);

  if (Array.isArray(report.topicScores) && report.topicScores.length > 0) {
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#1C1B18").text("Topic Performance");
    doc.font("Helvetica").fontSize(10);
    for (const t of report.topicScores) {
      const label = t.subtopic ? `${t.topic} — ${t.subtopic}` : t.topic;
      doc.text(`${label}: ${t.accuracy}% (${t.questionsAttempted} attempted) — ${t.strength.replace(/_/g, " ")}`);
    }
    doc.moveDown(0.5);
  }

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#1C1B18").text("Difficulty Performance");
  doc.font("Helvetica").fontSize(10);
  for (const d of ["EASY", "MEDIUM", "HARD"]) {
    const v = report.difficultyScores?.[d];
    doc.text(`${d}: ${v != null ? `${v}%` : "Not assessed"}`);
  }
  doc.moveDown(0.5);

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#1C1B18").text("Strengths");
  doc.font("Helvetica").fontSize(10).text(report.strongAreas?.length ? report.strongAreas.join(", ") : "None identified yet.");
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(12).text("Areas to Improve");
  doc.font("Helvetica").fontSize(10).text(report.weakAreas?.length ? report.weakAreas.join(", ") : "None — well-rounded performance.");
  doc.moveDown(0.6);

  if (Array.isArray(report.recommendations) && report.recommendations.length > 0) {
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#1C1B18").text("Recommended Action Plan");
    doc.font("Helvetica").fontSize(10);
    for (const r of report.recommendations) doc.text(`${r.priority}. ${r.topic} — ${r.action}`);
    doc.moveDown(0.5);
  }

  if (report.nextAssessmentSuggestion) {
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#1C1B18").text("What's Next");
    doc.font("Helvetica").fontSize(10).text(report.nextAssessmentSuggestion);
  }

  doc.end();
}

module.exports = { generateReadinessReportPdf };
