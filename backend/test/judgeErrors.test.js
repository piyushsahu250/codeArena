// REGRESSION: the lesson practice and project task routes answered a full judge queue, an unreachable judge and a malformed body with the same generic 500
// ("Execution failed" / "Submission failed"), which reads like a verdict on the student's code. A class practising at once fills the queue, so this was reachable.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { codeBodyProblem, sendJudgeError, MAX_CODE_CHARS } = require("../src/utils/judgeErrors");

function fakeRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const quiet = (fn) => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

test("a request body that cannot be run is rejected before anything is executed", () => {
  assert.equal(codeBodyProblem({ language: "python", code: "print(1)" }), null);
  assert.equal(codeBodyProblem({ language: "python", code: "" }), null, "an empty program is valid, it just prints nothing");
  assert.match(codeBodyProblem({ language: "python" }), /code is required/);
  assert.match(codeBodyProblem({ language: "python", code: 42 }), /code is required/);
  assert.match(codeBodyProblem({ language: "python", code: null }), /code is required/);
  assert.match(codeBodyProblem({}), /code is required/);
  assert.match(codeBodyProblem(undefined), /code is required/);
  assert.match(codeBodyProblem({ language: "python", code: "x".repeat(MAX_CODE_CHARS + 1) }), /too long/);
  assert.equal(codeBodyProblem({ language: "python", code: "x".repeat(MAX_CODE_CHARS) }), null, "exactly the limit is allowed");
  assert.match(codeBodyProblem({ language: "cobol", code: "x" }), /Unsupported language/);
  assert.match(codeBodyProblem({ code: "x" }), /Unsupported language/);
  assert.match(codeBodyProblem({ language: ["python"], code: "x" }), /Unsupported language/);
  for (const language of ["python", "javascript", "java", "c", "cpp", "sql"]) assert.equal(codeBodyProblem({ language, code: "x" }), null, language);
});

test("a full judge queue is a 503 that tells the student their code is safe", () => {
  const res = fakeRes();
  sendJudgeError(res, Object.assign(new Error("Judge queue is full"), { queueBusy: true }), "Execution failed");
  assert.equal(res.code, 503);
  assert.equal(res.body.queueBusy, true);
  assert.match(res.body.error, /busy/i);
  assert.match(res.body.error, /code is safe/i);
});

test("an unreachable or timed-out judge is a 502, not a verdict on the code", () => {
  for (const err of [Object.assign(new Error("judge service unreachable (ECONNREFUSED)"), { unreachable: true }), Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), new Error("judge service error 500")]) {
    const res = fakeRes();
    quiet(() => sendJudgeError(res, err, "Execution failed"));
    assert.equal(res.code, 502, err.message);
    assert.equal(res.body.judgeUnavailable, true);
    assert.match(res.body.error, /unavailable/i);
  }
});

test("an unexpected fault stays a 500 with the route's own message and is logged", () => {
  const logged = [];
  const e = console.error; console.error = (...a) => logged.push(a);
  try {
    const res = fakeRes();
    sendJudgeError(res, new TypeError("boom"), "Submission failed");
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { error: "Submission failed" });
    assert.equal(logged.length, 1, "the real error is logged for the operator, never sent to the student");
    assert.ok(!JSON.stringify(res.body).includes("boom"));
  } finally { console.error = e; }
});

test("every route that runs a student's code through the learning and module-coding routers uses the shared handling", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "routes", f), "utf8");
  const learning = read("learning.js"), moduleCoding = read("moduleCoding.js");
  for (const [name, src] of [["learning.js", learning], ["moduleCoding.js", moduleCoding]]) {
    assert.ok(!/res\.status\(500\)\.json\(\{ error: "(Execution|Submission) failed" \}\)/.test(src), `${name} still has a bare 500 for a judge failure`);
  }
  assert.equal((learning.match(/codeBodyProblem\(req\.body\)/g) || []).length, 4, "practice run/submit and project task run/submit validate the body");
  assert.equal((learning.match(/sendJudgeError\(res, err, "(Execution|Submission) failed"\)/g) || []).length, 4);
  assert.equal((moduleCoding.match(/sendJudgeError\(res, err, "(Execution|Submission) failed"\)/g) || []).length, 2);
});
