// READ-ONLY detail for module coding attempts still IN_PROGRESS past their deadline: how old, how much saved work, which assessment.
//   node scripts/auditStuckModuleCoding.js
const prisma = require("../src/prisma");
(async () => {
  const now = Date.now();
  const rows = await prisma.moduleCodingAttempt.findMany({
    where: { status: "IN_PROGRESS" },
    select: {
      id: true, startedAt: true, attemptNumber: true, studentId: true, passed: true, score: true,
      moduleCodingTest: { select: { id: true, timeLimitMin: true, isActive: true, gatesModule: true, module: { select: { title: true } } } },
      _count: { select: { submissions: true, questions: true } },
    },
    orderBy: { startedAt: "asc" },
  });
  const out = rows.map((a) => {
    const limit = a.moduleCodingTest?.timeLimitMin || 45;
    const overdueH = Math.round((now - a.startedAt.getTime() - limit * 60000) / 360000) / 10;
    return { attempt: a.id.slice(0, 8), student: a.studentId.slice(0, 8), startedAt: a.startedAt.toISOString().slice(0, 16), limitMin: limit, overdueHours: overdueH, saved: a._count.submissions, of: a._count.questions, module: a.moduleCodingTest?.module?.title?.slice(0, 30) || "-", gatesModule: a.moduleCodingTest?.gatesModule ?? null };
  });
  console.table(out);
  console.log("env flags in this container:", JSON.stringify({ ENABLE_TEST_ATTEMPT_AUTO_FINALIZE: process.env.ENABLE_TEST_ATTEMPT_AUTO_FINALIZE || null }));
  console.log("READ ONLY: nothing was changed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
