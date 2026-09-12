// Deterministic, auditable scoring — spec §20: "The final decision must be based on configurable
// scoring rules, not an unexplained AI opinion." The LLM only ever produces PER-TURN evaluation
// signals (AIInterviewEngine.evaluateAnswer); every aggregate score and the final STRONG/GOOD/
// BORDERLINE/NEEDS_IMPROVEMENT decision below is plain arithmetic over those stored signals, with
// weights an admin can change (RUBRIC below) without touching the LLM prompts at all.
//
// RUBRIC is deliberately a plain exported object, not read from the database yet — a real admin-
// configuration UI (spec §38) is a further phase; this phase makes the rule itself explicit,
// versioned, and independent of any single AI response, which is the actual requirement being
// satisfied here. DECISION_RULE_VERSION is stored on every AiInterviewReport row specifically so a
// later change to these thresholds is provable against historical reports instead of silently
// reinterpreting them.
const DECISION_RULE_VERSION = "v1";

const RUBRIC = {
  weights: { technical: 0.4, problemSolving: 0.25, communication: 0.2, confidence: 0.15 },
  thresholds: { STRONG: 80, GOOD: 65, BORDERLINE: 50 },
};

function average(nums) {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// Aggregates every turn's stored evaluation JSON into the report's headline scores. Turns with no
// evaluation (skipped, or the interview ended before this turn was answered) are excluded rather
// than counted as zero — a candidate shouldn't be penalized for an interview that ran out of time
// on an already-planned question they never got to.
function aggregateScores(turns) {
  const evaluated = turns.filter((t) => t.evaluation);
  const technicalScore = average(evaluated.map((t) => t.evaluation.technicalDepth ?? t.evaluation.correctness ?? 0));
  const problemSolvingScore = average(evaluated.map((t) => t.evaluation.reasoning ?? 0));
  const communicationScore = average(evaluated.map((t) => t.evaluation.clarity ?? 0));
  const confidenceScore = average(evaluated.map((t) => t.evaluation.confidence ?? 0));
  const relevanceScore = average(evaluated.map((t) => t.evaluation.relevance ?? 0));

  const overallScore = Math.round(
    technicalScore * RUBRIC.weights.technical +
    problemSolvingScore * RUBRIC.weights.problemSolving +
    communicationScore * RUBRIC.weights.communication +
    confidenceScore * RUBRIC.weights.confidence
  );

  // roleFitScore folds relevance in alongside the weighted core — "was this actually an answer to
  // what was asked" matters for role fit specifically, distinct from raw technical correctness.
  const roleFitScore = Math.round((overallScore + relevanceScore) / 2);

  return { overallScore, technicalScore, problemSolvingScore, communicationScore, confidenceScore, roleFitScore };
}

function aggregateSkillScores(turns, competencyPlan) {
  const bySkill = {};
  for (const entry of competencyPlan) bySkill[entry.skill] = entry.coverageScore;
  return bySkill;
}

function decideOutcome(overallScore) {
  if (overallScore >= RUBRIC.thresholds.STRONG) return "STRONG";
  if (overallScore >= RUBRIC.thresholds.GOOD) return "GOOD";
  if (overallScore >= RUBRIC.thresholds.BORDERLINE) return "BORDERLINE";
  return "NEEDS_IMPROVEMENT";
}

module.exports = { RUBRIC, DECISION_RULE_VERSION, aggregateScores, aggregateSkillScores, decideOutcome };
