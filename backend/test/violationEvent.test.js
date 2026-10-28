// The identity of a violation event reported by the exam page (modules/tests/tests.violationEvent.js): an idempotency key and a client-claimed time. The database and API side is covered by
// scripts/verifyViolationIdempotency.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseEventId, parseClientAt, isUniqueViolation, MAX_CLIENT_SKEW_MS } = require("../src/modules/tests/tests.violationEvent");

test("a missing event id is allowed (older pages) and means 'no idempotency key'", () => {
  for (const v of [undefined, null, ""]) assert.deepEqual(parseEventId(v), { value: null });
});

test("a UUID, and 8 to 64 letters, digits, - or _, are accepted as they are", () => {
  for (const ok of ["3f2b9c1e-8d4a-4f6b-9a2e-1c7d5e8f0a3b", "abcdEFGH", "a_b-c_d-1234", "x".repeat(64)]) assert.deepEqual(parseEventId(ok), { value: ok });
});

test("anything else is refused: too short, too long, spaces, punctuation, non-strings", () => {
  for (const bad of ["short", "x".repeat(65), "has space 123", "semi;colon12", "quote'quote1", "../../etc/pass", 12345678, {}, [], true, "\n\nabcdefgh"]) assert.ok(parseEventId(bad).error, `${JSON.stringify(bad)} must be refused`);
});

test("the client's own time is kept only when it is a plausible time, and is never trusted for more", () => {
  const now = Date.UTC(2026, 9, 28, 10, 0, 0);
  assert.equal(parseClientAt(now - 5000, now).getTime(), now - 5000);
  assert.equal(parseClientAt(new Date(now - 60000).toISOString(), now).getTime(), now - 60000);
  assert.equal(parseClientAt(now - MAX_CLIENT_SKEW_MS - 1, now), null, "more than a day away is ignored");
  assert.equal(parseClientAt(now + MAX_CLIENT_SKEW_MS + 1, now), null);
  for (const junk of [undefined, null, "", "not a date", NaN, Infinity, {}, [], true]) assert.equal(parseClientAt(junk, now), null);
});

test("a unique-constraint violation is recognised by its Prisma code, nothing else is", () => {
  assert.equal(isUniqueViolation({ code: "P2002" }), true);
  assert.equal(isUniqueViolation({ code: "P2003" }), false);
  assert.equal(isUniqueViolation(new Error("x")), false);
  assert.equal(isUniqueViolation(null), false);
});
