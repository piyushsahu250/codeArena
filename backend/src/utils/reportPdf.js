const PDFDocument = require("pdfkit");
const { drawReportLogoBadge } = require("./pdfBranding");

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

function row(doc, label, value) {
  doc.font("Helvetica-Bold").fontSize(10).text(label, { continued: true, width: 250 });
  doc.font("Helvetica").text(`  ${value ?? "—"}`);
}

// Streams a one-page-plus performance report directly to `res` (or any writable stream).
// Kept intentionally plain (no external fonts/images) since pdfkit's bundled Helvetica is all
// that's guaranteed to work in the Docker container without extra font files.
function generatePerformancePdf(data, res) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);
  drawReportLogoBadge(doc);

  doc.font("Helvetica-Bold").fontSize(18).text("Student Performance Report", { align: "center" });
  doc.moveDown(1);

  doc.fontSize(13).text("Student Details");
  doc.moveTo(doc.x, doc.y + 2).lineTo(555, doc.y + 2).strokeColor("#999").stroke();
  doc.moveDown(0.5);
  row(doc, "Name", data.student.name);
  row(doc, "Roll Number", data.student.rollNumber);
  row(doc, "Registration Number (PRN)", data.student.registrationNumber);
  row(doc, "Official Email", data.student.email);
  row(doc, "Mobile", data.student.mobile);
  row(doc, "Institute", data.student.institute?.name);
  row(doc, "Department", data.student.academicGroup?.department?.name || data.student.department);
  row(doc, "Section", data.student.academicGroup?.section || data.student.section);
  row(doc, "Batch Year", data.student.academicGroup?.batch || data.student.batchYear);
  doc.moveDown(1);

  doc.fontSize(13).text("Overall Statistics");
  doc.moveTo(doc.x, doc.y + 2).lineTo(555, doc.y + 2).strokeColor("#999").stroke();
  doc.moveDown(0.5);
  const s = data.summary;
  row(doc, "Total Tests Assigned", s.totalTestsAssigned);
  row(doc, "Total Tests Attempted", s.totalTestsAttempted);
  row(doc, "Total Tests Completed", s.totalTestsCompleted);
  row(doc, "Total Tests Pending", s.totalTestsPending);
  row(doc, "Average Score (%)", `${s.averageScorePercent}%`);
  row(doc, "Overall Percentage", `${s.overallPercentage}%`);
  row(doc, "Highest Score", s.highest ? `${s.highest.score}/${s.highest.maxScore} (${s.highest.percentage}%) — ${s.highest.testName}` : "—");
  row(doc, "Lowest Score", s.lowest ? `${s.lowest.score}/${s.lowest.maxScore} (${s.lowest.percentage}%) — ${s.lowest.testName}` : "—");
  row(doc, "Total Coding Questions Solved", `${s.totalCodingSolved} / ${s.totalCodingAttempted}`);
  row(doc, "Total MCQs Attempted", s.totalMcqAttempted);
  row(doc, "Total MCQs Answered Correctly", s.totalMcqCorrect);
  row(doc, "Total Time Spent on Tests", `${s.totalTimeSpentMin} min`);
  row(doc, "Last Test Attempt Date", fmtDate(s.lastAttemptDate));
  doc.moveDown(1);

  doc.fontSize(13).text("Test History");
  doc.moveTo(doc.x, doc.y + 2).lineTo(555, doc.y + 2).strokeColor("#999").stroke();
  doc.moveDown(0.5);

  const colX = [40, 220, 300, 370, 440, 500];
  const headers = ["Test Name", "Date", "Score", "%", "Time", "Status"];
  doc.font("Helvetica-Bold").fontSize(9);
  headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: (colX[i + 1] || 555) - colX[i], continued: false }));
  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#ccc").stroke();
  doc.moveDown(0.3);

  doc.font("Helvetica").fontSize(9);
  for (const h of data.testHistory) {
    if (doc.y > 780) doc.addPage();
    const y = doc.y;
    doc.text(h.testName, colX[0], y, { width: colX[1] - colX[0] - 4 });
    doc.text(fmtDate(h.date), colX[1], y, { width: colX[2] - colX[1] - 4 });
    doc.text(h.resultsPending ? "Pending" : `${h.score}/${h.maxScore}`, colX[2], y, { width: colX[3] - colX[2] - 4 });
    doc.text(h.resultsPending ? "—" : `${h.percentage}%`, colX[3], y, { width: colX[4] - colX[3] - 4 });
    doc.text(h.timeTakenMin != null ? `${h.timeTakenMin}m` : "—", colX[4], y, { width: colX[5] - colX[4] - 4 });
    doc.text(h.status, colX[5], y, { width: 555 - colX[5] });
    doc.moveDown(0.6);
  }

  if (data.testHistory.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor("#666").text("No test attempts yet.");
  }

  doc.end();
}

module.exports = { generatePerformancePdf };
