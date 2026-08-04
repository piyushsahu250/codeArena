const prisma = require("../prisma");
const { testEligibilityWhere } = require("./testEligibility");
const { getStudentPoolIds } = require("./talentPoolEligibility");

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Builds the full performance picture for one student: summary stats, per-test history, and
// chart-ready analytics. Used by the on-screen dashboard and both report exports, so all three
// stay numerically consistent.
//
// maskUnpublished: when true (a student viewing their own dashboard), any attempt on a test
// with showResults=false has its score/percentage withheld from history rows and excluded from
// every score-based aggregate/chart — same "don't leak the answer key before publish" rule
// already enforced on the single-test result page. Admin/Staff always see everything.
async function computeStudentPerformance(studentId, { maskUnpublished = false } = {}) {
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: {
      id: true, name: true, email: true, rollNumber: true, registrationNumber: true, mobile: true,
      department: true, program: true, batchYear: true, section: true, isActive: true, profilePhotoUrl: true,
      institute: { select: { id: true, name: true } },
      class: { select: { id: true, name: true, batchYear: true } },
      academicGroup: { select: { id: true, batch: true, section: true, department: { select: { name: true } } } },
    },
  });
  if (!student || student.id !== studentId) return null;

  const memberPoolIds = await getStudentPoolIds(prisma, studentId);
  const [assignedTests, attempts] = await Promise.all([
    prisma.test.findMany({
      where: {
        isPublished: true,
        ...testEligibilityWhere(student.academicGroup?.id, student.class?.id, [...memberPoolIds], student.institute?.id),
      },
      select: { id: true },
    }),
    prisma.testAttempt.findMany({
      where: { studentId },
      include: { submissions: true },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const assignedTestIds = new Set(assignedTests.map((t) => t.id));

  const testIds = [...new Set(attempts.map((a) => a.testId))];
  const allQuestionIds = [...new Set(attempts.flatMap((a) => a.submissions.map((s) => s.questionId)))];
  const [testsRaw, questions] = await Promise.all([
    testIds.length
      ? prisma.test.findMany({
          where: { id: { in: testIds } },
          select: {
            id: true, title: true, showResults: true,
            questions: { select: { question: { select: { points: true } } } },
          },
        })
      : Promise.resolve([]),
    allQuestionIds.length
      ? prisma.question.findMany({
          where: { id: { in: allQuestionIds } },
          select: { id: true, questionType: true, subject: true },
        })
      : Promise.resolve([]),
  ]);
  const testMap = new Map(testsRaw.map((t) => [t.id, t]));
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  const testHistory = attempts.map((a) => {
    const test = testMap.get(a.testId);
    const maxScore = (test?.questions || []).reduce((s, q) => s + (q.question?.points || 0), 0);
    const finalized = a.status !== "IN_PROGRESS";
    const masked = maskUnpublished && test && test.showResults === false;
    const percentage = maxScore > 0 ? round1((a.totalScore / maxScore) * 100) : 0;
    const timeTakenMin = a.submittedAt
      ? Math.round((new Date(a.submittedAt) - new Date(a.startedAt)) / 60000)
      : null;
    const scoreVisible = finalized && !masked;
    return {
      testId: a.testId,
      testName: test?.title || "Deleted test",
      date: a.startedAt,
      status: a.status,
      score: scoreVisible ? a.totalScore : null,
      maxScore,
      percentage: scoreVisible ? percentage : null,
      timeTakenMin,
      resultsPending: !scoreVisible,
    };
  });

  const scored = testHistory.filter((h) => h.score !== null);
  const totalScoreSum = scored.reduce((s, h) => s + h.score, 0);
  const totalMaxSum = scored.reduce((s, h) => s + h.maxScore, 0);
  const overallPercentage = totalMaxSum > 0 ? round1((totalScoreSum / totalMaxSum) * 100) : 0;
  const averageScorePercent = scored.length
    ? round1(scored.reduce((s, h) => s + h.percentage, 0) / scored.length)
    : 0;
  const highest = scored.length ? scored.reduce((a, b) => (b.percentage > a.percentage ? b : a)) : null;
  const lowest = scored.length ? scored.reduce((a, b) => (b.percentage < a.percentage ? b : a)) : null;

  const attemptedTestIds = new Set(attempts.map((a) => a.testId));
  const totalTestsAssigned = assignedTestIds.size;
  const totalTestsAttempted = attempts.length;
  const totalTestsCompleted = attempts.filter((a) => a.status !== "IN_PROGRESS").length;
  const totalTestsPending = [...assignedTestIds].filter((id) => !attemptedTestIds.has(id)).length;

  let codingAttempted = 0, codingSolved = 0, mcqAttempted = 0, mcqCorrect = 0;
  const subjectStats = new Map();
  for (const a of attempts) {
    const test = testMap.get(a.testId);
    const masked = maskUnpublished && test && test.showResults === false;
    if (masked || a.status === "IN_PROGRESS") continue;
    for (const s of a.submissions) {
      const q = questionMap.get(s.questionId);
      if (!q) continue;
      const correct = s.verdict === "ACCEPTED";
      if (q.questionType === "CODING") {
        codingAttempted++;
        if (correct) codingSolved++;
      } else {
        mcqAttempted++;
        if (correct) mcqCorrect++;
      }
      if (q.subject) {
        const cur = subjectStats.get(q.subject) || { correct: 0, total: 0 };
        cur.total++;
        if (correct) cur.correct++;
        subjectStats.set(q.subject, cur);
      }
    }
  }

  const totalTimeSpentMin = testHistory.reduce((s, h) => s + (h.timeTakenMin || 0), 0);
  const lastAttemptDate = attempts.length
    ? attempts.reduce((latest, a) => {
        const d = a.submittedAt || a.startedAt;
        return !latest || new Date(d) > new Date(latest) ? d : latest;
      }, null)
    : null;

  const scoreTrend = scored
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((h) => ({ date: h.date, testName: h.testName, percentage: h.percentage }));

  const subjectWise = [...subjectStats.entries()].map(([subject, { correct, total }]) => ({
    subject, correct, total, percentage: total > 0 ? round1((correct / total) * 100) : 0,
  }));

  const codingVsMcq = {
    coding: { attempted: codingAttempted, solved: codingSolved, percentage: codingAttempted > 0 ? round1((codingSolved / codingAttempted) * 100) : 0 },
    mcq: { attempted: mcqAttempted, correct: mcqCorrect, percentage: mcqAttempted > 0 ? round1((mcqCorrect / mcqAttempted) * 100) : 0 },
  };

  const monthlyMap = new Map();
  for (const h of scored) {
    const d = new Date(h.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = monthlyMap.get(key) || { sum: 0, count: 0 };
    cur.sum += h.percentage;
    cur.count++;
    monthlyMap.set(key, cur);
  }
  const monthly = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { sum, count }]) => ({ month, averagePercentage: round1(sum / count), testsCount: count }));

  return {
    student,
    summary: {
      totalTestsAssigned, totalTestsAttempted, totalTestsCompleted, totalTestsPending,
      averageScorePercent, overallPercentage,
      highest, lowest,
      totalCodingAttempted: codingAttempted, totalCodingSolved: codingSolved,
      totalMcqAttempted: mcqAttempted, totalMcqCorrect: mcqCorrect,
      totalTimeSpentMin, lastAttemptDate,
    },
    testHistory,
    analytics: { scoreTrend, subjectWise, codingVsMcq, monthly },
  };
}

module.exports = { computeStudentPerformance };
