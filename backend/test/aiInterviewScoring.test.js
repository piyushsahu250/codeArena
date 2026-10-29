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
  // 80*0.45 + 70*0.30 + 75*0.2 + 65*0.05 = 36 + 21 + 15 + 3.25 = 75.25 -> rounds to 75
  assert.equal(scores.overallScore, 75);
});

test("a harder question counts for more than an easier one in every average", () => {
  const strongOnHard = [
    { difficultyAtTurn: 9, evaluation: { technicalDepth: 90, reasoning: 90, clarity: 90, confidence: 90, relevance: 90 } },
    { difficultyAtTurn: 2, evaluation: { technicalDepth: 50, reasoning: 50, clarity: 50, confidence: 50, relevance: 50 } },
  ];
  const strongOnEasy = [
    { difficultyAtTurn: 9, evaluation: { technicalDepth: 50, reasoning: 50, clarity: 50, confidence: 50, relevance: 50 } },
    { difficultyAtTurn: 2, evaluation: { technicalDepth: 90, reasoning: 90, clarity: 90, confidence: 90, relevance: 90 } },
  ];
  const hard = aggregateScores(strongOnHard);
  const easy = aggregateScores(strongOnEasy);
  assert.ok(hard.technicalScore > 70, "good on the hard question and weak on the easy one lands above the plain average of 70");
  assert.ok(easy.technicalScore < 70, "weak on the hard question and good on the easy one lands below it");
  // weights: difficulty 9 -> 1.4, difficulty 2 -> 0.7 ; (90*1.4 + 50*0.7) / 2.1 = 76.67 -> 77
  assert.equal(hard.technicalScore, 77);
});

test("a turn with no stored difficulty counts as 1.0, so data from before this rule averages as it used to", () => {
  const scores = aggregateScores([
    { evaluation: { technicalDepth: 100, reasoning: 0, clarity: 0, confidence: 0, relevance: 0 } },
    { difficultyAtTurn: null, evaluation: { technicalDepth: 0, reasoning: 0, clarity: 0, confidence: 0, relevance: 0 } },
  ]);
  assert.equal(scores.technicalScore, 50);
});

test("equal difficulty everywhere gives the plain average", () => {
  const scores = aggregateScores([5, 5, 5].map((d, i) => ({ difficultyAtTurn: d, evaluation: { technicalDepth: [60, 70, 80][i], reasoning: 0, clarity: 0, confidence: 0, relevance: 0 } })));
  assert.equal(scores.technicalScore, 70);
});

test("the rule version is v2 and the default weights sum to 1", () => {
  const { DECISION_RULE_VERSION } = require("../src/services/aiInterview/scoring");
  assert.equal(DECISION_RULE_VERSION, "v2");
  const w = RUBRIC.weights;
  assert.ok(Math.abs(w.technical + w.problemSolving + w.communication + w.confidence - 1) < 1e-9);
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

test("aggregateScores flags reviewRequired when a third or more of turns have low evaluator confidence", () => {
  const turns = [
    turn({ technicalDepth: 80, reasoning: 80, clarity: 80, confidence: 80, relevance: 80, evaluatorConfidence: 30 }),
    turn({ technicalDepth: 80, reasoning: 80, clarity: 80, confidence: 80, relevance: 80, evaluatorConfidence: 90 }),
    turn({ technicalDepth: 80, reasoning: 80, clarity: 80, confidence: 80, relevance: 80, evaluatorConfidence: 90 }),
  ];
  const scores = aggregateScores(turns);
  assert.equal(scores.lowConfidenceTurnCount, 1);
  assert.equal(scores.reviewRequired, true, "1 of 3 turns low-confidence meets the 1/3 threshold");
});

test("aggregateScores does not flag reviewRequired when low-confidence turns are under the threshold", () => {
  const turns = [
    turn({ technicalDepth: 80, reasoning: 80, clarity: 80, confidence: 80, relevance: 80, evaluatorConfidence: 30 }),
    turn({ technicalDepth: 80, reasoning: 80, clarity: 80, confidence: 80, relevance: 80, evaluatorConfidence: 90 }),
    turn({ technicalDepth: 80, reasoning: 80, clarity: 80, confidence: 80, relevance: 80, evaluatorConfidence: 90 }),
    turn({ technicalDepth: 80, reasoning: 80, clarity: 80, confidence: 80, relevance: 80, evaluatorConfidence: 90 }),
  ];
  const scores = aggregateScores(turns);
  assert.equal(scores.lowConfidenceTurnCount, 1);
  assert.equal(scores.reviewRequired, false, "1 of 4 turns is under the 1/3 threshold");
});

test("aggregateScores treats a missing evaluatorConfidence (evaluations stored before this field existed) as fully confident", () => {
  const turns = [turn({ technicalDepth: 80, reasoning: 80, clarity: 80, confidence: 80, relevance: 80 })];
  const scores = aggregateScores(turns);
  assert.equal(scores.lowConfidenceTurnCount, 0, "backward compatibility: no retroactive flagging of pre-existing reports");
  assert.equal(scores.reviewRequired, false);
});

test("aggregateScores.reviewRequired is false (not undefined-truthy) for an empty turn list", () => {
  const scores = aggregateScores([]);
  assert.equal(scores.reviewRequired, false);
  assert.equal(scores.lowConfidenceTurnCount, 0);
});

test("RUBRIC weights/thresholds are overridable via env vars (same convention as AI_RPM_LIMIT etc.), defaulting to the documented values when unset", () => {
  // scoring.js reads process.env once at module load, so verifying the override requires a fresh
  // require with the env vars set first — same pattern as aiQueue.test.js's AI_RPM_LIMIT test.
  const keys = [
    "AI_INTERVIEW_WEIGHT_TECHNICAL", "AI_INTERVIEW_WEIGHT_PROBLEM_SOLVING",
    "AI_INTERVIEW_WEIGHT_COMMUNICATION", "AI_INTERVIEW_WEIGHT_CONFIDENCE",
    "AI_INTERVIEW_THRESHOLD_STRONG", "AI_INTERVIEW_THRESHOLD_GOOD", "AI_INTERVIEW_THRESHOLD_BORDERLINE",
  ];
  const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    delete require.cache[require.resolve("../src/services/aiInterview/scoring")];
    const defaultRubric = require("../src/services/aiInterview/scoring").RUBRIC;
    assert.deepEqual(defaultRubric.weights, { technical: 0.45, problemSolving: 0.3, communication: 0.2, confidence: 0.05 }, "documented defaults when no env vars are set");
    assert.deepEqual(defaultRubric.thresholds, { STRONG: 80, GOOD: 65, BORDERLINE: 50 });

    process.env.AI_INTERVIEW_WEIGHT_TECHNICAL = "0.5";
    process.env.AI_INTERVIEW_THRESHOLD_STRONG = "90";
    delete require.cache[require.resolve("../src/services/aiInterview/scoring")];
    const overriddenRubric = require("../src/services/aiInterview/scoring").RUBRIC;
    assert.equal(overriddenRubric.weights.technical, 0.5, "an env var actually overrides its weight");
    assert.equal(overriddenRubric.thresholds.STRONG, 90, "an env var actually overrides its threshold");
    assert.equal(overriddenRubric.weights.problemSolving, 0.3,"an unset env var still falls back to its default even when a sibling is overridden");
  } finally {
    for (const k of keys) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
    delete require.cache[require.resolve("../src/services/aiInterview/scoring")];
  }
});
