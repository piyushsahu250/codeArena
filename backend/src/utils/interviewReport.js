// Builds the persisted InterviewReport snapshot from a session's answers. `answersWithQuestions`
// is [{ ...InterviewAnswer, question: { category, subject, aptitudeCategory } }]. `sessionMeta`
// (optional) carries round-elimination/timing context — { roundPlanSnapshot, eliminatedAtRound,
// durationMin } — used only to populate companyReadinessScore/timeEfficiency/
// optimizationSuggestions; every existing field's computation is unchanged by its presence.
function buildInterviewReport(answersWithQuestions, sessionMeta = {}) {
  const answered = answersWithQuestions.filter((a) => !a.skipped);
  const skippedCount = answersWithQuestions.length - answered.length;

  if (answered.length === 0) {
    return {
      overallScore: 0,
      scoreBreakdown: {},
      strongAreas: [],
      weakAreas: [],
      recommendations: ["No questions were answered — attempt at least a few questions to get a meaningful report."],
      companyReadinessScore: null,
      timeEfficiency: null,
      optimizationSuggestions: [],
    };
  }

  const overallScore = Math.max(0, Math.round(answered.reduce((s, a) => s + a.score, 0) / answered.length));

  const subScoreSums = {}, subScoreCounts = {};
  for (const a of answered) {
    for (const [k, v] of Object.entries(a.breakdown || {})) {
      if (typeof v !== "number") continue;
      subScoreSums[k] = (subScoreSums[k] || 0) + v;
      subScoreCounts[k] = (subScoreCounts[k] || 0) + 1;
    }
  }
  const scoreBreakdown = {};
  for (const k of Object.keys(subScoreSums)) scoreBreakdown[k] = Math.round(subScoreSums[k] / subScoreCounts[k]);

  const groupScores = new Map();
  for (const a of answered) {
    const label = a.question.subject || a.question.aptitudeCategory || a.question.category;
    if (!label) continue;
    if (!groupScores.has(label)) groupScores.set(label, []);
    groupScores.get(label).push(a.score);
  }
  const groupAverages = [...groupScores.entries()].map(([label, scores]) => ({
    label, avg: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
  }));
  const strongAreas = groupAverages.filter((g) => g.avg >= 75).sort((a, b) => b.avg - a.avg).map((g) => g.label);
  const weakAreas = groupAverages.filter((g) => g.avg < 50).sort((a, b) => a.avg - b.avg).map((g) => g.label);

  const recommendations = [];
  if (weakAreas.length > 0) recommendations.push(`Focus more practice on: ${weakAreas.join(", ")}.`);
  if (skippedCount > 0) recommendations.push(`You skipped ${skippedCount} question${skippedCount === 1 ? "" : "s"} — attempting every question (even partially) gives a fuller picture of your readiness.`);
  if (scoreBreakdown.confidence !== undefined && scoreBreakdown.confidence < 60) recommendations.push('Reduce hedging language ("maybe", "I think", "probably") — answer assertively even when unsure.');
  if (scoreBreakdown.communication !== undefined && scoreBreakdown.communication < 60) recommendations.push('Watch filler words ("um", "like", "actually") and aim for clear, moderate-length sentences.');
  if (scoreBreakdown.completeness !== undefined && scoreBreakdown.completeness < 60) recommendations.push("Expand your answers — aim for at least 60 words covering context, action, and outcome (the STAR method).");
  if (scoreBreakdown.codeQuality !== undefined && scoreBreakdown.codeQuality < 60) recommendations.push("Add comments and keep functions focused — code quality matters to interviewers beyond just passing tests.");
  if (overallScore >= 80) recommendations.push("Strong performance — keep practicing to maintain consistency across topics.");
  if (recommendations.length === 0) recommendations.push("Solid all-around performance. Keep practicing regularly to stay sharp.");

  // Company readiness score — blends overall score with how far the student got before being
  // eliminated (or full credit for round-completion if never eliminated). Falls back to plain
  // overallScore for every session that isn't a round-elimination Company Round, so the field is
  // always populated rather than sometimes null.
  let companyReadinessScore = overallScore;
  const { roundPlanSnapshot, eliminatedAtRound, durationMin } = sessionMeta;
  if (Array.isArray(roundPlanSnapshot) && roundPlanSnapshot.length > 0) {
    const totalRounds = roundPlanSnapshot.length;
    const roundsCompleted = eliminatedAtRound ? eliminatedAtRound - 1 : totalRounds;
    const roundCompletionPct = Math.round((roundsCompleted / totalRounds) * 100);
    companyReadinessScore = Math.round(overallScore * 0.7 + roundCompletionPct * 0.3);
  }

  // Time efficiency — pure arithmetic over InterviewAnswer.timeTakenSec (already captured at
  // answer-submit time) against an implied per-question budget derived from the session's total
  // duration budget split evenly across its question count. No new capture needed.
  let timeEfficiency = null;
  if (durationMin && answersWithQuestions.length > 0) {
    const budgetSecPerQuestion = (durationMin * 60) / answersWithQuestions.length;
    const timed = answered.filter((a) => typeof a.timeTakenSec === "number");
    if (timed.length > 0) {
      const avgTimePerQuestionSec = Math.round(timed.reduce((s, a) => s + a.timeTakenSec, 0) / timed.length);
      const byCategorySums = {};
      for (const a of timed) {
        const cat = a.question.category || "OTHER";
        if (!byCategorySums[cat]) byCategorySums[cat] = [];
        byCategorySums[cat].push(a.timeTakenSec);
      }
      const byCategory = {};
      for (const [cat, times] of Object.entries(byCategorySums)) byCategory[cat] = Math.round(times.reduce((s, v) => s + v, 0) / times.length);
      const ratio = avgTimePerQuestionSec / budgetSecPerQuestion;
      const comparedToBudget = ratio < 0.85 ? "under" : ratio > 1.15 ? "over" : "on-pace";
      timeEfficiency = { avgTimePerQuestionSec, budgetSecPerQuestion: Math.round(budgetSecPerQuestion), byCategory, comparedToBudget };
    }
  }

  // Optimization suggestions — pacing/structure advice, deliberately kept separate from
  // `recommendations` above (which is weak-topic-content-driven) so a student can tell "what to
  // study" apart from "how you paced yourself" at a glance.
  const optimizationSuggestions = [];
  if (timeEfficiency?.comparedToBudget === "over") {
    optimizationSuggestions.push(`You averaged ${timeEfficiency.avgTimePerQuestionSec}s per question against a ~${timeEfficiency.budgetSecPerQuestion}s budget — practicing under a visible timer can help build pacing instinct.`);
  } else if (timeEfficiency?.comparedToBudget === "under") {
    optimizationSuggestions.push("You moved through questions quickly — double-check you're not rushing past details that could cost you points in a real interview.");
  }
  if (timeEfficiency?.byCategory?.CODING && timeEfficiency.byCategory.CODING > timeEfficiency.budgetSecPerQuestion * 1.3) {
    optimizationSuggestions.push("Coding questions took notably longer than other sections — timed coding drills focused on speed (not just correctness) may help.");
  }
  if (answersWithQuestions.length > 0 && skippedCount / answersWithQuestions.length > 0.3) {
    optimizationSuggestions.push("You skipped a large share of questions — even a rough attempt scores better than a skip, and gives you a truer read on where you stand.");
  }

  return {
    overallScore, scoreBreakdown, strongAreas, weakAreas, recommendations: recommendations.slice(0, 6),
    companyReadinessScore, timeEfficiency, optimizationSuggestions,
  };
}

module.exports = { buildInterviewReport };
