const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isDuplicateQuestion, jaccardSimilarity } = require("../src/services/aiInterview/duplicateDetection");

test("an identical question is flagged as a duplicate", () => {
  const q = "Can you explain the difference between method overloading and method overriding in Java?";
  assert.equal(isDuplicateQuestion(q, [q]), true);
});

test("a near-restatement of a previous question is flagged as a duplicate", () => {
  const previous = ["What is the difference between method overloading and method overriding?"];
  const restated = "Could you explain the difference between overloading and overriding a method?";
  assert.equal(isDuplicateQuestion(restated, previous), true);
});

test("a genuinely different question sharing some domain vocabulary is NOT flagged", () => {
  const previous = ["What is polymorphism in Java?"];
  const different = "Suppose you have a parent reference pointing to a child object — which overridden method executes at runtime and why?";
  assert.equal(isDuplicateQuestion(different, previous), false);
});

test("an empty previous-question list never flags a duplicate", () => {
  assert.equal(isDuplicateQuestion("Anything at all", []), false);
});

test("jaccardSimilarity of two completely unrelated sentences is low", () => {
  const sim = jaccardSimilarity("Explain database normalization and third normal form.", "How would you design a rate limiter for an API?");
  assert.ok(sim < 0.3, `expected low similarity, got ${sim}`);
});

test("jaccardSimilarity of identical text is 1", () => {
  assert.equal(jaccardSimilarity("Explain inheritance in Java", "Explain inheritance in Java"), 1);
});
