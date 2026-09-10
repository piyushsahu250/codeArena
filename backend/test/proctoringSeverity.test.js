// Regression coverage for utils/proctoringSeverity.js — shared identically by tests.js,
// moduleCoding.js, and interview.js's violation-report endpoints. Added specifically so the
// live-test bug this session fixed (BROWSER_SHORTCUT counting as a violation strike for ordinary
// coding-editor keyboard shortcuts like Ctrl+S) can never silently regress back to SUSPICIOUS.
// Run with `npm test` (plain node:test, no extra dependency needed).
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { VIOLATION_SEVERITY, SUSPICIOUS_ESCALATION_THRESHOLD, classifyViolation } = require("../src/utils/proctoringSeverity");

describe("VIOLATION_SEVERITY classification", () => {
  test("CONFIRMED_VIOLATION types — leaving/breaking the proctored environment itself", () => {
    for (const type of ["TAB_SWITCH", "FULLSCREEN_EXIT", "CAMERA_DROPPED", "MIC_DROPPED"]) {
      assert.equal(VIOLATION_SEVERITY[type], "CONFIRMED_VIOLATION", `${type} should be CONFIRMED_VIOLATION`);
    }
  });

  test("keyboard-triggered / mobile-keyboard-shaped types are INTERRUPTION, never counted — the live-exam false positives fixed this session", () => {
    // BROWSER_SHORTCUT (2026-09-09): a student using ordinary coding-editor shortcuts (Ctrl+S etc.)
    // hit the escalation threshold and got a strike for normal typing.
    // SCREEN_OVERLAY_DETECTED (2026-09-10): a viewport-shrink heuristic that fires identically when
    // a phone's on-screen keyboard opens — students got strikes just for focusing the editor.
    // Both must stay logged-but-never-penalized.
    assert.equal(VIOLATION_SEVERITY.BROWSER_SHORTCUT, "INTERRUPTION");
    assert.equal(VIOLATION_SEVERITY.SCREEN_OVERLAY_DETECTED, "INTERRUPTION");
  });

  test("SUSPICIOUS types — restricted actions / heuristics with a real false-positive rate", () => {
    for (const type of ["MULTI_MONITOR", "DEVTOOLS", "COPY", "PASTE", "CUT", "RIGHT_CLICK", "DRAG_ATTEMPT", "PRINT_SCREEN_ATTEMPT"]) {
      assert.equal(VIOLATION_SEVERITY[type], "SUSPICIOUS", `${type} should be SUSPICIOUS`);
    }
  });

  test("an unrecognized event type defaults to INTERRUPTION, not SUSPICIOUS/CONFIRMED — never penalize what this file doesn't explicitly know", () => {
    const { severity, penalized } = classifyViolation("SOMETHING_MADE_UP");
    assert.equal(severity, "INTERRUPTION");
    assert.equal(penalized, false);
  });
});

describe("classifyViolation", () => {
  test("CONFIRMED_VIOLATION is always penalized, even on the very first occurrence", () => {
    const { severity, penalized } = classifyViolation("TAB_SWITCH", 0);
    assert.equal(severity, "CONFIRMED_VIOLATION");
    assert.equal(penalized, true);
  });

  test("INTERRUPTION (incl. BROWSER_SHORTCUT) is never penalized no matter how many times it recurs", () => {
    for (const priorCount of [0, 1, 2, 10, 100]) {
      assert.equal(classifyViolation("BROWSER_SHORTCUT", priorCount).penalized, false, `priorCount=${priorCount}`);
      assert.equal(classifyViolation("FACE_MISSING", priorCount).penalized, false, `priorCount=${priorCount}`);
    }
  });

  test(`SUSPICIOUS only escalates to a penalized strike every ${SUSPICIOUS_ESCALATION_THRESHOLD}th occurrence`, () => {
    // priorSuspiciousCount is "how many SUSPICIOUS events already logged BEFORE this one" — so
    // priorCount=0 is the 1st occurrence, priorCount=2 is the 3rd, etc.
    const results = [0, 1, 2, 3, 4, 5].map((priorCount) => classifyViolation("COPY", priorCount).penalized);
    assert.deepEqual(results, [false, false, true, false, false, true]);
  });

  test("SUSPICIOUS escalation counts MIXED types together, not per-type — one stray right-click plus two copy attempts still escalates on the 3rd", () => {
    // The route layer passes a single shared priorSuspiciousCount across every SUSPICIOUS type on
    // the attempt (see tests.js's own comment) — this just asserts classifyViolation applies the
    // threshold uniformly regardless of which SUSPICIOUS type is passed.
    assert.equal(classifyViolation("RIGHT_CLICK", 2).penalized, true);
    assert.equal(classifyViolation("PASTE", 2).penalized, true);
  });
});
