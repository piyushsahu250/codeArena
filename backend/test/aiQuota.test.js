// The AI daily-quota decision (services/ai/rateLimits.js). REGRESSION (2026-10 audit): only an institute-wide and a platform-wide daily budget existed, so one account at the
// route limit of 5 calls a minute could use an institute's whole day (300) in about an hour, and a few accounts the platform's (2000). A per-user cap now sits alongside them.
const test = require("node:test");
const assert = require("node:assert/strict");
const { quotaVerdict, PER_USER_DAILY_LIMIT, PER_INSTITUTE_DAILY_LIMIT, GLOBAL_DAILY_LIMIT } = require("../src/services/ai/rateLimits");

const none = { userCount: 0, instituteCount: 0, globalCount: 0 };

test("defaults: a per-user cap exists and is well below the institute and platform budgets", () => {
  assert.ok(PER_USER_DAILY_LIMIT > 0 && PER_USER_DAILY_LIMIT < PER_INSTITUTE_DAILY_LIMIT && PER_INSTITUTE_DAILY_LIMIT < GLOBAL_DAILY_LIMIT);
  assert.ok(PER_USER_DAILY_LIMIT >= 34, "the busiest user-day on the 2026-10-22 production record was 34 calls; the cap must never block that");
});

test("an unused day is allowed for everyone", () => {
  assert.equal(quotaVerdict({ userId: "u", instituteId: "i", ...none }), null);
  assert.equal(quotaVerdict({ ...none }), null);
});

test("a single user is stopped at their own cap even when the institute and platform have plenty left", () => {
  const v = quotaVerdict({ userId: "u", instituteId: "i", userCount: PER_USER_DAILY_LIMIT, instituteCount: 50, globalCount: 80 });
  assert.equal(v.quotaExceeded, "USER");
  assert.match(v.message, /You have reached your daily AI usage limit/);
  assert.equal(quotaVerdict({ userId: "u", instituteId: "i", userCount: PER_USER_DAILY_LIMIT - 1, instituteCount: 50, globalCount: 80 }), null, "one below the cap is still allowed");
});

test("the institute and platform budgets still apply, and keep their own messages", () => {
  assert.equal(quotaVerdict({ userId: "u", instituteId: "i", userCount: 1, instituteCount: PER_INSTITUTE_DAILY_LIMIT, globalCount: 10 }).quotaExceeded, "INSTITUTE");
  const g = quotaVerdict({ userId: "u", instituteId: "i", userCount: 1, instituteCount: 1, globalCount: GLOBAL_DAILY_LIMIT });
  assert.equal(g.quotaExceeded, "GLOBAL");
  assert.match(g.message, /platform's daily AI usage limit/);
});

test("when several budgets are exhausted at once the platform's is reported first, then the institute's, then the user's", () => {
  const all = { userId: "u", instituteId: "i", userCount: 9999, instituteCount: 9999, globalCount: 99999 };
  assert.equal(quotaVerdict(all).quotaExceeded, "GLOBAL");
  assert.equal(quotaVerdict({ ...all, globalCount: 0 }).quotaExceeded, "INSTITUTE");
  assert.equal(quotaVerdict({ ...all, globalCount: 0, instituteCount: 0 }).quotaExceeded, "USER");
});

test("a call with no user (the scheduled health check) is not subject to the per-user cap, and a user with no institute is not subject to the institute cap", () => {
  assert.equal(quotaVerdict({ userId: null, instituteId: "i", userCount: 9999, instituteCount: 0, globalCount: 0 }), null);
  assert.equal(quotaVerdict({ userId: "u", instituteId: null, userCount: 0, instituteCount: 9999, globalCount: 0 }), null);
  assert.equal(quotaVerdict({ userId: "u", instituteId: undefined, userCount: PER_USER_DAILY_LIMIT, instituteCount: 0, globalCount: 0 }).quotaExceeded, "USER", "a platform admin still has the per-user cap");
});

test("custom limits override the defaults", () => {
  assert.equal(quotaVerdict({ userId: "u", instituteId: "i", userCount: 5, instituteCount: 0, globalCount: 0 }, { user: 5 }).quotaExceeded, "USER");
  assert.equal(quotaVerdict({ userId: "u", instituteId: "i", userCount: 4, instituteCount: 0, globalCount: 0 }, { user: 5 }), null);
  assert.equal(quotaVerdict({ userId: "u", instituteId: "i", userCount: 0, instituteCount: 7, globalCount: 0 }, { institute: 7 }).quotaExceeded, "INSTITUTE");
});
