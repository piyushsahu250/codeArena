const prisma = require("../prisma");
const { cached } = require("./cache");
const { scoreSumsByStudent } = require("./attemptManifest");

// Mirrors groupRank.js's computeRankedGroup/computeGroupRank split: the expensive part (load every
// pool member + every completed attempt on the pool's exclusive tests, compute each member's
// overall percentage) is identical for every member of the same pool, so it's computed once and
// cached per poolId rather than recomputed from scratch on every single member's rank lookup.
// Previously this file called this exact query set fresh for every member on every leaderboard/
// my-pools/report.pdf request (an N-member pool meant N full recomputations of the same ranking,
// each itself several queries) — the same "loading every group member per single-student card"
// bug already fixed in groupRank.js, just reintroduced here since this ranker was built afterward
// without following that established pattern despite its comment claiming to mirror it.
async function computeRankedPool(poolId) {
  const [members, poolTests] = await Promise.all([
    prisma.talentPoolMember.findMany({ where: { poolId }, select: { studentId: true } }),
    prisma.talentPoolTest.findMany({ where: { poolId }, select: { testId: true } }),
  ]);
  const memberIds = members.map((m) => m.studentId);
  if (memberIds.length === 0) return [];
  const testIds = poolTests.map((t) => t.testId);

  // Scored out of each attempt's own manifest (utils/attemptManifest.js), not the test's current question list: for a RANDOM test that list is the whole bank, which understated
  // every member's percentage and ranked a member who took a RANDOM test below one who took a fixed test with the same real result.
  const attempts = testIds.length
    ? await prisma.testAttempt.findMany({
        where: { studentId: { in: memberIds }, testId: { in: testIds }, status: { not: "IN_PROGRESS" } },
        select: { id: true, studentId: true, testId: true, totalScore: true, questionOrder: true },
      })
    : [];
  const sums = await scoreSumsByStudent(prisma, attempts);

  return memberIds
    .map((id) => {
      const s = sums.get(id);
      return { id, pct: s && s.max > 0 ? (s.score / s.max) * 100 : -1 };
    })
    .sort((a, b) => b.pct - a.pct || (a.id < b.id ? -1 : 1)); // equal percentages keep a fixed order (by id)
}

// Ranks a student against fellow pool members by percentage on the pool's own exclusive
// assessments only, not the member's general test history. `percent` is null for a student with no
// completed attempts (sentinel -1 internally, never surfaced) so callers like report.pdf can show a
// real score instead of a hardcoded blank.
async function computeTalentPoolRank(studentId, poolId) {
  const ranked = await cached(`talentPoolRank:${poolId}`, 30 * 1000, () => computeRankedPool(poolId));
  if (ranked.length === 0) return { rank: null, totalStudents: null, percent: null };
  const entry = ranked.find((r) => r.id === studentId);
  const position = entry ? ranked.indexOf(entry) + 1 : null;
  return { rank: position, totalStudents: ranked.length, percent: entry && entry.pct >= 0 ? Math.round(entry.pct) : null };
}

async function computeRankedInterviewPool(poolId) {
  const [members, configs] = await Promise.all([
    prisma.talentPoolMember.findMany({ where: { poolId }, select: { studentId: true } }),
    prisma.talentPoolInterviewConfig.findMany({ where: { poolId }, select: { id: true } }),
  ]);
  const memberIds = members.map((m) => m.studentId);
  if (memberIds.length === 0) return [];
  const configIds = configs.map((c) => c.id);

  const reports = configIds.length
    ? await prisma.interviewReport.findMany({
        where: { studentId: { in: memberIds }, session: { talentPoolConfigId: { in: configIds } } },
        select: { studentId: true, overallScore: true },
      })
    : [];

  const sum = new Map(), count = new Map();
  for (const r of reports) {
    sum.set(r.studentId, (sum.get(r.studentId) || 0) + r.overallScore);
    count.set(r.studentId, (count.get(r.studentId) || 0) + 1);
  }

  return memberIds
    .map((id) => ({ id, avg: count.get(id) ? sum.get(id) / count.get(id) : -1 }))
    .sort((a, b) => b.avg - a.avg);
}

// Same shape, over InterviewReport.overallScore for sessions tied to this pool's interview
// configs — a straight average rather than a score/max ratio, since overallScore is already a
// normalized 0-100 figure per session.
async function computeTalentPoolInterviewRank(studentId, poolId) {
  const ranked = await cached(`talentPoolInterviewRank:${poolId}`, 30 * 1000, () => computeRankedInterviewPool(poolId));
  if (ranked.length === 0) return { rank: null, totalStudents: null };
  const entry = ranked.find((r) => r.id === studentId);
  const position = entry ? ranked.indexOf(entry) + 1 : null;
  return { rank: position, totalStudents: ranked.length };
}

module.exports = { computeTalentPoolRank, computeTalentPoolInterviewRank };
