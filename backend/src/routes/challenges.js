const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { judgeSubmission } = require("../utils/judge");
const { runQueued } = require("../utils/queue");
const { processGamification } = require("../utils/gamification");
const { resolveMostSpecificChallenge, loadStudentScope } = require("../utils/challengeScoping");
const { safeErrorMessage } = require("../utils/errors");
const { cached } = require("../utils/cache");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

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

// Re-resolves "the challenge currently valid for this student" (same isActive + institute/
// academicGroup scoping + date-window rules /daily/today and /weekly/current already apply via
// resolveMostSpecificChallenge) and requires the requested :id to match it. Without this, /run
// and /submit below only checked "does a row with this id exist" — a deactivated ("Inactive" in
// the admin UI, i.e. unpublished) challenge, a challenge scoped to a different institute/academic
// group, or a past/future day's challenge stayed fully runnable and gradeable-for-XP by anyone who
// still had its id, completely bypassing the admin "Active" toggle and student scoping.
async function assertChallengeIsCurrent(model, dateField, dateValue, studentId, challengeId) {
  const scope = await loadStudentScope(studentId);
  const resolved = await resolveMostSpecificChallenge(model, dateField, dateValue, scope);
  return !!resolved && resolved.id === challengeId;
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

// ============================ Admin tooling shared helpers ============================

// Search/filter shape shared by GET /admin/daily and GET /admin/weekly — filters live on the
// scheduled row's underlying Question (title/description/subject/topic/difficulty/status), since
// that's where all of a challenge's actual content already lives (see file header comment).
function buildAdminChallengeWhere({ q, subjectId, topicId, difficulty, status }) {
  const question = {};
  if (q) {
    question.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  if (subjectId) question.subjectId = subjectId;
  if (topicId) question.topicId = topicId;
  if (difficulty) question.difficulty = difficulty;
  if (status) question.questionStatus = status;
  return Object.keys(question).length > 0 ? { question } : {};
}

// DailyChallenge/WeeklyChallenge rows (unlike the underlying platform-wide Question bank they
// schedule from) carry a real instituteId — an institute-scoped ADMIN/STAFF must not see, edit,
// toggle, delete, or duplicate another institute's scheduled challenge, and a scoped requester
// creating a new one must not be able to target an arbitrary instituteId from the request body.
// Same null-means-global, scoped-requesters-excluded-from-global-writes convention as
// questionVisibility.js's ownsQuestionRow (Question Bank) — kept local here since these two
// models have no createdById column to also check.
function instituteScopedWhere(requesterInstituteId) {
  return requesterInstituteId ? { OR: [{ instituteId: requesterInstituteId }, { instituteId: null }] } : {};
}
function ownsChallengeRow(req, row) {
  return !req.requesterInstituteId || row.instituteId === req.requesterInstituteId;
}

// Hard-blocks scheduling a question with no way to grade it at all; everything else is a
// non-blocking heads-up shown in the admin UI, not enforced server-side, since none of these
// gaps make the challenge unusable — only lower quality (spec section: "quality-check
// validation before publish").
function validateChallengeReadiness(question) {
  const errors = [];
  const warnings = [];
  const testCases = question.testCases || [];
  if (testCases.length === 0) errors.push("This question has zero test cases — it cannot be graded.");
  if (!testCases.some((tc) => tc.isHidden)) warnings.push("No hidden test cases — students could pass by hard-coding the visible cases.");
  if (question.evaluationType === "FUNCTION" && !question.functionSignature) {
    warnings.push("FUNCTION mode is set but no function signature is configured.");
  }
  if (!question.starterCode && !question.starterCodeByLanguage) {
    warnings.push("No starter code configured for any language.");
  }
  return { valid: errors.length === 0, errors, warnings };
}

// Clones the underlying Question (including test cases) into a new, independent row — same
// field-stripping technique as questions.js's /bulk-copy (id/questionNumber/createdAt/testCases
// stripped, testCases recreated fresh) but self-contained here since bulk-copy also requires a
// destination folder + institute-ownership check that don't apply to these platform-wide,
// institute-less Daily/Weekly Challenge questions. Does NOT copy folder/institute — the copy
// lands wherever the original did, just as a new row, matching the file's existing "no institute
// scoping on these models" convention.
async function duplicateQuestionRow(question, actorId) {
  const { id, questionNumber, createdAt, testCases, ...rest } = question;
  return prisma.question.create({
    data: {
      ...rest,
      createdById: actorId,
      title: rest.title ? `${rest.title} (Copy)` : rest.title,
      testCases: { create: testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden, explanation: tc.explanation })) },
    },
  });
}

async function computeChallengeAnalytics(submissionModel, foreignKey, challengeId) {
  const submissions = await submissionModel.findMany({ where: { [foreignKey]: challengeId } });
  const attempts = submissions.length;
  const uniqueStudents = new Set(submissions.map((s) => s.studentId)).size;
  const solved = submissions.filter((s) => s.verdict === "ACCEPTED");
  const passRate = attempts > 0 ? Math.round((solved.length / attempts) * 100) : 0;
  const avgScore = attempts > 0
    ? Math.round(submissions.reduce((sum, s) => sum + (s.totalCases > 0 ? (s.passedCases / s.totalCases) * 100 : 0), 0) / attempts)
    : 0;
  const timedSubs = submissions.filter((s) => s.timeMs != null);
  const avgTimeMs = timedSubs.length > 0 ? Math.round(timedSubs.reduce((sum, s) => sum + s.timeMs, 0) / timedSubs.length) : null;
  return { attempts, uniqueStudents, passRate, avgScore, avgTimeMs };
}

// STUDENT: streak + challenge-XP summary — surfaces data already tracked by the shared
// gamification pipeline (processGamification -> StudentStreak/XpEvent, same tables every other
// streak-earning activity writes to) but never previously displayed on the Daily/Weekly Challenge
// pages themselves. Pure reads, no new computation.
router.get("/stats", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("coding_challenge"), async (req, res) => {
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

router.get("/daily/today", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("coding_challenge"), async (req, res) => {
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
      include: {
        question: { select: { title: true } },
        // Section: submission history — same DailyChallengeSubmission row the calendar strip's
        // `solved` boolean already reads, just selecting the rest of its columns too. Still one
        // row per (dailyChallengeId, studentId) — this is "the student's final state on that
        // day's challenge," not a click-by-click submit log (matches the platform's existing
        // "one row per attempt, best/latest wins" convention, same as Formal Test Submission).
        submissions: {
          where: { studentId: req.user.id },
          select: { verdict: true, passedCases: true, totalCases: true, timeMs: true, language: true, solvedAt: true, updatedAt: true },
        },
      },
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
    res.json(ordered.map((c) => {
      const sub = c.submissions[0] || null;
      return {
        date: c.date,
        solved: !!sub?.solvedAt,
        questionTitle: c.question?.title || null,
        // Only present once the student has actually attempted this day's challenge — a day
        // with no submission row at all stays exactly {date, solved:false, questionTitle} as
        // before, so this is purely additive for CalendarStrip's existing consumers.
        attempt: sub ? { verdict: sub.verdict, passedCases: sub.passedCases, totalCases: sub.totalCases, timeMs: sub.timeMs, language: sub.language, lastAttemptAt: sub.updatedAt } : null,
      };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load challenge history" });
  }
});

// Only ever ranks today's challenge — same "current" resolution as /run and /submit, so a stale
// or wrong-scope :id can't be probed for a leaderboard either. No numeric score exists on
// DailyChallengeSubmission (grading is pass/fail against hidden cases, not partial credit), so
// ranking is solve order (earliest solvedAt first, matching every LeetCode-style daily-challenge
// convention) with fastest runtime as the tiebreak — both server-recorded, never client-supplied.
// Scoped to the requester's own institute even when the challenge itself is Global: a Global
// challenge can have submissions from students across every institute, and showing those names
// across institute boundaries would be exactly the leak section 4/35 warn against.
router.get("/daily/:id/leaderboard", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("coding_challenge"), async (req, res) => {
  try {
    if (!(await assertChallengeIsCurrent(prisma.dailyChallenge, "date", dayStart(new Date()), req.user.id, req.params.id))) {
      return res.status(404).json({ error: "Challenge not found" });
    }
    const submissions = await prisma.dailyChallengeSubmission.findMany({
      where: { dailyChallengeId: req.params.id, verdict: "ACCEPTED", student: { instituteId: req.requesterInstituteId } },
      select: { studentId: true, solvedAt: true, timeMs: true, student: { select: { name: true } } },
      orderBy: [{ solvedAt: "asc" }, { timeMs: "asc" }],
      take: 100,
    });
    const leaderboard = submissions.map((s, i) => ({
      rank: i + 1, studentId: s.studentId, name: s.student.name, isYou: s.studentId === req.user.id,
      solvedAt: s.solvedAt, timeMs: s.timeMs,
    }));
    res.json({ leaderboard, yourRank: leaderboard.find((r) => r.isYou)?.rank || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

router.post("/daily/:id/run", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("coding_challenge"), runLimiter, async (req, res) => {
  try {
    const dc = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!dc) return res.status(404).json({ error: "Challenge not found" });
    if (!(await assertChallengeIsCurrent(prisma.dailyChallenge, "date", dayStart(new Date()), req.user.id, dc.id))) {
      return res.status(403).json({ error: "This challenge is not currently available." });
    }
    const { language, code } = req.body;
    const result = await runAgainstVisible(dc.question, language, code);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Execution failed" });
  }
});

router.post("/daily/:id/submit", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("coding_challenge"), runLimiter, async (req, res) => {
  try {
    const dc = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!dc) return res.status(404).json({ error: "Challenge not found" });
    if (!(await assertChallengeIsCurrent(prisma.dailyChallenge, "date", dayStart(new Date()), req.user.id, dc.id))) {
      return res.status(403).json({ error: "This challenge is not currently available." });
    }
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

// STUDENT: autosave in-progress code for today's Daily Challenge — same CodeDraft pattern already
// used by Practice Coding (learning.js) and Mock Interview coding (interview.js), keyed by
// challenge id so a refresh, reconnect, or accidental tab close restores in-progress work instead
// of resetting to starter code. No "is this challenge still current" gate here (unlike run/submit)
// — a draft written just before the challenge rolls over is harmless to keep, and gating would only
// risk losing a student's last few keystrokes right at the deadline.
router.post("/daily/:id/autosave", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { language, code } = req.body;
    if (typeof code !== "string" || !language) return res.status(400).json({ error: "language and code are required" });
    await prisma.codeDraft.upsert({
      where: { studentId_contextType_contextId: { studentId: req.user.id, contextType: "DAILY_CHALLENGE", contextId: req.params.id } },
      update: { code, language },
      create: { studentId: req.user.id, contextType: "DAILY_CHALLENGE", contextId: req.params.id, code, language },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Autosave failed" });
  }
});

// STUDENT: fetch the saved draft (if any), so reopening today's Daily Challenge restores
// in-progress code instead of resetting to the question's starter code.
router.get("/daily/:id/draft", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const draft = await prisma.codeDraft.findUnique({
      where: { studentId_contextType_contextId: { studentId: req.user.id, contextType: "DAILY_CHALLENGE", contextId: req.params.id } },
    });
    res.json(draft ? { code: draft.code, language: draft.language } : null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load draft" });
  }
});

// =============================== STUDENT: Weekly Challenge ===============================

router.get("/weekly/current", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("coding_challenge"), async (req, res) => {
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

// Weekly counterpart to /daily/:id/leaderboard — same rules (current-week only, solve-order
// ranking, own-institute scoping only). See that route's comment for the full reasoning.
router.get("/weekly/:id/leaderboard", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("coding_challenge"), async (req, res) => {
  try {
    if (!(await assertChallengeIsCurrent(prisma.weeklyChallenge, "weekStart", isoWeekStart(new Date()), req.user.id, req.params.id))) {
      return res.status(404).json({ error: "Challenge not found" });
    }
    const submissions = await prisma.weeklyChallengeSubmission.findMany({
      where: { weeklyChallengeId: req.params.id, verdict: "ACCEPTED", student: { instituteId: req.requesterInstituteId } },
      select: { studentId: true, solvedAt: true, timeMs: true, student: { select: { name: true } } },
      orderBy: [{ solvedAt: "asc" }, { timeMs: "asc" }],
      take: 100,
    });
    const leaderboard = submissions.map((s, i) => ({
      rank: i + 1, studentId: s.studentId, name: s.student.name, isYou: s.studentId === req.user.id,
      solvedAt: s.solvedAt, timeMs: s.timeMs,
    }));
    res.json({ leaderboard, yourRank: leaderboard.find((r) => r.isYou)?.rank || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

router.post("/weekly/:id/run", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("coding_challenge"), runLimiter, async (req, res) => {
  try {
    const wc = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!wc) return res.status(404).json({ error: "Challenge not found" });
    if (!(await assertChallengeIsCurrent(prisma.weeklyChallenge, "weekStart", isoWeekStart(new Date()), req.user.id, wc.id))) {
      return res.status(403).json({ error: "This challenge is not currently available." });
    }
    const { language, code } = req.body;
    const result = await runAgainstVisible(wc.question, language, code);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Execution failed" });
  }
});

router.post("/weekly/:id/submit", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("coding_challenge"), runLimiter, async (req, res) => {
  try {
    const wc = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!wc) return res.status(404).json({ error: "Challenge not found" });
    if (!(await assertChallengeIsCurrent(prisma.weeklyChallenge, "weekStart", isoWeekStart(new Date()), req.user.id, wc.id))) {
      return res.status(403).json({ error: "This challenge is not currently available." });
    }
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

// STUDENT: autosave/draft for this week's Weekly Challenge — same CodeDraft pattern as the Daily
// Challenge routes above.
router.post("/weekly/:id/autosave", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { language, code } = req.body;
    if (typeof code !== "string" || !language) return res.status(400).json({ error: "language and code are required" });
    await prisma.codeDraft.upsert({
      where: { studentId_contextType_contextId: { studentId: req.user.id, contextType: "WEEKLY_CHALLENGE", contextId: req.params.id } },
      update: { code, language },
      create: { studentId: req.user.id, contextType: "WEEKLY_CHALLENGE", contextId: req.params.id, code, language },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Autosave failed" });
  }
});

router.get("/weekly/:id/draft", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const draft = await prisma.codeDraft.findUnique({
      where: { studentId_contextType_contextId: { studentId: req.user.id, contextType: "WEEKLY_CHALLENGE", contextId: req.params.id } },
    });
    res.json(draft ? { code: draft.code, language: draft.language } : null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load draft" });
  }
});

// =============================== ADMIN: scheduling ===============================
// Unlike the underlying Question bank they schedule from (platform-wide, no institute concept),
// DailyChallenge/WeeklyChallenge rows DO carry instituteId/academicGroupId — see
// instituteScopedWhere/ownsChallengeRow above. Write access is ADMIN-only (matching the
// convention used for other global-content admin routes); STAFF gets read access. A NULL
// instituteId row is a genuinely platform-wide challenge, visible to every institute in list
// views, but only a platform-level admin (no instituteId on their own account) can write to it.

router.get("/admin/daily", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const { q, subjectId, topicId, difficulty, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const where = { ...buildAdminChallengeWhere({ q, subjectId, topicId, difficulty, status }), ...instituteScopedWhere(req.requesterInstituteId) };
    const [rows, total] = await Promise.all([
      prisma.dailyChallenge.findMany({
        where,
        orderBy: { date: "desc" },
        include: {
          question: { select: { id: true, title: true, description: true, difficulty: true, questionStatus: true, subjectRef: { select: { id: true, name: true } }, topicRef: { select: { id: true, name: true } } } },
          institute: { select: { id: true, name: true } },
          academicGroup: { select: { id: true, batch: true, section: true, department: { select: { name: true } } } },
          _count: { select: { submissions: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.dailyChallenge.count({ where }),
    ]);
    res.json({ rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load daily challenge schedule" });
  }
});

router.patch("/admin/daily/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, select: { instituteId: true } });
    if (!existing || !ownsChallengeRow(req, existing)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const { questionId } = req.body;
    if (!questionId) return res.status(400).json({ error: "questionId is required" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true, questionType: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING") return res.status(400).json({ error: "Only coding questions can be scheduled as a challenge" });
    const dc = await prisma.dailyChallenge.update({ where: { id: req.params.id }, data: { questionId } });
    await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_SCHEDULED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "DAILY", id: dc.id, questionId } });
    res.json(dc);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to update scheduled challenge") });
  }
});

router.patch("/admin/daily/:id/toggle", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, select: { isActive: true, instituteId: true } });
    if (!existing || !ownsChallengeRow(req, existing)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const dc = await prisma.dailyChallenge.update({ where: { id: req.params.id }, data: { isActive: !existing.isActive } });
    await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_TOGGLED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "DAILY", id: dc.id, isActive: dc.isActive } });
    res.json(dc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle scheduled challenge" });
  }
});

router.post("/admin/daily", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { date, questionId, academicGroupId } = req.body;
    // An institute-scoped ADMIN can only ever schedule against their own institute, regardless of
    // what instituteId the request body sends — only a platform-level admin (requesterInstituteId
    // null) can target an arbitrary institute or leave it null for a genuinely global challenge.
    const instituteId = req.requesterInstituteId || req.body.instituteId || null;
    if (!date || !questionId) return res.status(400).json({ error: "date and questionId are required" });
    if (academicGroupId && !instituteId) return res.status(400).json({ error: "academicGroupId requires instituteId" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, include: { testCases: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING") return res.status(400).json({ error: "Only coding questions can be scheduled as a challenge" });
    const readiness = validateChallengeReadiness(question);
    if (!readiness.valid) return res.status(400).json({ error: readiness.errors[0] });

    // Not a plain upsert: Prisma rejects null values inside a compound-unique where selector
    // (date_instituteId_academicGroupId) even though instituteId/academicGroupId are nullable
    // columns — "Argument `instituteId` must not be null." findFirst has no such restriction,
    // so look the row up that way and fall back to create/update explicitly.
    const scopeKey = { date: dayStart(date), instituteId: instituteId || null, academicGroupId: academicGroupId || null };
    const existing = await prisma.dailyChallenge.findFirst({ where: scopeKey });
    const dc = existing
      ? await prisma.dailyChallenge.update({ where: { id: existing.id }, data: { questionId } })
      : await prisma.dailyChallenge.create({ data: { ...scopeKey, questionId } });
    await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_SCHEDULED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "DAILY", id: dc.id, date: dc.date, questionId } });
    res.json({ ...dc, warnings: readiness.warnings });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to schedule daily challenge") });
  }
});

// Archive-safe: a scheduled slot with real student submissions is preserved as inactive
// (same "block destructive delete when dependent data exists" pattern already shipped for
// Chapter/Module/Lesson) — an admin who genuinely wants it gone can still deactivate it via
// the toggle route above; only an empty slot can be hard-deleted.
router.delete("/admin/daily/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, select: { instituteId: true } });
    if (!existing || !ownsChallengeRow(req, existing)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const submissionCount = await prisma.dailyChallengeSubmission.count({ where: { dailyChallengeId: req.params.id } });
    if (submissionCount > 0) {
      await prisma.dailyChallenge.update({ where: { id: req.params.id }, data: { isActive: false } });
      await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_ARCHIVED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "DAILY", id: req.params.id, submissionCount } });
      return res.status(409).json({ error: `This challenge has ${submissionCount} student submission(s) and was deactivated instead of deleted.`, archived: true });
    }
    await prisma.dailyChallenge.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove scheduled challenge" });
  }
});

// Reuses the file's own sanitizeQuestion — admin preview is guaranteed identical to what a
// student sees (hidden cases still stripped) because it's the same function, not a re-implementation.
router.get("/admin/daily/:id/preview", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const dc = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!dc || !ownsChallengeRow(req, dc)) return res.status(404).json({ error: "Scheduled challenge not found" });
    res.json({ question: sanitizeQuestion(dc.question) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load challenge preview" });
  }
});

// Short TTL cache — this is a per-row admin panel view, not a page-load-critical stat, so a small
// amount of staleness after a fresh submission is an acceptable tradeoff against re-aggregating
// every submission on every open of the panel.
router.get("/admin/daily/:id/analytics", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const exists = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, select: { id: true, instituteId: true } });
    if (!exists || !ownsChallengeRow(req, exists)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const analytics = await cached(`challenge:analytics:daily:${req.params.id}`, 2 * 60 * 1000, () =>
      computeChallengeAnalytics(prisma.dailyChallengeSubmission, "dailyChallengeId", req.params.id)
    );
    res.json(analytics);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load challenge analytics" });
  }
});

router.post("/admin/daily/:id/duplicate", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const dc = await prisma.dailyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!dc || !ownsChallengeRow(req, dc)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const copy = await duplicateQuestionRow(dc.question, req.user.id);
    await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_DUPLICATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "DAILY", sourceId: dc.id, newQuestionId: copy.id } });
    res.json({ question: copy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to duplicate challenge question" });
  }
});

router.get("/admin/weekly", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const { q, subjectId, topicId, difficulty, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const where = { ...buildAdminChallengeWhere({ q, subjectId, topicId, difficulty, status }), ...instituteScopedWhere(req.requesterInstituteId) };
    const [rows, total] = await Promise.all([
      prisma.weeklyChallenge.findMany({
        where,
        orderBy: { weekStart: "desc" },
        include: {
          question: { select: { id: true, title: true, description: true, difficulty: true, questionStatus: true, subjectRef: { select: { id: true, name: true } }, topicRef: { select: { id: true, name: true } } } },
          institute: { select: { id: true, name: true } },
          academicGroup: { select: { id: true, batch: true, section: true, department: { select: { name: true } } } },
          _count: { select: { submissions: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.weeklyChallenge.count({ where }),
    ]);
    res.json({ rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load weekly challenge schedule" });
  }
});

router.patch("/admin/weekly/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, select: { instituteId: true } });
    if (!existing || !ownsChallengeRow(req, existing)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const { questionId } = req.body;
    if (!questionId) return res.status(400).json({ error: "questionId is required" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true, questionType: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING") return res.status(400).json({ error: "Only coding questions can be scheduled as a challenge" });
    const wc = await prisma.weeklyChallenge.update({ where: { id: req.params.id }, data: { questionId } });
    await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_SCHEDULED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "WEEKLY", id: wc.id, questionId } });
    res.json(wc);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to update scheduled challenge") });
  }
});

router.patch("/admin/weekly/:id/toggle", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, select: { isActive: true, instituteId: true } });
    if (!existing || !ownsChallengeRow(req, existing)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const wc = await prisma.weeklyChallenge.update({ where: { id: req.params.id }, data: { isActive: !existing.isActive } });
    await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_TOGGLED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "WEEKLY", id: wc.id, isActive: wc.isActive } });
    res.json(wc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle scheduled challenge" });
  }
});

router.post("/admin/weekly", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { weekStart, questionId, academicGroupId } = req.body;
    // Same institute-lockdown as POST /admin/daily above — see its comment.
    const instituteId = req.requesterInstituteId || req.body.instituteId || null;
    if (!weekStart || !questionId) return res.status(400).json({ error: "weekStart and questionId are required" });
    if (academicGroupId && !instituteId) return res.status(400).json({ error: "academicGroupId requires instituteId" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, include: { testCases: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING") return res.status(400).json({ error: "Only coding questions can be scheduled as a challenge" });
    const readiness = validateChallengeReadiness(question);
    if (!readiness.valid) return res.status(400).json({ error: readiness.errors[0] });

    // Same null-in-compound-unique-where limitation as POST /admin/daily above — findFirst +
    // explicit create/update instead of upsert.
    const scopeKey = { weekStart: isoWeekStart(weekStart), instituteId: instituteId || null, academicGroupId: academicGroupId || null };
    const existing = await prisma.weeklyChallenge.findFirst({ where: scopeKey });
    const wc = existing
      ? await prisma.weeklyChallenge.update({ where: { id: existing.id }, data: { questionId } })
      : await prisma.weeklyChallenge.create({ data: { ...scopeKey, questionId } });
    await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_SCHEDULED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "WEEKLY", id: wc.id, weekStart: wc.weekStart, questionId } });
    res.json({ ...wc, warnings: readiness.warnings });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to schedule weekly challenge") });
  }
});

router.delete("/admin/weekly/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, select: { instituteId: true } });
    if (!existing || !ownsChallengeRow(req, existing)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const submissionCount = await prisma.weeklyChallengeSubmission.count({ where: { weeklyChallengeId: req.params.id } });
    if (submissionCount > 0) {
      await prisma.weeklyChallenge.update({ where: { id: req.params.id }, data: { isActive: false } });
      await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_ARCHIVED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "WEEKLY", id: req.params.id, submissionCount } });
      return res.status(409).json({ error: `This challenge has ${submissionCount} student submission(s) and was deactivated instead of deleted.`, archived: true });
    }
    await prisma.weeklyChallenge.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove scheduled challenge" });
  }
});

router.get("/admin/weekly/:id/preview", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const wc = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!wc || !ownsChallengeRow(req, wc)) return res.status(404).json({ error: "Scheduled challenge not found" });
    res.json({ question: sanitizeQuestion(wc.question) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load challenge preview" });
  }
});

router.get("/admin/weekly/:id/analytics", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const exists = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, select: { id: true, instituteId: true } });
    if (!exists || !ownsChallengeRow(req, exists)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const analytics = await cached(`challenge:analytics:weekly:${req.params.id}`, 2 * 60 * 1000, () =>
      computeChallengeAnalytics(prisma.weeklyChallengeSubmission, "weeklyChallengeId", req.params.id)
    );
    res.json(analytics);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load challenge analytics" });
  }
});

router.post("/admin/weekly/:id/duplicate", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const wc = await prisma.weeklyChallenge.findUnique({ where: { id: req.params.id }, include: { question: { include: { testCases: true } } } });
    if (!wc || !ownsChallengeRow(req, wc)) return res.status(404).json({ error: "Scheduled challenge not found" });
    const copy = await duplicateQuestionRow(wc.question, req.user.id);
    await logAudit({ req, action: AUDIT_ACTIONS.CHALLENGE_DUPLICATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { type: "WEEKLY", sourceId: wc.id, newQuestionId: copy.id } });
    res.json({ question: copy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to duplicate challenge question" });
  }
});

module.exports = router;
