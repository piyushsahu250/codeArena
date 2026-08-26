const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { computeLevel, getTotalXp } = require("../utils/gamification");
const { computeGroupRank } = require("../utils/groupRank");
const { cached, invalidate } = require("../utils/cache");

const router = express.Router();

function streakStillLive(lastActiveDate) {
  if (!lastActiveDate) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const last = new Date(lastActiveDate); last.setHours(0, 0, 0, 0);
  return last.getTime() === today.getTime() || last.getTime() === yesterday.getTime();
}

// =========================== Student-facing ===========================

// STUDENT: everything the Achievements page needs — level/XP, live streak, earned + locked
// badges, XP history (doubles as "Achievement History"), and their own leaderboard rank.
router.get("/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const studentId = req.user.id;
    // Sequential, not Promise.all — this page is linked straight off the student dashboard, so
    // many students can open it in the same short window (e.g. after a leaderboard/XP
    // announcement). Same pool-contention reasoning as auth.js/dashboard.js; computeGroupRank is
    // still cheap on a cache hit (see groupRank.js's 60s cache), so this mainly matters for the
    // other four direct Prisma reads.
    const student = await prisma.user.findUnique({ where: { id: studentId } });
    const totalXp = await getTotalXp(studentId);
    const streakRow = await prisma.studentStreak.findUnique({ where: { studentId } });
    const level = computeLevel(totalXp);
    const currentStreak = streakStillLive(streakRow?.lastActiveDate) ? streakRow.currentStreak : 0;

    const earnedBadges = await prisma.studentBadge.findMany({ where: { studentId }, include: { badge: true }, orderBy: { earnedAt: "desc" } });
    const allBadges = await prisma.badge.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
    const history = await prisma.xpEvent.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, take: 50 });
    const { rank, totalStudents } = await computeGroupRank(studentId, student.academicGroupId);
    const earnedIds = new Set(earnedBadges.map((b) => b.badgeId));

    res.json({
      level, totalXp,
      streak: { current: currentStreak, longest: streakRow?.longestStreak || 0 },
      badges: {
        earned: earnedBadges.map((b) => ({ code: b.badge.code, name: b.badge.name, description: b.badge.description, icon: b.badge.icon, category: b.badge.category, earnedAt: b.earnedAt })),
        locked: allBadges.filter((b) => !earnedIds.has(b.id)).map((b) => ({ code: b.code, name: b.name, description: b.description, icon: b.icon, category: b.category })),
      },
      history: history.map((h) => ({ activity: h.activity, label: h.label, xp: h.xp, date: h.createdAt })),
      leaderboardRank: { rank, totalStudents },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load achievements" });
  }
});

// "class" kept as a deprecated alias for "group" for one release, so a stale cached frontend
// request doesn't 400 — both resolve identically, off academicGroupId.
async function resolveScopeStudentIds(scope, req, requester) {
  if (scope === "group" || scope === "class") {
    const academicGroupId = req.user.role === "STUDENT" ? requester.academicGroupId : (req.query.academicGroupId || req.query.classId);
    if (!academicGroupId) return { error: "academicGroupId is required for this scope" };
    return { ids: (await prisma.user.findMany({ where: { academicGroupId, role: "STUDENT" }, select: { id: true } })).map((u) => u.id) };
  }
  if (scope === "department") {
    const department = req.user.role === "STUDENT" ? requester.department : req.query.department;
    if (!department) return { error: "department is required for this scope" };
    return { ids: (await prisma.user.findMany({ where: { department, role: "STUDENT" }, select: { id: true } })).map((u) => u.id) };
  }
  if (scope === "institute") {
    const instituteId = req.user.role === "STUDENT" ? requester.instituteId : req.query.instituteId || requester.instituteId;
    if (!instituteId) return { error: "instituteId is required for this scope" };
    return { ids: (await prisma.user.findMany({ where: { instituteId, role: "STUDENT" }, select: { id: true } })).map((u) => u.id) };
  }
  return { ids: (await prisma.user.findMany({ where: { role: "STUDENT" }, select: { id: true } })).map((u) => u.id) };
}

async function computeXpValues(ids) {
  const rows = await prisma.xpEvent.groupBy({ by: ["studentId"], where: { studentId: { in: ids } }, _sum: { xp: true } });
  return new Map(rows.map((r) => [r.studentId, r._sum.xp || 0]));
}

async function computeProblemsValues(ids) {
  // groupBy on (studentId, questionId) dedupes at the DB level — one row per distinct question a
  // student has ever solved, not one row per attempt. A student who re-ran an already-solved
  // question 50 times previously transferred and processed 50 rows for that one problem; this
  // transfers exactly 1.
  const rows = await prisma.practiceRunLog.groupBy({ by: ["studentId", "questionId"], where: { studentId: { in: ids }, verdict: "ACCEPTED" } });
  const map = new Map();
  for (const r of rows) map.set(r.studentId, (map.get(r.studentId) || 0) + 1);
  return map;
}

async function computeStreakValues(ids) {
  const streaks = await prisma.studentStreak.findMany({ where: { studentId: { in: ids } } });
  const map = new Map();
  for (const s of streaks) map.set(s.studentId, streakStillLive(s.lastActiveDate) ? s.currentStreak : 0);
  return map;
}

async function computeLearningValues(ids) {
  const javaCourse = await prisma.course.findUnique({ where: { slug: "java" } });
  if (!javaCourse) return new Map();
  const totalLessons = await prisma.lesson.count({ where: { module: { courseId: javaCourse.id } } });
  if (totalLessons === 0) return new Map();
  const progress = await prisma.lessonProgress.findMany({
    where: { studentId: { in: ids }, status: "COMPLETED", lesson: { module: { courseId: javaCourse.id } } },
    select: { studentId: true },
  });
  const counts = new Map();
  for (const p of progress) counts.set(p.studentId, (counts.get(p.studentId) || 0) + 1);
  const map = new Map();
  for (const id of ids) map.set(id, Math.round(((counts.get(id) || 0) / totalLessons) * 100));
  return map;
}

// Finds the top-100 student ids for the metric actually driving the sort, so the (up to) three
// other display-column metrics only ever get computed for the 100 students who'll be shown —
// not the entire scope, which at institute/overall scope could be thousands of students. xp and
// streak have a directly sortable DB column and get a real DB-side top-N; problems and learning
// don't (their values are computed, not stored), so those two still scan the full scope once —
// unavoidable without a stored/materialized column — but the other three metrics no longer do.
async function resolveTopIdsForMetric(metric, ids) {
  if (metric === "xp") {
    const rows = await prisma.xpEvent.groupBy({ by: ["studentId"], where: { studentId: { in: ids } }, _sum: { xp: true }, orderBy: { _sum: { xp: "desc" } }, take: 100 });
    return rows.map((r) => r.studentId);
  }
  if (metric === "streak") {
    const yesterday = new Date(); yesterday.setHours(0, 0, 0, 0); yesterday.setDate(yesterday.getDate() - 1);
    const rows = await prisma.studentStreak.findMany({
      where: { studentId: { in: ids }, lastActiveDate: { gte: yesterday } },
      orderBy: { currentStreak: "desc" },
      take: 100,
      select: { studentId: true },
    });
    return rows.map((r) => r.studentId);
  }
  const map = metric === "problems" ? await computeProblemsValues(ids) : await computeLearningValues(ids);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id);
}

// Any authenticated user: leaderboard ranked by one metric (xp/problems/learning/streak),
// scoped to class/department/institute/overall. Always returns XP + problems-solved + streak
// as display columns regardless of which metric is driving the sort, per the spec's column list.
router.get("/leaderboard", authenticate, async (req, res) => {
  try {
    const scope = req.query.scope || "overall";
    const metric = req.query.metric || "xp";
    if (!["group", "class", "department", "institute", "overall"].includes(scope)) return res.status(400).json({ error: "Invalid scope" });
    if (!["xp", "problems", "learning", "streak"].includes(metric)) return res.status(400).json({ error: "Invalid metric" });

    const requester = await prisma.user.findUnique({ where: { id: req.user.id } });
    const resolved = await resolveScopeStudentIds(scope, req, requester);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const ids = resolved.ids;
    if (ids.length === 0) return res.json([]);

    // Short TTL — a leaderboard doesn't need to reflect a submission from 30 seconds ago, and
    // this is the single most expensive read on the platform to recompute from scratch (multiple
    // groupBy passes even after the top-100 restructuring above).
    const cacheKey = `leaderboard:${scope}:${metric}:${req.query.academicGroupId || req.query.classId || ""}:${req.query.department || ""}:${req.query.instituteId || requester.instituteId || ""}`;
    const rows = await cached(cacheKey, 30 * 1000, async () => {
      const topIds = await resolveTopIdsForMetric(metric, ids);
      if (topIds.length === 0) return [];

      const [xpMap, problemsMap, streakMap, learningMap] = await Promise.all([
        computeXpValues(topIds), computeProblemsValues(topIds), computeStreakValues(topIds), computeLearningValues(topIds),
      ]);
      const students = await prisma.user.findMany({ where: { id: { in: topIds } }, select: { id: true, name: true, rollNumber: true } });
      const nameMap = new Map(students.map((s) => [s.id, s]));
      const primaryMap = { xp: xpMap, problems: problemsMap, streak: streakMap, learning: learningMap }[metric];

      return topIds
        .map((id) => ({
          studentId: id, name: nameMap.get(id)?.name || "—", rollNumber: nameMap.get(id)?.rollNumber || null,
          xp: xpMap.get(id) || 0, problemsSolved: problemsMap.get(id) || 0, streak: streakMap.get(id) || 0,
          learningProgressPercent: learningMap.get(id) || 0,
          primaryValue: primaryMap.get(id) || 0,
        }))
        .sort((a, b) => b.primaryValue - a.primaryValue)
        .map((r, i) => ({ rank: i + 1, ...r }));
    });

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

// Any authenticated user: the full badge catalog (used by the Achievements page for locked
// badges, and by the admin CMS list).
router.get("/badges", authenticate, async (req, res) => {
  const badges = await prisma.badge.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
  res.json(badges);
});

// =========================== Admin configuration ===========================

router.get("/xp-rules", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  res.json(await prisma.xpRule.findMany({ orderBy: { activity: "asc" } }));
});

router.patch("/xp-rules/:activity", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const { xp, label } = req.body;
    const rule = await prisma.xpRule.update({
      where: { activity: req.params.activity },
      data: { ...(xp !== undefined ? { xp: Number(xp) } : {}), ...(label !== undefined ? { label } : {}) },
    });
    res.json(rule);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update XP rule" });
  }
});

router.post("/badges", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const { code, name, description, icon, category } = req.body;
    if (!code || !name || !category) return res.status(400).json({ error: "code, name, and category are required" });
    const badge = await prisma.badge.create({ data: { code, name, description: description || null, icon: icon || "🏅", category } });
    res.json(badge);
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A badge with this code already exists" : "Failed to create badge" });
  }
});

router.patch("/badges/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const { name, description, icon, category, isActive } = req.body;
    const badge = await prisma.badge.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
      },
    });
    res.json(badge);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update badge" });
  }
});

router.delete("/badges/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    // StudentBadge.badge is Restrict, not Cascade — deleting a badge definition must not
    // silently erase every student's already-earned record of it.
    const earnedCount = await prisma.studentBadge.count({ where: { badgeId: req.params.id } });
    if (earnedCount > 0) {
      return res.status(409).json({
        error: `${earnedCount} student${earnedCount === 1 ? "" : "s"} have already earned this badge. It can't be deleted while any student holds it.`,
      });
    }
    await prisma.badge.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "P2003" || err.code === "P2014") {
      return res.status(409).json({ error: "This badge has already been earned by students and can't be deleted." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete badge" });
  }
});

// ADMIN: wipes every XP event platform-wide (every student's total XP and level resets to
// zero; earned badges and streaks are untouched since those aren't XP-derived). Irreversible —
// the frontend must confirm before calling this.
router.post("/leaderboard/reset", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const deleted = await prisma.xpEvent.deleteMany({});
    invalidate("leaderboard:");
    res.json({ success: true, xpEventsDeleted: deleted.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reset leaderboard" });
  }
});

// ADMIN/STAFF: aggregate achievement stats, institute-scoped the same way everything else on
// this platform is (unscoped for platform-level accounts).
router.get("/admin/stats", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const where = req.requesterInstituteId ? { instituteId: req.requesterInstituteId, role: "STUDENT" } : { role: "STUDENT" };
    const students = await prisma.user.findMany({ where, select: { id: true } });
    const ids = students.map((s) => s.id);
    if (ids.length === 0) return res.json({ totalStudents: 0, totalXpAwarded: 0, totalBadgesAwarded: 0, topStudents: [] });

    const [xpAgg, badgeCount, topXp] = await Promise.all([
      prisma.xpEvent.aggregate({ where: { studentId: { in: ids } }, _sum: { xp: true } }),
      prisma.studentBadge.count({ where: { studentId: { in: ids } } }),
      prisma.xpEvent.groupBy({ by: ["studentId"], where: { studentId: { in: ids } }, _sum: { xp: true }, orderBy: { _sum: { xp: "desc" } }, take: 5 }),
    ]);
    const topStudents = await prisma.user.findMany({ where: { id: { in: topXp.map((t) => t.studentId) } }, select: { id: true, name: true } });
    const nameMap = new Map(topStudents.map((s) => [s.id, s.name]));

    res.json({
      totalStudents: ids.length,
      totalXpAwarded: xpAgg._sum.xp || 0,
      totalBadgesAwarded: badgeCount,
      topStudents: topXp.map((t) => ({ name: nameMap.get(t.studentId) || "—", xp: t._sum.xp || 0 })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load achievement statistics" });
  }
});

module.exports = router;
