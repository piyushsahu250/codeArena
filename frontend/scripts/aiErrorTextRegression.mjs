// Regression test for the student-facing AI error wording. Pure functions, no DOM. Run: node frontend/scripts/aiErrorTextRegression.mjs
import { friendlyAiError, isRetryableAiError } from "../src/utils/aiErrorText.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };
const err = (status, data) => ({ response: { status, data } });

const daily = (s) => friendlyAiError(err(429, { code: "AI_DAILY_QUOTA", error: "server text", resetInSeconds: s }), "fallback");
check("daily limit names the wait in hours, rounded up", /in about 3 hours/.test(daily(2.1 * 3600)));
check("one hour is singular", /in about 1 hour\./.test(daily(3600)));
check("under an hour says so", /in under an hour/.test(daily(900)));
check("an unknown wait says later today", /later today/.test(daily(null)) && /later today/.test(daily(0)));
check("daily limit tells the student nothing is lost", /Nothing is lost/.test(daily(7200)));
check("daily limit does not tell a student to ask an administrator", !/administrator/i.test(daily(7200)));
check("another server message is shown as it is", friendlyAiError(err(429, { code: "AI_QUOTA_EXCEEDED", error: "You have reached your daily AI usage limit. Please try again tomorrow." }), "fb") === "You have reached your daily AI usage limit. Please try again tomorrow.");
check("no response falls back to the given text", friendlyAiError(new Error("network"), "Could not start the interview.") === "Could not start the interview.");
check("a missing error never throws", friendlyAiError(undefined, "fb") === "fb" && friendlyAiError(null, "fb") === "fb");

check("429, 502, 503, 504 can be retried", [429, 502, 503, 504].every((s) => isRetryableAiError(err(s, {}))));
check("401, 404, 409, 422 cannot", [401, 404, 409, 422].every((s) => !isRetryableAiError(err(s, {}))));
check("no response is not retryable", isRetryableAiError(undefined) === false && isRetryableAiError({}) === false);

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("AI error text regression: all passed");
