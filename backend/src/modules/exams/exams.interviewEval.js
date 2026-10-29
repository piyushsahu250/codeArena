// Section D, optional AI evaluation of interview answers (blueprint interview.evaluationMode = "AI"). Reuses services/ai/aiService.js (Gemini with its model fallback and
// quota accounting); no new provider. Guarantees:
//  - the student's answer is stored first and never changed by evaluation;
//  - the model's output is validated (scores 0-100, required fields): a malformed reply is a failed try, never a clamped or zero score;
//  - at most MAX_TRIES tries per answer, with growing delays; after that the evaluation is FAILED (visible, and an administrator can retry it), not zero;
//  - one runner per attempt (no duplicate jobs), one answer at a time (bounded AI concurrency);
//  - the evaluator is told to ignore accent, speaking style, grammar and speech-to-text errors, and to judge content only.
const prisma = require("../../prisma");
const aiService = require("../../services/ai/aiService");
const Scoring = require("../../utils/examScoring");

const RUBRIC_VERSION = "interview-ai-v1";
const MAX_TRIES = 3;
const BASE_DELAY_MS = 30000;
const DIMENSIONS = {
  technical: ["technicalCorrectness", "conceptualUnderstanding", "completeness", "reasoning", "examples"],
  behavioural: ["relevance", "clarity", "structure", "specificExamples", "reflection"],
};

const running = new Set();
const timers = new Map();

function rubricFor(category) {
  const technical = category === "TECHNICAL" || category === "SYSTEM_DESIGN";
  return { technical, dims: technical ? DIMENSIONS.technical : DIMENSIONS.behavioural };
}

function validateEvaluation(dims) {
  return (v) => {
    if (!v || typeof v !== "object") return "response is not an object";
    if (typeof v.score !== "number" || !Number.isFinite(v.score) || v.score < 0 || v.score > 100) return '"score" must be a number 0-100';
    if (!v.dimensions || typeof v.dimensions !== "object") return '"dimensions" is required';
    for (const d of dims) if (typeof v.dimensions[d] !== "number" || v.dimensions[d] < 0 || v.dimensions[d] > 100) return `dimension "${d}" must be a number 0-100`;
    for (const k of ["strengths", "missingConcepts", "suggestions", "evidence"]) if (!Array.isArray(v[k]) || !v[k].every((x) => typeof x === "string")) return `"${k}" must be an array of strings`;
    if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 100) return '"confidence" must be a number 0-100';
    return null;
  };
}

async function evaluateOne({ question, answerText, maxMarks, userId, instituteId }) {
  const { technical, dims } = rubricFor(question.category);
  const prompt = [
    `Interview question (${technical ? "technical" : "behavioural/HR"}): ${question.prompt}`,
    aiService.wrapUntrusted("Candidate's answer (may be dictated speech-to-text)", answerText),
    `Score the answer from 0 to 100 overall, and each of these dimensions from 0 to 100: ${dims.join(", ")}.`,
    technical ? "Judge technical correctness first: a wrong statement lowers the score even if the answer is well spoken." : "Judge relevance, clear structure and concrete examples; a vague answer with no example scores low.",
    "Judge CONTENT only. Do not lower any score for accent, speaking style, grammar, filler words, or words that a speech-to-text system may have misrecognised; read the evident intended meaning.",
    "Give strengths, missingConcepts (specific points the answer should have covered), suggestions (how to improve) and evidence (1-3 short quotes or paraphrases from the answer that justify the scores), all as short strings.",
    "confidence: how sure you are of these scores (0-100); lower it when the answer is ambiguous, very short, or looks mis-transcribed.",
    `Return ONLY this JSON: {"score":0-100,"dimensions":{${dims.map((d) => `"${d}":0-100`).join(",")}},"strengths":string[],"missingConcepts":string[],"suggestions":string[],"evidence":string[],"confidence":0-100}`,
  ].join("\n\n");
  const out = await aiService.generateJson({
    feature: "exam_interview_eval", userId, instituteId,
    system: "You are a fair interview evaluator for a computer-science education platform. You never score on accent, appearance, gender or any personal characteristic. Respond with ONLY the requested JSON.",
    prompt, maxTokens: 700, temperature: 0, validate: validateEvaluation(dims),
  });
  return {
    status: "DONE", method: "AI", rubricVersion: RUBRIC_VERSION, scorePct: out.score, marks: Scoring.round2((maxMarks * out.score) / 100),
    dimensions: out.dimensions, strengths: out.strengths, missingConcepts: out.missingConcepts, suggestions: out.suggestions, evidence: out.evidence,
    confidence: Scoring.round2(out.confidence / 100), evaluatedAt: new Date().toISOString(),
  };
}

// Evaluates every PENDING interview answer of the attempt, one at a time. `onSettled(attemptId)` refreshes the section summary and the result afterwards.
async function runInterviewEvaluations(attemptId, { onSettled } = {}) {
  if (running.has(attemptId)) return false; // a runner already owns this attempt: no duplicate job
  running.add(attemptId);
  let retryIn = null;
  try {
    const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId }, select: { id: true, studentId: true, instituteId: true, manifest: true } });
    if (!attempt) return false;
    const marksOf = new Map((attempt.manifest?.AI_INTERVIEW || []).map((i) => [i.ref, i.marks]));
    const answers = await prisma.examAnswer.findMany({ where: { attemptId, sectionKey: "AI_INTERVIEW" } });
    const pending = answers.filter((a) => a.evaluation?.status === "PENDING" && typeof a.payload?.text === "string" && a.payload.text.trim());
    if (!pending.length) return true;
    const questions = await prisma.interviewQuestion.findMany({ where: { id: { in: pending.map((a) => a.itemRef) } }, select: { id: true, prompt: true, category: true } });
    const qById = new Map(questions.map((q) => [q.id, q]));
    for (const a of pending) {
      const q = qById.get(a.itemRef);
      const tries = (a.evaluation.attempts || 0) + 1;
      try {
        if (!q) throw new Error("question no longer available");
        const done = await evaluateOne({ question: q, answerText: a.payload.text, maxMarks: marksOf.get(a.itemRef) ?? 0, userId: attempt.studentId, instituteId: attempt.instituteId });
        // conditional: only if the answer is still PENDING with the same text (a re-save or another runner changed nothing under us)
        await prisma.examAnswer.updateMany({ where: { id: a.id, version: a.version, evaluation: { path: ["status"], equals: "PENDING" } }, data: { evaluation: { ...done, attempts: tries } } });
      } catch (err) {
        const failed = tries >= MAX_TRIES;
        console.error(`[exam-interview-eval] attempt ${attemptId} item ${a.itemRef} try ${tries}: ${err.message}`);
        await prisma.examAnswer.updateMany({
          where: { id: a.id, version: a.version, evaluation: { path: ["status"], equals: "PENDING" } },
          data: { evaluation: { ...a.evaluation, status: failed ? "FAILED" : "PENDING", attempts: tries, lastError: String(err.message).slice(0, 200), lastTriedAt: new Date().toISOString() } },
        });
        if (!failed) retryIn = Math.max(retryIn ?? 0, BASE_DELAY_MS * 2 ** (tries - 1));
      }
    }
  } finally {
    running.delete(attemptId);
    if (retryIn !== null && !timers.has(attemptId)) {
      const t = setTimeout(() => { timers.delete(attemptId); runInterviewEvaluations(attemptId, { onSettled }).catch(() => {}); }, retryIn);
      if (t.unref) t.unref();
      timers.set(attemptId, t);
    }
    if (onSettled) await Promise.resolve(onSettled(attemptId)).catch((e) => console.error("[exam-interview-eval] onSettled failed:", e.message));
  }
  return true;
}

// Puts a failed evaluation back to PENDING (an authorised administrator's retry) and starts the runner.
async function retryFailedEvaluations(attemptId, hooks) {
  const res = await prisma.examAnswer.updateMany({ where: { attemptId, sectionKey: "AI_INTERVIEW", evaluation: { path: ["status"], equals: "FAILED" } }, data: { evaluation: { status: "PENDING", attempts: 0, method: "AI" } } });
  if (res.count) runInterviewEvaluations(attemptId, hooks).catch(() => {});
  return res.count;
}

module.exports = { RUBRIC_VERSION, MAX_TRIES, validateEvaluation, runInterviewEvaluations, retryFailedEvaluations, isRunning: (id) => running.has(id) };
