// One-off: reproduce the "AI service is temporarily unavailable" error a staff member hit
// generating a CODING question (Subject: "TCS Coding", Topic: "Arrays", target BTL set) via
// POST /ai/questions/generate-question. Calls aiService.generateJson directly with the exact same
// shape that route uses for CODING, measuring real timing, to determine whether this is a one-off
// transient blip or a systematic timeout for this generation type.
const aiService = require("../src/services/ai/aiService");

const BTL_TASK_DEFINITIONS = {
  1: "BTL 1 — Remember: the question must be answerable purely by recalling a stated fact, term, or definition, with no reasoning or application required.",
  2: "BTL 2 — Understand: the question must require explaining, summarizing, or restating a concept in the student's own terms, not just naming it.",
  3: "BTL 3 — Apply: the question must require using a known concept or procedure to solve a new, concrete problem or scenario — not just describing the concept.",
};

async function attempt(n) {
  const start = Date.now();
  try {
    const draft = await aiService.generateJson({
      feature: aiService.FEATURES.QUESTION_BANK_GENERATE, userId: "diagnostic-script", instituteId: null,
      system: "You write programming exam questions for a computer-science education platform. Return only JSON matching the requested schema — no markdown formatting inside JSON string values.",
      prompt: `Write one MEDIUM-difficulty CODING question about "TCS Coding" (topic: Arrays). The student writes a complete stdin/stdout program in any language — no function-signature harness.\nCognitive level requirement: ${BTL_TASK_DEFINITIONS[3]}\nReturn JSON exactly shaped: {"title": string, "description": string (full problem statement including input/output format and constraints), "explanation": string (brief solution approach), "testCases": [{"input": string, "expected": string, "isHidden": boolean}], "referenceSolution": string (a complete, correct Python 3 program reading from stdin and writing to stdout that solves the problem exactly as stated)}.\nProvide exactly 7 testCases: 2 with isHidden=false (visible samples shown to students) and 5 with isHidden=true (used only for grading — cover a basic case, a small/boundary case, a typical case, an edge case, and a large/stress case within the stated constraints).`,
      maxTokens: 4096,
      injectionGuard: false,
      validate: (v) => (!v?.title || !v?.description || !Array.isArray(v?.testCases)) ? "missing title/description/testCases" : null,
    });
    const ms = Date.now() - start;
    console.log(`Attempt ${n}: SUCCESS in ${ms}ms — title="${draft.title}", testCases=${draft.testCases.length}`);
    return true;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`Attempt ${n}: FAILED after ${ms}ms — timedOut=${!!err.timedOut} status=${err.status} message="${err.message}"`);
    return false;
  }
}

async function main() {
  console.log("isConfigured:", aiService.isConfigured());
  for (let i = 1; i <= 3; i++) {
    await attempt(i);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("SCRIPT FAILED:", e); process.exit(1); });
