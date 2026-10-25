// Regression test for src/utils/violationLog.js (the proctoring log shown to staff on the test results page). Pure logic: no browser, no server.
// The first scenario is the one reported from the live page: a right-click, two copy attempts (the second counted) and a full-screen exit, for a strike total of 2.
// Run: node frontend/scripts/violationLogRegression.mjs
import { EVENT_LABEL, buildViolationLog, countOutcome, eventLabel, observationOf } from "../src/utils/violationLog.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const at = (h, m, s) => new Date(Date.UTC(2026, 9, 25, h, m, s)).toISOString();
const policy = { ruleId: "CLIPBOARD", title: "Copy, paste or cut", enforcement: "BLOCK_ATTEMPTED", description: "Copy attempt on the exam page", shows: "A clipboard action was attempted.", doesNotShow: "What was copied.", version: "2026-10-16.1" };

// 1. The reported scenario, deliberately given OUT of time order (as a database may return it).
const reported = [
  { id: "d", type: "FULLSCREEN_EXIT", severity: "CONFIRMED_VIOLATION", penalized: true, counted: true, createdAt: at(11, 29, 44), evidence: { classification: "CONFIRMED_POLICY_VIOLATION", policy: { ...policy, ruleId: "PAGE_DEPARTURE", enforcement: "NOT_BLOCKABLE" } } },
  { id: "b", type: "COPY", severity: "SUSPICIOUS", penalized: false, counted: true, createdAt: at(10, 58, 20), evidence: { classification: "OBSERVED_EVENT", policy } },
  { id: "a", type: "RIGHT_CLICK", severity: "SUSPICIOUS", penalized: false, counted: true, createdAt: at(10, 48, 14), evidence: { classification: "OBSERVED_EVENT", policy: { note: "No exam rule applies" } } },
  { id: "c", type: "COPY", severity: "SUSPICIOUS", penalized: true, counted: true, createdAt: at(10, 58, 39), evidence: { classification: "OBSERVED_EVENT", policy } },
];
{
  const { rows, summary } = buildViolationLog(reported, 2);
  check("events are shown oldest first", rows.map((r) => r.ev.id).join("") === "abcd", rows.map((r) => r.ev.id).join(""));
  check("a single right-click and the first copy are warnings, not strikes", rows[0].outcome.kind === "warning" && rows[1].outcome.kind === "warning");
  check("the repeated copy is Strike 1 and the full-screen exit is Strike 2", rows[2].strikeNumber === 1 && rows[3].strikeNumber === 2 && rows.slice(0, 2).every((r) => r.strikeNumber === null));
  check("the summary matches: 4 events, 2 strikes, 2 warnings, 1 prohibited action", summary.events === 4 && summary.strikes === 2 && summary.warnings === 2 && summary.prohibited === 1, JSON.stringify(summary));
  check("a total of 2 agrees with the 2 counted events: no mismatch is reported", summary.mismatch === false);
  check("the reasons explain the counting without claiming misconduct", rows[2].outcome.reason.includes("repeated") && rows[3].outcome.reason.includes("first occurrence") && rows.every((r) => !/guilty|cheat|misconduct was/i.test(r.outcome.reason)));
}

// 2. A strike total that the listed events do not add up to is reported, not hidden.
{
  const { summary } = buildViolationLog(reported, 5);
  check("a strike total of 5 against 2 counted events is flagged", summary.mismatch === true && summary.strikeTotal === 5 && summary.strikes === 2);
  check("an unknown strike total is never flagged", buildViolationLog(reported, null).summary.mismatch === false && buildViolationLog(reported, undefined).summary.strikeTotal === null);
}

// 3. Counting outcomes follow the server's own flags.
check("a signal stored outside the strike table is never counted", countOutcome({ counted: false, penalized: false, severity: null }).kind === "signal");
check("an interruption is recorded only", countOutcome({ counted: true, penalized: false, severity: "INTERRUPTION" }).kind === "interruption");
check("a confirmed violation that was penalized is a strike", countOutcome({ counted: true, penalized: true, severity: "CONFIRMED_VIOLATION" }).kind === "strike");
check("a penalized event of unknown severity is still a strike", countOutcome({ counted: true, penalized: true, severity: "SOMETHING_NEW" }).kind === "strike");
check("an unpenalized event of unknown severity is not a strike", countOutcome({ counted: true, penalized: false, severity: "SOMETHING_NEW" }).kind === "interruption");

// 4. Names and observations.
check("every named event type reads as a sentence, not a raw code", Object.values(EVENT_LABEL).every((l) => /^[A-Z][a-z]/.test(l) && !/_/.test(l)));
check("the full-screen exit and right-click are named in plain words", eventLabel("FULLSCREEN_EXIT") === "Left full-screen mode" && eventLabel("RIGHT_CLICK") === "Right-click on the exam page");
check("an unknown type becomes readable instead of SHOUTING", eventLabel("SOME_NEW_EVENT") === "Some new event" && eventLabel("") === "Unknown event");
check("a prohibited action is labelled as observed, not as proven", observationOf({ evidence: { classification: "CONFIRMED_POLICY_VIOLATION" } }).label === "Prohibited action observed");
check("no classification defaults to a plain observation", observationOf({}).label === "Observed (browser signal)" && observationOf({}).tone === "neutral");

// 4b. The exam page losing focus (2026-10-25 rule): a warning the first time, a strike from the second. The wording follows what the server did to each event.
{
  const focus = (id, penalized, min) => ({ id, type: "POSSIBLE_EXTERNAL_ASSISTANT", severity: "SUSPICIOUS", penalized, counted: true, createdAt: at(10, min, 0) });
  const now = buildViolationLog([focus("c", true, 30), focus("a", false, 10), focus("b", true, 20)], 2);
  check("focus loss: 1st is a warning, 2nd and 3rd are Strike 1 and Strike 2", now.rows.map((r) => r.outcome.kind + ":" + r.strikeNumber).join(",") === "warning:null,strike:1,strike:2", now.rows.map((r) => r.outcome.kind + ":" + r.strikeNumber).join(","));
  check("focus loss: the reasons say the first time is only a warning and repeats count", now.rows[0].outcome.reason.includes("first time") && now.rows[1].outcome.reason.includes("more than once"));
  // an attempt recorded under the previous rule: the 2nd focus loss was NOT counted by the server, and the page must not claim it should have been
  const before = buildViolationLog([focus("a", false, 10), focus("b", false, 20)], 0);
  check("an older attempt: an uncounted repeat is described as recorded before repeats were counted", before.rows[1].outcome.kind === "warning" && before.rows[1].outcome.reason.includes("before repeats"), before.rows[1].outcome.reason);
  check("an older attempt: no strike is invented", before.summary.strikes === 0 && before.summary.mismatch === false);
  // under the previous rule a FIRST focus loss could be counted (as the 3rd suspicious event overall): the page then uses the generic reason, not a claim about repeats
  const oldFirst = buildViolationLog([focus("a", true, 10)], 1);
  check("an older attempt: a counted first focus loss does not claim it was a repeat", oldFirst.rows[0].outcome.kind === "strike" && !oldFirst.rows[0].outcome.reason.includes("more than once"), oldFirst.rows[0].outcome.reason);
  check("focus loss events of other types are not mixed into its occurrence count", buildViolationLog([{ id: 1, type: "COPY", severity: "SUSPICIOUS", penalized: false, counted: true, createdAt: at(9, 0, 0) }, focus("a", false, 10)], 0).rows[1].outcome.reason.includes("first time"));
  check("focus loss is named in plain words", eventLabel("POSSIBLE_EXTERNAL_ASSISTANT") === "Exam page lost focus (cause unknown)");
}

// 5. Edge cases.
{
  const empty = buildViolationLog([], 0);
  check("no events: empty rows, zero strikes, no mismatch", empty.rows.length === 0 && empty.summary.strikes === 0 && empty.summary.mismatch === false);
  check("events that is not a list is treated as empty", buildViolationLog(undefined, 0).rows.length === 0 && buildViolationLog({}, 0).rows.length === 0);
  const same = buildViolationLog([{ id: 1, type: "COPY", penalized: true, counted: true, severity: "SUSPICIOUS", createdAt: at(10, 0, 0) }, { id: 2, type: "PASTE", penalized: true, counted: true, severity: "SUSPICIOUS", createdAt: at(10, 0, 0) }], 2);
  check("events with the same time keep their original order and are numbered 1 and 2", same.rows.map((r) => r.strikeNumber).join(",") === "1,2");
  const bad = buildViolationLog([{ id: 1, type: "COPY", createdAt: "not a date" }, { id: 2, type: "PASTE", createdAt: at(9, 0, 0) }], 0);
  check("an unreadable time does not break the log", bad.rows.length === 2);
}

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
