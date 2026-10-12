// A student's performance dashboard, placement-readiness score and the Excel and PDF reports. A student sees only their own (scores of unpublished results are
// masked); staff, clerks and admins see students of their own institute, and platform accounts see everyone.
// Behaviour and messages are those of the routes this replaced (see backend/test/snapshots/users-contract.json).
const XLSX = require("xlsx");
const { safeRow, safeCell } = require("../../utils/spreadsheetSafe");
const { ServiceError } = require("../../utils/serviceError");
const { computeStudentPerformance } = require("../../utils/studentPerformance");
const { computePlacementReadiness } = require("../../utils/placementReadiness");
const d = require("./users.domain");
const repo = require("./users.repository");

// Throws 403/404, or returns the student's own institute-scope fields.
async function authorize(viewer, targetId) {
  // A student asking for someone else is refused before anything is read.
  if (viewer.role === "STUDENT" && viewer.id !== targetId) throw new ServiceError(403, "You can only view your own performance dashboard");
  const target = await repo.findStudentTarget(targetId);
  const viewerInstituteId = viewer.role !== "STUDENT" && target && target.role === "STUDENT" ? (await repo.findInstituteOf(viewer.id))?.instituteId : null;
  const refusal = d.performanceRefusal({ viewer, targetId, target, viewerInstituteId });
  if (refusal) throw new ServiceError(refusal.status, refusal.message);
  return target;
}

const maskFor = (viewer) => ({ maskUnpublished: viewer.role === "STUDENT" });

async function dashboard(viewer, targetId) {
  const target = await authorize(viewer, targetId);
  return computeStudentPerformance(target.id, maskFor(viewer));
}

// Its own endpoint, not folded into the dashboard: it also reads resume, interview and certificate data that callers of the dashboard should not pay for.
async function placementReadiness(viewer, targetId) {
  const target = await authorize(viewer, targetId);
  return computePlacementReadiness(target.id);
}

async function reportData(viewer, targetId) {
  const target = await authorize(viewer, targetId);
  return computeStudentPerformance(target.id, maskFor(viewer));
}

function excelReport(data) {
  const wb = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["Student Performance Report"],
    [],
    ["Name", data.student.name],
    ["Registration Number (PRN)", data.student.registrationNumber || "—"],
    ["Roll Number", data.student.rollNumber || "—"],
    ["Official Email", data.student.email],
    ["Mobile", data.student.mobile || "—"],
    ["Institute", data.student.institute?.name || "—"],
    ["Department", data.student.academicGroup?.department?.name || "—"],
    ["Section", data.student.academicGroup?.section || "—"],
    ["Batch Year", data.student.academicGroup?.batch || data.student.batchYear || "—"],
    [],
    ["Total Tests Assigned", data.summary.totalTestsAssigned],
    ["Total Tests Attempted", data.summary.totalTestsAttempted],
    ["Total Tests Completed", data.summary.totalTestsCompleted],
    ["Total Tests Pending", data.summary.totalTestsPending],
    ["Average Score (%)", data.summary.averageScorePercent],
    ["Overall Percentage", data.summary.overallPercentage],
    ["Highest Score (%)", data.summary.highest?.percentage ?? "—"],
    ["Lowest Score (%)", data.summary.lowest?.percentage ?? "—"],
    ["Total Coding Questions Solved", data.summary.totalCodingSolved],
    ["Total MCQs Attempted", data.summary.totalMcqAttempted],
    ["Total MCQs Answered Correctly", data.summary.totalMcqCorrect],
    ["Total Time Spent (minutes)", data.summary.totalTimeSpentMin],
    ["Last Test Attempt Date", data.summary.lastAttemptDate ? new Date(data.summary.lastAttemptDate).toLocaleString() : "—"],
  ].map((r) => r.map(safeCell)));
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  const historySheet = XLSX.utils.json_to_sheet(
    data.testHistory.map((h) => safeRow({
      "Test Name": h.testName,
      "Date": new Date(h.date).toLocaleDateString(),
      "Score": h.resultsPending ? "Pending" : h.score,
      "Max Score": h.maxScore,
      "Percentage": h.resultsPending ? "Pending" : `${h.percentage}%`,
      "Time Taken (min)": h.timeTakenMin ?? "—",
      "Status": h.status,
    }))
  );
  XLSX.utils.book_append_sheet(wb, historySheet, "Test History");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const reportFileStem = (data) => data.student.rollNumber || data.student.id;

module.exports = { dashboard, placementReadiness, reportData, excelReport, reportFileStem };
