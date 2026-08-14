const { judgeSubmission } = require("./judge");
const { runQueued } = require("./queue");

// BTL level -> the "dimension" label the spec asks the report to speak in (knowledge/conceptual/
// application/analysis/evaluation/problemSolving), per Bloom's Taxonomy's standard cognitive-level
// naming. `coding` is a separate, cross-cutting dimension (computed from CODING/SQL questions
// regardless of their BTL level, since coding ability is called out as its own axis in the spec,
// not something BTL alone captures).
const BTL_DIMENSION = { 1: "knowledge", 2: "conceptual", 3: "application", 4: "analysis", 5: "evaluation", 6: "problemSolving" };

// Grades one answer against its question — the sole place Readiness answer-scoring logic lives, so
// the live "Submit answer" route and any future bulk regrade share one implementation. MCQ/
// MULTISELECT/TRUE_FALSE use the same array-equality rule as Formal Tests' gradeQuizAnswer
// (routes/submissions.js); CODING/SQL reuse the platform's real judge engine — same hidden-case-
// with-legacy-fallback policy as utils/gradeAttempt.js's gradeCodingSubmission.
async function gradeReadinessAnswer(question, { answerText, code, language, selectedOptions, skipped }) {
  if (skipped) return { score: 0, isCorrect: null };

  if (question.questionType === "MCQ" || question.questionType === "MULTISELECT" || question.questionType === "TRUE_FALSE") {
    const correct = Array.isArray(question.correctAnswer) ? [...question.correctAnswer].sort() : [];
    const selected = Array.isArray(selectedOptions) ? [...new Set(selectedOptions)].sort() : [];
    const isCorrect = correct.length === selected.length && correct.every((v, i) => v === selected[i]);
    return { score: isCorrect ? 100 : 0, isCorrect };
  }

  if (question.questionType === "CODING" || question.questionType === "SQL") {
    const cases = Array.isArray(question.testCases) ? question.testCases : [];
    const hiddenCases = cases.filter((tc) => tc.isHidden);
    const gradingCases = hiddenCases.length > 0 ? hiddenCases : cases;
    const gradingLanguage = question.questionType === "SQL" ? "sql" : language;
    const result = await runQueued(() =>
      judgeSubmission({
        language: gradingLanguage, code, testCases: gradingCases, timeLimitMs: question.timeLimitMs,
        memoryLimitKb: question.memoryLimitKb || undefined, evaluationType: question.evaluationType,
        functionSignature: question.functionSignature, sqlSchema: question.sqlSchema,
      })
    );
    const score = result.totalCases === 0 ? 0 : Math.round((result.passedCases / result.totalCases) * 100);
    return { score, isCorrect: result.verdict === "ACCEPTED" };
  }

  // Not one of the platform's gradeable types (see readinessBlueprint.js's GRADABLE_QUESTION_TYPES)
  // — should never actually be reached since the blueprint only ever selects gradeable questions,
  // but fails safe rather than throwing if a subject's config is ever hand-edited to include one.
  return { score: 0, isCorrect: null };
}

// Builds the persisted ReadinessReport snapshot from one assessment's answers. `answersWithQuestions`
// is [{ ...ReadinessAnswer, question: { btlLevel, topic, subtopic, difficulty, questionType } }].
// `subject` is the owning ReadinessSubject row (for readinessThresholds/employabilityIndicators).
//
// overallScore formula (documented per spec's "no arbitrary score" rule): the weighted mean of
// each BTL level's percent-correct, weighted by how many questions were actually attempted at that
// level. A level with zero attempted questions contributes neither a score nor a weight — it does
// not drag the average toward 0, and does not need an arbitrary default value. This is the entire
// formula; there is no separate "difficulty" or "topic" multiplier layered on top of it, so the
// number a student sees is always explainable as "your BTL-weighted accuracy."
function buildReadinessReport(answersWithQuestions, subject) {
  const answered = answersWithQuestions.filter((a) => !a.skipped);

  if (answered.length === 0) {
    return {
      overallScore: 0,
      readinessLevel: resolveReadinessLevel(0, subject.readinessThresholds),
      btlScores: emptyBtlScores(),
      topicScores: [],
      difficultyScores: { EASY: null, MEDIUM: null, HARD: null },
      dimensionScores: {},
      employabilityIndicators: null,
      strongAreas: [],
      weakAreas: [],
      recommendations: ["No questions were answered — attempt at least a few questions to get a meaningful readiness report."],
      nextAssessmentSuggestion: null,
    };
  }

  // --- BTL scores: NOT_ASSESSED (null) for any level with zero attempted questions, never 0%. ---
  const btlBuckets = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const a of answered) {
    const lvl = a.question.btlLevel;
    if (lvl && btlBuckets[lvl]) btlBuckets[lvl].push(a.score);
  }
  const btlScores = {};
  for (const lvl of [1, 2, 3, 4, 5, 6]) {
    const scores = btlBuckets[lvl];
    btlScores[lvl] = scores.length > 0
      ? { attempted: scores.length, correct: scores.filter((s) => s >= 100).length, percent: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) }
      : null;
  }

  // --- overallScore: attempted-question-weighted mean of the assessed BTL levels' percents. ---
  let weightedSum = 0, totalWeight = 0;
  for (const lvl of [1, 2, 3, 4, 5, 6]) {
    if (!btlScores[lvl]) continue;
    weightedSum += btlScores[lvl].percent * btlScores[lvl].attempted;
    totalWeight += btlScores[lvl].attempted;
  }
  const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : Math.round(answered.reduce((s, a) => s + a.score, 0) / answered.length);

  // --- topic scores ---
  const topicBuckets = new Map();
  for (const a of answered) {
    const topic = a.question.topic || "Untagged";
    const key = `${topic}::${a.question.subtopic || ""}`;
    if (!topicBuckets.has(key)) topicBuckets.set(key, { topic, subtopic: a.question.subtopic || null, scores: [], btlCounts: {} });
    const bucket = topicBuckets.get(key);
    bucket.scores.push(a.score);
    const lvl = a.question.btlLevel;
    if (lvl) bucket.btlCounts[lvl] = (bucket.btlCounts[lvl] || 0) + 1;
  }
  const topicScores = [...topicBuckets.values()].map((b) => {
    const accuracy = Math.round(b.scores.reduce((s, v) => s + v, 0) / b.scores.length);
    const strength = accuracy >= 75 ? "STRONG" : accuracy >= 50 ? "NEEDS_IMPROVEMENT" : "CRITICAL";
    return { topic: b.topic, subtopic: b.subtopic, questionsAttempted: b.scores.length, accuracy, btlDistribution: b.btlCounts, strength };
  }).sort((a, b) => a.accuracy - b.accuracy);

  // --- difficulty scores (NOT_ASSESSED as null, same rule as BTL) ---
  const diffBuckets = { EASY: [], MEDIUM: [], HARD: [] };
  for (const a of answered) {
    if (a.question.difficulty && diffBuckets[a.question.difficulty]) diffBuckets[a.question.difficulty].push(a.score);
  }
  const difficultyScores = {};
  for (const d of ["EASY", "MEDIUM", "HARD"]) {
    difficultyScores[d] = diffBuckets[d].length > 0 ? Math.round(diffBuckets[d].reduce((s, v) => s + v, 0) / diffBuckets[d].length) : null;
  }

  // --- dimension scores: only dimensions actually assessed are populated ---
  const dimensionScores = {};
  for (const lvl of [1, 2, 3, 4, 5, 6]) {
    if (btlScores[lvl]) dimensionScores[BTL_DIMENSION[lvl]] = btlScores[lvl].percent;
  }
  const codingAnswers = answered.filter((a) => a.question.questionType === "CODING" || a.question.questionType === "SQL");
  if (codingAnswers.length > 0) {
    dimensionScores.coding = Math.round(codingAnswers.reduce((s, a) => s + a.score, 0) / codingAnswers.length);
  }

  // --- employability indicators: subject-defined groups, scored by matching topic name ---
  let employabilityIndicators = null;
  if (Array.isArray(subject.employabilityIndicators) && subject.employabilityIndicators.length > 0) {
    employabilityIndicators = subject.employabilityIndicators.map((indicator) => {
      const matches = topicScores.filter((t) => t.topic.toLowerCase() === String(indicator).toLowerCase());
      const score = matches.length > 0 ? Math.round(matches.reduce((s, t) => s + t.accuracy, 0) / matches.length) : null;
      return { indicator, score };
    });
  }

  const strongAreas = topicScores.filter((t) => t.strength === "STRONG").map((t) => t.topic);
  const weakAreas = topicScores.filter((t) => t.strength !== "STRONG").map((t) => t.topic);

  const readinessLevel = resolveReadinessLevel(overallScore, subject.readinessThresholds);
  const recommendations = buildRecommendations({ btlScores, topicScores, weakAreas, overallScore });
  const nextAssessmentSuggestion = buildNextAssessmentSuggestion({ overallScore, subject, btlScores });

  return {
    overallScore, readinessLevel, btlScores, topicScores, difficultyScores, dimensionScores,
    employabilityIndicators, strongAreas, weakAreas, recommendations, nextAssessmentSuggestion,
  };
}

function emptyBtlScores() {
  return { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
}

// Evaluated top-down against the subject's admin-configured thresholds (see ReadinessSubject.
// readinessThresholds' schema comment for the shape/example) — first threshold whose `min` the
// score clears, checked from highest to lowest, wins.
function resolveReadinessLevel(overallScore, readinessThresholds) {
  const thresholds = Array.isArray(readinessThresholds) ? [...readinessThresholds] : [];
  thresholds.sort((a, b) => b.min - a.min);
  const hit = thresholds.find((t) => overallScore >= t.min);
  return hit ? hit.label : "FOUNDATION_REQUIRED";
}

function buildRecommendations({ btlScores, topicScores, weakAreas, overallScore }) {
  const recs = [];
  const worstTopics = topicScores.filter((t) => t.strength === "CRITICAL").slice(0, 3);
  worstTopics.forEach((t, i) => recs.push({ priority: i + 1, topic: t.subtopic ? `${t.topic} — ${t.subtopic}` : t.topic, action: `Practice ${t.topic} questions — accuracy was ${t.accuracy}% across ${t.questionsAttempted} question(s).` }));

  // BTL-gap framing: strong at lower levels, weak at higher ones (or vice versa) — this is the
  // "explain why" the spec asks for, phrased in terms of the actual cognitive levels assessed.
  const assessedLevels = [1, 2, 3, 4, 5, 6].filter((l) => btlScores[l]);
  if (assessedLevels.length >= 2) {
    const lowLevels = assessedLevels.filter((l) => l <= 2);
    const highLevels = assessedLevels.filter((l) => l >= 3);
    const lowAvg = lowLevels.length ? lowLevels.reduce((s, l) => s + btlScores[l].percent, 0) / lowLevels.length : null;
    const highAvg = highLevels.length ? highLevels.reduce((s, l) => s + btlScores[l].percent, 0) / highLevels.length : null;
    if (lowAvg != null && highAvg != null && lowAvg - highAvg >= 20) {
      recs.push({ priority: recs.length + 1, topic: "Application & Analysis", action: "Strong on recall/understanding, but accuracy drops on application/analysis-level questions — practice applying concepts to new scenarios, not just recalling definitions." });
    } else if (highAvg != null && lowAvg != null && highAvg - lowAvg >= 20) {
      recs.push({ priority: recs.length + 1, topic: "Fundamentals", action: "Higher-order performance is ahead of foundational recall — a quick fundamentals refresh may close small gaps that show up under pressure." });
    }
  }

  if (weakAreas.length === 0 && overallScore >= 80) {
    recs.push({ priority: recs.length + 1, topic: "Overall", action: "Strong, well-rounded performance — attempt a higher assessment mode (e.g. Advanced/Interview Readiness) to keep progressing." });
  }
  if (recs.length === 0) recs.push({ priority: 1, topic: "Overall", action: "Solid performance overall — revisit this subject periodically to stay sharp." });
  return recs.slice(0, 6);
}

function buildNextAssessmentSuggestion({ overallScore, subject, btlScores }) {
  const modes = Array.isArray(subject.assessmentModes) ? subject.assessmentModes : [];
  if (modes.length === 0) return null;
  if (overallScore < 50) {
    const foundation = modes.find((m) => m.btlMin <= 2);
    if (foundation) return `Retry a ${foundation.label} assessment once you've addressed the weak topics above.`;
  }
  const assessedLevels = [1, 2, 3, 4, 5, 6].filter((l) => btlScores[l]);
  const assessedMax = assessedLevels.length > 0 ? Math.max(...assessedLevels) : 0;
  const next = modes.filter((m) => m.btlMin > assessedMax).sort((a, b) => a.btlMin - b.btlMin)[0];
  if (next) return `You're ready to attempt ${next.label} next.`;
  return "You've covered this subject's full BTL range — revisit periodically to track retention.";
}

// Ordinal ranking of the 6 fixed readinessLevel labels, lowest to highest — shared by any caller
// that needs "at least level X" comparisons (Talent Pool auto-selection criteria, certificate
// issuance thresholds) so the ranking is defined once, not reinvented per call site.
const READINESS_LEVEL_RANK = { FOUNDATION_REQUIRED: 0, NEEDS_IMPROVEMENT: 1, DEVELOPING: 2, NEARLY_READY: 3, JOB_READY: 4, EXCELLENTLY_READY: 5 };

// Assessment Coverage: what fraction of the subject's configured BTL-level question targets for
// this attempt were actually available and assembled (readinessBlueprint.js's `target` vs `actual`,
// already stored verbatim on ReadinessAssessment.blueprint — nothing new to compute or persist,
// just read). A low value means the question bank couldn't fully cover the intended blueprint (a
// thin BTL level, a narrow topic pool), so the resulting score/level should be read with that
// caveat rather than treated as fully conclusive — same "don't fake confidence" rule as the
// per-BTL-level "Not assessed" display. Computed here once so the JSON report and the PDF (the
// only two places it's shown) can never disagree, per the platform's single-scoring-engine rule.
function computeAssessmentCoverage(blueprint) {
  const target = blueprint?.target || {};
  const actual = blueprint?.actual || {};
  const totalTarget = Object.values(target).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalActual = Object.values(actual).reduce((s, v) => s + (Number(v) || 0), 0);
  if (totalTarget === 0) return null;
  return Math.round((totalActual / totalTarget) * 100);
}

module.exports = { gradeReadinessAnswer, buildReadinessReport, resolveReadinessLevel, READINESS_LEVEL_RANK, computeAssessmentCoverage };
