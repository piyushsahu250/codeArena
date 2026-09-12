const { test } = require("node:test");
const assert = require("node:assert/strict");
const { canTransition, isTerminal, ACTIVE_QUESTIONING_STATES } = require("../src/services/aiInterview/stateMachine");

test("the documented happy path is fully valid, one hop at a time", () => {
  assert.equal(canTransition("CREATED", "INTRODUCTION"), true);
  assert.equal(canTransition("INTRODUCTION", "QUESTIONING"), true);
  assert.equal(canTransition("QUESTIONING", "FOLLOW_UP"), true);
  assert.equal(canTransition("FOLLOW_UP", "DEEP_DIVE"), true);
  assert.equal(canTransition("DEEP_DIVE", "SKILL_TRANSITION"), true);
  assert.equal(canTransition("SKILL_TRANSITION", "FINAL_QUESTION"), true);
  assert.equal(canTransition("FINAL_QUESTION", "COMPLETED"), true);
  assert.equal(canTransition("COMPLETED", "EVALUATING"), true);
  assert.equal(canTransition("EVALUATING", "REPORT_READY"), true);
});

test("random/skipped transitions are rejected", () => {
  assert.equal(canTransition("CREATED", "QUESTIONING"), false, "cannot skip INTRODUCTION");
  assert.equal(canTransition("CREATED", "COMPLETED"), false);
  assert.equal(canTransition("REPORT_READY", "QUESTIONING"), false, "terminal state can never restart");
  assert.equal(canTransition("EVALUATING", "COMPLETED"), false, "cannot go backwards");
  assert.equal(canTransition("COMPLETED", "QUESTIONING"), false);
});

test("a state transitioning to itself is never valid (no-op must be handled explicitly by the caller)", () => {
  assert.equal(canTransition("QUESTIONING", "QUESTIONING"), false);
  assert.equal(canTransition("CREATED", "CREATED"), false);
});

test("ABANDONED is reachable from every non-terminal state (disconnect/timeout handling)", () => {
  for (const state of ["CREATED", "INTRODUCTION", "QUESTIONING", "FOLLOW_UP", "DEEP_DIVE", "SKILL_TRANSITION", "FINAL_QUESTION"]) {
    assert.equal(canTransition(state, "ABANDONED"), true, `${state} -> ABANDONED should be allowed`);
  }
  assert.equal(canTransition("COMPLETED", "ABANDONED"), false, "already completed, nothing to abandon");
});

test("COMPLETED is reachable from every active-questioning state (server timer can expire at any stage)", () => {
  for (const state of ACTIVE_QUESTIONING_STATES) {
    assert.equal(canTransition(state, "COMPLETED"), true, `${state} -> COMPLETED should be allowed`);
  }
});

test("isTerminal correctly identifies the two dead-end states", () => {
  assert.equal(isTerminal("REPORT_READY"), true);
  assert.equal(isTerminal("ABANDONED"), true);
  assert.equal(isTerminal("QUESTIONING"), false);
  assert.equal(isTerminal("COMPLETED"), false);
});
