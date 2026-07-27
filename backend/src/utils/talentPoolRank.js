const prisma = require("../prisma");

// Mirrors groupRank.js's computeGroupRank shape (batch-load pool members, sum score/max, sort,
// return {rank, totalStudents}) — but ranks over the pool's own exclusive assessments only, not a
// member's general test history. A Talent Pool ranking is meant to answer "how did this student
// do on the assessments this pool assigned," not "how good are they overall."
async function computeTalentPoolRank(studentId, poolId) {
  const [members, poolTests] = await Promise.all([
    prisma.talentPoolMember.findMany({ where: { poolId }, select: { studentId: true } }),
    prisma.talentPoolTest.findMany({ where: { poolId }, select: { testId: true } }),
  ]);
  const memberIds = members.map((m) => m.studentId);
  const testIds = poolTests.map((t) => t.testId);
  if (memberIds.length === 0 || testIds.length === 0) return { rank: null, totalStudents: memberIds.length || null };

  const attempts = await prisma.testAttempt.findMany({
    where: { studentId: { in: memberIds }, testId: { in: testIds }, status: { not: "IN_PROGRESS" } },
    select: { studentId: true, testId: true, totalScore: true },
  });
  const tests = await prisma.test.findMany({
    where: { id: { in: testIds } },
    select: { id: true, questions: { select: { question: { select: { points: true } } } } },
  });
  const maxByTest = new Map(tests.map((t) => [t.id, t.questions.reduce((s, q) => s + q.question.points, 0)]));

  const scoreSum = new Map(), maxSum = new Map();
  for (const a of attempts) {
    const max = maxByTest.get(a.testId) || 0;
    scoreSum.set(a.studentId, (scoreSum.get(a.studentId) || 0) + a.totalScore);
    maxSum.set(a.studentId, (maxSum.get(a.studentId) || 0) + max);
  }

  const ranked = memberIds
    .map((id) => {
      const s = scoreSum.get(id) || 0, m = maxSum.get(id) || 0;
      return { id, pct: m > 0 ? (s / m) * 100 : -1 };
    })
    .sort((a, b) => b.pct - a.pct);

  const position = ranked.findIndex((r) => r.id === studentId) + 1;
  return { rank: position || null, totalStudents: memberIds.length };
}

// Same shape, over InterviewReport.overallScore for sessions tied to this pool's interview
// configs — a straight average rather than a score/max ratio, since overallScore is already a
// normalized 0-100 figure per session.
async function computeTalentPoolInterviewRank(studentId, poolId) {
  const [members, configs] = await Promise.all([
    prisma.talentPoolMember.findMany({ where: { poolId }, select: { studentId: true } }),
    prisma.talentPoolInterviewConfig.findMany({ where: { poolId }, select: { id: true } }),
  ]);
  const memberIds = members.map((m) => m.studentId);
  const configIds = configs.map((c) => c.id);
  if (memberIds.length === 0 || configIds.length === 0) return { rank: null, totalStudents: memberIds.length || null };

  const reports = await prisma.interviewReport.findMany({
    where: { studentId: { in: memberIds }, session: { talentPoolConfigId: { in: configIds } } },
    select: { studentId: true, overallScore: true },
  });

  const sum = new Map(), count = new Map();
  for (const r of reports) {
    sum.set(r.studentId, (sum.get(r.studentId) || 0) + r.overallScore);
    count.set(r.studentId, (count.get(r.studentId) || 0) + 1);
  }

  const ranked = memberIds
    .map((id) => ({ id, avg: count.get(id) ? sum.get(id) / count.get(id) : -1 }))
    .sort((a, b) => b.avg - a.avg);

  const position = ranked.findIndex((r) => r.id === studentId) + 1;
  return { rank: position || null, totalStudents: memberIds.length };
}

module.exports = { computeTalentPoolRank, computeTalentPoolInterviewRank };
