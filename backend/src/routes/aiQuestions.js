const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const aiService = require("../services/ai/aiService");
const { sendAiError } = require("../utils/aiErrors");
const { shuffleQuestionOptions, answerIndexSetsMatch } = require("../utils/optionShuffle");
const { questionVisibilityWhere } = require("../utils/questionVisibility");
const { judgeSubmission } = require("../utils/judge");
const { runQueued } = require("../utils/queue");
const { checkNearDuplicate } = require("../utils/textSimilarity");

const router = express.Router();

// This route previously had no per-user AI rate limit at all — same 5/min budget as the sibling
// generators (draftGenLimiter, hintLimiter) elsewhere on the platform, so no single staff member
// can burn through the shared free-tier quota alone. Verification (see verifyAnswer below) adds a
// second AI call per MCQ/TRUE_FALSE/MULTISELECT generation, so this budget now covers up to 5
// *verified* questions/minute, not 5 raw generations — an intentional cost/correctness trade,
// not an oversight (spec: "answer verification is mandatory," "avoid unnecessary AI calls" was
// about skipping AI for things a deterministic check already covers, never about skipping the one
// check the whole feature exists to provide).
const generateLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => req.user.id });

// Scoped to the four QuestionType values this platform can actually grade (CODING via the judge,
// MCQ/TRUE_FALSE/MULTISELECT via stored correctAnswer indices — see schema.prisma's QuestionType
// enum and routes/questions.js). Deliberately does NOT offer SQL, fill-in-the-blank, or free-text
// "subjective" generation — there is no SQL execution engine and no subjective-answer question
// type or grading path anywhere on this platform, so generating those would produce content this
// codebase has no way to actually score. Every draft here is reviewed and edited by an
// admin/staff member in the existing CreateQuestion form before it's ever saved — this endpoint
// only drafts, it never writes to the question bank itself.
router.get("/status", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), (req, res) => {
  res.json({ configured: aiService.isConfigured() });
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

// Independent second-opinion answer check for MCQ/TRUE_FALSE/MULTISELECT — spec section 13's
// "mandatory... run a second validation/reasoning pass" for conceptual questions. Deliberately
// shown the question and options WITHOUT being told which one the generator claimed was correct —
// asking a model "is X really the right answer?" invites it to just agree; asking it to solve the
// question fresh and comparing the two independent answers actually catches a generator that
// wrote a confident-sounding but wrong explanation. Never silently trusts either pass alone; a
// disagreement is surfaced as NEEDS_REVIEW, never auto-resolved by picking one side.
async function verifyChoiceAnswer({ userId, instituteId, description, options, claimedAnswer }) {
  try {
    const result = await aiService.generateJson({
      feature: aiService.FEATURES.QUESTION_BANK_GENERATE, userId, instituteId,
      system: "You are an independent exam-answer checker for a computer-science education platform. Solve the question yourself from scratch — you are not told which option anyone else picked. Respond with ONLY the requested JSON.",
      prompt: `Question: ${description}\nOptions:\n${options.map((o, i) => `${i}: ${o}`).join("\n")}\n\nWhich option index/indices (0-based) are correct? Return JSON exactly shaped: {"correctAnswer": number[], "reasoning": string (one sentence)}.`,
      maxTokens: 400,
      injectionGuard: false,
      validate: (v) => (!Array.isArray(v?.correctAnswer)) ? "missing correctAnswer array" : null,
    });
    const agree = answerIndexSetsMatch(result.correctAnswer, claimedAnswer);
    return {
      verificationStatus: agree ? "VERIFIED" : "NEEDS_REVIEW",
      verificationDetail: agree
        ? "An independent AI re-check, solving the question from scratch without seeing the generated answer, agreed with the stated correct answer."
        : `An independent AI re-check disagreed: it computed option(s) ${result.correctAnswer.join(", ")} as correct instead of ${claimedAnswer.join(", ")} — reasoning: ${result.reasoning}. Review before publishing.`,
    };
  } catch (err) {
    // A failed/unparseable second pass is inconclusive, not proof the question is wrong — never
    // silently claim VERIFIED when the check itself didn't actually run.
    return { verificationStatus: "NOT_VERIFIED", verificationDetail: "Automatic answer verification could not complete — review the answer manually before publishing." };
  }
}

// Independent verification for CODING — spec section 18's "must not be marked READY unless the
// reference solution works... hidden cases pass." The generator is asked for a reference solution
// alongside the question itself; that solution is then actually executed against the generated
// test cases through the exact same judge a student submission runs through (utils/judge.js),
// never just asked "does this look right." A reference solution that fails its own test cases is
// the single clearest signal a generated coding question is broken (wrong expected output, an
// impossible constraint, a case that contradicts the problem statement).
async function verifyCodingAnswer({ referenceSolution, testCases }) {
  if (!referenceSolution || typeof referenceSolution !== "string" || !referenceSolution.trim()) {
    return { verificationStatus: "NOT_VERIFIED", verificationDetail: "The AI did not provide a reference solution to verify against — review the test cases manually before publishing." };
  }
  try {
    const result = await runQueued(() =>
      judgeSubmission({ language: "python", code: referenceSolution, testCases, evaluationType: "STDIO", timeLimitMs: 3000 })
    );
    const allPassed = result.totalCases > 0 && result.passedCases === result.totalCases;
    return {
      verificationStatus: allPassed ? "VERIFIED" : "NEEDS_REVIEW",
      verificationDetail: allPassed
        ? `The AI's own reference solution was executed against all ${result.totalCases} generated test cases and passed every one.`
        : `The AI's own reference solution only passed ${result.passedCases}/${result.totalCases} of its generated test cases (verdict: ${result.verdict}) — the problem statement, a test case, or the reference solution itself is likely wrong. Review before publishing.`,
    };
  } catch (err) {
    return { verificationStatus: "NOT_VERIFIED", verificationDetail: "Automatic execution-based verification could not complete (judge unavailable) — review the test cases manually before publishing." };
  }
}

// Pre-save duplicate check, scoped exactly like POST /questions's own real duplicate gate (same
// Subject+Unit scoping, same case-insensitive exact-text match) — spec section 23: a staff member
// should see "this looks like an existing question" AT GENERATION time, not discover it as a 409
// only after clicking Save. Only runs when the caller supplies subjectId/unitId (both callers —
// GenerateAiDrafts.jsx and CreateQuestion.jsx — already have them selected via SubjectUnitPicker
// before generating); silently skipped otherwise rather than guessing an unscoped match, which
// could otherwise flag two genuinely unrelated subjects' similarly-worded questions as duplicates.
//
// Two passes: (1) the original exact-text match -- a single indexed-shape DB query, essentially
// free; (2) a NEAR-duplicate pass over a bounded, recency-ordered window of existing questions in
// the same scope, using utils/textSimilarity.js's deterministic word-overlap check -- no AI call
// (spec section 45: deterministic checks first). Added after a real generated batch produced two
// Easy MCQs both titled "Java File Extension" whose bodies differed just enough that the exact
// match missed the second one entirely (confirmed live, 2026-09-11) -- exactly the "same question,
// reworded" case spec section 23 calls out that a pure exact-text match can never catch.
const NEAR_DUPLICATE_SCAN_LIMIT = 200; // bounds the cost of pass 2 regardless of how large the bank is
async function checkDuplicate(req, { title, description, subjectId, unitId }) {
  if (!subjectId || !unitId) return null;
  try {
    const exact = await prisma.question.findFirst({
      where: { ...questionVisibilityWhere(req), subjectId, unitId, description: { equals: description.trim(), mode: "insensitive" } },
      select: { id: true, title: true, description: true },
    });
    if (exact) return { ...exact, matchType: "exact" };

    const candidates = await prisma.question.findMany({
      where: { ...questionVisibilityWhere(req), subjectId, unitId },
      select: { id: true, title: true, description: true },
      orderBy: { createdAt: "desc" },
      take: NEAR_DUPLICATE_SCAN_LIMIT,
    });
    let best = null;
    for (const candidate of candidates) {
      const { isMatch, similarity, reason } = checkNearDuplicate({ title, description }, candidate);
      if (isMatch && (!best || similarity > best.similarity)) best = { ...candidate, matchType: "near", similarity, reason };
    }
    return best;
  } catch {
    return null; // never let a duplicate-check failure block generation itself
  }
}

router.post("/generate-question", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, generateLimiter, async (req, res) => {
  const { questionType, subject, topic, difficulty, btlLevel, skillTested, subtopic, subjectId, unitId } = req.body;
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
      const draft = await aiService.generateJson({
        feature: aiService.FEATURES.QUESTION_BANK_GENERATE, userId: req.user.id, instituteId: req.requesterInstituteId,
        system: "You write programming exam questions for a computer-science education platform. Return only JSON matching the requested schema — no markdown formatting inside JSON string values.",
        prompt: `Write one ${difficulty || "MEDIUM"}-difficulty CODING question about "${subject.trim()}"${topic ? ` (topic: ${topic.trim()})` : ""}${subtopicSuffix}. The student writes a complete stdin/stdout program in any language — no function-signature harness.${btlInstruction}${skillInstruction}
Return JSON exactly shaped: {"title": string, "description": string (full problem statement including input/output format and constraints), "explanation": string (brief solution approach), "testCases": [{"input": string, "expected": string, "isHidden": boolean}], "referenceSolution": string (a complete, correct Python 3 program reading from stdin and writing to stdout that solves the problem exactly as stated)}.
Provide exactly 7 testCases: 2 with isHidden=false (visible samples shown to students) and 5 with isHidden=true (used only for grading — cover a basic case, a small/boundary case, a typical case, an edge case, and a large/stress case within the stated constraints).`,
        maxTokens: 2200,
        injectionGuard: false, // subject/topic/skillTested are short admin-typed labels, not free-form student content
        validate: (v) => (!v?.title || !v?.description || !Array.isArray(v?.testCases)) ? "missing title/description/testCases" : null,
      });

      const [verification, duplicate] = await Promise.all([
        verifyCodingAnswer({ referenceSolution: draft.referenceSolution, testCases: draft.testCases }),
        checkDuplicate(req, { title: draft.title, description: draft.description, subjectId, unitId }),
      ]);
      const { referenceSolution, ...draftWithoutRawSolution } = draft;
      return res.json({
        questionType: "CODING", btlLevel: BTL_TASK_DEFINITIONS[level] ? level : null, skillTested: skillTested || null, subtopic: subtopic || null,
        ...draftWithoutRawSolution,
        // Reshaped to the { [language]: code } map Question.referenceSolution/CreateQuestion.jsx's
        // own referenceSolution state already use — not the bare string the AI returned.
        referenceSolution: referenceSolution ? { python: referenceSolution } : undefined,
        ...verification,
        duplicateWarning: duplicate,
      });
    }

    const shapeHint = type === "TRUE_FALSE"
      ? 'Exactly 2 options: "True" and "False", with exactly 1 correct.'
      : type === "MULTISELECT"
      ? "4 to 6 options with 2 or more correct."
      : "4 options with exactly 1 correct.";
    const draft = await aiService.generateJson({
      feature: aiService.FEATURES.QUESTION_BANK_GENERATE, userId: req.user.id, instituteId: req.requesterInstituteId,
      system: "You write exam questions for a computer-science education platform. Return only JSON matching the requested schema.",
      // Deliberately gives the model NO instruction about *where* the correct answer should sit
      // among the options — asking an LLM to "randomize" a position is not a reliable substitute
      // for real randomness (models have their own placement habits regardless of instruction).
      // Correctness first (the model just writes the right answer and 3 genuine distractors),
      // position second: the shuffle below re-randomizes placement server-side with a real RNG
      // after generation, so the saved question's answer position is never a function of the
      // model's own bias (see the MCQ correct-answer distribution audit this fix was written for).
      prompt: `Write one ${difficulty || "MEDIUM"}-difficulty ${type} question about "${subject.trim()}"${topic ? ` (topic: ${topic.trim()})` : ""}${subtopicSuffix}. ${shapeHint}${btlInstruction}${skillInstruction}
Return JSON exactly shaped: {"title": string, "description": string (the question text), "options": string[], "correctAnswer": number[] (0-based indices into options), "explanation": string}.`,
      maxTokens: 800,
      injectionGuard: false,
      validate: (v) => {
        if (!v?.title || !v?.description) return "missing title/description";
        // Don't blindly trust the model's own answer index (spec: never assume it's correct just
        // because it parsed) — a generation that names an out-of-range or missing correctAnswer is
        // surfaced as a generation failure (staff can retry or write it manually), never silently
        // saved with a broken/empty answer.
        if (type !== "CODING" && Array.isArray(v?.options)) {
          const idxs = Array.isArray(v.correctAnswer) ? v.correctAnswer : [];
          if (idxs.length === 0) return "AI did not specify a correct answer";
          if (idxs.some((i) => typeof i !== "number" || i < 0 || i >= v.options.length)) return "AI's correct answer index is out of range";
        }
        return null;
      },
    });

    // Independent second-opinion verification runs BEFORE the shuffle below, against the
    // generator's own original option order/indices — position never affects what's being
    // checked, only which options are the same set of strings.
    const [verification, duplicate] = await Promise.all([
      verifyChoiceAnswer({ userId: req.user.id, instituteId: req.requesterInstituteId, description: draft.description, options: draft.options, claimedAnswer: draft.correctAnswer }),
      checkDuplicate(req, { title: draft.title, description: draft.description, subjectId, unitId }),
    ]);

    // Re-randomize option position with a real RNG (crypto.randomUUID() as the shuffle seed —
    // see utils/optionShuffle.js) — every generated MCQ/MULTISELECT gets an independently random
    // placement regardless of the model's own habits. TRUE_FALSE is left as-is (always exactly
    // "True"/"False" in that order — nothing meaningful to shuffle there).
    if ((type === "MCQ" || type === "MULTISELECT") && Array.isArray(draft.options) && Array.isArray(draft.correctAnswer)) {
      const shuffled = shuffleQuestionOptions(draft.options, draft.correctAnswer, crypto.randomUUID());
      draft.options = shuffled.options;
      draft.correctAnswer = shuffled.correctAnswer;
    }
    res.json({
      questionType: type, btlLevel: BTL_TASK_DEFINITIONS[level] ? level : null, skillTested: skillTested || null, subtopic: subtopic || null,
      ...draft,
      ...verification,
      duplicateWarning: duplicate,
    });
  } catch (err) {
    sendAiError(res, err, "AI question generation failed — try again or write it manually");
  }
});

module.exports = router;
