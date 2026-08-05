const prisma = require("../prisma");
const { cached } = require("./cache");

// Per-examination rank + class average, computed once per exam (not per student) and cached —
// same TTL/keying convention as resultManagement.js's /admin/analytics route. Callers that write
// to ResultEntry (create/update/delete/bulk-import) MUST call invalidate(`resultExamStats:${id}`)
// afterward, or a corrected mark shows a stale rank/average for up to the cache TTL.
//
// Standard competition ranking (1-2-2-4): tied marks share a rank, the next distinct mark skips
// accordingly — the conventional scheme for a printed marksheet.
async function computeExaminationStats(examinationId) {
  return cached(`resultExamStats:${examinationId}`, 60 * 1000, async () => {
    const entries = await prisma.resultEntry.findMany({
      where: { examinationId },
      select: { studentId: true, obtainedMarks: true },
      orderBy: { obtainedMarks: "desc" },
    });
    const totalStudents = entries.length;
    const average = totalStudents
      ? Math.round((entries.reduce((sum, e) => sum + e.obtainedMarks, 0) / totalStudents) * 100) / 100
      : null;

    const rankByStudentId = new Map();
    let rank = 0, prevMarks = null, seen = 0;
    for (const e of entries) {
      seen++;
      if (e.obtainedMarks !== prevMarks) { rank = seen; prevMarks = e.obtainedMarks; }
      rankByStudentId.set(e.studentId, rank);
    }
    return { totalStudents, average, rankByStudentId };
  });
}

module.exports = { computeExaminationStats };
