const prisma = require("../prisma");
const { cached } = require("./cache");

// The expensive, per-GROUP half of computeGroupRank below (load every groupmate + every
// completed attempt + every attempt's test, compute each student's overall percentage) — this
// result is identical for every student in the same academic group, so it's cached per
// academicGroupId rather than recomputed from scratch on every single student's dashboard load
// (previously: N students in a group meant N full recomputations of the same ranking).
async function computeRankedGroup(academicGroupId) {
  const groupmates = await prisma.user.findMany({ where: { academicGroupId, role: "STUDENT" }, select: { id: true } });
  const ids = groupmates.map((c) => c.id);
  if (ids.length === 0) return [];

  const attempts = await prisma.testAttempt.findMany({
    where: { studentId: { in: ids }, status: { not: "IN_PROGRESS" } },
    select: { studentId: true, testId: true, totalScore: true },
  });
  const testIds = [...new Set(attempts.map((a) => a.testId))];
  const tests = testIds.length
    ? await prisma.test.findMany({
        where: { id: { in: testIds } },
        select: { id: true, questions: { select: { question: { select: { points: true } } } } },
      })
    : [];
  const maxByTest = new Map(tests.map((t) => [t.id, t.questions.reduce((s, q) => s + q.question.points, 0)]));

  const scoreSum = new Map(), maxSum = new Map();
  for (const a of attempts) {
    const max = maxByTest.get(a.testId) || 0;
    scoreSum.set(a.studentId, (scoreSum.get(a.studentId) || 0) + a.totalScore);
    maxSum.set(a.studentId, (maxSum.get(a.studentId) || 0) + max);
  }

  return ids
    .map((id) => {
      const s = scoreSum.get(id) || 0, m = maxSum.get(id) || 0;
      return { id, pct: m > 0 ? (s / m) * 100 : -1 };
    })
    .sort((a, b) => b.pct - a.pct);
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
