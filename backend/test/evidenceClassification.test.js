// The evidence labels reviewers see for browser-reported proctoring events. A browser page cannot prove misconduct, so nothing it reports may be labelled
// above SUSPECTED_ACTIVITY automatically; CONFIRMED_VIOLATION is for an authorised reviewer only.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/utils/evidenceClassification");
const { VIOLATION_SEVERITY } = require("../src/utils/proctoringSeverity");

const RANK = { INCONCLUSIVE: 0, OBSERVED_EVENT: 1, SUSPECTED_ACTIVITY: 2, POLICY_VIOLATION: 3, CONFIRMED_VIOLATION: 4 };

test("no browser-reported event type can ever be labelled above SUSPECTED_ACTIVITY, however often it repeats", () => {
  const types = [...Object.keys(E.RULES), "SOMETHING_NEW", "", undefined];
  for (const type of types) {
    for (const n of [1, 2, 3, 5, 10, 100, 10000]) {
      const e = E.evidenceFor(type, n);
      assert.ok(RANK[e.classification] <= RANK[E.AUTOMATIC_CEILING], `${type} x${n} -> ${e.classification}`);
      assert.notEqual(e.classification, "CONFIRMED_VIOLATION");
      assert.notEqual(e.classification, "POLICY_VIOLATION");
      assert.equal(e.confirmed, false);
      assert.equal(e.source, "BROWSER");
      assert.ok(e.limits.length > 20, `${type} states what it cannot prove`);
    }
  }
});

test("a tab switch, even one the exam counts as a strike, is an observation first and a suspicion only when repeated", () => {
  assert.equal(E.evidenceFor("TAB_SWITCH", 1).classification, "OBSERVED_EVENT");
  assert.equal(E.evidenceFor("TAB_SWITCH", 2).classification, "SUSPECTED_ACTIVITY");
  assert.equal(E.evidenceFor("TAB_SWITCH_BRIEF", 50).classification, "OBSERVED_EVENT", "a brief hide is never more than an observation");
  assert.equal(E.evidenceFor("TAB_SWITCH", 1).category, "TAB_SWITCH");
});

test("DevTools is an unreliable size heuristic: inconclusive once, suspected only when it recurs", () => {
  assert.equal(E.evidenceFor("DEVTOOLS", 1).classification, "INCONCLUSIVE");
  assert.equal(E.evidenceFor("DEVTOOLS", 2).classification, "SUSPECTED_ACTIVITY");
  assert.match(E.evidenceFor("DEVTOOLS", 1).limits, /does not report whether DevTools is open/);
});

test("a possible external assistant is only ever 'the page lost focus'; the label never names an app or a tool", () => {
  const e = E.evidenceFor("POSSIBLE_EXTERNAL_ASSISTANT", 5);
  assert.equal(e.category, "POSSIBLE_EXTERNAL_ASSISTANCE");
  assert.equal(e.classification, "SUSPECTED_ACTIVITY");
  assert.match(e.limits, /cannot see which app, other device or assistant/);
  assert.doesNotMatch(JSON.stringify(e), /ChatGPT|Gemini|Copilot/i);
});

test("browser shortcuts and drags stay observations: pressing keys or dragging text is not evidence of cheating", () => {
  for (const n of [1, 10, 500]) assert.equal(E.evidenceFor("BROWSER_SHORTCUT", n).classification, "OBSERVED_EVENT");
  assert.equal(E.evidenceFor("DRAG_ATTEMPT", 1).classification, "OBSERVED_EVENT");
  assert.match(E.evidenceFor("DRAG_ATTEMPT", 1).limits, /text selection/);
  assert.match(E.evidenceFor("BROWSER_SHORTCUT", 1).limits, /does not prove the browser or OS action completed/);
});

test("ordinary typing keys are not an event type at all: an unknown type is inconclusive", () => {
  for (const t of ["KEY_A", "KEY_S", "KEY_D", "CAPS_LOCK", "SHIFT", "TYPING", "A", "a"]) {
    const e = E.evidenceFor(t, 1);
    assert.equal(e.classification, "INCONCLUSIVE");
    assert.equal(e.category, "OTHER");
  }
});

test("every type the severity table knows has an evidence rule (none silently falls back to 'unknown')", () => {
  for (const type of Object.keys(VIOLATION_SEVERITY)) assert.ok(E.RULES[type], `${type} has no evidence rule`);
});

test("annotateEvents counts each type separately, keeps the original fields and does not mutate its input", () => {
  const events = [
    { id: "1", type: "TAB_SWITCH", severity: "CONFIRMED_VIOLATION", penalized: true },
    { id: "2", type: "DEVTOOLS", severity: "SUSPICIOUS", penalized: false },
    { id: "3", type: "TAB_SWITCH", severity: "CONFIRMED_VIOLATION", penalized: true },
    { id: "4", type: "DEVTOOLS", severity: "SUSPICIOUS", penalized: false },
  ];
  const frozen = JSON.stringify(events);
  const out = E.annotateEvents(events);
  assert.equal(JSON.stringify(events), frozen, "input untouched");
  assert.deepEqual(out.map((e) => e.evidence.classification), ["OBSERVED_EVENT", "INCONCLUSIVE", "SUSPECTED_ACTIVITY", "SUSPECTED_ACTIVITY"]);
  assert.deepEqual(out.map((e) => e.evidence.occurrence), [1, 1, 2, 2]);
  assert.equal(out[0].severity, "CONFIRMED_VIOLATION", "the legacy counting fields are unchanged");
  assert.equal(out[0].penalized, true);
  assert.deepEqual(E.annotateEvents([]), []);
});
