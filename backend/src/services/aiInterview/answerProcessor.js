// The adaptive core (spec §2), extracted out of routes/aiInterview.js so the text-based HTTP
// route and the Phase 2 voice-session WebSocket handler call the EXACT SAME implementation —
// evaluate the answer just given, decide the next objective/stage/difficulty FROM that
// evaluation, generate the next question, or end the interview. Two copies of this logic (one per
// transport) would be exactly the kind of drift this session's earlier audits found and fixed
// elsewhere on this platform (e.g. the keyboard-shortcut classifier, the score-computation logic)
// — this is the ONE place it's allowed to live now.
const prisma = require("../../prisma");
const engine = require("./AIInterviewEngine");
const { canTransition } = require("./stateMachine");
const { selectNextObjective, recordObjectiveAsked, computeDifficultyTrend, checkCompletion } = require("./competencyPlan");

// Only the fields a candidate should ever see about their own evaluation — internal signals like
// recommendedNextObjective/difficultyAdjustment steer the engine but are never shown, matching
// spec §11's "do not expose hidden chain-of-thought."
function publicEvaluation(evaluation) {
  const { correctness, technicalDepth, clarity, reasoning, confidence, relevance, strengths, weaknesses } = evaluation;
  return { correctness, technicalDepth, clarity, reasoning, confidence, relevance, strengths, weaknesses };
}

// session: the AiInterviewSession row. currentTurn: the still-open (evaluation: null) AiInterviewTurn
// row. answerText/skipped: what the candidate just said (transcribed, for voice) or typed.
// Returns { status, evaluation: publicEvaluation shape, nextQuestion: {id,turnIndex,questionText,questionType} | null }.
async function processAnswer({ session, currentTurn, answerText, skipped, userId, instituteId }) {
  const evaluation = await engine.evaluateAnswer({
    session, turn: currentTurn, answerText: skipped ? null : answerText, userId, instituteId,
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
    return { status: "COMPLETED", evaluation: publicEvaluation(evaluation), nextQuestion: null };
  }

  // Stage: FOLLOW_UP when the evaluator explicitly recommends probing further, DEEP_DIVE when the
  // answer was strong enough to justify going harder on the same objective, otherwise a normal
  // QUESTIONING turn possibly on a different objective — spec §2's worked examples.
  const nextObjective = selectNextObjective({ competencyPlan: updatedPlan, recommendedNextObjective: evaluation.recommendedNextObjective });
  const stage = evaluation.followUpRecommended
    ? "FOLLOW_UP"
    : evaluation.difficultyAdjustment > 0 && nextObjective === currentTurn.objective
    ? "DEEP_DIVE"
    : nextObjective !== currentTurn.objective
    ? "SKILL_TRANSITION"
    : "QUESTIONING";

  if (!canTransition(session.status, stage) && session.status !== stage) {
    const err = new Error(`Invalid stage transition ${session.status} -> ${stage}`);
    err.invalidTransition = true;
    throw err;
  }

  const nextQuestion = await engine.generateNextQuestion({
    session: { ...session, difficulty: nextDifficulty }, recentTurns: allTurns,
    objective: nextObjective, stage,
    resumeSnapshot: session.resumeSnapshot, jobDescription: session.jobDescription,
    userId, instituteId,
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

  return {
    status: stage,
    evaluation: publicEvaluation(evaluation),
    nextQuestion: { id: newTurn.id, turnIndex: newTurn.turnIndex, questionText: newTurn.questionText, questionType: newTurn.questionType },
  };
}

module.exports = { processAnswer, publicEvaluation };
