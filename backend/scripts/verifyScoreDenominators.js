// Live, database-backed check (audit batch 9) of two things that turn attempts into a ranking:
//  * every "overall percentage" -- the class rank on the student dashboard, the talent-pool rank, and the pool auto-selection rule "minimum average score" -- is scored out of what
//    EACH ATTEMPT WAS GIVEN (its saved question list), not out of the test's current question list. For a RANDOM test that list is the whole bank, which understated every student who
//    took one; an edited test changed old results.
//  * the on-screen leaderboard and the spreadsheet export put students with equal scores in the SAME order (the screen used to leave ties to the database).
// Disposable data ("ZZ SD ...", removed at the end). It calls the functions directly; no e-mail, no HTTP.
//   node scripts/verifyScoreDenominators.js
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { computeGroupRank } = require("../src/utils/groupRank");
const { computeTalentPoolRank } = require("../src/utils/talentPoolRank");
const { evaluateCandidates } = require("../src/utils/talentPoolAutoSelect");
const repo = require("../src/modules/tests/tests.repository");

const TAG = "ZZ SD";
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); if (!ok) failed++; };

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.talentPool.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.test.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.question.deleteMany({ where: { title: { startsWith: `${TAG} ` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-sd-", endsWith: "@example.invalid" } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  try {
    const inst = await prisma.institute.create({ data: { name: `${TAG} Institute ${ts}`, code: "ZZSD" } });
    const dept = await prisma.department.create({ data: { name: "ZZ SD Dept", instituteId: inst.id } });
    const group = await prisma.academicGroup.create({ data: { instituteId: inst.id, batch: "2026", departmentId: dept.id, section: "Section SD" } });
    const mk = async (key, role, extra = {}) => prisma.user.create({ data: { name: `ZZ SD ${key}`, email: `zz-sd-${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(crypto.randomBytes(12).toString("base64url"), 4), role, instituteId: inst.id, mustChangePassword: false, ...extra } });
    const admin = await mk("admin", "INSTITUTE_ADMIN");
    const A = await mk("a", "STUDENT", { academicGroupId: group.id });
    const B = await mk("b", "STUDENT", { academicGroupId: group.id });
    const L = await mk("legacy", "STUDENT", { academicGroupId: group.id });

    const qs = [];
    for (let i = 1; i <= 6; i++) qs.push(await prisma.question.create({ data: { title: `${TAG} Q${i}`, description: `denominator question ${i}`, questionType: "MCQ", difficulty: "EASY", points: 10, options: ["A", "B", "C"], correctAnswer: [1], instituteId: inst.id } }));
    const now = Date.now();
    const mkTest = (title, questionList, extra = {}) => prisma.test.create({
      data: {
        title: `${TAG} ${title}`, durationMin: 30, startTime: new Date(now - 7200000), endTime: new Date(now + 6 * 3600000), isPublished: true, showResults: true, requireFullscreen: false,
        createdById: admin.id, instituteId: inst.id, questions: { create: questionList.map((q, order) => ({ questionId: q.id, order })) }, ...extra,
      },
    });
    // RANDOM: a bank of six 10-point questions, two drawn per student (so a student is scored out of 20, the bank is worth 60).
    const tRandom = await mkTest("Random", qs, { questionSelectionMode: "RANDOM", randomQuestionsPerStudent: 2 });
    // FIXED: two 10-point questions (out of 20).
    const tFixed = await mkTest("Fixed", [qs[4], qs[5]]);
    // A Json column cannot be given a plain null; an attempt "with no saved list" is simply created without the field.
    const finished = (testId, studentId, totalScore, questionOrder, extra = {}) => prisma.testAttempt.create({
      data: { testId, studentId, status: "SUBMITTED", totalScore, startedAt: new Date(now - 3600000), submittedAt: new Date(now - 600000), ...(questionOrder ? { questionOrder, expectedQuestionCount: questionOrder.length, manifestVersion: 1 } : {}), ...extra },
    });
    await finished(tRandom.id, A.id, 20, [qs[0].id, qs[1].id]);   // A: full marks on a RANDOM draw -> 20 of 20 = 100%
    await finished(tFixed.id, B.id, 15, [qs[4].id, qs[5].id]);    // B: 15 of 20 on the fixed test = 75%
    await finished(tFixed.id, L.id, 10, null);                    // L: an old attempt with no saved list -> falls back to the test's list: 10 of 20 = 50%

    // ---- class rank (dashboard rank card)
    const rankA = await computeGroupRank(A.id, group.id), rankB = await computeGroupRank(B.id, group.id), rankL = await computeGroupRank(L.id, group.id);
    check("class rank: the student with 100% on a RANDOM test ranks first (it used to be 20 of the bank's 60 = 33%, below a 75% student)", rankA.rank === 1, JSON.stringify(rankA));
    check("class rank: 75% is second, and an old attempt with no saved list (50%) is third", rankB.rank === 2 && rankL.rank === 3 && rankA.totalStudents === 3, `${rankB.rank}/${rankL.rank}/${rankA.totalStudents}`);

    // ---- talent-pool rank
    const pool = await prisma.talentPool.create({ data: { name: `${TAG} Pool ${ts}`, createdById: admin.id } });
    await prisma.talentPoolMember.createMany({ data: [A, B].map((s) => ({ poolId: pool.id, studentId: s.id })) });
    await prisma.talentPoolTest.createMany({ data: [tRandom, tFixed].map((t) => ({ poolId: pool.id, testId: t.id })) });
    const poolA = await computeTalentPoolRank(A.id, pool.id), poolB = await computeTalentPoolRank(B.id, pool.id);
    check("pool rank: first with 100%, second with 75% (the percentages are the real ones)", poolA.rank === 1 && poolA.percent === 100 && poolB.rank === 2 && poolB.percent === 75, `${JSON.stringify(poolA)} ${JSON.stringify(poolB)}`);

    // ---- auto-selection rule "minimum average score"
    const rule = { minAverageScorePercent: 90, matchMode: "ALL" };
    let verdict = await evaluateCandidates(prisma, rule, [A.id, B.id, L.id]);
    check("auto-selection (minimum 90%): only the student with 100% matches", verdict.matchedIds.length === 1 && verdict.matchedIds[0] === A.id, JSON.stringify(verdict.matchedIds));
    // The test is edited after the attempts: one question is removed from it. B's result must not move.
    await prisma.testQuestion.delete({ where: { testId_questionId: { testId: tFixed.id, questionId: qs[5].id } } });
    verdict = await evaluateCandidates(prisma, rule, [A.id, B.id]);
    check("after the test is edited (a question removed), a finished attempt is still scored out of its own list: B stays at 75% and does not pass 90% (it was 15 of 10 = 150%)", verdict.matchedIds.length === 1 && verdict.matchedIds[0] === A.id, JSON.stringify(verdict.matchedIds));
    verdict = await evaluateCandidates(prisma, { minAverageScorePercent: 70, matchMode: "ALL" }, [A.id, B.id]);
    check("and a 70% minimum still admits B (75%)", verdict.matchedIds.length === 2, JSON.stringify(verdict.matchedIds));

    // ---- leaderboard order = export order for tied scores
    const T1 = await mk("t1", "STUDENT"), T2 = await mk("t2", "STUDENT"), T3 = await mk("t3", "STUDENT");
    const tTies = await mkTest("Ties", [qs[0], qs[1]]);
    // Inserted latest-start first, so the database's natural order is the REVERSE of the start order; equal scores of 5.
    await finished(tTies.id, T3.id, 5, [qs[0].id, qs[1].id], { startedAt: new Date(now - 1800000) });
    await finished(tTies.id, T2.id, 5, [qs[0].id, qs[1].id], { startedAt: new Date(now - 2400000) });
    await finished(tTies.id, T1.id, 5, [qs[0].id, qs[1].id], { startedAt: new Date(now - 3000000) });
    await finished(tTies.id, A.id, 9, [qs[0].id, qs[1].id], { startedAt: new Date(now - 2000000) }); // a higher score ranks above the tie
    const screen = (await repo.attemptsForResults(tTies.id, {})).map((a) => a.studentId);
    const sheet = (await repo.attemptsForExport(tTies.id, {})).map((a) => a.studentId);
    check("the screen and the export list the same students in the same order", JSON.stringify(screen) === JSON.stringify(sheet), `${screen.length} vs ${sheet.length}`);
    check("a higher score first; students tied on score are ordered by who started first (earliest start first)", JSON.stringify(screen) === JSON.stringify([A.id, T1.id, T2.id, T3.id]), JSON.stringify(screen.map((id) => [A, T1, T2, T3].find((u) => u.id === id)?.name ?? id)));
  } finally {
    await cleanup();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(failed === 0 ? "\nSCORE DENOMINATORS AND TIE ORDER VERIFIED" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
