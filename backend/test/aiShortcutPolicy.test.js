// The per-test switch for recording Copilot-key / AI-assistant shortcut signals. It defaults OFF everywhere, only a boolean is accepted, the browser is told
// the effective value, and the signal types carry no weight in the risk score (they are observations for a reviewer, never a verdict).
const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("../src/utils/examSecurity");
const { policyOf } = require("../src/utils/testExamSecurity");

test("blockAiShortcuts is off by default for every preset, so existing exams are unchanged", () => {
  for (const level of X.LEVELS) assert.equal(X.PRESETS[level].blockAiShortcuts, false, level);
  assert.equal(policyOf({ securityLevel: "STANDARD" }).blockAiShortcuts, false);
  assert.equal(policyOf({ securityLevel: "PROCTORED" }).blockAiShortcuts, false);
  assert.equal(policyOf({}).blockAiShortcuts, false);
});

test("an admin can switch it on per test, for either level; anything that is not a boolean is dropped", () => {
  assert.equal(policyOf({ securityLevel: "STANDARD", securityPolicy: { blockAiShortcuts: true } }).blockAiShortcuts, true);
  assert.equal(policyOf({ securityLevel: "PROCTORED", securityPolicy: { blockAiShortcuts: true } }).blockAiShortcuts, true);
  assert.deepEqual(X.sanitizePolicyOverrides({ blockAiShortcuts: true }), { blockAiShortcuts: true });
  assert.deepEqual(X.sanitizePolicyOverrides({ blockAiShortcuts: "true" }), {});
  assert.deepEqual(X.sanitizePolicyOverrides({ blockAiShortcuts: 1 }), {});
  assert.equal(policyOf({ securityLevel: "STANDARD", securityPolicy: { blockAiShortcuts: "yes" } }).blockAiShortcuts, false);
});

test("the browser receives the effective switch as a strict boolean", () => {
  assert.equal(X.clientPolicy(policyOf({ securityLevel: "STANDARD", securityPolicy: { blockAiShortcuts: true } })).blockAiShortcuts, true);
  assert.equal(X.clientPolicy(policyOf({ securityLevel: "STANDARD" })).blockAiShortcuts, false);
});

test("the signal types are observations: low severity, zero risk weight, and not something a plain browser can raise through the generic intake", () => {
  for (const t of ["COPILOT_KEY_SIGNAL", "AI_SHORTCUT_DETECTED"]) {
    assert.equal(X.EVENT_SEVERITY[t], "LOW");
    assert.equal(X.WEIGHTS[t], 0);
    assert.equal(X.CLIENT_REPORTABLE.has(t), false, "only the dedicated, policy-checked endpoint accepts them");
  }
  const risk = X.computeRisk(Array.from({ length: 12 }, () => ({ type: "COPILOT_KEY_SIGNAL" })));
  assert.equal(risk.score, 0, "twelve signals add nothing to the risk score");
});
