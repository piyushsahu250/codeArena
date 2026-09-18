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

// Env-var overridable — the same "tune via env var, don't hardcode" convention already used for
// every other tunable knob on this platform (AI_RPM_LIMIT, AI_CONCURRENCY, AI_DAILY_LIMIT_*,
// GEMINI_MAX_RETRIES, etc.), applied here as a real but PARTIAL answer to "weights must be
// configurable": an ops/admin person can retune these by setting an env var and redeploying,
// without touching this file or any LLM prompt. This is NOT the full admin-UI-with-no-redeploy
// version the spec ultimately calls for (still a further phase, per the comment above) — being
// explicit about that gap rather than quietly overstating what this closes. DECISION_RULE_VERSION
// intentionally stays "v1" even when these are overridden: it identifies the RULE'S FORMULA/SHAPE
// (weighted-average-then-threshold), which is unchanged, not a specific weight configuration —
// bump it only if the calculation itself changes shape.
function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

const RUBRIC = {
  weights: {
    technical: envNumber("AI_INTERVIEW_WEIGHT_TECHNICAL", 0.4),
    problemSolving: envNumber("AI_INTERVIEW_WEIGHT_PROBLEM_SOLVING", 0.25),
    communication: envNumber("AI_INTERVIEW_WEIGHT_COMMUNICATION", 0.2),
    confidence: envNumber("AI_INTERVIEW_WEIGHT_CONFIDENCE", 0.15),
  },
  thresholds: {
    STRONG: envNumber("AI_INTERVIEW_THRESHOLD_STRONG", 80),
    GOOD: envNumber("AI_INTERVIEW_THRESHOLD_GOOD", 65),
    BORDERLINE: envNumber("AI_INTERVIEW_THRESHOLD_BORDERLINE", 50),
  },
};

// "If evaluation confidence is insufficient, mark REVIEW_REQUIRED instead of pretending
// certainty" — evaluatorConfidence is the AI's own certainty in each per-turn evaluation (see
// AIInterviewEngine.js), distinct from the candidate-confidence score already folded into
// overallScore above. A single low-confidence turn doesn't discredit an otherwise-clear
// interview; a third or more of turns being low-confidence is a real signal the overall
// decision deserves a second look before being treated as fully certain.
const EVALUATOR_CONFIDENCE_LOW_THRESHOLD = 50;
const REVIEW_REQUIRED_LOW_CONFIDENCE_FRACTION = 1 / 3;

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

  const lowConfidenceTurnCount = evaluated.filter((t) => (t.evaluation.evaluatorConfidence ?? 100) < EVALUATOR_CONFIDENCE_LOW_THRESHOLD).length;
  const reviewRequired = evaluated.length > 0 && lowConfidenceTurnCount / evaluated.length >= REVIEW_REQUIRED_LOW_CONFIDENCE_FRACTION;

  return { overallScore, technicalScore, problemSolvingScore, communicationScore, confidenceScore, roleFitScore, lowConfidenceTurnCount, reviewRequired };
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
