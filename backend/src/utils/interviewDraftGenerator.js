const prisma = require("../prisma");
const aiService = require("../services/ai/aiService");

// Generates AI-drafted InterviewQuestion candidates and CompanyPatternNote checklists — the core
// content-generation logic behind the AI-Powered Auto-Updating Mock Interview System. Deliberately
// factored out of routes/interviewDrafts.js so both the admin-triggered "Generate" button and the
// (opt-in, off-by-default) scheduled auto-refresh job call the exact same implementation — one
// place that owns "what we ask Claude for and how we validate what comes back."
//
// Everything this module writes lands with status "PENDING" and is never read by any
// student-facing query (pickQuestions() in routes/interview.js only ever reads InterviewQuestion,
// a table this module never writes to directly) — a human must explicitly approve via
// routes/interviewDrafts.js before a draft becomes a real, servable question.

const CATEGORY_SCHEMA_HINT = {
  CODING:
    'Return exactly {"questions": [{"title": string, "prompt": string, "difficulty": "EASY"|"MEDIUM"|"HARD", ' +
    '"tags": string[], "testCases": [{"input": string, "expected": string, "isHidden": boolean}]}]}. ' +
    "Each question's testCases array must contain EXACTLY 2 entries with isHidden:false and EXACTLY 5 entries " +
    "with isHidden:true (7 total, covering a basic case, a small/boundary case, a typical case, an edge case, " +
    "and a large/stress case within the stated constraints) — this platform requires that minimum before a " +
    "coding question can be published. `prompt` is the full original problem statement (goal, constraints, " +
    "sample input/output).",
  APTITUDE:
    'Return exactly {"questions": [{"title": string, "prompt": string, ' +
    '"aptitudeCategory": "QUANTITATIVE"|"LOGICAL"|"VERBAL"|"DATA_INTERPRETATION", "options": string[] (exactly 4), ' +
    '"correctAnswer": [number] (single-element array, the correct option\'s 0-based index), "explanation": string}]}.',
  DEFAULT:
    'Return exactly {"questions": [{"title": string, "prompt": string, ' +
    '"expectedKeywords": string[] (3-6 concepts a strong answer should mention), "modelAnswer": string}]}.',
};

const SYSTEM_PROMPT =
  "You are drafting ORIGINAL practice interview questions for a student mock-interview platform. " +
  "Never reproduce a real LeetCode/HackerRank/company OA problem's exact wording — write a new problem " +
  "in a similar style, topic, and difficulty to what is commonly and publicly known to be asked in that " +
  "category (and, if given, at that company), based on general public knowledge, not any specific copied " +
  "source. Respond with ONLY the requested JSON, no commentary.";

function buildQuestionPrompt({ category, company, difficulty, count, topicHint }) {
  const schemaHint = CATEGORY_SCHEMA_HINT[category] || CATEGORY_SCHEMA_HINT.DEFAULT;
  const companyLine = company
    ? `Style them like questions commonly associated with ${company}'s interview process for this category.`
    : "These are for the general practice pool (not tied to a specific company).";
  // Lets an admin closing a specific coverage gap (e.g. "Amazon needs arrays/hashmap CODING
  // questions") ask for exactly that topic instead of a generic batch — same generate-then-
  // human-approve pipeline either way, this only shapes the prompt.
  const topicLine = topicHint ? ` Focus specifically on these topics: ${topicHint}.` : "";
  return (
    `Generate ${count} original ${category} interview practice question(s)${difficulty ? ` at ${difficulty} difficulty` : ""}. ` +
    `${companyLine}${topicLine} ${schemaHint}`
  );
}

// Clamp so one generation call can't ask for an unbounded amount of (billed) content.
function clampCount(count) {
  return Math.min(10, Math.max(1, Number(count) || 3));
}

async function generateQuestionDrafts({ category, company, count, difficulty, packageBand, experienceLevel, sourceRun, topicHint, userId, instituteId }) {
  const n = clampCount(count);
  const draft = await aiService.generateJson({
    feature: aiService.FEATURES.INTERVIEW_QUESTION_DRAFT, userId, instituteId,
    system: SYSTEM_PROMPT,
    prompt: buildQuestionPrompt({ category, company, difficulty, count: n, topicHint }),
    maxTokens: category === "CODING" ? 4096 : 2048,
    validate: (v) => !Array.isArray(v?.questions) ? "expected a questions array" : null,
  });
  const questions = Array.isArray(draft?.questions) ? draft.questions : [];
  const rows = await Promise.all(
    questions.slice(0, n).map((q) =>
      prisma.interviewQuestionDraft.create({
        data: {
          category,
          company: company || null,
          difficulty: q.difficulty || difficulty || "EASY",
          title: q.title || null,
          prompt: q.prompt || "",
          expectedKeywords: q.expectedKeywords ?? undefined,
          modelAnswer: q.modelAnswer || null,
          aptitudeCategory: q.aptitudeCategory || null,
          options: q.options ?? undefined,
          correctAnswer: q.correctAnswer ?? undefined,
          explanation: q.explanation || null,
          tags: Array.isArray(q.tags) && q.tags.length > 0 ? q.tags : undefined,
          testCases: q.testCases ?? undefined,
          sourceRun: sourceRun || null,
        },
      })
    )
  );
  return rows;
}

async function generateCompanyPatternNote({ company, category, sourceRun, userId, instituteId }) {
  const draft = await aiService.generateDraft({
    feature: aiService.FEATURES.COMPANY_PATTERN_DRAFT, userId, instituteId,
    system: SYSTEM_PROMPT,
    prompt:
      `Summarize, from general public knowledge, the commonly-reported ${category} interview pattern at ${company} ` +
      'as a short checklist. Return exactly {"checklistItems": string[]} with 2-6 short items (e.g. "OA Questions", ' +
      '"Leadership Principles", "System Design Round"). This is a general pattern summary, not a claim about any ' +
      "specific real question.",
    maxTokens: 512,
    validate: (v) => !Array.isArray(v?.checklistItems) ? "expected a checklistItems array" : null,
  });
  const checklistItems = Array.isArray(draft?.checklistItems) ? draft.checklistItems.filter((s) => typeof s === "string" && s.trim()) : [];
  return prisma.companyPatternNote.create({ data: { company, category, checklistItems, sourceRun: sourceRun || undefined } });
}

module.exports = { generateQuestionDrafts, generateCompanyPatternNote, clampCount };
