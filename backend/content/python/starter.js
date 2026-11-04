// The code a student starts from in an assessment problem that has no scaffold of its own. Without it the editor falls back to the platform's generic line ("Read input via input(), print your
// answer"), which is wrong for a program that takes no input. REPORTED 2026-11-04 on "Three-line greeting" (Module 1 assessment). Pure, so the seed, the live repair script and the tests share it.
"use strict";

const takesInput = (testCases) => (testCases || []).some((c) => String(c.input ?? "").trim() !== "");

function starterFor(question) {
  if (question.starter && String(question.starter).trim()) return question.starter;
  return takesInput(question.testCases)
    ? "# Read the input with input(), then print your answer with print().\n"
    : "# This problem has no input. Print the result with print().\n";
}

module.exports = { starterFor, takesInput };
