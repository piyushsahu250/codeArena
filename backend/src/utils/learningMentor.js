// "I'm Stuck" / AI Learning Mentor (LMS master-spec sections 18-20). Shared between Practice
// Coding (/practice/:id/assist) and Project Tasks (/tasks/:id/assist) — one AI-assist mechanism,
// not two, so a fix/tuning here applies everywhere a student can get stuck. Reuses aiService
// exactly like the pre-existing, narrower /practice/:id/hint route already did (same feature key,
// same Institute.aiHintsEnabled gate, same "never write the final solution" guardrail) — this
// module generalizes that one HINT category into the spec's full five-option menu, it does not
// replace the older route (still used, still works, untouched).
const aiService = require("../services/ai/aiService");

const STUCK_CATEGORIES = {
  HINT: {
    label: "I need a hint",
    instruction: "Give a short, specific hint that nudges the student toward finding and fixing their own bug or gap — never write corrected code, never give the full solution. 2-4 sentences.",
    requiresPriorAttempt: true, // matches the original /practice/:id/hint route's own gate
  },
  CONCEPT: {
    label: "I don't understand the concept",
    instruction: "Explain the underlying programming concept this task is testing, in plain language, with no code and without referencing the student's specific attempt. 3-5 sentences.",
    requiresPriorAttempt: false,
  },
  NOT_WORKING: {
    label: "My code isn't working",
    instruction: "Look at the student's code and explain what's likely going wrong (e.g. an off-by-one error, a wrong data type, a missed edge case) as a class of bug, without writing the corrected code or the full solution. 2-4 sentences.",
    requiresPriorAttempt: false,
  },
  REQUIREMENT: {
    label: "I don't understand the requirement",
    instruction: "Restate what the task is actually asking for, in simpler words than the original prompt, with a small concrete example if it helps. Do not give the solution.",
    requiresPriorAttempt: false,
  },
  EXAMPLE: {
    label: "I need an example",
    instruction: "Give a SIMPLE, DIFFERENT worked example (never this exact task) that illustrates the same underlying technique, with a tiny code snippet if it helps. Never solve the student's actual task.",
    requiresPriorAttempt: false,
  },
};

async function generateMentorAssist({ category, taskPrompt, studentCode, language, verdict, userId, instituteId }) {
  const cat = STUCK_CATEGORIES[category] || STUCK_CATEGORIES.HINT;
  const codeBlock = studentCode
    ? aiService.wrapUntrusted(`Student's ${language || "code"} submission${verdict ? ` (verdict: ${verdict})` : ""}`, studentCode.slice(0, 4000))
    : "(the student hasn't written any code yet)";
  const text = await aiService.generateText({
    feature: aiService.FEATURES.LEARNING_HINT,
    userId, instituteId,
    system: `You are a patient programming tutor. A student clicked "I'm Stuck" and selected: "${cat.label}". ${cat.instruction} Never blindly provide the final answer, even if asked directly.`,
    prompt: `Task: ${taskPrompt}\n\n${codeBlock}\n\nRespond directly to the student in 2nd person.`,
    maxTokens: 350,
    temperature: 0.5,
  });
  return { category: category && STUCK_CATEGORIES[category] ? category : "HINT", text };
}

module.exports = { STUCK_CATEGORIES, generateMentorAssist };
