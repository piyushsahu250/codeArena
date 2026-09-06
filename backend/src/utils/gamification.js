const prisma = require("../prisma");
const { computeStudentPerformance } = require("./studentPerformance");
const { getModuleLockMap } = require("./learningLock");
const { computeGroupRank } = require("./groupRank");

// Gamification starts counting from when this system was deployed — it does not retroactively
// backfill XP/badges for activity that already happened before these tables existed.

const XP_RULE_DEFS = [
  { activity: "MODULE_COMPLETE", label: "Complete a Learning Module", xp: 50 },
  { activity: "MODULE_QUIZ_PASS", label: "Pass a Module Quiz", xp: 20 },
  { activity: "CODING_EASY", label: "Solve an Easy Problem", xp: 10 },
  { activity: "CODING_MEDIUM", label: "Solve a Medium Problem", xp: 20 },
  { activity: "CODING_HARD", label: "Solve a Hard Problem", xp: 40 },
  { activity: "TEST_COMPLETE", label: "Complete a Coding Test", xp: 30 },
  { activity: "MODULE_CODING_PASS", label: "Pass a Module's Proctored Coding Assessment", xp: 40 },
  { activity: "PROJECT_TASK", label: "Complete a Project Task", xp: 15 },
  { activity: "PROJECT_COMPLETE", label: "Complete a Full Project", xp: 75 },
  { activity: "DAILY_STREAK", label: "Maintain Daily Streak", xp: 10 },
  { activity: "DAILY_CHALLENGE", label: "Solve the Daily Challenge", xp: 25 },
  { activity: "WEEKLY_CHALLENGE", label: "Solve the Weekly Challenge", xp: 60 },
];

const BADGE_DEFS = [
  { code: "FIRST_MODULE", name: "First Module Completed", description: "Complete your first learning module.", icon: "🥇", category: "LEARNING" },
  { code: "JAVA_BEGINNER", name: "Java Beginner", description: "Complete 3 Java modules.", icon: "☕", category: "LEARNING" },
  { code: "JAVA_INTERMEDIATE", name: "Java Intermediate", description: "Complete 8 Java modules.", icon: "☕", category: "LEARNING" },
  { code: "JAVA_EXPERT", name: "Java Expert", description: "Complete the entire Java course.", icon: "☕", category: "LEARNING" },
  { code: "FIRST_PROBLEM", name: "First Coding Problem Solved", description: "Solve your first coding practice problem.", icon: "🧩", category: "CODING" },
  { code: "PROBLEMS_10", name: "10 Problems Solved", description: "Solve 10 coding practice problems.", icon: "🧩", category: "CODING" },
  { code: "PROBLEMS_50", name: "50 Problems Solved", description: "Solve 50 coding practice problems.", icon: "🧩", category: "CODING" },
  { code: "PROBLEMS_100", name: "100 Problems Solved", description: "Solve 100 coding practice problems.", icon: "🧩", category: "CODING" },
  { code: "FIRST_TEST", name: "First Test Completed", description: "Complete your first assessment.", icon: "📝", category: "ASSESSMENT" },
  { code: "SCORE_90", name: "Scored Above 90%", description: "Score above 90% on a published test.", icon: "🌟", category: "ASSESSMENT" },
  { code: "PERFECT_SCORE", name: "Perfect Score", description: "Score 100% on a published test.", icon: "💯", category: "ASSESSMENT" },
  { code: "STREAK_3", name: "3-Day Streak", description: "Stay active for 3 days in a row.", icon: "🔥", category: "CONSISTENCY" },
  { code: "STREAK_7", name: "7-Day Streak", description: "Stay active for 7 days in a row.", icon: "🔥", category: "CONSISTENCY" },
  { code: "STREAK_30", name: "30-Day Streak", description: "Stay active for 30 days in a row.", icon: "🔥", category: "CONSISTENCY" },
  { code: "EARLY_LEARNER", name: "Early Learner", description: "Complete a lesson within 24 hours of joining.", icon: "🌱", category: "SPECIAL" },
  { code: "FAST_CODER", name: "Fast Coder", description: "Solve 5 coding problems in a single day.", icon: "⚡", category: "SPECIAL" },
  { code: "TOP_PERFORMER", name: "Top Performer", description: "Maintain an average score of 85% or higher.", icon: "🏅", category: "SPECIAL" },
  // code intentionally left as "TOP_10_CLASS" — it's persisted, FK-referenced data (Badge.code,
  // seeded via upsert, referenced by StudentBadge); renaming it would fork a duplicate badge and
  // strand every already-earned one. Only the display name/description changed.
  { code: "TOP_10_CLASS", name: "Top 10 in Group", description: "Rank in the top 10 of your academic group.", icon: "🏆", category: "SPECIAL" },
  { code: "BUG_HUNTER", name: "Bug Hunter", description: "Solve a problem after at least one failed attempt.", icon: "🐛", category: "SPECIAL" },
];

const BADGE_CRITERIA = {
  FIRST_MODULE: (s) => s.modulesCompleted >= 1,
  JAVA_BEGINNER: (s) => s.modulesCompleted >= 3,
  JAVA_INTERMEDIATE: (s) => s.modulesCompleted >= 8,
  JAVA_EXPERT: (s) => s.totalModules > 0 && s.modulesCompleted >= s.totalModules,
  FIRST_PROBLEM: (s) => s.codingSolved >= 1,
  PROBLEMS_10: (s) => s.codingSolved >= 10,
  PROBLEMS_50: (s) => s.codingSolved >= 50,
  PROBLEMS_100: (s) => s.codingSolved >= 100,
  FIRST_TEST: (s) => s.testsCompleted >= 1,
  SCORE_90: (s) => s.scoredAbove90,
  PERFECT_SCORE: (s) => s.perfectScore,
  STREAK_3: (s) => s.longestStreak >= 3,
  STREAK_7: (s) => s.longestStreak >= 7,
  STREAK_30: (s) => s.longestStreak >= 30,
  EARLY_LEARNER: (s) => s.earlyLearner,
  FAST_CODER: (s) => s.fastCoder,
  TOP_PERFORMER: (s) => s.testsCompleted > 0 && s.averageScorePercent >= 85,
  TOP_10_CLASS: (s) => s.rank != null && s.rank <= 10,
  BUG_HUNTER: (s) => s.hasDebuggedThroughFailure,
};

const LEVELS = [
  { level: 1, name: "Beginner", minXp: 0 },
  { level: 2, name: "Learner", minXp: 100 },
  { level: 3, name: "Explorer", minXp: 250 },
  { level: 4, name: "Programmer", minXp: 500 },
  { level: 5, name: "Advanced Programmer", minXp: 1000 },
  { level: 6, name: "Expert", minXp: 2000 },
  { level: 7, name: "Master Coder", minXp: 4000 },
];

function computeLevel(totalXp) {
  let current = LEVELS[0];
  for (const l of LEVELS) {
    if (totalXp >= l.minXp) current = l;
    else break;
  }
  const idx = LEVELS.indexOf(current);
  const next = LEVELS[idx + 1] || null;
  return {
    level: current.level,
    name: current.name,
    totalXp,
    currentLevelXp: totalXp - current.minXp,
    xpForNextLevel: next ? next.minXp - current.minXp : null,
    xpToNext: next ? next.minXp - totalXp : 0,
    progressPercent: next ? Math.round(((totalXp - current.minXp) / (next.minXp - current.minXp)) * 100) : 100,
    nextLevelName: next?.name || null,
  };
}

async function getTotalXp(studentId) {
  const agg = await prisma.xpEvent.aggregate({ where: { studentId }, _sum: { xp: true } });
  return agg._sum.xp || 0;
}

// Looks up the current XP amount from XpRule (admin-configurable) and logs one XpEvent.
// Callers are responsible for only calling this on a genuine one-time transition (e.g. "this
// module just became complete", "this question was just solved for the first time") — there's
// no dedupe here, by design, so a caller can legitimately award the same activity type multiple
// times for different targets (e.g. CODING_EASY once per distinct problem solved).
async function awardXp(studentId, activity, meta) {
  const rule = await prisma.xpRule.findUnique({ where: { activity } });
  if (!rule) return 0;
  await prisma.xpEvent.create({ data: { studentId, activity, label: rule.label, xp: rule.xp, meta: meta || undefined } });
  return rule.xp;
}

// Consecutive-day streak of "solved a coding problem OR completed a lesson". Lazily
// updated — only touched when a streak-eligible activity happens, not on a schedule. A second
// call on the same calendar day is a no-op (already counted). Awards DAILY_STREAK XP only when
// a genuinely new day is counted.
async function recordStreakActivity(studentId) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const existing = await prisma.studentStreak.findUnique({ where: { studentId } });

  if (!existing) {
    await prisma.studentStreak.create({ data: { studentId, currentStreak: 1, longestStreak: 1, lastActiveDate: today } });
    const xp = await awardXp(studentId, "DAILY_STREAK", { day: today.toISOString().slice(0, 10) });
    return { currentStreak: 1, longestStreak: 1, isNewDay: true, xpAwarded: xp };
  }

  const last = existing.lastActiveDate ? new Date(existing.lastActiveDate) : null;
  if (last) last.setHours(0, 0, 0, 0);
  if (last && last.getTime() === today.getTime()) {
    return { currentStreak: existing.currentStreak, longestStreak: existing.longestStreak, isNewDay: false, xpAwarded: 0 };
  }

  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const newCurrent = last && last.getTime() === yesterday.getTime() ? existing.currentStreak + 1 : 1;
  const newLongest = Math.max(existing.longestStreak, newCurrent);
  await prisma.studentStreak.update({ where: { studentId }, data: { currentStreak: newCurrent, longestStreak: newLongest, lastActiveDate: today } });
  const xp = await awardXp(studentId, "DAILY_STREAK", { day: today.toISOString().slice(0, 10) });
  return { currentStreak: newCurrent, longestStreak: newLongest, isNewDay: true, xpAwarded: xp };
}

// Gathers everything BADGE_CRITERIA needs in one pass, reusing computeStudentPerformance
// (maskUnpublished: true — a test-score badge shouldn't fire, and reveal the score, before
// results are actually published to the student).
async function gatherStudentStats(studentId) {
  const student = await prisma.user.findUnique({ where: { id: studentId } });
  const perf = await computeStudentPerformance(studentId, { maskUnpublished: true });

  let modulesCompleted = 0, totalModules = 0;
  const javaCourse = await prisma.course.findUnique({ where: { slug: "java" } });
  if (javaCourse) {
    const lockMap = await getModuleLockMap(prisma, studentId, javaCourse.id);
    totalModules = lockMap.size;
    modulesCompleted = [...lockMap.values()].filter((v) => v.completed).length;
  }

  const acceptedRuns = await prisma.practiceRunLog.findMany({
    where: { studentId, verdict: "ACCEPTED" },
    select: { questionId: true, createdAt: true },
  });
  const codingSolved = new Set(acceptedRuns.map((r) => r.questionId)).size;
  const dayCounts = new Map();
  for (const r of acceptedRuns) {
    const day = r.createdAt.toISOString().slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }
  const fastCoder = [...dayCounts.values()].some((c) => c >= 5);

  const allRuns = await prisma.practiceRunLog.findMany({
    where: { studentId }, orderBy: { createdAt: "asc" }, select: { questionId: true, verdict: true },
  });
  const byQuestion = new Map();
  for (const r of allRuns) {
    if (!byQuestion.has(r.questionId)) byQuestion.set(r.questionId, []);
    byQuestion.get(r.questionId).push(r.verdict);
  }
  let hasDebuggedThroughFailure = false;
  for (const verdicts of byQuestion.values()) {
    if (verdicts.indexOf("ACCEPTED") > 0) { hasDebuggedThroughFailure = true; break; }
  }

  const scoredAbove90 = perf.testHistory.some((h) => h.percentage !== null && h.percentage >= 90);
  const perfectScore = perf.testHistory.some((h) => h.percentage !== null && h.percentage >= 100);

  const streak = await prisma.studentStreak.findUnique({ where: { studentId } });

  const firstCompletedLesson = await prisma.lessonProgress.findFirst({
    where: { studentId, status: "COMPLETED" }, orderBy: { completedAt: "asc" }, select: { completedAt: true },
  });
  const earlyLearner = !!(
    firstCompletedLesson?.completedAt && student.createdAt &&
    new Date(firstCompletedLesson.completedAt) - new Date(student.createdAt) <= 24 * 3600 * 1000
  );

  const { rank } = await computeGroupRank(studentId, student.academicGroupId);

  return {
    modulesCompleted, totalModules, codingSolved, fastCoder, hasDebuggedThroughFailure,
    testsCompleted: perf.summary.totalTestsCompleted, scoredAbove90, perfectScore,
    averageScorePercent: perf.summary.averageScorePercent,
    longestStreak: streak?.longestStreak || 0, earlyLearner, rank,
  };
}

async function checkAndAwardBadges(studentId) {
  const stats = await gatherStudentStats(studentId);
  const activeBadges = await prisma.badge.findMany({ where: { isActive: true } });
  const alreadyEarned = new Set(
    (await prisma.studentBadge.findMany({ where: { studentId }, select: { badgeId: true } })).map((b) => b.badgeId)
  );

  const newlyAwarded = [];
  for (const badge of activeBadges) {
    if (alreadyEarned.has(badge.id)) continue;
    const criteria = BADGE_CRITERIA[badge.code];
    if (criteria && criteria(stats)) {
      const sb = await prisma.studentBadge.create({ data: { studentId, badgeId: badge.id } });
      newlyAwarded.push({ code: badge.code, name: badge.name, description: badge.description, icon: badge.icon, category: badge.category, earnedAt: sb.earnedAt });
    }
  }
  return newlyAwarded;
}

// Single entry point route handlers call after a gamification-relevant action. Returns a
// ready-to-render payload (xpAwarded, level/leveledUp, newBadges, streak) for an immediate toast
// — no separate round trip or polling needed on the frontend. xpActivities can list more than
// one activity (e.g. a lesson completion that also happens to finish the whole module awards
// both MODULE_QUIZ_PASS and MODULE_COMPLETE in one call) so leveledUp/newBadges are computed
// against the true final total, not recomputed piecemeal.
async function processGamification(studentId, { xpActivities = [], xpMeta, streakEligible } = {}) {
  const beforeLevel = computeLevel(await getTotalXp(studentId));

  let xpAwarded = 0;
  for (const activity of xpActivities) {
    if (activity) xpAwarded += await awardXp(studentId, activity, xpMeta);
  }

  let streakResult = null;
  if (streakEligible) {
    streakResult = await recordStreakActivity(studentId);
    xpAwarded += streakResult.xpAwarded;
  }

  const newBadges = await checkAndAwardBadges(studentId);
  const afterLevel = computeLevel(await getTotalXp(studentId));

  return {
    xpAwarded,
    totalXp: afterLevel.totalXp,
    level: afterLevel,
    leveledUp: afterLevel.level > beforeLevel.level,
    newBadges,
    streak: streakResult ? { current: streakResult.currentStreak, longest: streakResult.longestStreak, isNewDay: streakResult.isNewDay } : null,
  };
}

module.exports = {
  XP_RULE_DEFS, BADGE_DEFS, LEVELS,
  computeLevel, getTotalXp, awardXp, recordStreakActivity, checkAndAwardBadges, gatherStudentStats, processGamification,
};
