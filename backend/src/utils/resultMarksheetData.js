const prisma = require("../prisma");
const { computeExaminationStats } = require("./resultRank");
const { computeStudentOverallAttendancePercent } = require("./attendanceStats");
const { generateMarksheetCode } = require("./resultCode");

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena.site";

// Single source of truth for a marksheet's full payload — used identically by the PDF route, the
// on-screen JSON preview route, and the QR-image route, so none of them can ever disagree about
// what a marksheet's rank/class-average/attendance/verification-code actually are.
async function buildMarksheetData({ examination, entry, student, institute, department, division }) {
  // Lazy backfill for entries created before this feature shipped — every entry gets a code the
  // first time anyone views/downloads its marksheet, avoiding a separate one-off migration script.
  if (!entry.verificationCode) {
    const code = await generateMarksheetCode({ instituteCode: institute?.code });
    entry = await prisma.resultEntry.update({ where: { id: entry.id }, data: { verificationCode: code } });
  }

  let rank = null, totalStudents = null, classAverage = null;
  if (examination.showRank || examination.showClassAverage) {
    const stats = await computeExaminationStats(examination.id);
    if (examination.showRank) {
      rank = stats.rankByStudentId.get(entry.studentId) ?? null;
      totalStudents = stats.totalStudents;
    }
    if (examination.showClassAverage) classAverage = stats.average;
  }

  const attendancePercent = examination.showAttendance
    ? await computeStudentOverallAttendancePercent(student.id)
    : null;

  return {
    examination, entry, student, institute, department, division,
    verifyUrl: `${FRONTEND_URL}/results/verify/${entry.verificationCode}`,
    rank, totalStudents, classAverage, attendancePercent,
    signatories: Array.isArray(institute?.marksheetSignatories) ? institute.marksheetSignatories : [],
    generatedAt: new Date(),
  };
}

module.exports = { buildMarksheetData };
