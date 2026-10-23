const prisma = require("../prisma");
const { cached } = require("./cache");
const { scoreSumsByStudent } = require("./attemptManifest");

// The expensive, per-GROUP half of computeGroupRank below (load every groupmate + every
// completed attempt + every attempt's test, compute each student's overall percentage) — this
// result is identical for every student in the same academic group, so it's cached per
// academicGroupId rather than recomputed from scratch on every single student's dashboard load
// (previously: N students in a group meant N full recomputations of the same ranking).
async function computeRankedGroup(academicGroupId) {
  const groupmates = await prisma.user.findMany({ where: { academicGroupId, role: "STUDENT" }, select: { id: true } });
  const ids = groupmates.map((c) => c.id);
  if (ids.length === 0) return [];

  // Each attempt is scored out of the questions IT was given (its manifest, utils/attemptManifest.js), exactly as the student's own performance page does. This used to divide by
  // each test's current question list, which for a RANDOM test is the whole bank, so the class rank disagreed with the percentage the student sees on their dashboard.
  const attempts = await prisma.testAttempt.findMany({
    where: { studentId: { in: ids }, status: { not: "IN_PROGRESS" } },
    select: { id: true, studentId: true, testId: true, totalScore: true, questionOrder: true },
  });
  const sums = await scoreSumsByStudent(prisma, attempts);

  return ids
    .map((id) => {
      const s = sums.get(id);
      return { id, pct: s && s.max > 0 ? (s.score / s.max) * 100 : -1 };
    })
    .sort((a, b) => b.pct - a.pct || (a.id < b.id ? -1 : 1)); // equal percentages keep a fixed order (by id) rather than whatever order the database returned
}

// Ranks a student against groupmates (same academic group: Institute+Batch+Department+Section) by
// overall test percentage (score summed across every completed attempt, divided by the max
// possible across those same tests). Students with no completed attempts rank last (sentinel -1),
// tied among themselves. Returns nulls if the student has no academic group (nothing meaningful to
// rank against). Shared by routes/dashboard.js (rank card) and utils/gamification.js (TOP_10_CLASS
// badge — code string kept as-is, see BADGE_DEFS comment, only what it ranks against changed).
async function computeGroupRank(studentId, academicGroupId) {
  if (!academicGroupId) return { rank: null, totalStudents: null };
  const ranked = await cached(`groupRank:${academicGroupId}`, 60 * 1000, () => computeRankedGroup(academicGroupId));
  if (ranked.length === 0) return { rank: null, totalStudents: null };

  const position = ranked.findIndex((r) => r.id === studentId) + 1;
  return { rank: position || null, totalStudents: ranked.length };
}

module.exports = { computeGroupRank };
