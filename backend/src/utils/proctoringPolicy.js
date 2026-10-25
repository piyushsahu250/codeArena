// Versioned exam-integrity RULE CATALOG: which observed events can be a confirmed violation of a PUBLISHED exam rule, and what each one honestly shows.
//
// The decision is made on the SERVER from (a) the stored event type, (b) the test's own policy and (c) the stored metadata. Nothing the browser sends can say
// "confirmed": there is no such field to send, and an unknown type has no rule. A rule confirms an event only when ALL of these hold:
//   1. the exam policy prohibits the action (a switch the administrator turned on, or a rule every exam publishes), and
//   2. the exam shows students that rule before the attempt (the pre-start notice), and
//   3. the event itself is something the page directly observed (a keydown, a copy event, the page being hidden), not an inference.
// CONFIRMED_POLICY_VIOLATION means "the prohibited action, or the attempt at it, was observed". It never means an external app was opened or used, an extension is
// installed, or the student cheated; each rule's `shows` / `doesNotShow` text says exactly that, and the dashboards display it.
//
// What a web page can do about each action is stated per rule as the enforcement outcome: the page can ASK the browser to cancel an event (BLOCK_ATTEMPTED; it
// cannot verify the browser honoured it) but it cannot stop leaving the page, DevTools opened from the browser menu, or an operating-system assistant. Strict enforcement of
// those needs a managed device or the secure exam client.
const POLICY_VERSION = "2026-10-25.1";
const CONFIRMED = "CONFIRMED_POLICY_VIOLATION";

const ENFORCEMENT = Object.freeze({
  BLOCK_ATTEMPTED: "BLOCK_ATTEMPTED", // the page asked the browser to cancel the event; whether it was honoured cannot be verified
  NOT_BLOCKABLE: "NOT_BLOCKABLE", // a web page cannot prevent this action
  OBSERVED_ONLY: "OBSERVED_ONLY", // recorded, nothing was cancelled
});

// Human description of a combination from the stored metadata (never from free text).
function comboOf(meta) {
  if (!meta || typeof meta !== "object") return null;
  const parts = [];
  if (meta.ctrlKey) parts.push("Ctrl");
  if (meta.altKey) parts.push("Alt");
  if (meta.metaKey) parts.push("Win/Cmd");
  if (meta.shiftKey) parts.push("Shift");
  const key = typeof meta.code === "string" && meta.code ? meta.code : typeof meta.key === "string" ? meta.key : "";
  if (key) parts.push(key);
  return parts.length ? parts.join("+") : null;
}

// ruleId -> definition. `appliesTo`: event types. `prohibited(policy, type)`: is it prohibited AND published for this exam? `enforcement(type, meta)`: outcome.
const RULES = {
  PAGE_DEPARTURE: {
    title: "Leaving the exam page",
    appliesTo: ["TAB_SWITCH", "FULLSCREEN_EXIT"],
    // Every exam tells students that switching tabs is tracked; fullscreen exit is published only when the test requires fullscreen.
    prohibited: (policy, type) => (type === "FULLSCREEN_EXIT" ? policy.requireFullscreen !== false : true),
    enforcement: () => ENFORCEMENT.NOT_BLOCKABLE,
    describe: (type) => (type === "FULLSCREEN_EXIT" ? "The exam page left fullscreen" : "The exam page was hidden for longer than the grace period (tab switch, minimise or similar)"),
    shows: "The exam page was left or hidden, which the exam rules prohibit.",
    doesNotShow: "Which app or tab was opened, what was viewed, that an assistant was used, or why (a call, a lock screen and a system dialog look the same to a page).",
  },
  AI_SHORTCUT_ATTEMPT: {
    title: "Prohibited assistant shortcut",
    appliesTo: ["COPILOT_KEY_SIGNAL", "AI_SHORTCUT_DETECTED"],
    prohibited: (policy) => policy.blockAiShortcuts === true,
    enforcement: (type, meta) => (meta && meta.cancelAttempted ? ENFORCEMENT.BLOCK_ATTEMPTED : ENFORCEMENT.OBSERVED_ONLY),
    describe: (type, meta) => `Prohibited assistant shortcut attempt${comboOf(meta) ? ` (${comboOf(meta)})` : ""}`,
    shows: "A key combination that the exam rules prohibit reached the exam page.",
    doesNotShow: "That an assistant opened, which assistant it was, or that it was used. The operating system may handle such a key before the browser sees it.",
  },
  // Added 2026-10-25 at the administrator's request: the exam page losing focus is a rule every exam publishes (the pre-start notice of the test page says so). The first time is
  // a warning and the second and later times are counted as strikes (utils/proctoringSeverity.js, STRIKE_FROM_OCCURRENCE). The finding says what the page saw and never why.
  FOCUS_LOSS: {
    title: "Keeping the exam page in focus",
    appliesTo: ["POSSIBLE_EXTERNAL_ASSISTANT"],
    prohibited: () => true,
    enforcement: () => ENFORCEMENT.NOT_BLOCKABLE,
    describe: () => "The exam page lost focus while it was still visible",
    shows: "The exam page lost focus while it was open, which the exam rules ask students to avoid. The first time is a warning; repeats are counted.",
    doesNotShow: "Which app or window took the focus, that an assistant was used, or why. Notifications, system dialogs, phone calls and input methods cause the same signal.",
  },
  CLIPBOARD: {
    title: "Copy, paste or cut",
    appliesTo: ["COPY", "PASTE", "CUT"],
    // Published only in the "secure assessment" notice of PROCTORED tests, and only for the actions the policy blocks.
    prohibited: (policy, type) => policy.level === "PROCTORED" && ({ COPY: policy.blockCopy, PASTE: policy.blockPaste, CUT: policy.blockCut }[type] === true),
    enforcement: () => ENFORCEMENT.BLOCK_ATTEMPTED,
    describe: (type) => `${type === "COPY" ? "Copy" : type === "PASTE" ? "Paste" : "Cut"} attempt on the exam page`,
    shows: "A clipboard action that the exam rules prohibit was attempted on the exam page.",
    doesNotShow: "What was copied or pasted (the clipboard is never read) or where it came from or went.",
  },
};
const RULE_BY_TYPE = {};
for (const [id, def] of Object.entries(RULES)) for (const t of def.appliesTo) RULE_BY_TYPE[t] = id;

// Event types that are never confirmed by the browser alone, with the reason (shown to reviewers).
const NEVER_CONFIRMED = {
  DEVTOOLS: "Inferred from window size. A page cannot tell whether DevTools is open, so this stays suspected or inconclusive unless a managed client reports it.",
  BROWSER_SHORTCUT: "Editors and muscle memory use the same combinations, and a keydown does not show that the browser action happened.",
  PRINT_SCREEN_ATTEMPT: "A key press does not show that a capture was taken.",
  DRAG_ATTEMPT: "The page does not yet record where a drag started or ended, so a drag inside the code editor cannot be told apart from a prohibited drag.",
  SPLIT_SCREEN_SUSPECTED: "A window-size heuristic.",
  TAB_SWITCH_BRIEF: "A short loss of visibility, usually a notification or system prompt; it did not pass the grace period.",
};

// Returns null when no rule applies to this type (it then keeps the plain evidence classification), else { ruleId, confirmed, ... }.
function applyPolicy({ type, policy = {}, metadata = null }) {
  const t = String(type || "").toUpperCase();
  const ruleId = RULE_BY_TYPE[t];
  if (!ruleId) return NEVER_CONFIRMED[t] ? { ruleId: null, confirmed: false, note: NEVER_CONFIRMED[t], version: POLICY_VERSION } : null;
  const rule = RULES[ruleId];
  const prohibited = !!rule.prohibited(policy, t);
  return {
    ruleId, version: POLICY_VERSION, title: rule.title, confirmed: prohibited,
    enforcement: rule.enforcement(t, metadata), description: rule.describe(t, metadata),
    shows: rule.shows, doesNotShow: rule.doesNotShow,
    note: prohibited ? null : "The exam policy does not prohibit this action, so it is recorded as an observation only.",
  };
}

module.exports = { POLICY_VERSION, CONFIRMED, ENFORCEMENT, RULES, RULE_BY_TYPE, NEVER_CONFIRMED, applyPolicy, comboOf };
