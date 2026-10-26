// REGRESSION (2026-10 audit, the 2026-10-26 Coding Test): two function questions were saved with LeetCode-style test cases ("[7,1,5,3,6,4]", "[1,6,8,10,15,18]"). The generated driver reads one
// line per parameter with array values separated by spaces, so it crashed parsing every input: no solution could pass a hidden case, and the judge reported it as the student's runtime error /
// wrong answer. These tests pin the three fixes: the format check, the authoring-time refusal, and the judge reporting a setup problem instead of a wrong answer.
const test = require("node:test");
const assert = require("node:assert/strict");
const { functionCaseProblems, resolveCodingFields } = require("../src/utils/functionHarness");
const { judgeSubmission } = require("../src/utils/judge");
const { ServiceError } = require("../src/utils/serviceError");

const STOCK = { methodName: "maxProfit", returnType: "int", params: [{ name: "prices", type: "int[]" }] };
const MERGE = { methodName: "merge", returnType: "int[]", params: [{ name: "intervals", type: "int[]" }] };
const C = (input, expected, isHidden = true) => ({ input, expected, isHidden });

test("the exact cases that failed the exam are flagged, and the message says how to write arrays", () => {
  const p = functionCaseProblems(STOCK, [C("[7,1,5,3,6,4]", "5", false), C("[7,6,4,3,1]", "0")]);
  assert.equal(p.length, 2);
  assert.match(p[0], /Test case 1 \(sample\): line 1 \(parameter "prices", int\[\]\) is not a list of int values; arrays are written as the values separated by single spaces/);
  const m = functionCaseProblems(MERGE, [C("1 3 2 6", "[1, 6]")]);
  assert.equal(m.length, 1);
  assert.match(m[0], /expected output \(int\[\]\) is not a list of int values/);
});

test("cases in the line format the driver reads are accepted", () => {
  assert.deepEqual(functionCaseProblems(STOCK, [C("7 1 5 3 6 4", "5", false), C("1", "0"), C("10000 1", "0")]), []);
  assert.deepEqual(functionCaseProblems(MERGE, [C("1 3 2 6 8 10 15 18", "1 6 8 10 15 18"), C("5 7", "5 7"), C("1 4 0 0", "0 0 1 4")]), []);
  assert.deepEqual(functionCaseProblems(STOCK, [C("-3 4 -1", "7")]), [], "negative numbers are fine");
  assert.deepEqual(functionCaseProblems({ methodName: "f", returnType: "int[]", params: [{ name: "a", type: "int[]" }] }, [C("", "")]), [], "an empty array is an empty line");
});

test("every parameter type is checked with the rules its driver parses with", () => {
  const sig = { methodName: "f", returnType: "boolean", params: [{ name: "n", type: "int" }, { name: "x", type: "double" }, { name: "ok", type: "boolean" }, { name: "s", type: "string" }, { name: "w", type: "string[]" }] };
  assert.deepEqual(functionCaseProblems(sig, [C("5\n2.5\ntrue\nhello [world], again\na b c", "false")]), [], "strings are taken as they are, even with brackets");
  assert.equal(functionCaseProblems(sig, [C("five\n2.5\ntrue\nhi\na", "true")]).length, 1, "an int that is not a number");
  assert.equal(functionCaseProblems(sig, [C("5\nx\ntrue\nhi\na", "true")]).length, 1, "a double that is not a number");
  assert.equal(functionCaseProblems(sig, [C("5\n2.5\nyes\nhi\na", "true")]).length, 1, "a boolean that is not true/false");
  assert.equal(functionCaseProblems(sig, [C("5\n2.5\ntrue\nhi\na", "maybe")]).length, 1, "the expected boolean is checked too");
  assert.equal(functionCaseProblems(sig, [C("1e3\n2.5\nTRUE\nhi\na", "True")]).length, 1, "1e3 is not an int, but TRUE and True are fine for booleans");
});

test("missing and extra input lines", () => {
  const two = { methodName: "f", returnType: "int", params: [{ name: "a", type: "int" }, { name: "b", type: "int" }] };
  assert.equal(functionCaseProblems(two, [C("2", "2")]).length, 1, "a missing int line is reported");
  assert.equal(functionCaseProblems(two, [C("2 3", "5")]).length, 1, "'2 3' on one line is the old mistake (one line per parameter)");
  assert.deepEqual(functionCaseProblems(two, [C("2\n3", "5"), C("2\n3\n", "5"), C("2\r\n3", "5")]), [], "a trailing newline and Windows line endings are fine");
  assert.equal(functionCaseProblems(two, [C("2\n3\n4", "5")]).length, 1, "an extra non-empty line is reported");
  const tail = { methodName: "f", returnType: "int", params: [{ name: "n", type: "int" }, { name: "a", type: "int[]" }] };
  assert.deepEqual(functionCaseProblems(tail, [C("5", "0")]), [], "a missing last array line is an empty array, as the driver treats it");
});

test("authoring refuses cases that do not match the signature; other modes and calls without cases are unchanged", () => {
  assert.throws(() => resolveCodingFields({ evaluationType: "FUNCTION", functionSignature: STOCK, testCases: [C("[7,1,5]", "5")] }), (e) => e instanceof ServiceError && e.status === 400 && /no solution could pass them/.test(e.message));
  const ok = resolveCodingFields({ evaluationType: "FUNCTION", functionSignature: STOCK, testCases: [C("7 1 5", "5")] });
  assert.equal(ok.evaluationType, "FUNCTION");
  assert.ok(ok.starterCodeByLanguage.python);
  assert.equal(resolveCodingFields({ evaluationType: "STDIO", testCases: [C("[7,1,5]", "5")] }).evaluationType, "STDIO", "a standard-input question may use any format");
  assert.equal(resolveCodingFields({ evaluationType: "FUNCTION", functionSignature: STOCK }).evaluationType, "FUNCTION", "callers that pass no cases (other modules) are unchanged");
});

test("the judge reports a setup problem, not a wrong answer, and runs nothing", async () => {
  const r = await judgeSubmission({ language: "python", code: "class Solution:\n    def maxProfit(self, prices):\n        return 0\n", testCases: [C("[7,1,5,3,6,4]", "5"), C("[7,6,4,3,1]", "0")], evaluationType: "FUNCTION", functionSignature: STOCK });
  assert.equal(r.verdict, "JUDGE_ERROR");
  assert.equal(r.passedCases, 0);
  assert.equal(r.totalCases, 2);
  assert.equal(r.errorSummary.type, "Question setup error");
  assert.match(r.errorSummary.message, /not a problem with your code/);
  assert.ok(!JSON.stringify(r).includes("7,1,5,3,6,4"), "the message must not leak a test case");
});
