// AI Voice Interview module (Phase 1: text-only adaptive engine — see docs/AI_INTERVIEW.md).
// Mounted at /api/ai-interviews, deliberately separate from /api/interview (the existing
// admin-authored-question-bank Mock Interview module) — see AiInterviewSession's own schema
// comment for why this is a genuinely different data shape, not a rename of the old one.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { Prisma } = require("@prisma/client");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { sendAiError } = require("../utils/aiErrors");
const engine = require("../services/aiInterview/AIInterviewEngine");
const { canTransition, ACTIVE_QUESTIONING_STATES } = require("../services/aiInterview/stateMachine");
const {
  buildCompetencyPlan, selectNextObjective, recordObjectiveAsked,
  computeDifficultyTrend, checkCompletion, TREND_WINDOW,
} = require("../services/aiInterview/competencyPlan");
const { aggregateScores, aggregateSkillScores, decideOutcome, DECISION_RULE_VERSION } = require("../services/aiInterview/scoring");

const router = express.Router();

// Real, billed Gemini calls on every turn — one call to generate the next question plus one to
// evaluate the answer just given, so this is intentionally tighter than a typical per-user AI
// limiter (matching the rationale behind interview.js's own aiInsightsLimiter/execLimiter).
const answerLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user.id });
const createLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => req.user.id });

const VALID_INTERVIEW_TYPES = [
  "TECHNICAL", "HR", "BEHAVIORAL", "CODING", "SYSTEM_DESIGN", "PROJECT",
  "MIXED", "COMPANY_SPECIFIC", "PLACEMENT", "AI_MOCK",
];
const VALID_EXPERIENCE_LEVELS = ["FRESHER", "EXPERIENCED", "INTERN", "ENTRY_LEVEL", "JUNIOR", "MID_LEVEL", "SENIOR", "LEAD", "MANAGER"];

// Ownership check reused by every route below — a student may only ever act on their OWN session.
// 404 (not 403) on mismatch, same "don't confirm another student's session even exists" pattern
// used throughout this codebase (e.g. resultManagement.js's loadOwnMarksheetEntry).
async function loadOwnSession(req, res) {
  const session = await prisma.aiInterviewSession.findUnique({ where: { id: req.params.id } });
  if (!session || session.studentId !== req.user.id) {
    res.status(404).json({ error: "Interview session not found" });
    return null;
  }
  return session;
}

// POST /api/ai-interviews — create a session (spec §1's configuration screen + §27).
router.post("/", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("ai_voice_interview"), createLimiter, async (req, res) => {
  try {
    const { role, experienceLevel, targetSkills, interviewType, durationMin, language, companyId, jobDescription } = req.body;

    if (!role || typeof role !== "string" || !role.trim()) return res.status(400).json({ error: "Job role is required" });
    if (!VALID_EXPERIENCE_LEVELS.includes(experienceLevel)) return res.status(400).json({ error: "Invalid experience level" });
    if (!VALID_INTERVIEW_TYPES.includes(interviewType)) return res.status(400).json({ error: "Invalid interview type" });
    if (!Array.isArray(targetSkills) || targetSkills.length === 0 || targetSkills.some((s) => typeof s !== "string" || !s.trim())) {
      return res.status(400).json({ error: "At least one target skill is required" });
    }
    const duration = Number(durationMin);
    if (!Number.isFinite(duration) || duration < 5 || duration > 60) return res.status(400).json({ error: "Duration must be between 5 and 60 minutes" });

    // Resume-aware (spec §8) — best-effort: an interview must still be startable for a student
    // with no resume on file, so a missing Resume row is not an error here, just less context.
    const resume = await prisma.resume.findUnique({
      where: { studentId: req.user.id },
      select: { skills: true, projects: true, experience: true },
    });

    const competencyPlan = buildCompetencyPlan({ targetSkills, durationMin: duration });

    const session = await prisma.aiInterviewSession.create({
      data: {
        studentId: req.user.id,
        instituteId: req.requesterInstituteId,
        role: role.trim(),
        experienceLevel,
        interviewType,
        targetSkills,
        language: language || "en",
        companyId: companyId || null,
        durationMin: duration,
        competencyPlan,
        resumeSnapshot: resume || null,
        jobDescription: jobDescription ? String(jobDescription).slice(0, 4000) : null,
        status: "CREATED",
      },
    });

    res.status(201).json(session);
  } catch (err) {
    console.error("[ai-interviews] create failed:", err.message);
    res.status(500).json({ error: "Failed to create interview session" });
  }
});

// GET /api/ai-interviews/:id — session state (reconnect support, spec §15/§29).
router.get("/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const session = await loadOwnSession(req, res);
    if (!session) return;
    const remainingSeconds = session.expiresAt ? Math.max(0, Math.round((new Date(session.expiresAt) - Date.now()) / 1000)) : null;
    res.json({ ...session, remainingSeconds, competencyPlan: undefined }); // hidden plan never leaves the server, spec §34
  } catch (err) {
    console.error("[ai-interviews] get session failed:", err.message);
    res.status(500).json({ error: "Failed to load interview session" });
  }
});

// POST /api/ai-interviews/:id/start — CREATED -> INTRODUCTION -> QUESTIONING, generates the
// spoken introduction and the first question. One combined route (not two) because a candidate
// has no reason to ever pause between "introduce yourself" and "ask the first question."
router.post("/:id/start", authenticate, requireRole("STUDENT"), createLimiter, async (req, res) => {
  // Whole handler in one try/catch — see the /answer route's own comment for the real bug this
  // convention exists to prevent (an uncaught rejection from an async Express 4 handler never
  // sends a response at all; the client just hangs until its own timeout).
  try {
    const session = await loadOwnSession(req, res);
    if (!session) return;
    if (!canTransition(session.status, "INTRODUCTION")) {
      return res.status(409).json({ error: `Cannot start an interview from status ${session.status}` });
    }

    const introduction = await engine.generateIntroduction({ session, userId: req.user.id, instituteId: session.instituteId });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + session.durationMin * 60 * 1000);
    const objective = selectNextObjective({ competencyPlan: session.competencyPlan, recommendedNextObjective: null });
    const firstQuestion = await engine.generateNextQuestion({
      session, recentTurns: [], objective, stage: "QUESTIONING",
      resumeSnapshot: session.resumeSnapshot, jobDescription: session.jobDescription,
      userId: req.user.id, instituteId: session.instituteId,
    });

    const updatedPlan = recordObjectiveAsked(session.competencyPlan, objective, 0);

    const [, turn] = await prisma.$transaction([
      prisma.aiInterviewSession.update({
        where: { id: session.id },
        data: { status: "QUESTIONING", startedAt: now, expiresAt, currentObjective: objective, competencyPlan: updatedPlan },
      }),
      prisma.aiInterviewTurn.create({
        data: {
          sessionId: session.id, turnIndex: 0, objective,
          questionType: firstQuestion.questionType, questionText: firstQuestion.questionText,
          difficultyAtTurn: session.difficulty,
        },
      }),
    ]);

    res.json({ introduction, status: "QUESTIONING", expiresAt, turn: { id: turn.id, turnIndex: 0, questionText: turn.questionText, questionType: turn.questionType } });
  } catch (err) {
    sendAiError(res, err, "Failed to start the interview");
  }
});

// POST /api/ai-interviews/:id/answer — THE adaptive core (spec §2). Evaluates the answer just
// given, decides the next objective/stage/difficulty FROM that evaluation, and generates the next
// question — or ends the interview if time/coverage is exhausted. One route, not split across
// "submit answer" + "get next question" (spec §27 lists them separately as an example, but
// splitting them would let a client fetch a next question without ever having submitted an
// answer for the current one, which breaks the "next depends on previous" invariant this whole
// module exists to guarantee).
router.post("/:id/answer", authenticate, requireRole("STUDENT"), answerLimiter, async (req, res) => {
  // The ENTIRE handler body is inside this one try/catch, deliberately — a real bug caught during
  // testing (2026-09-12): the currentTurn lookup below used to sit BEFORE any try/catch, and its
  // `evaluation: null` filter (see the Prisma.JsonNull fix just below) threw a Prisma validation
  // error ("Argument `evaluation` must not be null" — a plain JS null is ambiguous for a Json?
  // column; Prisma requires Prisma.JsonNull/Prisma.DbNull instead). Express 4 does NOT auto-catch
  // a rejected promise from an async route handler, so that thrown error was silently swallowed —
  // no response was ever sent, and the request hung until the CLIENT's own timeout fired. Verified
  // live: every /answer call hung for 75s+ before this fix, and completed normally after it.
  try {
    const session = await loadOwnSession(req, res);
    if (!session) return;
    if (!ACTIVE_QUESTIONING_STATES.includes(session.status)) {
      return res.status(409).json({ error: `No question is currently awaiting an answer (status: ${session.status})` });
    }
    if (session.expiresAt && new Date() >= new Date(session.expiresAt)) {
      return finalizeExpiredSession(req, res, session);
    }

    // A turn that has never been answered has a true database NULL in this column (never once
    // written to), not a stored JSON "null" literal — Prisma.DbNull is the correct match for that,
    // where a plain `null` is rejected outright and Prisma.JsonNull would match the OTHER case
    // (an explicitly-stored JSON null value, which never happens here).
    const currentTurn = await prisma.aiInterviewTurn.findFirst({
      where: { sessionId: session.id, evaluation: { equals: Prisma.DbNull } },
      orderBy: { turnIndex: "desc" },
    });
    if (!currentTurn) return res.status(409).json({ error: "No open question to answer" });

    const { answerText, skipped } = req.body;
    if (!skipped && (typeof answerText !== "string" || !answerText.trim())) {
      return res.status(400).json({ error: "answerText is required unless skipped is true" });
    }

    const evaluation = await engine.evaluateAnswer({
      session, turn: currentTurn, answerText: skipped ? null : answerText,
      userId: req.user.id, instituteId: session.instituteId,
    });

    await prisma.aiInterviewTurn.update({
      where: { id: currentTurn.id },
      data: { answerText: skipped ? null : answerText, answeredAt: new Date(), skipped: !!skipped, evaluation },
    });

    const allTurns = await prisma.aiInterviewTurn.findMany({ where: { sessionId: session.id }, orderBy: { turnIndex: "asc" } });
    const recentCorrectness = allTurns.filter((t) => t.evaluation).map((t) => t.evaluation.correctness);
    const nextDifficulty = computeDifficultyTrend({ currentDifficulty: session.difficulty, recentCorrectness });

    const updatedPlan = recordObjectiveAsked(session.competencyPlan, currentTurn.objective, evaluation.correctness);

    const completionReason = checkCompletion({
      now: new Date(), expiresAt: session.expiresAt, turnsCount: allTurns.length, competencyPlan: updatedPlan,
    });

    if (completionReason) {
      await prisma.aiInterviewSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt: new Date(), terminationReason: completionReason, difficulty: nextDifficulty, competencyPlan: updatedPlan },
      });
      return res.json({ status: "COMPLETED", evaluation: publicEvaluation(evaluation), nextQuestion: null });
    }

    // Stage: FOLLOW_UP when the evaluator explicitly recommends probing further, DEEP_DIVE when
    // the answer was strong enough to justify going harder on the same objective, otherwise a
    // normal QUESTIONING turn possibly on a different objective — spec §2's worked examples.
    const nextObjective = selectNextObjective({
      competencyPlan: updatedPlan, recommendedNextObjective: evaluation.recommendedNextObjective,
    });
    const stage = evaluation.followUpRecommended
      ? "FOLLOW_UP"
      : evaluation.difficultyAdjustment > 0 && nextObjective === currentTurn.objective
      ? "DEEP_DIVE"
      : nextObjective !== currentTurn.objective
      ? "SKILL_TRANSITION"
      : "QUESTIONING";

    if (!canTransition(session.status, stage) && session.status !== stage) {
      // Fallback: any of the active-questioning states can always re-enter plain QUESTIONING —
      // this only trips if the computed stage above were ever somehow invalid, which validateion
      // above already prevents; kept as a defensive 409 rather than silently writing a bad status.
      return res.status(409).json({ error: `Invalid stage transition ${session.status} -> ${stage}` });
    }

    const nextQuestion = await engine.generateNextQuestion({
      session: { ...session, difficulty: nextDifficulty }, recentTurns: allTurns,
      objective: nextObjective, stage,
      resumeSnapshot: session.resumeSnapshot, jobDescription: session.jobDescription,
      userId: req.user.id, instituteId: session.instituteId,
    });

    const finalPlan = recordObjectiveAsked(updatedPlan, nextObjective, 0);

    const [, newTurn] = await prisma.$transaction([
      prisma.aiInterviewSession.update({
        where: { id: session.id },
        data: { status: stage, difficulty: nextDifficulty, currentObjective: nextObjective, competencyPlan: finalPlan },
      }),
      prisma.aiInterviewTurn.create({
        data: {
          sessionId: session.id, turnIndex: currentTurn.turnIndex + 1, objective: nextObjective,
          questionType: nextQuestion.questionType, questionText: nextQuestion.questionText, difficultyAtTurn: nextDifficulty,
        },
      }),
    ]);

    res.json({
      status: stage,
      evaluation: publicEvaluation(evaluation),
      nextQuestion: { id: newTurn.id, turnIndex: newTurn.turnIndex, questionText: newTurn.questionText, questionType: newTurn.questionType },
    });
  } catch (err) {
    sendAiError(res, err, "Failed to process your answer");
  }
});

// Only the fields a candidate should ever see about their own evaluation — internal signals like
// recommendedNextObjective/difficultyAdjustment steer the engine but are never shown, matching
// spec §11's "do not expose hidden chain-of-thought."
function publicEvaluation(evaluation) {
  const { correctness, technicalDepth, clarity, reasoning, confidence, relevance, strengths, weaknesses } = evaluation;
  return { correctness, technicalDepth, clarity, reasoning, confidence, relevance, strengths, weaknesses };
}

async function finalizeExpiredSession(req, res, session) {
  await prisma.aiInterviewSession.update({
    where: { id: session.id },
    data: { status: "COMPLETED", completedAt: new Date(), terminationReason: "TIME_EXPIRED" },
  });
  return res.json({ status: "COMPLETED", evaluation: null, nextQuestion: null, reason: "TIME_EXPIRED" });
}

// POST /api/ai-interviews/:id/complete — candidate-initiated early end, or a client-detected
// timer expiry double-checked server-side (the server's own expiresAt is authoritative either
// way — spec §15 — this route never trusts a client claim that time is up without verifying it).
router.post("/:id/complete", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const session = await loadOwnSession(req, res);
    if (!session) return;
    if (!ACTIVE_QUESTIONING_STATES.includes(session.status)) {
      return res.status(409).json({ error: `Cannot complete an interview from status ${session.status}` });
    }
    const reason = session.expiresAt && new Date() >= new Date(session.expiresAt) ? "TIME_EXPIRED" : "CANDIDATE_ENDED";
    await prisma.aiInterviewSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED", completedAt: new Date(), terminationReason: reason },
    });
    res.json({ status: "COMPLETED", terminationReason: reason });
  } catch (err) {
    console.error("[ai-interviews] complete failed:", err.message);
    res.status(500).json({ error: "Failed to complete interview session" });
  }
});

// GET /api/ai-interviews/:id/transcript — full turn history (spec §19).
router.get("/:id/transcript", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const session = await loadOwnSession(req, res);
    if (!session) return;
    const turns = await prisma.aiInterviewTurn.findMany({ where: { sessionId: session.id }, orderBy: { turnIndex: "asc" } });
    res.json(turns.map((t) => ({
      turnIndex: t.turnIndex, questionText: t.questionText, questionType: t.questionType,
      answerText: t.answerText, skipped: t.skipped, answeredAt: t.answeredAt,
      evaluation: t.evaluation ? publicEvaluation(t.evaluation) : null,
    })));
  } catch (err) {
    console.error("[ai-interviews] transcript failed:", err.message);
    res.status(500).json({ error: "Failed to load transcript" });
  }
});

// GET /api/ai-interviews/:id/report — final report; generates it on first request if the session
// is COMPLETED but not yet REPORT_READY (mirrors interview.js's existing ai-insights
// generate-on-first-view pattern, so a student is never billed for a report they never open).
router.get("/:id/report", authenticate, requireRole("STUDENT"), async (req, res) => {
  let session;
  try {
    session = await loadOwnSession(req, res);
    if (!session) return;

    const existing = await prisma.aiInterviewReport.findUnique({ where: { sessionId: session.id } });
    if (existing) return res.json(existing);

    if (session.status !== "COMPLETED") {
      return res.status(409).json({ error: "Report is not available until the interview is completed" });
    }

    await prisma.aiInterviewSession.update({ where: { id: session.id }, data: { status: "EVALUATING" } });
    const turns = await prisma.aiInterviewTurn.findMany({ where: { sessionId: session.id }, orderBy: { turnIndex: "asc" } });
    const scores = aggregateScores(turns);
    const skillScores = aggregateSkillScores(turns, session.competencyPlan);
    const narrative = await engine.generateReportNarrative({ session, turns, scores, userId: req.user.id, instituteId: session.instituteId });
    const decision = decideOutcome(scores.overallScore);

    const evidence = {};
    for (const t of turns) if (t.evaluation?.evidence?.length) evidence[t.objective] = (evidence[t.objective] || []).concat(t.evaluation.evidence);

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.aiInterviewReport.create({
        data: {
          sessionId: session.id, studentId: session.studentId,
          ...scores, skillScores,
          strengths: narrative.strengths, weaknesses: narrative.weaknesses, recommendedLearning: narrative.recommendedLearning,
          evidence, decision, decisionRuleVersion: DECISION_RULE_VERSION,
        },
      });
      await tx.aiInterviewSession.update({ where: { id: session.id }, data: { status: "REPORT_READY" } });
      return created;
    });

    res.json(report);
  } catch (err) {
    if (session?.id) await prisma.aiInterviewSession.update({ where: { id: session.id }, data: { status: "COMPLETED" } }).catch(() => {});
    sendAiError(res, err, "Failed to generate the interview report");
  }
});

module.exports = router;
