// One-off: bypass generateJson()'s parse/validate to see the RAW Gemini response for the CODING
// question-bank generation prompt -- finishReason, truncated flag, full text -- since generateJson
// only reports "could not be validated," not why.
const geminiProvider = require("../src/services/ai/geminiProvider");

const BTL3 = "BTL 3 — Apply: the question must require using a known concept or procedure to solve a new, concrete problem or scenario — not just describing the concept.";

async function main() {
  const system = "You write programming exam questions for a computer-science education platform. Return only JSON matching the requested schema — no markdown formatting inside JSON string values.";
  const prompt = `Write one MEDIUM-difficulty CODING question about "TCS Coding" (topic: Arrays). The student writes a complete stdin/stdout program in any language — no function-signature harness.\nCognitive level requirement: ${BTL3}\nReturn JSON exactly shaped: {"title": string, "description": string (full problem statement including input/output format and constraints), "explanation": string (brief solution approach), "testCases": [{"input": string, "expected": string, "isHidden": boolean}], "referenceSolution": string (a complete, correct Python 3 program reading from stdin and writing to stdout that solves the problem exactly as stated)}.\nProvide exactly 7 testCases: 2 with isHidden=false (visible samples shown to students) and 5 with isHidden=true (used only for grading — cover a basic case, a small/boundary case, a typical case, an edge case, and a large/stress case within the stated constraints).`;

  const result = await geminiProvider.generateContent({ system, prompt, maxTokens: 4096, temperature: 0.6, jsonMode: true });
  console.log("finishReason:", result.finishReason);
  console.log("truncated:", result.truncated);
  console.log("usage:", JSON.stringify(result.usage));
  console.log("text length:", result.text.length);
  console.log("--- RAW TEXT (first 2000 chars) ---");
  console.log(result.text.slice(0, 2000));
  console.log("--- RAW TEXT (last 1000 chars) ---");
  console.log(result.text.slice(-1000));
  console.log("--- JSON.parse attempt ---");
  try {
    const parsed = JSON.parse(result.text);
    console.log("PARSED OK. Keys:", Object.keys(parsed));
    console.log("title:", parsed.title);
    console.log("description present:", !!parsed.description);
    console.log("testCases:", Array.isArray(parsed.testCases) ? parsed.testCases.length : "NOT ARRAY");
  } catch (e) {
    console.log("PARSE FAILED:", e.message);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("SCRIPT FAILED:", e); process.exit(1); });
