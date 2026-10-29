const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/utils/interviewViolationPolicy");
const { VIOLATION_SEVERITY } = require("../src/utils/proctoringSeverity");

test("every type the severity map knows is accepted", () => {
  for (const type of Object.keys(VIOLATION_SEVERITY)) assert.equal(P.isKnownViolationType(type), true, type);
});

test("unknown, empty and prototype-chain names are rejected", () => {
  for (const bad of ["", "UNKNOWN", "tab switch", "TAB_SWITCH ", "CONSTRUCTOR", "__PROTO__", "TOSTRING", "HASOWNPROPERTY"]) {
    assert.equal(P.isKnownViolationType(bad), false, JSON.stringify(bad));
  }
});

test("normalizeViolationType trims, upper-cases, caps at 40 and survives non-strings", () => {
  assert.equal(P.normalizeViolationType("  tab_switch "), "TAB_SWITCH");
  assert.equal(P.normalizeViolationType("x".repeat(100)).length, 40);
  assert.equal(P.normalizeViolationType(undefined), "");
  assert.equal(P.normalizeViolationType(null), "");
  assert.equal(P.normalizeViolationType(42), "42");
  assert.equal(P.normalizeViolationType({}), "[OBJECT OBJECT]");
});

test("a lower-case client type is accepted after normalising, a garbage one is not", () => {
  assert.equal(P.isKnownViolationType(P.normalizeViolationType("fullscreen_exit")), true);
  assert.equal(P.isKnownViolationType(P.normalizeViolationType("drop table")), false);
});

test("an event repeated inside the window is a duplicate, one after it is not", () => {
  const now = 1_000_000;
  assert.equal(P.isDuplicateEvent(now - 500, now, 2000), true);
  assert.equal(P.isDuplicateEvent(now - 1999, now, 2000), true);
  assert.equal(P.isDuplicateEvent(now - 2000, now, 2000), false);
  assert.equal(P.isDuplicateEvent(now - 60000, now, 2000), false);
});

test("no earlier event, or an unreadable time, is never a duplicate", () => {
  assert.equal(P.isDuplicateEvent(null, 1000, 2000), false);
  assert.equal(P.isDuplicateEvent(undefined, 1000, 2000), false);
  assert.equal(P.isDuplicateEvent("not a date", 1000, 2000), false);
});

test("Date objects and ISO strings work as the stored time", () => {
  const now = Date.now();
  assert.equal(P.isDuplicateEvent(new Date(now - 100), now, 2000), true);
  assert.equal(P.isDuplicateEvent(new Date(now - 100).toISOString(), now, 2000), true);
});

test("a stored time slightly in the future (clock skew) counts as just now", () => {
  const now = 1_000_000;
  assert.equal(P.isDuplicateEvent(now + 300, now, 2000), true);
});

test("the default window is 2 s, and a type with its own window keeps it", () => {
  assert.equal(P.duplicateWindowMs("TAB_SWITCH"), P.DEFAULT_DUPLICATE_WINDOW_MS);
  assert.equal(P.DEFAULT_DUPLICATE_WINDOW_MS, 2000);
  assert.equal(P.duplicateWindowMs("WINDOW_NOT_FILLING_SCREEN"), 30000);
});

test("the per-session event cap is a hard stop at its limit", () => {
  assert.equal(P.exceedsEventCap(P.MAX_EVENT_ROWS_PER_SESSION - 1), false);
  assert.equal(P.exceedsEventCap(P.MAX_EVENT_ROWS_PER_SESSION), true);
  assert.equal(P.exceedsEventCap(P.MAX_EVENT_ROWS_PER_SESSION + 50), true);
  assert.equal(P.exceedsEventCap(0), false);
});

test("the strike limit is unchanged at 3", () => {
  assert.equal(P.MAX_INTERVIEW_VIOLATIONS, 3);
});

test("a Back-button attempt during an interview is a known event that is logged but never counted", () => {
  const { classifyViolation } = require("../src/utils/proctoringSeverity");
  assert.equal(P.isKnownViolationType("NAVIGATION_ATTEMPT"), true);
  for (let prior = 0; prior < 10; prior++) {
    const r = classifyViolation("NAVIGATION_ATTEMPT", prior);
    assert.equal(r.severity, "INTERRUPTION");
    assert.equal(r.penalized, false, "never a strike, however often it happens");
  }
});
