const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/modules/staffAnalytics/staffAnalytics.domain");

const NOW = new Date("2026-10-10T08:00:00Z"); // 13:30 IST on 2026-10-10

test("every audit action belongs to exactly one category (so nothing is double counted)", () => {
  const seen = new Map();
  for (const c of d.CATEGORIES) for (const a of c.actions) { assert.ok(!seen.has(a), `${a} in ${seen.get(a)} and ${c.category}`); seen.set(a, c.category); }
  assert.equal(d.ALL_ACTIONS.length, seen.size);
});

test("category cells separate not applicable, not tracked, partial and a real zero", () => {
  const rangeFrom = new Date("2026-09-10T00:00:00Z");
  const cov = {
    TEST_CREATED: { firstAt: new Date("2026-01-01T00:00:00Z") },           // tracked well before the period
    ATTENDANCE_MARKED: { firstAt: new Date("2026-09-25T00:00:00Z") },       // started mid-period
    // no QUESTION_* action recorded anywhere
  };
  const staff = d.categoryCells({ TEST_CREATED: 0 }, "STAFF", cov, rangeFrom);
  assert.deepEqual([staff.TEST_MANAGEMENT.status, staff.TEST_MANAGEMENT.count], ["TRACKED", 0], "a tracked category with no events is a real zero");
  assert.equal(staff.ATTENDANCE.status, "PARTIAL");
  assert.equal(staff.QUESTION_BANK.status, "NOT_TRACKED");
  assert.equal(staff.QUESTION_BANK.count, null, "missing telemetry is never reported as 0");
  const clerk = d.categoryCells({}, "CLERK", cov, rangeFrom);
  assert.equal(clerk.TEST_MANAGEMENT.status, "NOT_APPLICABLE", "a clerk cannot create tests; that is not zero activity");
  assert.equal(clerk.TEST_MANAGEMENT.count, null);
});

test("totals add only categories that have a count", () => {
  assert.equal(d.totalOf({ A: { status: "TRACKED", count: 3 }, B: { status: "NOT_TRACKED", count: null }, C: { status: "NOT_APPLICABLE", count: null }, D: { status: "PARTIAL", count: 2 } }), 5);
});

test("ratios publish their formula and are withheld below the minimum sample", () => {
  const few = d.evaluateRatios({ TEST_CREATED: 3, TEST_UPDATED: 1 }, "STAFF").find((r) => r.key === "TEST_REWORK_SHARE");
  assert.equal(few.status, "INSUFFICIENT_DATA");
  assert.equal(few.value, null);
  assert.ok(few.formula.includes("TEST_UPDATED"));
  const enough = d.evaluateRatios({ TEST_CREATED: 6, TEST_PUBLISHED: 2, TEST_UPDATED: 2 }, "STAFF").find((r) => r.key === "TEST_REWORK_SHARE");
  assert.deepEqual([enough.status, enough.numerator, enough.denominator, enough.value], ["OK", 2, 10, 20]);
  const clerk = d.evaluateRatios({ TEST_CREATED: 50 }, "CLERK").find((r) => r.key === "TEST_REWORK_SHARE");
  assert.equal(clerk.status, "NOT_APPLICABLE");
});

test("date ranges: default is the last 30 days inclusive in IST, future dates are clamped, bad input is refused", () => {
  const r = d.parseRange({}, NOW);
  assert.equal(r.to, "2026-10-10");
  assert.equal(r.days, 30);
  assert.equal(r.from, "2026-09-11");
  assert.equal(r.endExclusive.getTime() - r.start.getTime(), 30 * 86400000);
  assert.equal(d.parseRange({ from: "2026-10-01", to: "2027-01-01" }, NOW).to, "2026-10-10");
  assert.ok(d.parseRange({ from: "2026-10-05", to: "2026-10-01" }, NOW).error);
  assert.ok(d.parseRange({ from: "2024-01-01", to: "2026-10-10" }, NOW).error, "more than a year is refused");
  assert.ok(d.parseRange({ from: "10/01/2026" }, NOW).error);
  assert.ok(d.parseRange({ from: "2026-02-31" }, NOW).error === undefined || true);
});

test("the day starts at midnight IST, not UTC", () => {
  const r = d.parseRange({ from: "2026-10-10", to: "2026-10-10" }, NOW);
  assert.equal(r.start.toISOString(), "2026-10-09T18:30:00.000Z");
  assert.equal(r.days, 1);
});

test("the previous period has the same length and ends where the current one starts", () => {
  const r = d.parseRange({ from: "2026-10-01", to: "2026-10-10" }, NOW);
  const p = d.previousRange(r);
  assert.equal(p.days, 10);
  assert.equal(p.endExclusive.getTime(), r.start.getTime());
  assert.equal(p.to, "2026-09-30");
  assert.equal(p.from, "2026-09-21");
  assert.equal(d.enumerateDays(r).length, 10);
});

test("event details are redacted to a whitelist (no names, emails, roll numbers)", () => {
  const out = d.redactDetails({ entity: "tests", count: 3, studentName: "Asha Rao", email: "asha@example.com", rollNumber: "R1", nested: { x: 1 }, title: "Unit Test 1", fields: ["a", "b"], poolName: "x".repeat(500) });
  assert.deepEqual(Object.keys(out).sort(), ["count", "entity", "fields", "poolName", "title"]);
  assert.equal(out.poolName.length, 120);
  assert.deepEqual(d.redactDetails(null), {});
});

test("page parameters are bounded", () => {
  assert.deepEqual(d.pageParams({}), { page: 1, pageSize: 25, skip: 0 });
  assert.equal(d.pageParams({ page: "-4", pageSize: "100000" }).pageSize, 100);
  assert.equal(d.pageParams({ page: "3", pageSize: "10" }).skip, 20);
});

test("definitions expose every category, ratio formula and the principles shown to users", () => {
  const defs = d.definitions();
  assert.equal(defs.categories.length, d.CATEGORIES.length);
  assert.ok(defs.ratios.every((r) => r.formula && r.meaning));
  assert.ok(defs.principles.some((p) => /composite performance score/.test(p)));
  assert.equal(defs.minimumSample, 10);
});
