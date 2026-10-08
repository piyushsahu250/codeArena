// GET /api/student/dashboard — ONE consolidated, student-scoped payload for the redesigned
// student dashboard (replaces the ~8 parallel + 1 waterfall requests the old page fired).
//
// Rules this file follows:
//  - Everything is keyed by req.user.id; no id is ever accepted from the client (no IDOR surface).
//  - Institute/group scoping reuses the same eligibility helpers the rest of the app uses.
//  - Each section is isolated: a failure becomes { error: true } for that section only.
//  - Missing data is null/[] — never a fabricated 0 — so the UI can say "Not available yet".
//  - Only DTO fields are returned (no hidden test cases, no answers, no other users' data).
//  - Live/volatile things (test status, timers, results) are NOT cached; only recommendations
//    reuse their existing 5-minute cache.
//  - Sections run in small sequential groups (not one giant Promise.all) to protect the DB pool,
//    same reasoning as routes/dashboard.js.
const express = require("express");
const prisma = require("../prisma");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../utils/permissions");
const { LIVE, liveLessonWhere } = require("../utils/publishState");
const { computeStudentPerformance } = require("../utils/studentPerformance");
const { computeGroupRank } = require("../utils/groupRank");
const { getModuleLockMap } = require("../utils/learningLock");
const { testEligibilityWhere } = require("../utils/testEligibility");
const { getStudentPoolIds } = require("../utils/talentPoolEligibility");
const { cached } = require("../utils/cache");
const { computeLearningRecommendations } = require("../utils/learningRecommendations");
const { courseEligibilityWhere, isEligibilityUnresolvable } = require("../utils/courseEligibility");
const { computeStudentOverallAttendancePercent } = require("../utils/attendanceStats");
const { computeCompletion } = require("../utils/resumeAts");
const { computeMandatoryCompletion } = require("../utils/studentProfileCompletion");
const { decryptProfile } = require("../utils/piiEncryption");

const router = express.Router();

const DAY = 24 * 3600 * 1000;

async function safe(name, fn) {
  try { return await fn(); } catch (err) {
    console.error(`[student/dashboard] section "${name}" failed:`, err.message);
    return { error: true };
  }
}

// Readiness categories shown on the dashboard, mapped from ReadinessSubject.name by keyword.
const READINESS_CATEGORIES = [
  { key: "dsa", label: "DSA", re: /\b(dsa|data structure|algorithm)/i },
  { key: "java", label: "Java", re: /\bjava\b/i },
  { key: "dbms", label: "DBMS", re: /\b(dbms|database|sql)/i },
  { key: "os", label: "OS", re: /\b(os|operating system)/i },
  { key: "cn", label: "CN", re: /\b(cn|computer network|networking)/i },
  { key: "aptitude", label: "Aptitude", re: /aptitude|quantitative|reasoning/i },
  { key: "communication", label: "Communication", re: /communication|english|soft skill/i },
  { key: "cybersecurity", label: "Cybersecurity", re: /cyber|security/i },
];

const CERT_TYPE_LABEL = { LEARNING_MODULE: "Course", CODING_ASSESSMENT: "Coding assessment", MANUAL: "Programme", READINESS: "Readiness" };

function certVerifyPath(c) {
  return c.type === "LEARNING_MODULE" ? `/learning/certificate/verify/${c.certificateCode}` : `/certificate/verify/${c.certificateCode}`;
}

async function loadLearning(student, primaryCourse) {
  if (!primaryCourse) return { course: null };
  const [modules, lockMap, totalLessons, completedLessons] = await Promise.all([
    prisma.courseModule.findMany({
      where: { courseId: primaryCourse.id, ...LIVE },
      orderBy: { order: "asc" },
      select: { id: true, title: true, order: true },
    }),
    getModuleLockMap(prisma, student.id, primaryCourse.id),
    prisma.lesson.count({ where: { AND: [{ module: { courseId: primaryCourse.id } }, liveLessonWhere] } }),
    prisma.lessonProgress.count({ where: { studentId: student.id, status: "COMPLETED", lesson: { module: { courseId: primaryCourse.id }, ...liveLessonWhere } } }),
  ]);
  const percent = totalLessons > 0 ? Math.min(100, Math.round((completedLessons / totalLessons) * 100)) : null;
  const currentModule = modules.find((m) => {
    const s = lockMap.get(m.id);
    return s && !s.locked && !s.completed;
  }) || null;

  let nextLesson = null;
  let remainingMinutes = null;
  if (currentModule) {
    const lessons = await prisma.lesson.findMany({
      where: { moduleId: currentModule.id, ...liveLessonWhere },
      orderBy: { order: "asc" },
      select: { id: true, title: true, estimatedMinutes: true, progress: { where: { studentId: student.id }, select: { status: true } } },
    });
    const open = lessons.filter((l) => l.progress?.[0]?.status !== "COMPLETED");
    nextLesson = open[0] || null;
    remainingMinutes = open.reduce((s, l) => s + (l.estimatedMinutes || 0), 0) || null;
  }
  const done = percent === 100;
  return {
    course: {
      slug: primaryCourse.slug,
      name: primaryCourse.name,
      percent,
      totalLessons,
      completedLessons,
      currentModule: currentModule ? { id: currentModule.id, title: currentModule.title } : null,
      nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
      remainingMinutes,
      completed: done,
      resumeUrl: nextLesson ? `/learning/${primaryCourse.slug}/lesson/${nextLesson.id}` : `/learning/${primaryCourse.slug}`,
    },
  };
}

async function loadTasks(student) {
  const now = new Date();
  const poolIds = await getStudentPoolIds(prisma, student.id);
  const [tests, attempts] = await Promise.all([
    prisma.test.findMany({
      where: {
        isPublished: true,
        endTime: { gt: now }, // expired, never-attempted items are not "pending tasks"
        ...testEligibilityWhere(student.academicGroupId, student.classId, [...poolIds], student.instituteId),
      },
      select: { id: true, title: true, startTime: true, endTime: true, durationMin: true },
      orderBy: { endTime: "asc" },
      take: 30,
    }),
    prisma.testAttempt.findMany({
      where: { studentId: student.id },
      select: { testId: true, status: true },
    }),
  ]);
  const attemptByTest = new Map(attempts.map((a) => [a.testId, a.status]));
  const items = [];
  for (const t of tests) {
    const st = attemptByTest.get(t.id);
    if (st && st !== "IN_PROGRESS") continue; // already finished
    const started = t.startTime <= now;
    items.push({
      kind: "test",
      id: t.id,
      title: t.title,
      due: t.endTime,
      starts: t.startTime,
      durationMin: t.durationMin,
      status: st === "IN_PROGRESS" ? "IN_PROGRESS" : started ? "OPEN" : "UPCOMING",
      cta: st === "IN_PROGRESS" ? "Resume" : started ? "Start" : "View",
      url: `/test/${t.id}`,
    });
  }
  // in-progress first, then open, then upcoming; each by nearest deadline
  const rank = { IN_PROGRESS: 0, OPEN: 1, UPCOMING: 2 };
  items.sort((a, b) => rank[a.status] - rank[b.status] || new Date(a.due) - new Date(b.due));
  return { items: items.slice(0, 6), total: items.length };
}

async function loadCoding(student) {
  const solvedRows = await prisma.practiceRunLog.findMany({
    where: { studentId: student.id, verdict: "ACCEPTED" },
    distinct: ["questionId"],
    select: { question: { select: { difficulty: true } } },
    take: 5000,
  });
  const by = { EASY: 0, MEDIUM: 0, HARD: 0 };
  for (const r of solvedRows) if (by[r.question?.difficulty] !== undefined) by[r.question.difficulty]++;
  return { solved: solvedRows.length, byDifficulty: by };
}

async function loadReadiness(student) {
  const reports = await prisma.readinessReport.findMany({
    where: { studentId: student.id },
    orderBy: { assessment: { submittedAt: "desc" } },
    select: { overallScore: true, readinessLevel: true, weakAreas: true, assessment: { select: { id: true, submittedAt: true, subject: { select: { id: true, name: true } } } } },
    take: 40,
  });
  const latestBySubject = new Map();
  for (const r of reports) {
    const sid = r.assessment?.subject?.id;
    if (sid && !latestBySubject.has(sid)) latestBySubject.set(sid, r);
  }
  const categories = READINESS_CATEGORIES.map((cat) => {
    const matches = [...latestBySubject.values()].filter((r) => cat.re.test(r.assessment.subject.name));
    if (!matches.length) return { key: cat.key, label: cat.label, score: null };
    const best = matches.reduce((a, b) => (b.overallScore > a.overallScore ? b : a));
    return { key: cat.key, label: cat.label, score: best.overallScore, level: best.readinessLevel, reportUrl: `/readiness/report/${best.assessment.id}` };
  });
  const assessed = [...latestBySubject.values()];
  const overall = assessed.length ? Math.round(assessed.reduce((s, r) => s + r.overallScore, 0) / assessed.length) : null;
  const weak = [];
  for (const r of assessed) {
    if (Array.isArray(r.weakAreas)) for (const w of r.weakAreas) if (typeof w === "string" && weak.length < 4 && !weak.includes(w)) weak.push(w);
  }
  return { overall, assessedSubjects: assessed.length, categories, weakAreas: weak };
}

async function loadInterview(student) {
  const last = await prisma.interviewReport.findFirst({
    where: { studentId: student.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, overallScore: true, scoreBreakdown: true, weakAreas: true, strongAreas: true, createdAt: true, session: { select: { category: true, isCompanyRound: true } } },
  });
  if (!last) return { last: null };
  const count = await prisma.interviewReport.count({ where: { studentId: student.id } });
  const breakdown = last.scoreBreakdown && typeof last.scoreBreakdown === "object" && !Array.isArray(last.scoreBreakdown)
    ? Object.entries(last.scoreBreakdown).filter(([, v]) => typeof v === "number").slice(0, 5).map(([k, v]) => ({ label: k, score: v }))
    : [];
  return {
    count,
    last: {
      id: last.id,
      score: last.overallScore,
      date: last.createdAt,
      category: last.session?.isCompanyRound ? "Company round" : (last.session?.category || null),
      breakdown,
      weakAreas: Array.isArray(last.weakAreas) ? last.weakAreas.filter((x) => typeof x === "string").slice(0, 3) : [],
      reportUrl: `/interview/report/${last.id}`,
    },
  };
}

async function loadCareer(student, userRow) {
  const profileRow = await prisma.studentProfile.findUnique({ where: { studentId: student.id } });
  const resume = await prisma.resume.findUnique({ where: { studentId: student.id } });
  const documents = await prisma.studentDocument.findMany({ where: { studentId: student.id }, select: { id: true } });
  const prof = computeMandatoryCompletion(userRow, decryptProfile(profileRow), resume, documents);
  const res = resume ? computeCompletion(resume, []) : null;
  return {
    profilePercent: prof.percent,
    profileMissing: prof.missingFields.slice(0, 4).map((f) => f.label),
    resume: resume ? { exists: true, percent: res.percent, missing: res.missingSections.slice(0, 3) } : { exists: false, percent: null },
    hasPhoto: !!userRow.profilePhotoUrl,
    photoUrl: userRow.profilePhotoUrl || null,
    linkedinUrl: userRow.linkedinUrl || null,
  };
}

async function loadCertificates(student) {
  const certs = await prisma.certificate.findMany({
    where: { studentId: student.id },
    orderBy: { issuedAt: "desc" },
    take: 3,
    select: { id: true, certificateCode: true, type: true, title: true, status: true, issuedAt: true },
  });
  const total = await prisma.certificate.count({ where: { studentId: student.id } });
  return {
    total,
    items: certs.map((c) => ({
      id: c.id, title: c.title, typeLabel: CERT_TYPE_LABEL[c.type] || "Certificate", status: c.status, issuedAt: c.issuedAt,
      verifyUrl: certVerifyPath(c), downloadPath: `/certificates/${c.id}/download`,
    })),
  };
}

async function loadNotifications(student) {
  const [items, unread, announcements] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientId: student.id },
      orderBy: { createdAt: "desc" }, take: 6,
      select: { id: true, type: true, message: true, link: true, read: true, createdAt: true },
    }),
    prisma.notification.count({ where: { recipientId: student.id, read: false } }),
    prisma.notification.findMany({
      where: { recipientId: student.id, type: "SYSTEM_ANNOUNCEMENT", createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
      orderBy: { createdAt: "desc" }, take: 3,
      select: { id: true, message: true, link: true, createdAt: true, read: true },
    }),
  ]);
  return { unreadCount: unread, items, announcements };
}

async function loadActivity(student) {
  const [attempts, lessons, runs, certs] = await Promise.all([
    prisma.testAttempt.findMany({
      where: { studentId: student.id, status: { not: "IN_PROGRESS" }, submittedAt: { not: null } },
      select: { submittedAt: true, test: { select: { title: true } } }, orderBy: { submittedAt: "desc" }, take: 5,
    }),
    prisma.lessonProgress.findMany({
      where: { studentId: student.id, status: "COMPLETED", completedAt: { not: null } },
      select: { completedAt: true, lesson: { select: { title: true, module: { select: { title: true } } } } }, orderBy: { completedAt: "desc" }, take: 5,
    }),
    prisma.practiceRunLog.findMany({
      where: { studentId: student.id, verdict: "ACCEPTED" },
      select: { createdAt: true, question: { select: { title: true, prompt: true } } }, orderBy: { createdAt: "desc" }, take: 5,
    }),
    prisma.certificate.findMany({ where: { studentId: student.id }, select: { issuedAt: true, title: true }, orderBy: { issuedAt: "desc" }, take: 3 }),
  ]);
  const clip = (s) => (s.length > 60 ? `${s.slice(0, 60)}…` : s);
  return [
    ...attempts.map((a) => ({ type: "test", text: `Completed the test "${a.test?.title || "Test"}"`, date: a.submittedAt })),
    ...lessons.map((p) => ({ type: "lesson", text: `Finished "${p.lesson.title}" in ${p.lesson.module.title}`, date: p.completedAt })),
    ...runs.map((r) => ({ type: "coding", text: `Solved "${clip(r.question.title || r.question.prompt)}"`, date: r.createdAt })),
    ...certs.map((c) => ({ type: "certificate", text: `Earned the ${c.title} certificate`, date: c.issuedAt })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
}

async function getStreak(studentId) {
  const s = await prisma.studentStreak.findUnique({ where: { studentId } });
  if (!s || !s.lastActiveDate) return { current: null, longest: s?.longestStreak || null };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(s.lastActiveDate); last.setHours(0, 0, 0, 0);
  const live = today - last <= DAY;
  return { current: live ? s.currentStreak : 0, longest: s.longestStreak };
}

router.get("/dashboard", authenticate, requirePermission("student.portal"), async (req, res) => {
  const t0 = Date.now();
  try {
    const userRow = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, name: true, email: true, program: true, department: true, instituteId: true, academicGroupId: true, classId: true,
        profilePhotoUrl: true, linkedinUrl: true, mobile: true, gender: true, institute: { select: { name: true } },
      },
    });
    if (!userRow) return res.status(404).json({ error: "Student not found" });
    const student = userRow;

    const primaryCourse = isEligibilityUnresolvable(student.instituteId, student.academicGroupId)
      ? null
      : await prisma.course.findFirst({
          where: { status: "PUBLISHED", ...courseEligibilityWhere(student.instituteId, student.academicGroupId) },
          orderBy: { order: "asc" },
          select: { id: true, slug: true, name: true },
        });

    // group 1 — the performance core
    const perf = await safe("performance", () => computeStudentPerformance(student.id, { maskUnpublished: true }));
    const rank = await safe("rank", () => computeGroupRank(student.id, student.academicGroupId));
    const streak = await safe("streak", () => getStreak(student.id));
    const attendance = await safe("attendance", () => computeStudentOverallAttendancePercent(student.id));
    // group 2 — learning & work
    const learning = await safe("learning", () => loadLearning(student, primaryCourse));
    const tasks = await safe("tasks", () => loadTasks(student));
    const coding = await safe("coding", () => loadCoding(student));
    // group 3 — career
    const readiness = await safe("readiness", () => loadReadiness(student));
    const interview = await safe("interview", () => loadInterview(student));
    const career = await safe("career", () => loadCareer(student, userRow));
    // group 4 — feeds
    const certificates = await safe("certificates", () => loadCertificates(student));
    const notifications = await safe("notifications", () => loadNotifications(student));
    const activity = await safe("activity", () => loadActivity(student));
    const recommendations = await safe("recommendations", () => cached(`recommendations:${student.id}`, 5 * 60 * 1000, () => computeLearningRecommendations(prisma, student.id)));

    const perfOk = perf && !perf.error;
    const since = Date.now() - 30 * DAY;
    const trend = perfOk
      ? perf.analytics.scoreTrend.filter((p) => new Date(p.date).getTime() >= since).map((p) => ({ date: p.date, label: p.testName, percentage: p.percentage }))
      : { error: true };
    const firstName = (student.name || "").trim().split(/\s+/)[0] || null;

    res.json({
      generatedAt: new Date().toISOString(),
      profile: { firstName, name: student.name || null, program: student.program || null, department: student.department || null, institute: student.institute?.name || null, photoUrl: student.profilePhotoUrl || null },
      kpis: perfOk ? {
        averageScorePercent: perf.summary.totalTestsCompleted > 0 && perf.analytics.scoreTrend.length > 0 ? perf.summary.averageScorePercent : null,
        testsCompleted: perf.summary.totalTestsCompleted,
        testsAssigned: perf.summary.totalTestsAssigned,
        testsPending: perf.summary.totalTestsPending,
        rank: rank && !rank.error && rank.rank ? rank.rank : null,
        totalInGroup: rank && !rank.error ? rank.totalStudents || null : null,
        attendancePercent: typeof attendance === "number" ? attendance : null,
        streak: streak && !streak.error ? streak.current : null,
        longestStreak: streak && !streak.error ? streak.longest : null,
        codingSolved: perf.summary.totalCodingSolved,
      } : { error: true },
      trend,
      recentResults: perfOk ? perf.testHistory.filter((h) => h.status !== "IN_PROGRESS" && !h.resultsPending).slice(0, 4).map((h) => ({ testId: h.testId, name: h.testName, date: h.date, percentage: h.percentage })) : { error: true },
      learning, tasks, coding, readiness, interview, career, certificates, notifications, activity, recommendations,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error("[student/dashboard] failed", { userId: req.user?.id, error: err.message, stack: err.stack });
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

module.exports = router;
