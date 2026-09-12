// The adaptive reasoning core of the AI Voice Interview module (Phase 1: text-only — see
// docs/AI_INTERVIEW.md). Every LLM call here goes through aiService.generateText/generateJson
// (never a raw provider call), so quota enforcement, request queueing, usage logging, and the
// prompt-injection boundary are inherited for free, exactly like every other AI feature on this
// platform. What lives in THIS file is the interview-specific prompt engineering itself — kept out
// of aiService.js (which stays a thin, feature-agnostic gateway) since this module's prompts are
// numerous and specific enough to deserve their own file, the same way a big enough feature
// eventually gets its own route file instead of living inside a shared one.
const aiService = require("../ai/aiService");
const { isDuplicateQuestion } = require("./duplicateDetection");

const FEATURES = {
  INTRO: "ai_interview_introduction",
  NEXT_QUESTION: "ai_interview_next_question",
  EVALUATE_ANSWER: "ai_interview_evaluate_answer",
  REPORT_NARRATIVE: "ai_interview_report_narrative",
};

// Recent-history cap — bounds both token cost and prompt-injection surface area, same reasoning
// as interview.js's existing 8000-char transcript cap for evaluateInterview(). An adaptive
// interview only ever needs the last handful of turns to decide what's next; the full transcript
// (for the final report) is a separate, capped-differently concern in generateReportNarrative.
const RECENT_TURNS_FOR_CONTEXT = 6;

function summarizeTurn(turn) {
  const parts = [`Q (${turn.questionType}, targeting "${turn.objective}"): ${turn.questionText}`];
  if (turn.skipped) parts.push(`A: (candidate skipped / said they didn't know)`);
  else if (turn.answerText) parts.push(`A: ${turn.answerText}`);
  if (turn.evaluation) {
    parts.push(
      `[internal eval: correctness=${turn.evaluation.correctness}, depth=${turn.evaluation.technicalDepth}, ` +
      `confidence=${turn.evaluation.confidence}${turn.evaluation.missingConcepts?.length ? `, missing: ${turn.evaluation.missingConcepts.join(", ")}` : ""}]`
    );
  }
  return parts.join("\n");
}

// Natural, config-driven introduction — spec §33 explicitly forbids hardcoding the exact sentence
// shown as an example; this generates a fresh one from the session's own configuration every time.
async function generateIntroduction({ session, userId, instituteId }) {
  const prompt = [
    `Write a short, natural spoken introduction (2-4 sentences) for an AI interviewer about to conduct a ${session.interviewType} interview for a ${session.role} role.`,
    `Candidate experience level: ${session.experienceLevel}.`,
    `Duration: ${session.durationMin} minutes.`,
    "Mention that questions will adapt to their answers and that they can ask you to repeat or clarify anything at any time.",
    "Do not mention scoring, grading, or that the interview is AI-generated content-wise beyond identifying yourself as an AI interviewer once.",
    "Professional, warm, not robotic. No markdown, just the spoken text.",
  ].join("\n");

  return aiService.generateText({
    feature: FEATURES.INTRO, userId, instituteId,
    system: "You are a professional AI technical interviewer for a university/enterprise placement platform. Speak naturally, never robotically.",
    prompt, maxTokens: 300, temperature: 0.8, injectionGuard: false, // no candidate-supplied content in this prompt
  });
}

const QUESTION_TYPES = [
  "FUNDAMENTALS", "CONCEPTUAL", "PRACTICAL", "SCENARIO", "DEBUGGING", "SYSTEM_DESIGN",
  "BEHAVIORAL", "PROJECT_BASED", "FOLLOW_UP", "DEEP_DIVE", "SITUATIONAL", "ROLE_SPECIFIC",
];

function validateQuestionShape(v) {
  if (!v || typeof v !== "object") return "response is not an object";
  if (typeof v.questionText !== "string" || v.questionText.trim().length < 8) return "questionText missing or too short";
  if (!QUESTION_TYPES.includes(v.questionType)) return `questionType must be one of ${QUESTION_TYPES.join(", ")}`;
  return null;
}

// THE core adaptive call (spec §2's whole point): the next question is generated from the
// candidate's own previous answer + evaluation, never picked from a fixed sequence. Retries once
// (regenerating with an explicit "that repeated something" instruction) if the duplicate-detection
// heuristic flags a near-restatement of a previous question — spec §35.
async function generateNextQuestion({ session, recentTurns, objective, stage, resumeSnapshot, jobDescription, userId, instituteId }) {
  const previousTexts = recentTurns.map((t) => t.questionText);
  const history = recentTurns.slice(-RECENT_TURNS_FOR_CONTEXT).map(summarizeTurn).join("\n\n");

  const contextParts = [
    `Role: ${session.role} | Experience level: ${session.experienceLevel} | Interview type: ${session.interviewType}`,
    `Current difficulty (1-10 scale): ${session.difficulty}`,
    `Target objective for THIS question: ${objective}`,
    `Interview stage: ${stage}`,
  ];
  if (resumeSnapshot) contextParts.push(aiService.wrapUntrusted("Candidate resume summary (skills/projects/experience)", JSON.stringify(resumeSnapshot)));
  if (jobDescription) contextParts.push(aiService.wrapUntrusted("Job description this interview is scoped against", jobDescription));
  if (history) contextParts.push(aiService.wrapUntrusted("Recent conversation so far (questions, candidate answers, internal evaluation signals)", history));

  async function ask(extraInstruction) {
    const prompt = [
      contextParts.join("\n\n"),
      extraInstruction || "",
      "Generate the SINGLE next interview question. It must:",
      "- Target the given objective, at a difficulty matching the current level and the stage.",
      "- Genuinely depend on the candidate's previous answer where relevant (probe a gap, go deeper on strength, pivot on a weak/skipped answer per the stage) — never a generic question that ignores what was just said.",
      "- Be an ORIGINAL question you write now, never copied from a known question bank, LeetCode/HackerRank problem, or a real company's actual interview.",
      "- Never repeat or closely restate a question already asked in this session.",
      'Return ONLY this JSON: {"questionText": string, "questionType": one of ' + JSON.stringify(QUESTION_TYPES) + '}',
    ].filter(Boolean).join("\n\n");

    return aiService.generateJson({
      feature: FEATURES.NEXT_QUESTION, userId, instituteId,
      system: "You are conducting a live adaptive technical interview. You never reveal answers, never coach unless explicitly told to, and never invent facts about the candidate beyond what's given to you. Respond with ONLY the requested JSON.",
      prompt, maxTokens: 400, temperature: 0.75,
      validate: validateQuestionShape,
    });
  }

  let result = await ask();
  if (isDuplicateQuestion(result.questionText, previousTexts)) {
    result = await ask("Your previous attempt repeated a question already asked this session — generate a genuinely different one for the same objective.");
  }
  return result;
}

const EVALUATION_SCORE_KEYS = ["correctness", "technicalDepth", "clarity", "reasoning", "confidence", "relevance"];

function validateEvaluationShape(v) {
  if (!v || typeof v !== "object") return "response is not an object";
  for (const key of EVALUATION_SCORE_KEYS) {
    if (typeof v[key] !== "number" || v[key] < 0 || v[key] > 100) return `"${key}" must be a number 0-100`;
  }
  if (!Array.isArray(v.strengths) || !Array.isArray(v.weaknesses) || !Array.isArray(v.missingConcepts) || !Array.isArray(v.evidence)) {
    return "strengths/weaknesses/missingConcepts/evidence must all be arrays";
  }
  if (typeof v.followUpRecommended !== "boolean") return "followUpRecommended must be a boolean";
  if (![-1, 0, 1].includes(v.difficultyAdjustment)) return "difficultyAdjustment must be -1, 0, or 1";
  return null;
}

// Structured, evidence-based per-answer evaluation — spec §11/§37 exactly. Never asked to expose
// hidden reasoning/chain-of-thought — only these concrete signals and short evidence strings.
async function evaluateAnswer({ session, turn, answerText, userId, instituteId }) {
  if (turn.skipped || !answerText || !answerText.trim()) {
    // "I don't know" / skip — spec §12: never mechanically zero this out without a real judgment
    // call, but there is genuinely nothing to evaluate. A tiny deterministic shape, no LLM call
    // needed (saves cost on the one case with no real content to reason about).
    return {
      correctness: 0, technicalDepth: 0, clarity: 0, reasoning: 0, confidence: 0, relevance: 0,
      strengths: [], weaknesses: ["Did not attempt an answer"], missingConcepts: [], evidence: ["Candidate skipped or said they did not know."],
      followUpRecommended: false, recommendedNextObjective: null, difficultyAdjustment: -1,
    };
  }

  const prompt = [
    `Role: ${session.role} | Experience level: ${session.experienceLevel} | Objective: ${turn.objective}`,
    `Question asked: ${turn.questionText}`,
    aiService.wrapUntrusted("Candidate's answer", answerText),
    "Evaluate ONLY this answer to this question. Score 0-100 on each: correctness, technicalDepth, clarity, reasoning, confidence, relevance.",
    "List concrete strengths, weaknesses, and missingConcepts (specific technical concepts the answer should have covered but didn't) as short phrases.",
    "evidence: 1-3 short quotes or paraphrases from the answer that justify the scores above (this makes the report auditable).",
    "followUpRecommended: true if this answer is incomplete/ambiguous enough that probing further would be valuable.",
    "recommendedNextObjective: which skill/topic the NEXT question should target given this answer (can repeat the current objective if it needs more probing, or name a different one from context if this one seems well-covered).",
    "difficultyAdjustment: -1 if this answer suggests the candidate is struggling at the current difficulty, +1 if they're clearly ready for harder, 0 otherwise.",
    "Do not penalize accent, phrasing style, or non-native English — evaluate technical content and reasoning only.",
    'Return ONLY this JSON: {"correctness":0-100,"technicalDepth":0-100,"clarity":0-100,"reasoning":0-100,"confidence":0-100,"relevance":0-100,"strengths":string[],"weaknesses":string[],"missingConcepts":string[],"evidence":string[],"followUpRecommended":boolean,"recommendedNextObjective":string|null,"difficultyAdjustment":-1|0|1}',
  ].join("\n\n");

  return aiService.generateJson({
    feature: FEATURES.EVALUATE_ANSWER, userId, instituteId,
    system: "You are an unbiased technical interview evaluator. Never score based on accent, phrasing, gender, or any protected characteristic — only content, reasoning, and technical accuracy. Respond with ONLY the requested JSON.",
    prompt, maxTokens: 700, temperature: 0.3,
    validate: validateEvaluationShape,
  });
}

function validateNarrativeShape(v) {
  if (!v || typeof v !== "object") return "response is not an object";
  if (!Array.isArray(v.strengths) || !Array.isArray(v.weaknesses) || !Array.isArray(v.recommendedLearning)) {
    return "strengths/weaknesses/recommendedLearning must all be arrays";
  }
  return null;
}

// The ONLY LLM call in report generation — a human-readable narrative summary built from the
// already-scored, already-aggregated signals (scoring.js). This never decides the numeric scores
// or the STRONG/GOOD/BORDERLINE/NEEDS_IMPROVEMENT decision — those are pure arithmetic (spec §20).
async function generateReportNarrative({ session, turns, scores, userId, instituteId }) {
  const evidenceSummary = turns
    .filter((t) => t.evaluation)
    .map((t) => `- [${t.objective}] ${t.evaluation.evidence?.join("; ") || "(no evidence recorded)"}`)
    .join("\n");

  const prompt = [
    `Role: ${session.role} | Interview type: ${session.interviewType} | Experience level: ${session.experienceLevel}`,
    `Computed scores — overall: ${scores.overallScore}, technical: ${scores.technicalScore}, problem-solving: ${scores.problemSolvingScore}, communication: ${scores.communicationScore}, confidence: ${scores.confidenceScore}`,
    aiService.wrapUntrusted("Per-question evidence collected during the interview", evidenceSummary || "(no evidence recorded)"),
    "Write a concise final summary: 2-4 strengths, 2-4 weaknesses, and 2-3 recommendedLearning topics, ALL grounded only in the evidence above — never invent something not supported by it.",
    'Return ONLY this JSON: {"strengths":string[],"weaknesses":string[],"recommendedLearning":string[]}',
  ].join("\n\n");

  return aiService.generateJson({
    feature: FEATURES.REPORT_NARRATIVE, userId, instituteId,
    system: "You write final interview report summaries for a computer-science education platform, grounded strictly in the evidence provided. Respond with ONLY the requested JSON.",
    prompt, maxTokens: 600, temperature: 0.4,
    validate: validateNarrativeShape,
  });
}

module.exports = { generateIntroduction, generateNextQuestion, evaluateAnswer, generateReportNarrative, QUESTION_TYPES };
