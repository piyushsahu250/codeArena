// READ-ONLY: sessions that should have ended but are still IN_PROGRESS, per engine. A healthy platform has none older than a few minutes past their deadline
// (the auto-finalize schedulers close them); a pile of old ones means a scheduler or a finalize path is failing and students' work is sitting unscored.
//   node scripts/auditStuckSessions.js [--grace-min=30]
const prisma = require("../src/prisma");
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=")[1] : d; };

(async () => {
  const graceMin = Number(arg("grace-min", 30));
  const now = Date.now();
  const cutoff = (min) => new Date(now - (min + graceMin) * 60000);
  const out = {};

  // formal tests: deadline = startedAt + durationMin
  const testAttempts = await prisma.testAttempt.findMany({ where: { status: "IN_PROGRESS" }, select: { id: true, startedAt: true, testId: true, test: { select: { title: true, durationMin: true, endTime: true } } } });
  const stuckTests = testAttempts.filter((a) => now - a.startedAt.getTime() > (a.test.durationMin + graceMin) * 60000);
  out.testAttempts = { inProgress: testAttempts.length, stuckPastDeadline: stuckTests.length, oldest: stuckTests.sort((a, b) => a.startedAt - b.startedAt).slice(0, 5).map((a) => ({ id: a.id.slice(0, 8), test: a.test.title.slice(0, 40), startedAt: a.startedAt.toISOString(), durationMin: a.test.durationMin })) };

  // module coding assessments
  const mca = await prisma.moduleCodingAttempt.findMany({ where: { status: "IN_PROGRESS" }, select: { id: true, startedAt: true, moduleCodingTest: { select: { timeLimitMin: true } } } });
  const stuckMca = mca.filter((a) => now - a.startedAt.getTime() > ((a.moduleCodingTest?.timeLimitMin || 45) + graceMin) * 60000);
  out.moduleCodingAttempts = { inProgress: mca.length, stuckPastDeadline: stuckMca.length };

  // interviews (default 60 min when no duration is stored)
  const interviews = await prisma.interviewSession.findMany({ where: { status: "IN_PROGRESS" }, select: { id: true, startedAt: true, config: true } });
  const stuckIv = interviews.filter((s) => now - s.startedAt.getTime() > ((Number(s.config?.durationMin) || 60) + graceMin) * 60000);
  out.interviewSessions = { inProgress: interviews.length, stuckPastDeadline: stuckIv.length };

  // AI voice interviews
  const ai = await prisma.aiInterviewSession.count({ where: { status: { in: ["INTRODUCTION", "QUESTIONING", "FOLLOW_UP", "DEEP_DIVE", "SKILL_TRANSITION", "FINAL_QUESTION"] }, expiresAt: { lt: cutoff(0) } } }).catch((e) => `error: ${e.message.slice(0, 80)}`);
  out.aiInterviewSessionsPastExpiryStillActive = ai;

  // readiness assessments
  const readiness = await prisma.readinessAssessment.findMany({ where: { status: "IN_PROGRESS" }, select: { id: true, startedAt: true } }).catch(() => null);
  if (readiness) out.readinessAssessments = { inProgress: readiness.length, olderThan3h: readiness.filter((r) => now - r.startedAt.getTime() > 3 * 3600000).length };

  console.log(JSON.stringify(out, null, 1));
  console.log("READ ONLY: nothing was changed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
