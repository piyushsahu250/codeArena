const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/utils/examReport");

const topic = (obtained, maxMarks, correct, total) => ({ obtained, maxMarks, correct, total, percent: Math.round((obtained / maxMarks) * 10000) / 100 });

test("topics are called strong or weak only from what the student actually answered, most extreme first", () => {
  const byTopic = { Percentages: topic(9, 10, 9, 10), Ratios: topic(2, 10, 2, 10), Probability: topic(5, 10, 5, 10), Empty: { obtained: 0, maxMarks: 0, correct: 0, total: 0, percent: 0 } };
  const r = R.topicInsights(byTopic);
  assert.deepEqual(r.strengths.map((s) => s.name), ["Percentages"]);
  assert.deepEqual(r.weaknesses.map((s) => s.name), ["Ratios"]);
  assert.equal(r.strengths[0].correct, 9);
  assert.deepEqual(R.topicInsights(undefined), { strengths: [], weaknesses: [] });
  assert.deepEqual(R.topicInsights({}), { strengths: [], weaknesses: [] });
});

test("the thresholds are inclusive at 70 for strong and exclusive at 50 for weak", () => {
  const r = R.topicInsights({ A: topic(7, 10, 7, 10), B: topic(5, 10, 5, 10), C: topic(4.9, 10, 4, 10) });
  assert.deepEqual(r.strengths.map((s) => s.name), ["A"]);
  assert.deepEqual(r.weaknesses.map((s) => s.name), ["C"]);
});

test("interview dimensions are averaged over evaluated answers only, from AI dimensions or the rule breakdown", () => {
  const dims = R.aggregateInterviewDimensions([
    { status: "DONE", dimensions: { clarity: 80, structure: 40 } },
    { status: "DONE", breakdown: { clarity: 60 } },
    { status: "PENDING", dimensions: { clarity: 0 } },
    { status: "FAILED" },
    null,
    { status: "DONE", dimensions: { clarity: "high", examples: NaN } },
  ]);
  assert.deepEqual(dims, { clarity: 70, structure: 40 });
  assert.deepEqual(R.aggregateInterviewDimensions([]), {});
  assert.deepEqual(R.aggregateInterviewDimensions(undefined), {});
  const i = R.interviewInsights({ clarity: 85, structure: 30, examples: 60 });
  assert.deepEqual(i.strengths.map((s) => s.name), ["clarity"]);
  assert.deepEqual(i.weaknesses.map((s) => s.name), ["structure"]);
});

const objective = (key, byTopic, extra = {}) => ({ key, status: "FINAL", maxMarks: 25, questions: 10, unanswered: 0, byTopic, bySubject: {}, ...extra });

test("recommendations name the topic and the evidence", () => {
  const recs = R.buildRecommendations({
    sections: [objective("APTITUDE", { Ratios: topic(2, 10, 2, 10), Percentages: topic(9, 10, 9, 10) })],
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].section, "APTITUDE");
  assert.equal(recs[0].area, "Ratios");
  assert.match(recs[0].reason, /2 of 10 correct \(20%\)/);
});

test("technical recommendations use the subject breakdown when it exists", () => {
  const recs = R.buildRecommendations({ sections: [objective("TECHNICAL", { Joins: topic(1, 10, 1, 10) }, { bySubject: { DBMS: topic(3, 10, 3, 10), OS: topic(9, 10, 9, 10) } })] });
  assert.deepEqual(recs.map((r) => r.area), ["DBMS"]);
});

test("many unanswered questions are reported as a time-management finding, few are not", () => {
  const many = R.buildRecommendations({ sections: [objective("APTITUDE", {}, { unanswered: 4 })] });
  assert.equal(many.length, 1);
  assert.equal(many[0].area, "Time management");
  assert.match(many[0].reason, /4 of 10/);
  assert.equal(R.buildRecommendations({ sections: [objective("APTITUDE", {}, { unanswered: 2 })] }).length, 0);
});

test("a section that is pending, or was never reached, produces no finding", () => {
  assert.deepEqual(R.buildRecommendations({ sections: [{ ...objective("APTITUDE", { Ratios: topic(0, 10, 0, 10) }), status: "PENDING" }] }), []);
  assert.deepEqual(R.buildRecommendations({ sections: [{ ...objective("APTITUDE", { Ratios: topic(0, 10, 0, 10) }), notReached: true }] }), []);
  assert.deepEqual(R.buildRecommendations({ sections: [] }), []);
  assert.deepEqual(R.buildRecommendations({}), []);
});

test("coding recommendations come from the judged problems", () => {
  const recs = R.buildRecommendations({
    sections: [{ key: "CODING", status: "FINAL", problems: 3, attempted: 2, compileFailures: 1, perProblem: [
      { id: "p1", status: "SOLVED", testsPassed: 5, testsTotal: 5 }, { id: "p2", status: "PARTIAL", testsPassed: 2, testsTotal: 5 }, { id: "p3", status: "NOT_ATTEMPTED" },
    ] }],
  });
  assert.equal(recs.some((r) => r.area === "Problem p2" && /2 of 5 test cases/.test(r.reason)), true);
  assert.equal(recs.some((r) => r.area === "Problem p1"), false, "a solved problem is not a weakness");
  assert.equal(recs.some((r) => r.area === "Problem p3"), false, "an unattempted problem is covered by Coverage");
  assert.equal(recs.some((r) => r.area === "Compilation"), true);
  assert.equal(recs.some((r) => r.area === "Coverage" && /1 of 3/.test(r.reason)), true);
});

test("interview recommendations come from the weak rubric dimensions and from skipped questions", () => {
  const recs = R.buildRecommendations({ sections: [{ key: "AI_INTERVIEW", status: "FINAL", questions: 5, skipped: 2 }], interviewDimensions: { structure: 35, clarity: 80 } });
  assert.equal(recs.some((r) => /Structure/.test(r.area) && /35/.test(r.reason)), true);
  assert.equal(recs.some((r) => r.area === "Clarity"), false);
  assert.equal(recs.some((r) => r.area === "Completeness" && /2 of 5/.test(r.reason)), true);
});

test("pending indicators say what is waiting and that the answers are saved", () => {
  const out = R.pendingIndicators([
    { key: "APTITUDE", status: "FINAL" },
    { key: "CODING", status: "PENDING", pendingItems: 2 },
    { key: "AI_INTERVIEW", status: "PENDING", pendingItems: 1, failedItems: 3 },
  ]);
  assert.deepEqual(out.map((o) => `${o.section}:${o.kind}`), ["CODING:JUDGE_PENDING", "AI_INTERVIEW:EVALUATION_PENDING", "AI_INTERVIEW:EVALUATION_FAILED"]);
  assert.ok(out.every((o) => /saved/.test(o.message)));
  assert.deepEqual(R.pendingIndicators([{ key: "APTITUDE", status: "FINAL" }]), []);
  assert.deepEqual(R.pendingIndicators(undefined), []);
});
