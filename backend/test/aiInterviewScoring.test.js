const { test } = require("node:test");
const assert = require("node:assert/strict");
const { aggregateScores, decideOutcome, RUBRIC } = require("../src/services/aiInterview/scoring");

function turn(evaluation) {
  return { evaluation };
}

test("aggregateScores computes a weighted overall score from per-turn signals", () => {
  const turns = [
    turn({ technicalDepth: 90, reasoning: 80, clarity: 85, confidence: 75, relevance: 90 }),
    turn({ technicalDepth: 70, reasoning: 60, clarity: 65, confidence: 55, relevance: 70 }),
  ];
  const scores = aggregateScores(turns);
  assert.equal(scores.technicalScore, 80);
  assert.equal(scores.problemSolvingScore, 70);
  assert.equal(scores.communicationScore, 75);
  assert.equal(scores.confidenceScore, 65);
  // 80*0.4 + 70*0.25 + 75*0.2 + 65*0.15 = 32 + 17.5 + 15 + 9.75 = 74.25 -> rounds to 74
  assert.equal(scores.overallScore, 74);
});

test("aggregateScores excludes turns with no evaluation (never answered) rather than counting them as zero", () => {
  const turns = [
    turn({ technicalDepth: 100, reasoning: 100, clarity: 100, confidence: 100, relevance: 100 }),
    turn(null), // ran out of time before this one was answered
  ];
  const scores = aggregateScores(turns);
  assert.equal(scores.technicalScore, 100, "the unanswered turn must not drag the average down");
});

test("aggregateScores returns all zeros for an empty turn list without throwing", () => {
  const scores = aggregateScores([]);
  assert.equal(scores.overallScore, 0);
});

test("decideOutcome applies the documented thresholds exactly", () => {
  assert.equal(decideOutcome(RUBRIC.thresholds.STRONG), "STRONG");
  assert.equal(decideOutcome(RUBRIC.thresholds.STRONG - 1), "GOOD");
  assert.equal(decideOutcome(RUBRIC.thresholds.GOOD), "GOOD");
  assert.equal(decideOutcome(RUBRIC.thresholds.GOOD - 1), "BORDERLINE");
  assert.equal(decideOutcome(RUBRIC.thresholds.BORDERLINE), "BORDERLINE");
  assert.equal(decideOutcome(RUBRIC.thresholds.BORDERLINE - 1), "NEEDS_IMPROVEMENT");
  assert.equal(decideOutcome(0), "NEEDS_IMPROVEMENT");
  assert.equal(decideOutcome(100), "STRONG");
});

test("decideOutcome is a pure function of the score alone (deterministic, not an AI opinion)", () => {
  assert.equal(decideOutcome(82), decideOutcome(82));
});
