const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { judgeSubmission } = require("../utils/judge");
const { runQueued } = require("../utils/queue");
const { processGamification } = require("../utils/gamification");
const { resolveMostSpecificChallenge, loadStudentScope } = require("../utils/challengeScoping");

const router = express.Router();

const runLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user.id });

function dayStart(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

// Monday (UTC) of the ISO week containing d — matches WeeklyChallenge.weekStart's stated
// convention regardless of which day of that week an admin happens to pick in the scheduler.
function isoWeekStart(d) {
  const x = dayStart(d);
  const day = x.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

// Same shape moduleCoding.js's sanitizeQuestion uses (Daily/Weekly Challenges reuse the exact
// same Question model, hidden test cases, and judge) plus evaluationType/functionSignature so
// the student page can show a "Function-based" badge same as CreateQuestion.jsx's own preview.
function sanitizeQuestion(q) {
  return {
    id: q.id,
    title: q.title,
    description: q.description,
    difficulty: q.difficulty,
    tags: q.tags || null,
    estimatedTimeMin: q.estimatedTimeMin ?? null,
    realWorldScenario: q.realWorldScenario || null,
    constraints: q.constraints || null,
    inputFormat: q.inputFormat || null,
    outputFormat: q.outputFormat || null,
    notes: q.notes || null,
    edgeCases: q.edgeCases || null,
    problemExplanation: q.problemExplanation || null,
    // Safe here — Daily/Weekly Challenges are self-paced, not a proctored/permanently-graded
    // assessment (no useProctoring hook, unlike TestTaking.jsx/ModuleCodingAssessment.jsx).
    hints: q.hints || null,
    timeComplexity: q.timeComplexity || null,
    spaceComplexity: q.spaceComplexity || null,
    editorial: q.editorial || null,
    similarQuestions: q.similarQuestions || null,
    starterCode: q.starterCode,
    starterCodeByLanguage: q.starterCodeByLanguage || null,
    evaluationType: q.evaluationType || "STDIO",
    functionSignature: q.functionSignature || null,
    testCases: (q.testCases || []).filter((tc) => !tc.isHidden).map((tc) => ({ input: tc.input, expected: tc.expected, explanation: tc.explanation || null })),
  };
}

async function runAgainstVisible(question, language, code) {
  const visible = question.testCases.filter((tc) => !tc.isHidden);
  return runQueued(() =>
    judgeSubmission({
      language, code, testCases: visible, timeLimitMs: question.timeLimitMs,
      memoryLimitKb: question.memoryLimitKb || undefined, evaluationType: question.evaluationType, functionSignature: question.functionSignature,
    })
  );
}

async function gradeAgainstHidden(question, language, code) {
  const hidden = question.testCases.filter((tc) => tc.isHidden);
  const gradingCases = hidden.length > 0 ? hidden : question.testCases.filter((tc) => !tc.isHidden);
  return runQueued(() =>
    judgeSubmission({
      language, code, testCases: gradingCases, timeLimitMs: question.timeLimitMs,
      memoryLimitKb: question.memoryLimitKb || undefined, evaluationType: question.evaluationType, functionSignature: question.functionSignature,
    })
  );
}

// STUDENT: streak + challenge-XP summary — surfaces data already tracked by the shared
// gamification pipeline (processGamification -> StudentStreak/XpEvent, same tables every other
// streak-earning activity writes to) but never previously displayed on the Daily/Weekly Challenge
// pages themselves. Pure reads, no new computation.
router.get("/stats", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const [streak, xpAgg] = await Promise.all([
      prisma.studentStreak.findUnique({ where: { studentId: req.user.id } }),
      prisma.xpEvent.aggregate({ where: { studentId: req.user.id, activity: { in: ["DAILY_CHALLENGE", "WEEKLY_CHALLENGE"] } }, _sum: { xp: true } }),
    ]);
    res.json({
      currentStreak: streak?.currentStreak || 0,
      longestStreak: streak?.longestStreak || 0,
      challengeXp: xpAgg._sum.xp || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load challenge stats" });
  }
});

// =============================== STUDENT: Daily Challenge ===============================

router.get("/daily/today", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const scope = await loadStudentScope(req.user.id);
    const dcRow = await resolveMostSpecificChallenge(prisma.dailyChallenge, "date", dayStart(new Date()), scope);
    if (!dcRow) return res.json({ challenge: null });
    const dc = await prisma.dailyChallenge.findUnique({ where: { id: dcRow.id }, include: { question: { include: { testCases: true } } } });
    if (!dc) return res.json({ challenge: null });

    const submission = await prisma.dailyChallengeSubmission.findUnique({
      where: { dailyChallengeId_studentId: { dailyChallengeId: dc.id, studentId: req.user.id } },
    });
    res.json({
      challenge: { id: dc.id, date: dc.date },
      question: sanitizeQuestion(dc.question),
      submission: submission
        ? { language: submission.language, code: submission.code, verdict: submission.verdict, passedCases: submission.passedCases, totalCases: submission.totalCases, timeMs: submission.timeMs, memoryKb: submission.memoryKb, solvedAt: submission.solvedAt }
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load today's challenge" });
  }
});

// Last 30 days: which days had a challenge and whether this student solved it — powers a
// GitHub-style calendar strip on the Daily Challenge page.
router.get("/daily/history", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const scope = await loadStudentScope(req.user.id);
    const since = dayStart(new Date());
    since.setUTCDate(since.getUTCDate() - 29);
    const candidates = await prisma.dailyChallenge.findMany({
      where: {
        date: { gte: since },
        isActive: true,
        OR: [
          ...(scope.academicGroupId ? [{ academicGroupId: scope.academicGroupId }] : []),
          ...(scope.instituteId ? [{ instituteId: scope.instituteId, academicGroupId: null }] : []),
          { instituteId: null, academicGroupId: null },
        ],
      },
      orderBy: { date: "asc" },
      include: { submissions: { where: { studentId: req.user.id }, select: { solvedAt: true } } },
    });
    // Most-specific-per-date, same resolution rule as resolveMostSpecificChallenge — a date can
    // have up to 3 candidate rows (global/institute/academicGroup) in range at once.
    const byDate = new Map();
    for (const c of candidates) {
      const key = c.date.toISOString();
      const existing = byDate.get(key);
      const specificity = c.academicGroupId ? 2 : c.instituteId ? 1 : 0;
      const existingSpecificity = existing ? (existing.academicGroupId ? 2 : existing.instituteId ? 1 : 0) : -1;
      if (specificity > existingSpecificity) byDate.set(key, c);
    }
    const ordered = [...byDate.values()].sort((a, b) => a.date - b.date);
    res.json(ordered.map((c) => ({ date: c.date, solved: c.submissions.some((s) => s.solvedAt) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load challenge history" });
  }
});

router.post("/daily/:id/run", authenticate, requireRole("STUDENT"), runLimiter, async (req, res) => {
  try {
    const dc = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!dc) return res.status(404).json({ error: "Challenge not found" });
    const { language, code } = req.body;
    const result = await runAgainstVisible(dc.question, language, code);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Execution failed" });
  }
});

router.post("/daily/:id/submit", authenticate, requireRole("STUDENT"), runLimiter, async (req, res) => {
  try {
    const dc = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!dc) return res.status(404).json({ error: "Challenge not found" });
    const { language, code } = req.body;
    const result = await gradeAgainstHidden(dc.question, language, code);

    const existing = await prisma.dailyChallengeSubmission.findUnique({
      where: { dailyChallengeId_studentId: { dailyChallengeId: dc.id, studentId: req.user.id } },
    });
    const wasAlreadySolved = !!existing?.solvedAt;
    const nowSolved = result.verdict === "ACCEPTED";
    const fields = {
      language, code, verdict: result.verdict, passedCases: result.passedCases, totalCases: result.totalCases,
      timeMs: result.maxTimeMs ?? null, memoryKb: result.maxMemoryKb ?? null,
    };
    await prisma.dailyChallengeSubmission.upsert({
      where: { dailyChallengeId_studentId: { dailyChallengeId: dc.id, studentId: req.user.id } },
      update: { ...fields, ...(nowSolved && !wasAlreadySolved ? { solvedAt: new Date() } : {}) },
      create: { dailyChallengeId: dc.id, studentId: req.user.id, ...fields, solvedAt: nowSolved ? new Date() : null },
    });

    let gamification = null;
    if (nowSolved && !wasAlreadySolved) {
      try {
        gamification = await processGamification(req.user.id, { xpActivities: ["DAILY_CHALLENGE"], xpMeta: { dailyChallengeId: dc.id }, streakEligible: true });
      } catch (e) {
        console.error("gamification failed", e);
      }
    }

    const { details, ...safeResult } = result;
    res.json({ ...safeResult, alreadySolved: wasAlreadySolved, gamification });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Submission failed" });
  }
});

// =============================== STUDENT: Weekly Challenge ===============================

router.get("/weekly/current", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const scope = await loadStudentScope(req.user.id);
    const wcRow = await resolveMostSpecificChallenge(prisma.weeklyChallenge, "weekStart", isoWeekStart(new Date()), scope);
    if (!wcRow) return res.json({ challenge: null });
    const wc = await prisma.weeklyChallenge.findUnique({ where: { id: wcRow.id }, include: { question: { include: { testCases: true } } } });
    if (!wc) return res.json({ challenge: null });

    const submission = await prisma.weeklyChallengeSubmission.findUnique({
      where: { weeklyChallengeId_studentId: { weeklyChallengeId: wc.id, studentId: req.user.id } },
    });
    res.json({
      challenge: { id: wc.id, weekStart: wc.weekStart },
      question: sanitizeQuestion(wc.question),
      submission: submission
        ? { language: submission.language, code: submission.code, verdict: submission.verdict, passedCases: submission.passedCases, totalCases: submission.totalCases, timeMs: submission.timeMs, memoryKb: submission.memoryKb, solvedAt: submission.solvedAt }
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load this week's challenge" });
  }
});

router.post("/weekly/:id/run", authenticate, requireRole("STUDENT"), runLimiter, async (req, res) => {
  try {
    const wc = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!wc) return res.status(404).json({ error: "Challenge not found" });
    const { language, code } = req.body;
    const result = await runAgainstVisible(wc.question, language, code);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Execution failed" });
  }
});

router.post("/weekly/:id/submit", authenticate, requireRole("STUDENT"), runLimiter, async (req, res) => {
  try {
    const wc = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!wc) return res.status(404).json({ error: "Challenge not found" });
    const { language, code } = req.body;
    const result = await gradeAgainstHidden(wc.question, language, code);

    const existing = await prisma.weeklyChallengeSubmission.findUnique({
      where: { weeklyChallengeId_studentId: { weeklyChallengeId: wc.id, studentId: req.user.id } },
    });
    const wasAlreadySolved = !!existing?.solvedAt;
    const nowSolved = result.verdict === "ACCEPTED";
    const fields = {
      language, code, verdict: result.verdict, passedCases: result.passedCases, totalCases: result.totalCases,
      timeMs: result.maxTimeMs ?? null, memoryKb: result.maxMemoryKb ?? null,
    };
    await prisma.weeklyChallengeSubmission.upsert({
      where: { weeklyChallengeId_studentId: { weeklyChallengeId: wc.id, studentId: req.user.id } },
      update: { ...fields, ...(nowSolved && !wasAlreadySolved ? { solvedAt: new Date() } : {}) },
      create: { weeklyChallengeId: wc.id, studentId: req.user.id, ...fields, solvedAt: nowSolved ? new Date() : null },
    });

    let gamification = null;
    if (nowSolved && !wasAlreadySolved) {
      try {
        gamification = await processGamification(req.user.id, { xpActivities: ["WEEKLY_CHALLENGE"], xpMeta: { weeklyChallengeId: wc.id }, streakEligible: true });
      } catch (e) {
        console.error("gamification failed", e);
      }
    }

    const { details, ...safeResult } = result;
    res.json({ ...safeResult, alreadySolved: wasAlreadySolved, gamification });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Submission failed" });
  }
});

// =============================== ADMIN: scheduling ===============================
// Platform-wide (no institute scoping on these models, same as the underlying Question bank
// they schedule from) — write access is ADMIN-only, matching the convention already used for
// other global content (gamification.js's XP-rule/badge admin routes); STAFF gets read access.

router.get("/admin/daily", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const rows = await prisma.dailyChallenge.findMany({
      orderBy: { date: "desc" },
      include: {
        question: { select: { id: true, title: true, description: true, difficulty: true } },
        institute: { select: { id: true, name: true } },
        academicGroup: { select: { id: true, batch: true, section: true, department: { select: { name: true } } } },
        _count: { select: { submissions: true } },
      },
      take: 90,
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load daily challenge schedule" });
  }
});

router.patch("/admin/daily/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { questionId } = req.body;
    if (!questionId) return res.status(400).json({ error: "questionId is required" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true, questionType: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING") return res.status(400).json({ error: "Only coding questions can be scheduled as a challenge" });
    const dc = await prisma.dailyChallenge.update({ where: { id: req.params.id }, data: { questionId } });
    res.json(dc);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to update scheduled challenge" });
  }
});

router.patch("/admin/daily/:id/toggle", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const existing = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, select: { isActive: true } });
    if (!existing) return res.status(404).json({ error: "Scheduled challenge not found" });
    const dc = await prisma.dailyChallenge.update({ where: { id: req.params.id }, data: { isActive: !existing.isActive } });
    res.json(dc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle scheduled challenge" });
  }
});

router.post("/admin/daily", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { date, questionId, instituteId, academicGroupId } = req.body;
    if (!date || !questionId) return res.status(400).json({ error: "date and questionId are required" });
    if (academicGroupId && !instituteId) return res.status(400).json({ error: "academicGroupId requires instituteId" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true, questionType: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING") return res.status(400).json({ error: "Only coding questions can be scheduled as a challenge" });

    const scopeKey = { date: dayStart(date), instituteId: instituteId || null, academicGroupId: academicGroupId || null };
    const dc = await prisma.dailyChallenge.upsert({
      where: { date_instituteId_academicGroupId: scopeKey },
      update: { questionId },
      create: { ...scopeKey, questionId },
    });
    res.json(dc);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to schedule daily challenge" });
  }
});

router.delete("/admin/daily/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    await prisma.dailyChallenge.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove scheduled challenge" });
  }
});

router.get("/admin/weekly", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const rows = await prisma.weeklyChallenge.findMany({
      orderBy: { weekStart: "desc" },
      include: {
        question: { select: { id: true, title: true, description: true, difficulty: true } },
        institute: { select: { id: true, name: true } },
        academicGroup: { select: { id: true, batch: true, section: true, department: { select: { name: true } } } },
        _count: { select: { submissions: true } },
      },
      take: 90,
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load weekly challenge schedule" });
  }
});

router.patch("/admin/weekly/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { questionId } = req.body;
    if (!questionId) return res.status(400).json({ error: "questionId is required" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true, questionType: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING") return res.status(400).json({ error: "Only coding questions can be scheduled as a challenge" });
    const wc = await prisma.weeklyChallenge.update({ where: { id: req.params.id }, data: { questionId } });
    res.json(wc);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to update scheduled challenge" });
  }
});

router.patch("/admin/weekly/:id/toggle", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const existing = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, select: { isActive: true } });
    if (!existing) return res.status(404).json({ error: "Scheduled challenge not found" });
    const wc = await prisma.weeklyChallenge.update({ where: { id: req.params.id }, data: { isActive: !existing.isActive } });
    res.json(wc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle scheduled challenge" });
  }
});

router.post("/admin/weekly", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { weekStart, questionId, instituteId, academicGroupId } = req.body;
    if (!weekStart || !questionId) return res.status(400).json({ error: "weekStart and questionId are required" });
    if (academicGroupId && !instituteId) return res.status(400).json({ error: "academicGroupId requires instituteId" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true, questionType: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING") return res.status(400).json({ error: "Only coding questions can be scheduled as a challenge" });

    const scopeKey = { weekStart: isoWeekStart(weekStart), instituteId: instituteId || null, academicGroupId: academicGroupId || null };
    const wc = await prisma.weeklyChallenge.upsert({
      where: { weekStart_instituteId_academicGroupId: scopeKey },
      update: { questionId },
      create: { ...scopeKey, questionId },
    });
    res.json(wc);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to schedule weekly challenge" });
  }
});

router.delete("/admin/weekly/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    await prisma.weeklyChallenge.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove scheduled challenge" });
  }
});

module.exports = router;
