// Regression coverage for utils/textSimilarity.js — the deterministic (no AI call) near-duplicate
// detector added to aiQuestions.js's generation-time duplicate check after a real batch produced
// two Easy MCQs both titled "Java File Extension" whose body wording differed just enough that a
// plain exact-text match missed the second one. Run with `npm test`.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { jaccardSimilarity, checkNearDuplicate, DEFAULT_THRESHOLD } = require("../src/utils/textSimilarity");

describe("jaccardSimilarity", () => {
  test("identical text is a perfect match", () => {
    assert.equal(jaccardSimilarity("What is a Java ArrayList?", "What is a Java ArrayList?"), 1);
  });

  test("completely unrelated text scores low", () => {
    const sim = jaccardSimilarity(
      "Explain the difference between TCP and UDP in computer networks.",
      "Write a SQL query to find the second highest salary in an Employee table."
    );
    assert.ok(sim < 0.15, `expected low similarity, got ${sim}`);
  });

  test("reworded-but-same-question scores high (the real observed gap)", () => {
    const a = "A developer needs to store student PRNs as keys and retrieve student details in constant average-time lookup. Which Java collection is most appropriate?";
    const b = "Which Java collection should a developer use to store student PRNs as keys and retrieve the corresponding student details with constant average-time lookup?";
    assert.ok(jaccardSimilarity(a, b) >= DEFAULT_THRESHOLD, `expected reworded duplicate to cross the threshold, got ${jaccardSimilarity(a, b)}`);
  });

  test("empty or missing text never divides by zero, never crashes", () => {
    assert.equal(jaccardSimilarity("", "something"), 0);
    assert.equal(jaccardSimilarity(null, undefined), 0);
    assert.equal(jaccardSimilarity("the a of", "is are was"), 0); // both sides are pure stopwords
  });

  test("shared common CS vocabulary alone doesn't false-positive two different questions", () => {
    // Both mention "Java," "class," and "method" -- genuinely different questions, must stay low.
    const a = "In Java, which keyword is used to prevent a class from being subclassed?";
    const b = "In Java, what is the purpose of the finalize() method in the Object class?";
    const sim = jaccardSimilarity(a, b);
    assert.ok(sim < DEFAULT_THRESHOLD, `expected these to stay below the duplicate threshold, got ${sim}`);
  });
});

describe("checkNearDuplicate", () => {
  test("identical titles are flagged even if the body text differs somewhat -- the exact observed bug", () => {
    const a = { title: "Java File Extension", description: "What is the standard file extension for a compiled Java class file?" };
    const b = { title: "Java File Extension", description: "Which file extension does the Java compiler produce for bytecode output?" };
    const result = checkNearDuplicate(a, b);
    assert.equal(result.isMatch, true);
    assert.equal(result.reason, "identical title");
  });

  test("title match is case- and whitespace-insensitive", () => {
    const a = { title: "  java FILE Extension  ", description: "x" };
    const b = { title: "Java File Extension", description: "y" };
    assert.equal(checkNearDuplicate(a, b).isMatch, true);
  });

  test("falls back to body similarity when titles differ", () => {
    const a = { title: "Question 1", description: "A developer needs to store student PRNs as keys and retrieve student details in constant average-time lookup. Which Java collection is most appropriate?" };
    const b = { title: "Question 2", description: "Which Java collection should a developer use to store student PRNs as keys and retrieve the corresponding student details with constant average-time lookup?" };
    const result = checkNearDuplicate(a, b);
    assert.equal(result.isMatch, true);
    assert.match(result.reason, /% word overlap/);
  });

  test("genuinely different questions are not flagged", () => {
    const a = { title: "TCP vs UDP", description: "Explain the difference between TCP and UDP in computer networks." };
    const b = { title: "SQL Salary Query", description: "Write a SQL query to find the second highest salary in an Employee table." };
    const result = checkNearDuplicate(a, b);
    assert.equal(result.isMatch, false);
    assert.equal(result.reason, null);
  });

  test("a custom threshold is respected", () => {
    const a = { title: "Q1", description: "alpha beta gamma delta epsilon" };
    const b = { title: "Q2", description: "alpha beta gamma zeta eta" };
    // 3 shared (alpha, beta, gamma) / 7 union = ~0.43 -- below the default 0.6, above a loosened 0.4
    assert.equal(checkNearDuplicate(a, b).isMatch, false);
    assert.equal(checkNearDuplicate(a, b, { threshold: 0.4 }).isMatch, true);
  });
});
