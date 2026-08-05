const prisma = require("../prisma");

// LEAVE is excluded from the denominator (an approved leave neither helps nor hurts the
// percentage); LATE counts toward presence (the student was there, just tardy). Shared by
// routes/attendance.js's per-subject computation and the marksheet's overall-attendance line.
function computeAttendancePercent(counts) {
  const present = counts.PRESENT || 0;
  const absent = counts.ABSENT || 0;
  const late = counts.LATE || 0;
  const denominator = present + absent + late;
  if (denominator === 0) return null;
  return Math.round(((present + late) / denominator) * 100);
}

// Single DB-side aggregation across every subject/session a student has ever had attendance
// recorded for — used for the marksheet's optional "Attendance %" line, which is deliberately
// institute-wide overall attendance rather than scoped to one exam's date range (exams have no
// term/subject linkage to attendance sessions).
async function computeStudentOverallAttendancePercent(studentId) {
  const grouped = await prisma.attendanceRecord.groupBy({
    by: ["status"],
    where: { studentId },
    _count: { _all: true },
  });
  const counts = {};
  for (const g of grouped) counts[g.status] = g._count._all;
  return computeAttendancePercent(counts);
}

module.exports = { computeAttendancePercent, computeStudentOverallAttendancePercent };
