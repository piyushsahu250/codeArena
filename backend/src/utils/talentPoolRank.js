const prisma = require("../prisma");
const { cached } = require("./cache");

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

  const [attempts, tests] = await Promise.all([
    testIds.length
      ? prisma.testAttempt.findMany({
          where: { studentId: { in: memberIds }, testId: { in: testIds }, status: { not: "IN_PROGRESS" } },
          select: { studentId: true, testId: true, totalScore: true },
        })
      : [],
    testIds.length
      ? prisma.test.findMany({ where: { id: { in: testIds } }, select: { id: true, questions: { select: { question: { select: { points: true } } } } } })
      : [],
  ]);
  const maxByTest = new Map(tests.map((t) => [t.id, t.questions.reduce((s, q) => s + q.question.points, 0)]));

  const scoreSum = new Map(), maxSum = new Map();
  for (const a of attempts) {
    const max = maxByTest.get(a.testId) || 0;
    scoreSum.set(a.studentId, (scoreSum.get(a.studentId) || 0) + a.totalScore);
    maxSum.set(a.studentId, (maxSum.get(a.studentId) || 0) + max);
  }

  return memberIds
    .map((id) => {
      const s = scoreSum.get(id) || 0, m = maxSum.get(id) || 0;
      return { id, pct: m > 0 ? (s / m) * 100 : -1 };
    })
    .sort((a, b) => b.pct - a.pct);
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
