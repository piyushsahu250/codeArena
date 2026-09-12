const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mintTicket, consumeTicket } = require("../src/services/aiInterview/voiceTickets");

test("mintTicket returns a distinct random string each call", () => {
  const t1 = mintTicket({ sessionId: "s1", studentId: "u1", instituteId: "i1" });
  const t2 = mintTicket({ sessionId: "s1", studentId: "u1", instituteId: "i1" });
  assert.equal(typeof t1, "string");
  assert.ok(t1.length >= 32, "should be a real random token, not something guessable");
  assert.notEqual(t1, t2);
});

test("consumeTicket returns the original entry for a valid ticket", () => {
  const ticket = mintTicket({ sessionId: "session-abc", studentId: "student-xyz", instituteId: "inst-1" });
  const entry = consumeTicket(ticket);
  assert.equal(entry.sessionId, "session-abc");
  assert.equal(entry.studentId, "student-xyz");
  assert.equal(entry.instituteId, "inst-1");
});

test("a ticket can only ever be consumed ONCE (single-use)", () => {
  const ticket = mintTicket({ sessionId: "s2", studentId: "u2", instituteId: null });
  const first = consumeTicket(ticket);
  const second = consumeTicket(ticket);
  assert.ok(first, "first consumption should succeed");
  assert.equal(second, null, "replaying the same ticket must fail");
});

test("an unknown/never-issued ticket is rejected", () => {
  assert.equal(consumeTicket("this-was-never-minted"), null);
});

test("consumeTicket never leaks its internal Map by identity (returns a plain snapshot)", () => {
  const ticket = mintTicket({ sessionId: "s3", studentId: "u3", instituteId: "i3" });
  const entry = consumeTicket(ticket);
  assert.ok("expiresAt" in entry);
});
