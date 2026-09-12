// Pure, dependency-free planning logic for the adaptive interview engine (spec §34: "a hidden
// competency plan... NOT a fixed question list... The AI dynamically chooses the next objective
// based on coverage, candidate performance, remaining time, skill importance, previous answers").
// Nothing here calls an LLM — this is the deterministic bookkeeping around the LLM calls in
// AIInterviewEngine.js, kept separate specifically so it's unit-testable without a live API key.

// One question roughly every 2.5 minutes is a deliberately conservative planning assumption (real
// answer length varies a lot) — it only sizes the initial plan's targetQuestions per skill; actual
// pacing is governed live by checkCompletion()'s time/turn checks below, not by this estimate.
const MINUTES_PER_QUESTION = 2.5;

function estimateMaxTurns(durationMin) {
  return Math.max(4, Math.round(durationMin / MINUTES_PER_QUESTION));
}

// Builds the hidden assessment plan at session creation. Equal weight across skills by default —
// an admin-configurable per-role weighting (spec §9's competency matrix, e.g. "Java 20%, Spring
// Boot 20%, SQL 15%...") is a real, valuable enhancement but is NOT implemented in this phase
// (text-only adaptive engine); every skill the candidate/admin listed is weighted equally today,
// which is honest default behavior, not a placeholder pretending to be the full matrix.
function buildCompetencyPlan({ targetSkills, durationMin }) {
  const skills = Array.isArray(targetSkills) && targetSkills.length ? targetSkills : ["General"];
  const maxTurns = estimateMaxTurns(durationMin);
  const weight = Math.round((100 / skills.length) * 100) / 100;
  const targetPerSkill = Math.max(1, Math.round(maxTurns / skills.length));
  return skills.map((skill) => ({
    skill,
    weight,
    targetQuestions: targetPerSkill,
    questionsAsked: 0,
    coverageScore: 0, // running average of this skill's per-turn "correctness" evaluations, 0-100
  }));
}

// Picks which skill/objective the NEXT question should target. Honors the previous turn's
// recommendedNextObjective (spec §11's evaluation output) when that skill still needs coverage —
// the LLM's own judgment about what to probe next is respected, not overridden, as long as it
// doesn't starve a still-uncovered skill of its planned questions entirely. Falls back to the
// least-covered-relative-to-its-weight skill otherwise (spec §34: "coverage... skill importance...
// remaining time").
function selectNextObjective({ competencyPlan, recommendedNextObjective, remainingTurns }) {
  const needsCoverage = (entry) => entry.questionsAsked < entry.targetQuestions;
  if (recommendedNextObjective) {
    const match = competencyPlan.find((e) => e.skill === recommendedNextObjective);
    if (match && needsCoverage(match)) return match.skill;
  }
  const uncovered = competencyPlan.filter(needsCoverage);
  const pool = uncovered.length ? uncovered : competencyPlan;
  // Least-covered-per-weight first — a skill worth more of the interview but under-asked relative
  // to its own target takes priority over one that's already had its planned share.
  const sorted = [...pool].sort((a, b) => (a.questionsAsked / a.targetQuestions) - (b.questionsAsked / b.targetQuestions));
  return sorted[0].skill;
}

function recordObjectiveAsked(competencyPlan, skill, coverageDelta) {
  return competencyPlan.map((entry) =>
    entry.skill === skill
      ? {
          ...entry,
          questionsAsked: entry.questionsAsked + 1,
          coverageScore: entry.questionsAsked === 0
            ? coverageDelta
            : Math.round((entry.coverageScore * entry.questionsAsked + coverageDelta) / (entry.questionsAsked + 1)),
        }
      : entry
  );
}

// Difficulty follows the OVERALL TREND across recent turns, not a mechanical +1/-1 after every
// single answer (spec §10 explicitly warns against that) — looks at the last WINDOW evaluations'
// average correctness and only nudges once every WINDOW turns, clamped to 1-10.
const TREND_WINDOW = 3;
function computeDifficultyTrend({ currentDifficulty, recentCorrectness }) {
  if (recentCorrectness.length < TREND_WINDOW) return currentDifficulty;
  const avg = recentCorrectness.slice(-TREND_WINDOW).reduce((a, b) => a + b, 0) / TREND_WINDOW;
  let next = currentDifficulty;
  if (avg >= 75) next = currentDifficulty + 1;
  else if (avg <= 40) next = currentDifficulty - 1;
  return Math.max(1, Math.min(10, next));
}

// Interview ends when the server-authoritative timer expires, OR the plan's overall coverage
// target is reached with a sane minimum floor — whichever comes first (spec §15: timer is
// authoritative; spec §34: coverage-driven, not a fixed count). MAX_TURNS_HARD_CAP is a pure
// safety backstop against a pathological loop generating turns forever if coverage math is ever
// wrong; a real interview should never actually reach it.
const MIN_TURNS = 4;
const MAX_TURNS_HARD_CAP = 40;
function checkCompletion({ now, expiresAt, turnsCount, competencyPlan }) {
  if (expiresAt && now >= expiresAt) return "TIME_EXPIRED";
  if (turnsCount >= MAX_TURNS_HARD_CAP) return "MAX_TURNS";
  const fullyCovered = competencyPlan.every((e) => e.questionsAsked >= e.targetQuestions);
  if (fullyCovered && turnsCount >= MIN_TURNS) return "PLAN_COMPLETE";
  return null;
}

module.exports = {
  estimateMaxTurns, buildCompetencyPlan, selectNextObjective, recordObjectiveAsked,
  computeDifficultyTrend, checkCompletion, MIN_TURNS, MAX_TURNS_HARD_CAP, TREND_WINDOW,
};
