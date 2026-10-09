// READ-ONLY audit: for every test attempt, compares what the student was actually given (TestAttempt.questionOrder) with what the test is configured to
// give, and with what was graded. Writes nothing. Output: a summary on stdout and, with --csv=<path>, one row per mismatching attempt.
//   node scripts/auditAttemptManifests.js [--csv=/tmp/attempt-mismatches.csv] [--test=<testId>]
const fs = require("fs");
const prisma = require("../src/prisma");

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=");

(async () => {
  const onlyTest = arg("test");
  const tests = await prisma.test.findMany({
    where: onlyTest ? { id: onlyTest } : { attempts: { some: {} } },
    select: {
      id: true, title: true, questionSelectionMode: true, randomQuestionsPerStudent: true, createdAt: true, updatedAt: true, instituteId: true,
      questions: { select: { questionId: true, question: { select: { id: true, points: true, questionType: true } } } },
    },
  });
  const rows = [];
  const kinds = {};
  let attemptsSeen = 0;
  for (const t of tests) {
    const configured = t.questionSelectionMode === "RANDOM" && t.randomQuestionsPerStudent ? t.randomQuestionsPerStudent : t.questions.length;
    const currentIds = new Set(t.questions.map((q) => q.questionId));
    const attempts = await prisma.testAttempt.findMany({
      where: { testId: t.id },
      select: { id: true, studentId: true, status: true, startedAt: true, submittedAt: true, totalScore: true, questionOrder: true, _count: { select: { submissions: true } } },
    });
    for (const a of attempts) {
      attemptsSeen++;
      const order = Array.isArray(a.questionOrder) ? a.questionOrder : null;
      const delivered = order ? order.length : null;
      const unique = order ? new Set(order).size : null;
      const existing = order ? await prisma.question.count({ where: { id: { in: order } } }) : null;
      const notOnTestNow = order ? order.filter((id) => !currentIds.has(id)).length : null;
      const problems = [];
      if (!order) problems.push("NO_MANIFEST");
      else {
        if (delivered !== configured) problems.push(delivered < configured ? "FEWER_THAN_CONFIGURED" : "MORE_THAN_CONFIGURED");
        if (unique !== delivered) problems.push("DUPLICATE_IDS");
        if (existing !== unique) problems.push("DELETED_QUESTIONS");
        if (t.questionSelectionMode !== "RANDOM" && delivered < t.questions.length && a.startedAt < t.updatedAt) problems.push("TEST_EDITED_AFTER_START");
      }
      if (problems.length) {
        for (const p of problems) kinds[p] = (kinds[p] || 0) + 1;
        rows.push({
          testId: t.id, title: t.title, mode: t.questionSelectionMode, attemptId: a.id, studentId: a.studentId, status: a.status,
          configured, currentOnTest: t.questions.length, delivered, unique, existingQuestions: existing, notOnTestNow, savedAnswers: a._count.submissions,
          totalScore: a.totalScore, startedAt: a.startedAt.toISOString(), testUpdatedAt: t.updatedAt.toISOString(), problems: problems.join("|"),
        });
      }
    }
  }
  console.log(`tests with attempts: ${tests.length}, attempts examined: ${attemptsSeen}, attempts with a mismatch: ${rows.length}`);
  console.log("by kind:", JSON.stringify(kinds));
  const byTest = {};
  for (const r of rows) (byTest[r.testId] ||= { title: r.title, configured: r.configured, current: r.currentOnTest, n: 0, delivered: {} }, byTest[r.testId].n++, byTest[r.testId].delivered[r.delivered] = (byTest[r.testId].delivered[r.delivered] || 0) + 1);
  for (const [id, v] of Object.entries(byTest).sort((a, b) => b[1].n - a[1].n).slice(0, 40)) console.log(`${id.slice(0, 8)} "${String(v.title).slice(0, 50)}" configured=${v.configured} nowOnTest=${v.current} affected=${v.n} deliveredCounts=${JSON.stringify(v.delivered)}`);
  const csvPath = arg("csv");
  if (csvPath && rows.length) {
    const cols = Object.keys(rows[0]);
    fs.writeFileSync(csvPath, [cols.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n"));
    console.log(`wrote ${rows.length} rows to ${csvPath}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
