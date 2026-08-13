const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const { askClaudeJson, isConfigured } = require("../utils/aiClient");

const router = express.Router();

// Scoped to the four QuestionType values this platform can actually grade (CODING via the judge,
// MCQ/TRUE_FALSE/MULTISELECT via stored correctAnswer indices — see schema.prisma's QuestionType
// enum and routes/questions.js). Deliberately does NOT offer SQL, fill-in-the-blank, or free-text
// "subjective" generation — there is no SQL execution engine and no subjective-answer question
// type or grading path anywhere on this platform, so generating those would produce content this
// codebase has no way to actually score. Every draft here is reviewed and edited by an
// admin/staff member in the existing CreateQuestion form before it's ever saved — this endpoint
// only drafts, it never writes to the question bank itself.
router.get("/status", authenticate, requireRole("ADMIN", "STAFF"), (req, res) => {
  res.json({ configured: isConfigured() });
});

// Bloom's Taxonomy cognitive-task definitions, given verbatim to the model when a target BTL
// level is supplied — per the Employability & Readiness module's rule that BTL must reflect the
// question's actual cognitive demand, never be assigned randomly or inferred from wording
// difficulty. The admin/staff member picks the target level (same as they'd pick Difficulty);
// the AI is told what that level actually requires so the question it writes matches it. The
// admin still reviews and can change the level after generation — this doesn't auto-classify.
const BTL_TASK_DEFINITIONS = {
  1: "BTL 1 — Remember: the question must be answerable purely by recalling a stated fact, term, or definition, with no reasoning or application required.",
  2: "BTL 2 — Understand: the question must require explaining, summarizing, or restating a concept in the student's own terms, not just naming it.",
  3: "BTL 3 — Apply: the question must require using a known concept or procedure to solve a new, concrete problem or scenario — not just describing the concept.",
  4: "BTL 4 — Analyze: the question must require breaking a scenario, system, or piece of code down into parts, identifying relationships, causes, or flaws — e.g. \"why does this fail\" or \"which part is responsible for X\".",
  5: "BTL 5 — Evaluate: the question must require judging, comparing, or justifying a choice between multiple valid options against stated criteria — e.g. \"which approach is better and why\".",
  6: "BTL 6 — Create: the question must require designing, constructing, or proposing a new solution, structure, or system from scratch — not selecting or applying an existing one.",
};

router.post("/generate-question", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const { questionType, subject, topic, difficulty, btlLevel, skillTested, subtopic } = req.body;
  const type = ["CODING", "MCQ", "TRUE_FALSE", "MULTISELECT"].includes(questionType) ? questionType : "MCQ";
  if (!subject || !subject.trim()) return res.status(400).json({ error: "Subject is required" });

  // Real objective/skill context, per the module's "never generate from a bare prompt" rule —
  // when the caller supplies a BTL level and/or skill, they're folded into the prompt as explicit
  // constraints rather than left for the model to infer.
  const level = Number(btlLevel);
  const btlInstruction = BTL_TASK_DEFINITIONS[level] ? `\nCognitive level requirement: ${BTL_TASK_DEFINITIONS[level]}` : "";
  const skillInstruction = skillTested && skillTested.trim() ? `\nThe question must specifically exercise this skill: "${skillTested.trim()}".` : "";
  const subtopicSuffix = subtopic && subtopic.trim() ? ` (subtopic: ${subtopic.trim()})` : "";

  try {
    if (type === "CODING") {
      const draft = await askClaudeJson({
        system: "You write programming exam questions for a computer-science education platform. Return only JSON matching the requested schema — no markdown formatting inside JSON string values.",
        prompt: `Write one ${difficulty || "MEDIUM"}-difficulty CODING question about "${subject.trim()}"${topic ? ` (topic: ${topic.trim()})` : ""}${subtopicSuffix}. The student writes a complete stdin/stdout program in any language — no function-signature harness.${btlInstruction}${skillInstruction}
Return JSON exactly shaped: {"title": string, "description": string (full problem statement including input/output format and constraints), "explanation": string (brief solution approach), "testCases": [{"input": string, "expected": string, "isHidden": boolean}]}.
Provide exactly 5 testCases: 2 with isHidden=false (visible samples shown to students) and 3 with isHidden=true (used only for grading, covering edge cases).`,
        maxTokens: 1500,
      });
      return res.json({ questionType: "CODING", btlLevel: BTL_TASK_DEFINITIONS[level] ? level : null, skillTested: skillTested || null, subtopic: subtopic || null, ...draft });
    }

    const shapeHint = type === "TRUE_FALSE"
      ? 'Exactly 2 options: "True" and "False", with exactly 1 correct.'
      : type === "MULTISELECT"
      ? "4 to 6 options with 2 or more correct."
      : "4 options with exactly 1 correct.";
    const draft = await askClaudeJson({
      system: "You write exam questions for a computer-science education platform. Return only JSON matching the requested schema.",
      prompt: `Write one ${difficulty || "MEDIUM"}-difficulty ${type} question about "${subject.trim()}"${topic ? ` (topic: ${topic.trim()})` : ""}${subtopicSuffix}. ${shapeHint}${btlInstruction}${skillInstruction}
Return JSON exactly shaped: {"title": string, "description": string (the question text), "options": string[], "correctAnswer": number[] (0-based indices into options), "explanation": string}.`,
      maxTokens: 800,
    });
    res.json({ questionType: type, btlLevel: BTL_TASK_DEFINITIONS[level] ? level : null, skillTested: skillTested || null, subtopic: subtopic || null, ...draft });
  } catch (err) {
    if (err.notConfigured) return res.status(503).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "AI question generation failed — try again or write it manually" });
  }
});

module.exports = router;
