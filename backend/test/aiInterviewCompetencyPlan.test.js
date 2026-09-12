const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCompetencyPlan, selectNextObjective, recordObjectiveAsked,
  computeDifficultyTrend, checkCompletion, estimateMaxTurns,
} = require("../src/services/aiInterview/competencyPlan");

test("buildCompetencyPlan creates one entry per skill with equal weight and zero coverage", () => {
  const plan = buildCompetencyPlan({ targetSkills: ["Java", "DSA", "SQL"], durationMin: 15 });
  assert.equal(plan.length, 3);
  for (const entry of plan) {
    assert.equal(entry.questionsAsked, 0);
    assert.equal(entry.coverageScore, 0);
    assert.ok(entry.targetQuestions >= 1);
  }
  const totalWeight = plan.reduce((a, e) => a + e.weight, 0);
  assert.ok(Math.abs(totalWeight - 100) < 1, "weights should sum to ~100");
});

test("buildCompetencyPlan falls back to a General skill when none are given", () => {
  const plan = buildCompetencyPlan({ targetSkills: [], durationMin: 20 });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].skill, "General");
});

test("estimateMaxTurns scales with duration", () => {
  assert.ok(estimateMaxTurns(20) > estimateMaxTurns(10));
  assert.ok(estimateMaxTurns(5) >= 4, "should never go below the floor");
});

test("selectNextObjective honors a still-uncovered recommended objective", () => {
  const plan = [
    { skill: "Java", weight: 50, targetQuestions: 3, questionsAsked: 1, coverageScore: 80 },
    { skill: "SQL", weight: 50, targetQuestions: 3, questionsAsked: 0, coverageScore: 0 },
  ];
  const next = selectNextObjective({ competencyPlan: plan, recommendedNextObjective: "Java" });
  assert.equal(next, "Java");
});

test("selectNextObjective ignores a recommendation for an already-fully-covered skill", () => {
  const plan = [
    { skill: "Java", weight: 50, targetQuestions: 1, questionsAsked: 1, coverageScore: 80 },
    { skill: "SQL", weight: 50, targetQuestions: 3, questionsAsked: 0, coverageScore: 0 },
  ];
  const next = selectNextObjective({ competencyPlan: plan, recommendedNextObjective: "Java" });
  assert.equal(next, "SQL", "Java is already fully covered, must move to the uncovered skill");
});

test("selectNextObjective picks the least-covered-relative-to-weight skill with no recommendation", () => {
  const plan = [
    { skill: "Java", weight: 50, targetQuestions: 4, questionsAsked: 3, coverageScore: 70 },
    { skill: "SQL", weight: 50, targetQuestions: 4, questionsAsked: 1, coverageScore: 60 },
  ];
  const next = selectNextObjective({ competencyPlan: plan, recommendedNextObjective: null });
  assert.equal(next, "SQL");
});

test("recordObjectiveAsked increments count and rolls the coverage average correctly", () => {
  const plan = [{ skill: "Java", weight: 100, targetQuestions: 3, questionsAsked: 1, coverageScore: 60 }];
  const updated = recordObjectiveAsked(plan, "Java", 80);
  assert.equal(updated[0].questionsAsked, 2);
  assert.equal(updated[0].coverageScore, 70, "(60+80)/2 = 70");
});

test("computeDifficultyTrend does NOT adjust before enough data exists (never mechanical per-answer)", () => {
  assert.equal(computeDifficultyTrend({ currentDifficulty: 5, recentCorrectness: [90, 95] }), 5, "only 2 samples, window is 3");
});

test("computeDifficultyTrend raises difficulty on a strong rolling average", () => {
  assert.equal(computeDifficultyTrend({ currentDifficulty: 5, recentCorrectness: [80, 85, 90] }), 6);
});

test("computeDifficultyTrend lowers difficulty on a weak rolling average", () => {
  assert.equal(computeDifficultyTrend({ currentDifficulty: 5, recentCorrectness: [20, 30, 25] }), 4);
});

test("computeDifficultyTrend holds steady on a middling average", () => {
  assert.equal(computeDifficultyTrend({ currentDifficulty: 5, recentCorrectness: [55, 60, 58] }), 5);
});

test("computeDifficultyTrend clamps to the 1-10 range", () => {
  assert.equal(computeDifficultyTrend({ currentDifficulty: 10, recentCorrectness: [90, 95, 100] }), 10);
  assert.equal(computeDifficultyTrend({ currentDifficulty: 1, recentCorrectness: [0, 5, 10] }), 1);
});

test("checkCompletion ends the interview when the server-authoritative timer expires", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const expiresAt = new Date("2026-01-01T09:59:00Z");
  const reason = checkCompletion({ now, expiresAt, turnsCount: 2, competencyPlan: [{ skill: "Java", questionsAsked: 0, targetQuestions: 5 }] });
  assert.equal(reason, "TIME_EXPIRED");
});

test("checkCompletion ends the interview once the plan is fully covered (with the minimum-turns floor met)", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const expiresAt = new Date("2026-01-01T10:30:00Z");
  const plan = [{ skill: "Java", questionsAsked: 3, targetQuestions: 3 }, { skill: "SQL", questionsAsked: 2, targetQuestions: 2 }];
  const reason = checkCompletion({ now, expiresAt, turnsCount: 5, competencyPlan: plan });
  assert.equal(reason, "PLAN_COMPLETE");
});

test("checkCompletion does not end early just because coverage looks done but the minimum-turns floor isn't met", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const expiresAt = new Date("2026-01-01T10:30:00Z");
  const plan = [{ skill: "Java", questionsAsked: 1, targetQuestions: 1 }];
  const reason = checkCompletion({ now, expiresAt, turnsCount: 1, competencyPlan: plan });
  assert.equal(reason, null);
});

test("checkCompletion returns null (keep going) when neither condition is met", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const expiresAt = new Date("2026-01-01T10:30:00Z");
  const plan = [{ skill: "Java", questionsAsked: 1, targetQuestions: 5 }];
  const reason = checkCompletion({ now, expiresAt, turnsCount: 1, competencyPlan: plan });
  assert.equal(reason, null);
});
