const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { computeStudentPerformance } = require("../utils/studentPerformance");
const { getModuleLockMap } = require("../utils/learningLock");
const { computeGroupRank } = require("../utils/groupRank");
const { testEligibilityWhere } = require("../utils/testEligibility");
const { getStudentPoolIds } = require("../utils/talentPoolEligibility");

const router = express.Router();

// Reads the persisted streak (updated by utils/gamification.js on any streak-eligible
// activity — solving a coding problem or completing a lesson). currentStreak is only updated
// lazily on the next activity, so it must be treated as stale (effectively 0) once
// lastActiveDate is more than a day behind today.
async function getCodingStreak(studentId) {
  const streak = await prisma.studentStreak.findUnique({ where: { studentId } });
  if (!streak || !streak.lastActiveDate) return { current: 0, longest: streak?.longestStreak || 0 };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const last = new Date(streak.lastActiveDate); last.setHours(0, 0, 0, 0);
  const stillLive = last.getTime() === today.getTime() || last.getTime() === yesterday.getTime();
  return { current: stillLive ? streak.currentStreak : 0, longest: streak.longestStreak };
}

async function getRecentActivity(studentId) {
  const [attempts, lessonProgress, certificates, runs] = await Promise.all([
    prisma.testAttempt.findMany({
      where: { studentId, status: { not: "IN_PROGRESS" } },
      select: { submittedAt: true, test: { select: { title: true } } },
      orderBy: { submittedAt: "desc" }, take: 5,
    }),
    prisma.lessonProgress.findMany({
      where: { studentId, status: "COMPLETED" },
      select: { completedAt: true, lesson: { select: { title: true, isModuleTest: true, module: { select: { title: true } } } } },
      orderBy: { completedAt: "desc" }, take: 5,
    }),
    prisma.certificate.findMany({
      where: { studentId },
      select: { issuedAt: true, title: true, programName: true, course: { select: { name: true } } },
      orderBy: { issuedAt: "desc" }, take: 3,
    }),
    prisma.practiceRunLog.findMany({
      where: { studentId, verdict: "ACCEPTED" },
      select: { createdAt: true, question: { select: { prompt: true } } },
      orderBy: { createdAt: "desc" }, take: 5,
    }),
  ]);

  const items = [
    ...attempts.map((a) => ({ type: "test", text: `Completed "${a.test.title}" test`, date: a.submittedAt })),
    ...lessonProgress.map((p) => ({
      type: "lesson",
      text: p.lesson.isModuleTest ? `Passed the "${p.lesson.module.title}" practice test` : `Finished "${p.lesson.title}" (${p.lesson.module.title})`,
      date: p.completedAt,
    })),
    // course is populated for LEARNING_MODULE and (as of the course-wide redesign) CODING_ASSESSMENT
    // certificates — only MANUAL certs have none, so this falls back to the certificate's own
    // title/programName instead of crashing for those.
    ...certificates.map((c) => ({ type: "certificate", text: `Earned the ${c.course?.name || c.programName || c.title} certificate`, date: c.issuedAt })),
    ...runs.map((r) => ({
      type: "coding",
      text: `Solved a coding practice problem: "${r.question.prompt.length > 60 ? `${r.question.prompt.slice(0, 60)}…` : r.question.prompt}"`,
      date: r.createdAt,
    })),
  ]
    .filter((i) => i.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);

  return items;
}

async function getNotifications(student) {
  const notifications = [];
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 3600 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  const memberPoolIds = await getStudentPoolIds(prisma, student.id);
  const [assignedTests, myAttempts] = await Promise.all([
    prisma.test.findMany({
      where: {
        isPublished: true,
        ...testEligibilityWhere(student.academicGroupId, student.classId, [...memberPoolIds], student.instituteId),
      },
      select: { id: true, title: true, startTime: true, createdAt: true },
    }),
    prisma.testAttempt.findMany({ where: { studentId: student.id }, select: { testId: true } }),
  ]);
  const myAttemptTestIds = new Set(myAttempts.map((a) => a.testId));

  for (const t of assignedTests) {
    if (t.createdAt >= last7d && !myAttemptTestIds.has(t.id)) {
      notifications.push({ type: "test_assigned", text: `New test assigned: "${t.title}"`, date: t.createdAt });
    }
    if (t.startTime >= now && t.startTime <= in48h) {
      notifications.push({ type: "test_reminder", text: `"${t.title}" starts ${new Date(t.startTime).toLocaleString()}`, date: t.startTime });
    }
  }

  const javaCourse = await prisma.course.findUnique({ where: { slug: "java" } });
  if (javaCourse) {
    const modules = await prisma.courseModule.findMany({ where: { courseId: javaCourse.id }, orderBy: { order: "asc" } });
    const lockMap = await getModuleLockMap(prisma, student.id, javaCourse.id);
    const currentUnstarted = modules.find((m, i) => i > 0 && !lockMap.get(m.id)?.locked && !lockMap.get(m.id)?.completed);
    if (currentUnstarted) {
      const anyProgress = await prisma.lessonProgress.count({
        where: { studentId: student.id, status: { not: "NOT_STARTED" }, lesson: { moduleId: currentUnstarted.id } },
      });
      if (anyProgress === 0) {
        notifications.push({ type: "module_unlocked", text: `"${currentUnstarted.title}" module is now unlocked`, date: now });
      }
    }
  }

  const recentCerts = await prisma.certificate.findMany({
    where: { studentId: student.id, issuedAt: { gte: last7d } },
    select: { issuedAt: true, title: true, programName: true, course: { select: { name: true } } },
  });
  for (const c of recentCerts) {
    notifications.push({ type: "certificate", text: `You earned the ${c.course?.name || c.programName || c.title} certificate!`, date: c.issuedAt });
  }

  return notifications.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
}

// STUDENT: single aggregation endpoint for the dashboard's summary cards, performance summary,
// and recent test results — one round trip instead of the frontend re-deriving these from raw
// test/submission data itself. Upcoming tests and full Learning Module progress are still
// fetched separately (GET /tests and GET /learning/courses/:slug already do exactly this, and
// duplicating their institute/class-scoping logic here would just be a second place for that
// logic to drift out of sync).
router.get("/student", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!student) return res.status(404).json({ error: "Student not found" });

    // Sequential, not Promise.all — this is the single highest-traffic route on the platform
    // (every student's dashboard load), and each of these already fans out into its own 2-4-way
    // Promise.all internally (computeStudentPerformance, getRecentActivity, getNotifications).
    // Running all 7 at once could spike one request to 10+ simultaneous pool connections; a burst
    // of students loading their dashboard together (start of day/class) is exactly the shape of
    // load that exhausted the pool for login and attendance before those were fixed the same way
    // (see auth.js/attendance.js). A few hundred ms of added latency per request is worth it.
    const perf = await computeStudentPerformance(student.id, { maskUnpublished: true });
    // computeStudentPerformance only returns null if the student row vanished between the
    // findUnique above and this call (e.g. deleted by an admin mid-request) — vanishingly rare,
    // but worth a clear error over a null-dereference crash a few lines down.
    if (!perf) return res.status(404).json({ error: "Student not found" });
    const rank = await computeGroupRank(student.id, student.academicGroupId);
    const streak = await getCodingStreak(student.id);
    const certificatesEarned = await prisma.certificate.count({ where: { studentId: student.id } });
    const recentActivity = await getRecentActivity(student.id);
    const notifications = await getNotifications(student);
    const javaCourse = await prisma.course.findUnique({ where: { slug: "java" } });

    let learningProgressPercent = 0;
    if (javaCourse) {
      const totalLessons = await prisma.lesson.count({ where: { module: { courseId: javaCourse.id } } });
      const completedLessons = await prisma.lessonProgress.count({
        where: { studentId: student.id, status: "COMPLETED", lesson: { module: { courseId: javaCourse.id } } },
      });
      learningProgressPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
    }

    res.json({
      cards: {
        testsAssigned: perf.summary.totalTestsAssigned,
        testsCompleted: perf.summary.totalTestsCompleted,
        testsPending: perf.summary.totalTestsPending,
        averageScorePercent: perf.summary.averageScorePercent,
        rank: rank.rank,
        totalStudentsInClass: rank.totalStudents,
        codingSolved: perf.summary.totalCodingSolved,
        mcqCorrect: perf.summary.totalMcqCorrect,
        learningProgressPercent,
        codingStreak: streak.current,
        longestStreak: streak.longest,
        certificatesEarned,
      },
      performanceSummary: {
        highest: perf.summary.highest,
        lowest: perf.summary.lowest,
        averageScorePercent: perf.summary.averageScorePercent,
        totalTimeSpentMin: perf.summary.totalTimeSpentMin,
        lastAttemptDate: perf.summary.lastAttemptDate,
      },
      recentTestResults: perf.testHistory.filter((h) => h.status !== "IN_PROGRESS").slice(0, 5),
      recentActivity,
      notifications,
    });
  } catch (err) {
    // Detailed context server-side only — the client only ever sees the generic message below,
    // never a stack trace or internal field names.
    console.error("[dashboard/student] failed", {
      userId: req.user?.id, role: req.user?.role, endpoint: req.originalUrl,
      timestamp: new Date().toISOString(), error: err.message, stack: err.stack,
    });
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

module.exports = router;
