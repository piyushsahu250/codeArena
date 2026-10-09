// DRY-RUN EVALUATION for the stuck module coding attempts: runs each saved answer through the judge under the SAME rules the real finalize uses
// (hidden test cases, per-question percent = passed/total cases, attempt score = average of the question percents, pass = score >= passingPercent) and prints
// the marks it WOULD produce. It writes NOTHING: no submission row, attempt, module access, gamification or certificate is touched.
//   node scripts/previewStuckModuleCodingGrades.js [attemptIdPrefix ...]
const prisma = require("../src/prisma");
const { judgeSubmission } = require("../src/utils/judgeGateway");
const { runQueued } = require("../src/utils/queue");

(async () => {
  const only = process.argv.slice(2);
  const now = Date.now();
  const attempts = await prisma.moduleCodingAttempt.findMany({
    where: { status: "IN_PROGRESS" },
    orderBy: { startedAt: "asc" },
    include: {
      student: { select: { name: true } },
      moduleCodingTest: { select: { id: true, timeLimitMin: true, passingPercent: true } },
      questions: { include: { question: { include: { testCases: true } } } },
      submissions: true,
    },
  });
  for (const a of attempts) {
    const limit = a.moduleCodingTest?.timeLimitMin || 45;
    if (now <= a.startedAt.getTime() + limit * 60000) continue;
    if (only.length && !only.some((p) => a.id.startsWith(p))) continue;
    const bySub = new Map(a.submissions.map((s) => [s.questionId, s]));
    let sum = 0;
    const lines = [];
    for (const { question } of a.questions) {
      const sub = bySub.get(question.id);
      if (!sub || !sub.code || !sub.code.trim()) { lines.push(`   - ${(question.title || "question").slice(0, 40)}: no saved code -> 0%`); continue; }
      let passed = sub.passedCases, total = sub.totalCases, verdict = sub.verdict, source = "already evaluated";
      if (sub.verdict === "PENDING") {
        const hidden = question.testCases.filter((t) => t.isHidden);
        const cases = hidden.length > 0 ? hidden : question.testCases;
        try {
          const r = await runQueued(() => judgeSubmission({ language: sub.language, code: sub.code, testCases: cases, timeLimitMs: question.timeLimitMs, memoryLimitKb: question.memoryLimitKb || undefined, evaluationType: question.evaluationType, functionSignature: question.functionSignature }));
          passed = r.passedCases; total = r.totalCases; verdict = r.verdict; source = "judge, now";
        } catch (e) { lines.push(`   - ${(question.title || "question").slice(0, 40)}: judge unavailable (${e.message}) -> cannot preview`); continue; }
      }
      const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
      sum += total > 0 ? pct : 0;
      lines.push(`   - ${(question.title || "question").slice(0, 40)}: ${sub.language}, ${passed}/${total} cases, ${verdict}, ${pct}% (${source})`);
    }
    const n = a.questions.length;
    const score = n > 0 ? Math.round(sum / n) : 0;
    const wouldPass = score >= a.moduleCodingTest.passingPercent;
    const prior = await prisma.moduleCodingAttempt.count({ where: { moduleCodingTestId: a.moduleCodingTestId, studentId: a.studentId, passed: true } });
    console.log(`${a.id.slice(0, 8)}  ${a.student.name}  attempt #${a.attemptNumber}\n${lines.join("\n")}\n   => PROPOSED score ${score}% (pass mark ${a.moduleCodingTest.passingPercent}%): ${wouldPass ? "WOULD PASS" : "would not pass"}${wouldPass && prior === 0 ? "  [a real grade would then unlock the next module and could issue a certificate]" : ""}${prior > 0 ? "  [student has already passed this assessment in another attempt]" : ""}\n`);
  }
  console.log("DRY RUN: nothing was graded, saved or changed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
