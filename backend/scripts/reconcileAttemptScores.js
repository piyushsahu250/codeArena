// DRY-RUN reconciliation of assessment scores and denominators. It never writes. For every attempt it compares:
//   expected  questions assigned (manifest = TestAttempt.questionOrder; legacy attempts: the test's list, lower confidence)
//   delivered how many of those still exist as questions
//   answered  distinct manifest questions with a saved answer
//   stored    TestAttempt.totalScore  vs  recomputed = sum of each manifest question's best submission score (the rule in utils/gradeAttempt.js)
//   old / new maximum  what the pre-manifest reports computed (the test's CURRENT question list) vs the manifest-based maximum
// and prints a proposed correction with a confidence level. Rows whose stored score or maximum differ are the ones that need a human decision; nothing is
// changed here, and any correction must be approved and applied by a separate, logged step.
//   node scripts/reconcileAttemptScores.js [--csv=/tmp/reconcile.csv] [--test=<testId>]
const fs = require("fs");
const prisma = require("../src/prisma");
const { scoreBases } = require("../src/utils/attemptManifest");
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=");

(async () => {
  const onlyTest = arg("test");
  const attempts = await prisma.testAttempt.findMany({
    where: onlyTest ? { testId: onlyTest } : {},
    select: {
      id: true, testId: true, studentId: true, status: true, totalScore: true, questionOrder: true, expectedQuestionCount: true,
      submissions: { select: { questionId: true, score: true, verdict: true } },
    },
  });
  const tests = await prisma.test.findMany({ where: { id: { in: [...new Set(attempts.map((a) => a.testId))] } }, select: { id: true, title: true, questions: { select: { questionId: true } } } });
  const testById = new Map(tests.map((t) => [t.id, t]));
  const bases = await scoreBases(prisma, attempts);
  const allIds = [...new Set(attempts.flatMap((a) => [...(Array.isArray(a.questionOrder) ? a.questionOrder : []), ...(testById.get(a.testId)?.questions || []).map((q) => q.questionId)]))];
  const pts = new Map((await prisma.question.findMany({ where: { id: { in: allIds } }, select: { id: true, points: true } })).map((q) => [q.id, q.points || 0]));

  const rows = [];
  const tally = { attempts: attempts.length, scoreDiffers: 0, maxDiffers: 0, countDiffers: 0, legacyNoManifest: 0, pendingEval: 0 };
  for (const a of attempts) {
    const base = bases.get(a.id);
    const manifest = Array.isArray(a.questionOrder) && a.questionOrder.length ? a.questionOrder : null;
    const ids = manifest || (testById.get(a.testId)?.questions || []).map((q) => q.questionId);
    const inManifest = new Set(ids);
    const best = new Map();
    for (const s of a.submissions) if (inManifest.has(s.questionId) && (!best.has(s.questionId) || s.score > best.get(s.questionId))) best.set(s.questionId, s.score);
    const recomputed = [...best.values()].reduce((x, y) => x + y, 0);
    const oldMax = (testById.get(a.testId)?.questions || []).reduce((s, q) => s + (pts.get(q.questionId) || 0), 0);
    const delivered = ids.filter((id) => pts.has(id)).length;
    const pending = a.submissions.filter((s) => s.verdict === "PENDING" && inManifest.has(s.questionId)).length;
    const problems = [];
    if (a.status !== "IN_PROGRESS" && recomputed !== a.totalScore) problems.push("STORED_SCORE_DIFFERS_FROM_RECOMPUTED");
    if (oldMax !== base.maxScore) problems.push("OLD_MAX_DIFFERS_FROM_MANIFEST_MAX");
    if (a.expectedQuestionCount != null && a.expectedQuestionCount !== ids.length) problems.push("EXPECTED_COUNT_DIFFERS_FROM_MANIFEST");
    if (delivered !== ids.length) problems.push("ASSIGNED_QUESTION_DELETED");
    if (!manifest) tally.legacyNoManifest++;
    if (a.status !== "IN_PROGRESS" && pending > 0) { problems.push("SUBMISSIONS_STILL_PENDING_EVALUATION"); tally.pendingEval++; }
    if (!problems.length) continue;
    if (problems.includes("STORED_SCORE_DIFFERS_FROM_RECOMPUTED")) tally.scoreDiffers++;
    if (problems.includes("OLD_MAX_DIFFERS_FROM_MANIFEST_MAX")) tally.maxDiffers++;
    if (problems.includes("EXPECTED_COUNT_DIFFERS_FROM_MANIFEST")) tally.countDiffers++;
    const confidence = manifest ? (problems.includes("ASSIGNED_QUESTION_DELETED") ? "LOW" : "HIGH") : "LOW";
    const proposal = problems.includes("STORED_SCORE_DIFFERS_FROM_RECOMPUTED")
      ? `set totalScore ${a.totalScore} -> ${recomputed} (needs approval)`
      : "no score change; report denominators now use the manifest maximum";
    rows.push({
      testId: a.testId, title: testById.get(a.testId)?.title || "", attemptId: a.id, studentId: a.studentId, status: a.status, expected: base.expectedCount, delivered,
      answered: best.size, source: base.source, storedScore: a.totalScore, recomputedScore: recomputed, oldMax: oldMax, manifestMax: base.maxScore,
      problems: problems.join("|"), proposal, confidence,
    });
  }
  console.log(JSON.stringify(tally));
  const byProblem = {};
  for (const r of rows) for (const p of r.problems.split("|")) byProblem[p] = (byProblem[p] || 0) + 1;
  console.log("rows needing review:", rows.length, JSON.stringify(byProblem));
  for (const r of rows.slice(0, 25)) console.log(`${r.attemptId.slice(0, 8)} test=${r.testId.slice(0, 8)} "${r.title.slice(0, 40)}" expected=${r.expected} stored=${r.storedScore} recomputed=${r.recomputedScore} oldMax=${r.oldMax} manifestMax=${r.manifestMax} [${r.problems}] ${r.confidence}`);
  const csv = arg("csv");
  if (csv && rows.length) { const cols = Object.keys(rows[0]); fs.writeFileSync(csv, [cols.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n")); console.log(`wrote ${rows.length} rows to ${csv}`); }
  console.log("DRY RUN: nothing was changed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
