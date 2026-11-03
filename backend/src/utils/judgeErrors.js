// Answers shared by every route that runs a student's code. Before this, the lesson practice and project task routes turned a full judge queue, an unreachable judge and a
// malformed request body into the same generic 500 ("Execution failed" / "Submission failed"), which reads like a verdict on the student's code. The interview and question
// routes already distinguished them; this gives the learning routes the same behaviour.
"use strict";

const LANGUAGES = ["python", "javascript", "java", "c", "cpp", "sql"]; // the languages utils/judge.js can run
const MAX_CODE_CHARS = Number(process.env.JUDGE_MAX_CODE_CHARS || 100000);

// Returns a message when the body cannot be run at all, otherwise null. An empty program is valid (it just produces no output).
function codeBodyProblem(body) {
  const { language, code } = body || {};
  if (typeof code !== "string") return "code is required";
  if (code.length > MAX_CODE_CHARS) return `code is too long (the limit is ${MAX_CODE_CHARS} characters)`;
  if (typeof language !== "string" || !LANGUAGES.includes(language)) return "Unsupported language";
  return null;
}

// One response per kind of failure. `fallback` is the message for anything unexpected (a real server fault), which is also logged.
function sendJudgeError(res, err, fallback) {
  if (err && err.queueBusy) {
    return res.status(503).json({ error: "The code runner is busy right now. Your code is safe; please try again in a few seconds.", queueBusy: true });
  }
  if (err && (err.unreachable || err.name === "TimeoutError" || /judge service error/i.test(err.message || ""))) {
    console.error("[judge] unavailable:", err.message);
    return res.status(502).json({ error: "The code runner is unavailable right now. Your code is safe; please try again in a minute.", judgeUnavailable: true });
  }
  console.error(err);
  return res.status(500).json({ error: fallback });
}

module.exports = { codeBodyProblem, sendJudgeError, LANGUAGES, MAX_CODE_CHARS };
