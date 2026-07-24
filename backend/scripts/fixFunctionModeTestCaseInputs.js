/**
 * One-time (idempotent) fix for the exact defect auditFunctionModeTestCaseInputs.js flags: a
 * FUNCTION-mode test case whose `input` is N scalar values joined by spaces on a single line,
 * instead of one value per line (see functionHarness.js's own documented convention). Confirmed
 * live in production: 12 test cases across 3 Module 1 Coding Assessment questions ("Sum of Two
 * Integers", "Integer Division", "Largest of Three") and 1 Practice question, all blocking real
 * students mid-assessment with java.lang.NumberFormatException.
 *
 * Same detection rule as the audit script (all-scalar signature, 2+ params, single-line input
 * whose whitespace-split token count exactly equals the param count) — only fires on the one
 * shape that's mechanically unambiguous to correct; anything else is left untouched and logged.
 * Safe to run on every boot like migrateAcademicGroups.js: already-correct rows are no-ops.
 */
const prisma = require("../src/prisma");

function needsFix(functionSignature, input) {
  if (!functionSignature || !Array.isArray(functionSignature.params)) return null;
  const params = functionSignature.params;
  const allScalar = params.every((p) => !String(p.type || "").endsWith("[]"));
  if (!allScalar || params.length < 2) return null;
  const lines = (input ?? "").split("\n");
  if (lines.length === params.length) return null; // already correct
  const tokens = (input ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== params.length) return null; // ambiguous shape — never auto-fixed
  return tokens.join("\n");
}

async function fixQuestions() {
  const questions = await prisma.question.findMany({ where: { evaluationType: "FUNCTION" }, include: { testCases: true } });
  let fixed = 0;
  for (const q of questions) {
    for (const tc of q.testCases) {
      const corrected = needsFix(q.functionSignature, tc.input);
      if (corrected == null) continue;
      await prisma.testCase.update({ where: { id: tc.id }, data: { input: corrected } });
      console.log(`[fixFunctionModeTestCaseInputs] Question "${q.title || q.id}" testCase=${tc.id}: ${JSON.stringify(tc.input)} -> ${JSON.stringify(corrected)}`);
      fixed++;
    }
  }
  return fixed;
}

async function fixPracticeQuestions() {
  const rows = await prisma.practiceQuestion.findMany({ where: { evaluationType: "FUNCTION" } });
  let fixed = 0;
  for (const q of rows) {
    if (!Array.isArray(q.testCases)) continue;
    let changed = false;
    const next = q.testCases.map((tc) => {
      const corrected = needsFix(q.functionSignature, tc.input);
      if (corrected == null) return tc;
      changed = true;
      console.log(`[fixFunctionModeTestCaseInputs] PracticeQuestion "${q.title || q.id}": ${JSON.stringify(tc.input)} -> ${JSON.stringify(corrected)}`);
      return { ...tc, input: corrected };
    });
    if (changed) {
      await prisma.practiceQuestion.update({ where: { id: q.id }, data: { testCases: next } });
      fixed += next.filter((tc, i) => tc !== q.testCases[i]).length;
    }
  }
  return fixed;
}

async function fixInterviewQuestions() {
  const rows = await prisma.interviewQuestion.findMany({ where: { evaluationType: "FUNCTION" } });
  let fixed = 0;
  for (const q of rows) {
    if (!Array.isArray(q.testCases)) continue;
    let changed = false;
    const next = q.testCases.map((tc) => {
      const corrected = needsFix(q.functionSignature, tc.input);
      if (corrected == null) return tc;
      changed = true;
      console.log(`[fixFunctionModeTestCaseInputs] InterviewQuestion "${q.title || q.id}": ${JSON.stringify(tc.input)} -> ${JSON.stringify(corrected)}`);
      return { ...tc, input: corrected };
    });
    if (changed) {
      await prisma.interviewQuestion.update({ where: { id: q.id }, data: { testCases: next } });
      fixed += next.filter((tc, i) => tc !== q.testCases[i]).length;
    }
  }
  return fixed;
}

async function main() {
  const a = await fixQuestions();
  const b = await fixPracticeQuestions();
  const c = await fixInterviewQuestions();
  console.log(`[fixFunctionModeTestCaseInputs] Done. Fixed ${a} Question + ${b} PracticeQuestion + ${c} InterviewQuestion test case(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[fixFunctionModeTestCaseInputs] failed:", err);
  process.exit(1);
});
