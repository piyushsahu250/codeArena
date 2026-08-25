// One-off: real end-to-end verification that GEMINI_API_KEY + the configured model actually work
// against the live Gemini API — a plain text call, a JSON-structured call, and the domain-level
// evaluateInterview() validator, so a bad model name or a schema mismatch surfaces here rather
// than in a student's first real AI request.
const aiService = require("../src/services/ai/aiService");

async function main() {
  console.log("isConfigured:", aiService.isConfigured());

  const text = await aiService.generateText({
    feature: "verify_connectivity",
    prompt: "Reply with exactly the word: pong",
    maxTokens: 20,
    injectionGuard: false,
  });
  console.log("generateText result:", JSON.stringify(text));

  const json = await aiService.generateJson({
    feature: "verify_connectivity",
    prompt: 'Return exactly this JSON: {"ok": true, "n": 2}',
    maxTokens: 50,
    injectionGuard: false,
    validate: (v) => (v?.ok !== true ? "missing ok:true" : null),
  });
  console.log("generateJson result:", JSON.stringify(json));

  const evaluation = await aiService.evaluateInterview({
    transcript: "Q: What is a variable?\nA: A named storage location for a value.\nScore: 80/100",
    category: "TECHNICAL",
  });
  console.log("evaluateInterview keys:", Object.keys(evaluation).join(", "));
  console.log("evaluateInterview sample:", JSON.stringify(evaluation).slice(0, 300));
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
