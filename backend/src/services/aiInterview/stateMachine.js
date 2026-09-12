// Explicit interview-state transition graph (spec §6: "Never allow random state transitions.
// Every transition must be validated server-side."). Pure and dependency-free so it's trivially
// unit-testable — every route that moves an AiInterviewSession forward calls canTransition()
// before writing the new status, and rejects (409) rather than silently accepting an invalid jump.
//
// ABANDONED is reachable from every non-terminal state — a browser refresh/network drop/server
// restart mid-interview must be able to mark a session dead without needing to pass through the
// normal COMPLETED->EVALUATING->REPORT_READY sequence (spec §29/§15 reconnect handling). COMPLETED
// is reachable from every questioning-adjacent state too, not just QUESTIONING itself, because the
// server-authoritative timer (spec §15) can expire the interview mid FOLLOW_UP/DEEP_DIVE/
// SKILL_TRANSITION just as easily as mid plain QUESTIONING.
const TRANSITIONS = {
  CREATED: ["INTRODUCTION", "ABANDONED"],
  INTRODUCTION: ["QUESTIONING", "ABANDONED"],
  QUESTIONING: ["FOLLOW_UP", "DEEP_DIVE", "SKILL_TRANSITION", "FINAL_QUESTION", "COMPLETED", "ABANDONED"],
  FOLLOW_UP: ["QUESTIONING", "DEEP_DIVE", "SKILL_TRANSITION", "FINAL_QUESTION", "COMPLETED", "ABANDONED"],
  DEEP_DIVE: ["QUESTIONING", "FOLLOW_UP", "SKILL_TRANSITION", "FINAL_QUESTION", "COMPLETED", "ABANDONED"],
  SKILL_TRANSITION: ["QUESTIONING", "FOLLOW_UP", "DEEP_DIVE", "FINAL_QUESTION", "COMPLETED", "ABANDONED"],
  FINAL_QUESTION: ["COMPLETED", "ABANDONED"],
  COMPLETED: ["EVALUATING"],
  EVALUATING: ["REPORT_READY"],
  REPORT_READY: [],
  ABANDONED: [],
};

function canTransition(from, to) {
  if (from === to) return false; // no-op "transitions" must go through an explicit idempotency check at the call site, not silently succeed here
  return !!TRANSITIONS[from] && TRANSITIONS[from].includes(to);
}

function isTerminal(status) {
  return status === "REPORT_READY" || status === "ABANDONED";
}

// The interview stages where the candidate is actively being asked something and an answer is
// expected — used by routes to decide whether POST .../answer is even a valid call right now.
const ACTIVE_QUESTIONING_STATES = ["QUESTIONING", "FOLLOW_UP", "DEEP_DIVE", "SKILL_TRANSITION", "FINAL_QUESTION"];

module.exports = { canTransition, isTerminal, ACTIVE_QUESTIONING_STATES, TRANSITIONS };
