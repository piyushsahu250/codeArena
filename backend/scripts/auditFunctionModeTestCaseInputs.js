/**
 * Read-only audit: finds FUNCTION-mode test cases whose `input` doesn't match the documented
 * one-line-per-parameter format (see functionHarness.js's top-of-file comment) — specifically the
 * shape that broke live: all-scalar signature, but `input` is a single line with N space-separated
 * values instead of N newline-separated lines. Never writes anything; only logs findings, so it's
 * safe to run against production as many times as needed while scoping the real fix.
 */
const prisma = require("../src/prisma");

function auditTestCases(label, id, title, functionSignature, testCases) {
  if (!functionSignature || !Array.isArray(functionSignature.params)) return [];
  const params = functionSignature.params;
  const allScalar = params.every((p) => !String(p.type || "").endsWith("[]"));
  if (!allScalar || params.length < 2) return []; // only this exact, mechanically-safe-to-detect shape
  const findings = [];
  (testCases || []).forEach((tc, idx) => {
    const input = tc.input ?? "";
    const lines = input.split("\n");
    if (lines.length === params.length) return; // already correct
    const tokens = input.trim().split(/\s+/).filter(Boolean);
    // For the relational Question model each test case has a real .id; PracticeQuestion/
    // InterviewQuestion store testCases as a plain JSON array on the row itself, so the array
    // index is the only stable locator for those (used only for logging here, read-only).
    const testCaseRef = tc.id ?? `index:${idx}`;
    if (tokens.length === params.length) {
      findings.push({ label, id, title, testCaseRef, hidden: !!tc.isHidden, currentInput: input, suggestedInput: tokens.join("\n") });
    } else {
      findings.push({ label, id, title, testCaseRef, hidden: !!tc.isHidden, currentInput: input, suggestedInput: null, note: `unclear shape: ${lines.length} lines, ${tokens.length} tokens, ${params.length} params` });
    }
  });
  return findings;
}

async function main() {
  const all = [];

  const questions = await prisma.question.findMany({
    where: { evaluationType: "FUNCTION" },
    include: { testCases: true },
  });
  for (const q of questions) {
    all.push(...auditTestCases("Question", q.id, q.title || q.description?.slice(0, 60), q.functionSignature, q.testCases));
  }

  // testCases is a plain Json[] field on these two models (not a relation) — no include needed.
  const practiceQuestions = await prisma.practiceQuestion.findMany({ where: { evaluationType: "FUNCTION" } });
  for (const q of practiceQuestions) {
    all.push(...auditTestCases("PracticeQuestion", q.id, q.title || q.prompt?.slice(0, 60), q.functionSignature, q.testCases));
  }

  const interviewQuestions = await prisma.interviewQuestion.findMany({ where: { evaluationType: "FUNCTION" } });
  for (const q of interviewQuestions) {
    all.push(...auditTestCases("InterviewQuestion", q.id, q.title || q.prompt?.slice(0, 60), q.functionSignature, q.testCases));
  }

  console.log(`[auditFunctionModeTestCaseInputs] Scanned ${questions.length} Question + ${practiceQuestions.length} PracticeQuestion + ${interviewQuestions.length} InterviewQuestion FUNCTION-mode rows.`);
  console.log(`[auditFunctionModeTestCaseInputs] Found ${all.length} suspicious test case(s):`);
  for (const f of all) {
    console.log(`  [${f.label} ${f.id}] "${f.title}" testCase=${f.testCaseRef} hidden=${f.hidden} current=${JSON.stringify(f.currentInput)} ${f.suggestedInput ? `-> suggested=${JSON.stringify(f.suggestedInput)}` : `(${f.note})`}`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[auditFunctionModeTestCaseInputs] failed:", err);
  process.exit(1);
});
