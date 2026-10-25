// Regression test for src/utils/autoSubmit.js (why a formal-test attempt was auto-submitted). Pure logic: no browser, no server.
// Run: node frontend/scripts/autoSubmitRegression.mjs
import { DEFAULT_STRIKE_LIMIT, explainAutoSubmit, formatDuration } from "../src/utils/autoSubmit.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const T0 = Date.UTC(2026, 9, 25, 10, 0, 0);
const at = (minutes, seconds = 0) => new Date(T0 + minutes * 60000 + seconds * 1000).toISOString();
const base = { status: "AUTO_SUBMITTED", startedAt: at(0), durationMin: 20, strikes: 0 };
const fact = (e, label) => e.facts.find((f) => f.label === label)?.value;

check("the default strike limit mirrors the server's (3)", DEFAULT_STRIKE_LIMIT === 3);

// not auto-submitted: nothing to explain
for (const status of ["SUBMITTED", "IN_PROGRESS", undefined, "", "weird"]) check(`a ${JSON.stringify(status)} attempt has no auto-submit explanation`, explainAutoSubmit({ ...base, status, submittedAt: at(20) }) === null);
check("the status is matched case-insensitively", explainAutoSubmit({ ...base, status: "auto_submitted", submittedAt: at(20) })?.reason === "TIME_EXPIRED");

// 1. strike limit
{
  const e = explainAutoSubmit({ ...base, strikes: 3, submittedAt: at(7) });
  check("3 of 3 strikes: strike limit reached", e.reason === "STRIKE_LIMIT" && e.title === "Auto-submitted: strike limit reached");
  check("it says the strike that reached the limit submitted it, and points to the counted events", /reached 3 of 3 strikes/.test(e.summary) && /counted are listed below/.test(e.summary));
  check("the strike count is shown as a fact", fact(e, "Strikes") === "3 of 3");
  check("more strikes than the limit is still the strike limit", explainAutoSubmit({ ...base, strikes: 5, submittedAt: at(7) }).reason === "STRIKE_LIMIT");
  check("the strike limit wins even if the clock had also run out", explainAutoSubmit({ ...base, strikes: 3, submittedAt: at(40) }).reason === "STRIKE_LIMIT");
  check("a different limit is honoured", explainAutoSubmit({ ...base, strikes: 2, strikeLimit: 2, submittedAt: at(5) }).reason === "STRIKE_LIMIT" && explainAutoSubmit({ ...base, strikes: 2, strikeLimit: 5, submittedAt: at(20) }).reason === "TIME_EXPIRED");
}

// 2. the student's own page submitted when the time ran out
{
  const e = explainAutoSubmit({ ...base, submittedAt: at(20, 2) });
  check("submitted 2 s after the deadline with 0 strikes: time ran out, no strikes involved", e.reason === "TIME_EXPIRED" && /No strikes were involved/.test(e.summary) && /at the deadline/.test(e.summary));
  check("the facts show start, allowed time, deadline and submit time", ["Started", "Allowed time", "Deadline", "Submitted automatically", "Strikes"].every((l) => fact(e, l)) && fact(e, "Allowed time") === "20 minutes");
  const early = explainAutoSubmit({ ...base, submittedAt: at(19, 50) });
  check("a submit 10 s before the deadline (the page's allowed margin) is still the clock", early.reason === "TIME_EXPIRED");
  const lag = explainAutoSubmit({ ...base, submittedAt: at(21, 20) });
  check("80 s after the deadline is still the student's own page (network lag)", lag.reason === "TIME_EXPIRED" && /at the deadline/.test(lag.summary) && fact(lag, "After the deadline") === "1 min 20 s");
  const some = explainAutoSubmit({ ...base, strikes: 2, submittedAt: at(20, 1) });
  check("2 strikes below the limit: says the strikes did not end it", some.reason === "TIME_EXPIRED" && /2 strikes, below the limit of 3/.test(some.summary));
  check("1 strike uses the singular", /1 strike, below/.test(explainAutoSubmit({ ...base, strikes: 1, submittedAt: at(20, 1) }).summary));
}

// 3. the server closed an attempt the page never submitted
{
  const e = explainAutoSubmit({ ...base, submittedAt: at(30) });
  check("closed 10 minutes after the deadline: the server closed it and the page did not submit", e.reason === "TIME_EXPIRED" && /did not submit the test/.test(e.summary) && /10 min after the deadline/.test(e.summary));
  check("the delay is a fact", fact(e, "After the deadline") === "10 min");
  check("it never claims misconduct", !/cheat|misconduct|guilty/i.test(JSON.stringify(e)));
}

// cannot be told
{
  const nothing = explainAutoSubmit({ status: "AUTO_SUBMITTED", strikes: 0 });
  check("no stored times and no strikes at the limit: the reason cannot be told, and it says so", nothing.reason === "UNKNOWN" && /not recorded/.test(nothing.summary));
  const early = explainAutoSubmit({ ...base, submittedAt: at(5) });
  check("submitted well before the deadline with few strikes: not the clock, not the limit, so unknown", early.reason === "UNKNOWN");
  check("a missing duration cannot be treated as time ran out", explainAutoSubmit({ status: "AUTO_SUBMITTED", startedAt: at(0), submittedAt: at(30), strikes: 0 }).reason === "UNKNOWN");
  check("garbage values do not throw", explainAutoSubmit({ status: "AUTO_SUBMITTED", startedAt: "x", submittedAt: "y", durationMin: "z", strikes: "n", strikeLimit: -1 }).reason === "UNKNOWN");
}

// durations
check("formatDuration", formatDuration(45000) === "45 s" && formatDuration(60000) === "1 min" && formatDuration(312000) === "5 min 12 s" && formatDuration(3720000) === "1 h 2 min" && formatDuration(3600000) === "1 h" && formatDuration(NaN) === "");

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
