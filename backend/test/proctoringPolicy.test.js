// The versioned exam-rule catalog and the way it turns stored events into findings. What these tests pin down:
//  - a finding needs a published rule, the matching policy switch and a directly observed event; nothing the client sends can raise it
//  - heuristics (DevTools, drag, external assistant, split screen, shortcuts) never become a confirmed finding from the browser alone
//  - no finding or label names an app, extension or assistant, and none claims a blocked action succeeded
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/utils/proctoringPolicy");
const E = require("../src/utils/evidenceClassification");
const { policyOf } = require("../src/utils/testExamSecurity");

const standard = policyOf({ securityLevel: "STANDARD", requireFullscreen: true });
const proctored = policyOf({ securityLevel: "PROCTORED", requireFullscreen: true });
const aiOn = policyOf({ securityLevel: "STANDARD", requireFullscreen: true, securityPolicy: { blockAiShortcuts: true } });
const noFullscreen = policyOf({ securityLevel: "STANDARD", requireFullscreen: false });

const confirmedOf = (type, policy, metadata = null) => E.annotateEvents([{ id: "1", type, metadata }], policy)[0].evidence;

test("the policy carries a version and every rule names what it shows and what it does not", () => {
  assert.match(P.POLICY_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  for (const [id, rule] of Object.entries(P.RULES)) {
    assert.ok(rule.title && rule.shows.length > 20 && rule.doesNotShow.length > 20, `${id} states both sides`);
    assert.ok(rule.appliesTo.length > 0);
  }
});

test("a page departure is a finding under the 'leaving the exam page' rule, never proof of assistance", () => {
  const ev = confirmedOf("TAB_SWITCH", standard);
  assert.equal(ev.classification, "CONFIRMED_POLICY_VIOLATION");
  assert.equal(ev.policy.ruleId, "PAGE_DEPARTURE");
  assert.equal(ev.policy.version, P.POLICY_VERSION);
  assert.equal(ev.policy.enforcement, "NOT_BLOCKABLE");
  assert.match(ev.policy.doesNotShow, /Which app or tab was opened/);
  assert.match(ev.rationale, /does not show that an assistant or another app was used/);
  assert.equal(ev.confirmed, false, "the reviewer-only 'confirmed' flag is never set automatically");
});

test("fullscreen exit is prohibited only when the test requires fullscreen", () => {
  assert.equal(confirmedOf("FULLSCREEN_EXIT", standard).classification, "CONFIRMED_POLICY_VIOLATION");
  const ev = confirmedOf("FULLSCREEN_EXIT", noFullscreen);
  assert.notEqual(ev.classification, "CONFIRMED_POLICY_VIOLATION");
  assert.match(ev.policy.note, /does not prohibit/);
});

test("a brief page hide (under the grace period) is never a finding", () => {
  const ev = confirmedOf("TAB_SWITCH_BRIEF", proctored);
  assert.equal(ev.classification, "OBSERVED_EVENT");
  assert.equal(ev.policy.ruleId, null);
});

test("assistant shortcuts are a finding only when the test prohibits them, and the outcome says 'attempted', never 'blocked'", () => {
  const meta = { code: "KeyC", key: "c", ctrlKey: true, altKey: true, cancelAttempted: true };
  for (const type of ["COPILOT_KEY_SIGNAL", "AI_SHORTCUT_DETECTED"]) {
    const off = confirmedOf(type, standard, meta);
    assert.equal(off.classification, "OBSERVED_EVENT", "the switch is off by default, so it is an observation only");
    assert.match(off.policy.note, /does not prohibit/);
    const on = confirmedOf(type, aiOn, meta);
    assert.equal(on.classification, "CONFIRMED_POLICY_VIOLATION");
    assert.equal(on.policy.ruleId, "AI_SHORTCUT_ATTEMPT");
    assert.equal(on.policy.enforcement, "BLOCK_ATTEMPTED");
    assert.match(on.policy.description, /Ctrl\+Alt\+KeyC/);
    assert.match(on.policy.doesNotShow, /assistant opened/);
  }
  assert.equal(confirmedOf("AI_SHORTCUT_DETECTED", aiOn, { code: "KeyZ", ctrlKey: true }).policy.enforcement, "OBSERVED_ONLY", "no cancel was attempted, so nothing is claimed about blocking");
  assert.doesNotMatch(JSON.stringify(confirmedOf("COPILOT_KEY_SIGNAL", aiOn, meta)), /\bblocked\b|prevented|stopped/i, "a cancel attempt is never described as a success");
});

test("clipboard attempts are findings only where the exam publishes the rule (PROCTORED) and the action is blocked", () => {
  assert.equal(confirmedOf("PASTE", standard).classification, "OBSERVED_EVENT");
  for (const t of ["COPY", "PASTE", "CUT"]) assert.equal(confirmedOf(t, proctored).classification, "CONFIRMED_POLICY_VIOLATION");
  const p = policyOf({ securityLevel: "PROCTORED", requireFullscreen: true, securityPolicy: { blockPaste: false } });
  assert.notEqual(confirmedOf("PASTE", p).classification, "CONFIRMED_POLICY_VIOLATION");
  assert.equal(confirmedOf("PASTE", proctored).policy.enforcement, "BLOCK_ATTEMPTED");
});

test("heuristic signals never reach a confirmed finding, whatever the policy and however often they repeat", () => {
  for (const type of Object.keys(P.NEVER_CONFIRMED)) {
    for (const policy of [standard, proctored, aiOn]) {
      const events = Array.from({ length: 50 }, (_, i) => ({ id: String(i), type }));
      for (const out of E.annotateEvents(events, policy)) {
        assert.notEqual(out.evidence.classification, "CONFIRMED_POLICY_VIOLATION", `${type} must not be confirmed`);
        assert.notEqual(out.evidence.classification, "CONFIRMED_VIOLATION");
        assert.ok(["OBSERVED_EVENT", "SUSPECTED_ACTIVITY", "INCONCLUSIVE"].includes(out.evidence.classification));
      }
    }
  }
  assert.ok(P.NEVER_CONFIRMED.DEVTOOLS && P.NEVER_CONFIRMED.DRAG_ATTEMPT && P.NEVER_CONFIRMED.POSSIBLE_EXTERNAL_ASSISTANT && P.NEVER_CONFIRMED.BROWSER_SHORTCUT);
});

test("unknown, empty or ordinary-key types have no rule and are never confirmed", () => {
  for (const type of ["SOMETHING_NEW", "", undefined, "KEY_A", "CAPS_LOCK", "SHIFT"]) {
    assert.equal(P.applyPolicy({ type, policy: proctored }), null);
    assert.notEqual(confirmedOf(type, proctored).classification, "CONFIRMED_POLICY_VIOLATION");
  }
});

test("a forged client flag cannot raise a finding: metadata supplies wording only, never the classification", () => {
  const hostile = { confirmed: true, classification: "CONFIRMED_VIOLATION", ruleId: "PAGE_DEPARTURE", enforcement: "BLOCKED", description: "ChatGPT opened" };
  for (const type of ["DEVTOOLS", "DRAG_ATTEMPT", "POSSIBLE_EXTERNAL_ASSISTANT", "BROWSER_SHORTCUT"]) {
    const ev = confirmedOf(type, aiOn, hostile);
    assert.notEqual(ev.classification, "CONFIRMED_POLICY_VIOLATION");
    assert.notEqual(ev.classification, "CONFIRMED_VIOLATION");
  }
  const ev = confirmedOf("AI_SHORTCUT_DETECTED", standard, hostile);
  assert.equal(ev.classification, "OBSERVED_EVENT", "the policy switch is off, so nothing the client sent matters");
  const on = confirmedOf("AI_SHORTCUT_DETECTED", aiOn, hostile);
  assert.doesNotMatch(JSON.stringify(on), /ChatGPT/, "free text in metadata never reaches the finding");
  assert.equal(on.policy.enforcement, "OBSERVED_ONLY");
});

test("no finding or limit text names a specific assistant, app or extension", () => {
  const types = [...Object.keys(E.RULES), ...Object.keys(P.NEVER_CONFIRMED), "TAB_SWITCH", "FULLSCREEN_EXIT", "COPY", "PASTE", "CUT"];
  for (const policy of [standard, proctored, aiOn]) {
    for (const type of types) {
      assert.doesNotMatch(JSON.stringify(confirmedOf(type, policy, { code: "KeyC", ctrlKey: true, cancelAttempted: true })), /ChatGPT|Gemini|Copilot app|Claude|Perplexity|extension is installed/i, type);
    }
  }
});

test("annotateEvents without a policy keeps the old ceiling; with a policy the input is still not mutated", () => {
  const events = [{ id: "1", type: "TAB_SWITCH", metadata: null }];
  const frozen = JSON.stringify(events);
  assert.equal(E.annotateEvents(events)[0].evidence.classification, "OBSERVED_EVENT");
  assert.equal(E.annotateEvents(events, standard)[0].evidence.classification, "CONFIRMED_POLICY_VIOLATION");
  assert.equal(JSON.stringify(events), frozen);
});
