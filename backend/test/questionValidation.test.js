// Regression coverage for utils/questionValidation.js — the single Question Completeness Audit
// engine (GET /admin/question-audit + the VERIFIED-status gate). Added so the three real bugs
// fixed this session can never silently regress:
//   1. whitespace-only text passing as "present" (everything but title used a bare `!value`)
//   2. SQL questions being entirely invisible to the audit (it only ever queried "CODING")
//   3. MCQ/TRUE_FALSE/MULTISELECT having no completeness check anywhere
// Run with `npm test` (plain node:test, no extra dependency needed).
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  isBlank,
  auditCodingCompleteness,
  auditSqlCompleteness,
  auditChoiceCompleteness,
  auditQuestionCompleteness,
  validateQuestionForVerification,
} = require("../src/utils/questionValidation");

const twoVisibleFiveHidden = [
  { isHidden: false }, { isHidden: false },
  { isHidden: true }, { isHidden: true }, { isHidden: true }, { isHidden: true }, { isHidden: true },
];

function completeCodingQuestion(overrides = {}) {
  return {
    title: "Reverse an array",
    description: "Read N integers and print them reversed.",
    inputFormat: "First line N, second line N integers.",
    outputFormat: "The N integers reversed.",
    constraints: "1 <= N <= 1000",
    tags: ["Arrays"],
    starterCode: "// starter",
    evaluationType: "STDIO",
    ...overrides,
  };
}

describe("isBlank", () => {
  test("null/undefined/empty string are blank", () => {
    assert.equal(isBlank(null), true);
    assert.equal(isBlank(undefined), true);
    assert.equal(isBlank(""), true);
  });

  test("whitespace-only string is blank — the actual bug this closes", () => {
    assert.equal(isBlank("   "), true);
    assert.equal(isBlank("\n\t "), true);
  });

  test("real content is not blank", () => {
    assert.equal(isBlank("x"), false);
    assert.equal(isBlank("  x  "), false);
  });
});

describe("auditCodingCompleteness", () => {
  test("a fully-filled-in question has nothing missing", () => {
    const missing = auditCodingCompleteness(completeCodingQuestion(), twoVisibleFiveHidden);
    assert.deepEqual(missing, []);
  });

  test("flags a whitespace-only description as missing, not present", () => {
    const missing = auditCodingCompleteness(completeCodingQuestion({ description: "   " }), twoVisibleFiveHidden);
    assert.ok(missing.includes("description"));
  });

  test("flags whitespace-only inputFormat/outputFormat/constraints", () => {
    const missing = auditCodingCompleteness(
      completeCodingQuestion({ inputFormat: " ", outputFormat: "\t", constraints: "" }),
      twoVisibleFiveHidden
    );
    assert.ok(missing.includes("inputFormat"));
    assert.ok(missing.includes("outputFormat"));
    assert.ok(missing.includes("constraints"));
  });

  test("flags too few hidden test cases with the actual counts", () => {
    const missing = auditCodingCompleteness(completeCodingQuestion(), [{ isHidden: false }, { isHidden: false }, { isHidden: true }]);
    assert.ok(missing.some((m) => m.includes("hidden test cases") && m.includes("has 1") && m.includes("needs 5")));
  });

  test("FUNCTION-mode question missing a signature is flagged", () => {
    const missing = auditCodingCompleteness(
      completeCodingQuestion({ evaluationType: "FUNCTION", functionSignature: null }),
      twoVisibleFiveHidden
    );
    assert.ok(missing.includes("function signature"));
  });

  test("starterCodeByLanguage with at least one language counts as having starter code", () => {
    const missing = auditCodingCompleteness(
      completeCodingQuestion({ starterCode: null, starterCodeByLanguage: { java: "public class Main {}" } }),
      twoVisibleFiveHidden
    );
    assert.ok(!missing.includes("starter code"));
  });

  test("falls back to `prompt` for description when `description` itself is absent — PracticeQuestion/InterviewQuestion shape", () => {
    const q = completeCodingQuestion();
    delete q.description;
    q.prompt = "Read N integers and print them reversed.";
    const missing = auditCodingCompleteness(q, twoVisibleFiveHidden);
    assert.ok(!missing.includes("description"));
  });
});

describe("auditSqlCompleteness", () => {
  test("previously entirely unscanned by the audit — now genuinely checked", () => {
    const missing = auditSqlCompleteness({ title: "", description: "", sqlSchema: "" }, []);
    assert.ok(missing.includes("title"));
    assert.ok(missing.includes("SQL schema (table setup / seed data)"));
    assert.ok(missing.some((m) => m.includes("visible test cases")));
    assert.ok(missing.some((m) => m.includes("hidden test cases")));
  });

  test("a complete SQL question has nothing missing", () => {
    const missing = auditSqlCompleteness(
      { title: "Top earners", description: "Find the top 3 earners.", sqlSchema: "CREATE TABLE employees (...)" },
      [{ isHidden: false }, { isHidden: true }, { isHidden: true }, { isHidden: true }, { isHidden: true }, { isHidden: true }]
    );
    assert.deepEqual(missing, []);
  });
});

describe("auditChoiceCompleteness — MCQ/TRUE_FALSE/MULTISELECT/PracticeQuestion/InterviewQuestion-Aptitude", () => {
  test("a complete MCQ (Question-shaped: correctAnswer as an array) has nothing missing", () => {
    const missing = auditChoiceCompleteness({
      description: "What is 2 + 2?",
      questionType: "MCQ",
      options: ["3", "4", "5"],
      correctAnswer: [1],
    });
    assert.deepEqual(missing, []);
  });

  test("normalizes a PracticeQuestion/InterviewQuestion-shaped bare-number correctAnswer — the exact misdiagnosis this generalization exists to avoid", () => {
    const missing = auditChoiceCompleteness({
      prompt: "What is 2 + 2?",
      questionType: "MCQ",
      options: ["3", "4", "5"],
      correctAnswer: 1, // a single index, NOT an array — PracticeQuestion/InterviewQuestion's real shape
    });
    assert.ok(!missing.includes("correct answer"));
  });

  test("flags fewer than 2 non-blank options", () => {
    const missing = auditChoiceCompleteness({ description: "Q", options: ["only one", "  "], correctAnswer: [0] });
    assert.ok(missing.some((m) => m.startsWith("options (has 1")));
  });

  test("flags a byte-for-byte duplicate option", () => {
    const missing = auditChoiceCompleteness({ description: "Q", options: ["Same", "Same", "Different"], correctAnswer: [0] });
    assert.ok(missing.includes("duplicate options"));
  });

  test("does NOT flag a case-different option as duplicate — real questions rely on this distinction", () => {
    const missing = auditChoiceCompleteness({ description: "Q", options: ["HELLO", "hello", "Goodbye"], correctAnswer: [0] });
    assert.ok(!missing.includes("duplicate options"));
  });

  test("flags a missing correct answer", () => {
    const missing = auditChoiceCompleteness({ description: "Q", options: ["A", "B"], correctAnswer: [] });
    assert.ok(missing.includes("correct answer"));
  });

  test("flags a correct answer pointing at an option that doesn't exist", () => {
    const missing = auditChoiceCompleteness({ description: "Q", options: ["A", "B"], correctAnswer: [5] });
    assert.ok(missing.includes("correct answer references an option that doesn't exist"));
  });

  test("flags multiple correct answers on a non-MULTISELECT question", () => {
    const missing = auditChoiceCompleteness({ description: "Q", questionType: "MCQ", options: ["A", "B", "C"], correctAnswer: [0, 1] });
    assert.ok(missing.includes("only one correct answer is allowed for this question type"));
  });

  test("allows multiple correct answers on a MULTISELECT question", () => {
    const missing = auditChoiceCompleteness({ description: "Q", questionType: "MULTISELECT", options: ["A", "B", "C"], correctAnswer: [0, 1] });
    assert.ok(!missing.includes("only one correct answer is allowed for this question type"));
  });
});

describe("auditQuestionCompleteness — dispatcher", () => {
  test("routes CODING/SQL/CHOICE to the right per-type check", () => {
    assert.deepEqual(auditQuestionCompleteness(completeCodingQuestion(), twoVisibleFiveHidden, "CODING"), []);
    assert.ok(auditQuestionCompleteness({ title: "", description: "", sqlSchema: "" }, [], "SQL").length > 0);
    assert.ok(auditQuestionCompleteness({ description: "", options: [], correctAnswer: [] }, null, "CHOICE").length > 0);
  });

  test("an out-of-scope kind (e.g. a free-text interview category) returns no findings rather than inventing rules for it", () => {
    assert.deepEqual(auditQuestionCompleteness({ prompt: "Tell me about yourself" }, null, null), []);
  });
});

describe("validateQuestionForVerification — the VERIFIED-status save-time gate", () => {
  test("shares the exact same MIN_CASES thresholds as the audit — can't silently drift apart", () => {
    const reasons = validateQuestionForVerification({ questionType: "CODING" }, []);
    assert.ok(reasons.some((r) => r.includes("2 visible")));
    assert.ok(reasons.some((r) => r.includes("5 hidden")));
  });

  test("a structurally complete CODING question passes with no reasons", () => {
    const reasons = validateQuestionForVerification({ questionType: "CODING", evaluationType: "STDIO" }, twoVisibleFiveHidden);
    assert.deepEqual(reasons, []);
  });

  test("SQL missing its schema is rejected", () => {
    const reasons = validateQuestionForVerification({ questionType: "SQL", sqlSchema: "" }, []);
    assert.ok(reasons.some((r) => r.includes("SQL schema")));
  });
});
