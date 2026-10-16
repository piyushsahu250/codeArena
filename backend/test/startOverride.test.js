// Rules of the administrator start override for strict module-coding assessments (utils/startOverride.js): input validation, expiry, single use, the in-memory cache and the
// event catalogue entries. The database-backed behaviour is checked end to end by scripts/verifyStartOverride.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const SO = require("../src/utils/startOverride");
const X = require("../src/utils/examSecurity");

const GOOD = "Managed tablet failed the capability check at the desk";

test("a request needs a test, a student and a reason of at least 10 characters", () => {
  assert.equal(SO.parseGrantInput(undefined).ok, false);
  assert.equal(SO.parseGrantInput({}).ok, false);
  assert.equal(SO.parseGrantInput({ testId: "t", studentId: "s" }).ok, false);
  assert.equal(SO.parseGrantInput({ testId: "t", studentId: "s", reason: "too short" }).ok, false);
  assert.equal(SO.parseGrantInput({ testId: "t", studentId: "s", reason: "          " }).ok, false, "spaces are not a reason");
  assert.equal(SO.parseGrantInput({ testId: "", studentId: "s", reason: GOOD }).ok, false);
  assert.equal(SO.parseGrantInput({ testId: { $ne: null }, studentId: "s", reason: GOOD }).ok, false, "non-string ids are refused");
  assert.equal(SO.parseGrantInput({ testId: "t".repeat(65), studentId: "s", reason: GOOD }).ok, false);
  const ok = SO.parseGrantInput({ testId: " t ", studentId: " s ", reason: `  ${GOOD}  ` });
  assert.deepEqual(ok, { ok: true, value: { testId: "t", studentId: "s", reason: GOOD, ttlMin: 30 } });
});

test("the window defaults to 30 minutes and can never exceed 120", () => {
  const ttl = (ttlMinutes) => SO.parseGrantInput({ testId: "t", studentId: "s", reason: GOOD, ttlMinutes });
  assert.equal(ttl(undefined).value.ttlMin, 30);
  assert.equal(ttl(null).value.ttlMin, 30);
  assert.equal(ttl(5).value.ttlMin, 5);
  assert.equal(ttl(120).value.ttlMin, 120);
  assert.equal(ttl(100000).value.ttlMin, 120, "a huge window is clamped");
  assert.equal(ttl(0.4).ok, true);
  assert.equal(ttl(0.4).value.ttlMin, 1);
  for (const bad of [0, -5, "abc", NaN]) assert.equal(ttl(bad).ok, false, String(bad));
  assert.equal(SO.parseGrantInput({ testId: "t", studentId: "s", reason: "r".repeat(500) }).value.reason.length, SO.MAX_REASON, "the stored reason is clipped");
});

test("a grant is usable only while unused, unrevoked and unexpired", () => {
  const now = 1_000_000;
  const row = (over = {}) => ({ type: SO.TYPES.GRANTED, reviewStatus: "PENDING", metadata: { expiresAt: now + 1 }, ...over });
  assert.equal(SO.isActiveGrant(row(), now), true);
  assert.equal(SO.isActiveGrant(row({ metadata: { expiresAt: now } }), now), false, "expiry is exclusive");
  assert.equal(SO.isActiveGrant(row({ metadata: { expiresAt: now - 1 } }), now), false);
  assert.equal(SO.isActiveGrant(row({ reviewStatus: "REVIEWED" }), now), false, "used or revoked");
  assert.equal(SO.isActiveGrant(row({ type: SO.TYPES.USED }), now), false, "only a grant row counts");
  assert.equal(SO.isActiveGrant(row({ metadata: null }), now), false);
  assert.equal(SO.isActiveGrant(row({ metadata: { expiresAt: "soon" } }), now), false);
  assert.equal(SO.isActiveGrant(null, now), false);
});

// A minimal fake of the one prisma call the single-use rule depends on: updateMany with a conditional where.
function fakePrisma(initial) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  return {
    rows,
    examSecurityEvent: {
      updateMany: async ({ where, data }) => {
        const r = rows.get(where.id);
        if (!r || r.type !== where.type || r.reviewStatus !== where.reviewStatus) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
      findFirst: async ({ where }) => ([...rows.values()].find((r) => r.attemptId === where.attemptId && r.type === where.type) ? { id: "x" } : null),
      create: async ({ data }) => { rows.set(`n${rows.size}`, { id: `n${rows.size}`, reviewStatus: "PENDING", ...data }); return data; },
    },
  };
}

test("single use: of many simultaneous starts exactly one consumes the grant", async () => {
  const p = fakePrisma([{ id: "g1", type: SO.TYPES.GRANTED, reviewStatus: "PENDING" }]);
  const results = await Promise.all(Array.from({ length: 10 }, () => SO.consumeGrant(p, "g1")));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(p.rows.get("g1").reviewNote, "USED");
  assert.equal(await SO.consumeGrant(p, "g1"), false, "a used grant cannot be used again");
  assert.equal(await SO.consumeGrant(p, "missing"), false);
});

test("revoke works once on an unused grant and never on a used one", async () => {
  const p = fakePrisma([{ id: "g1", type: SO.TYPES.GRANTED, reviewStatus: "PENDING", studentId: "s", testId: "t" }, { id: "g2", type: SO.TYPES.GRANTED, reviewStatus: "REVIEWED", reviewNote: "USED", studentId: "s", testId: "t" }]);
  assert.equal(await SO.revokeGrant(p, p.rows.get("g1"), { id: "admin" }), true);
  assert.equal(p.rows.get("g1").reviewNote, "REVOKED");
  assert.equal([...p.rows.values()].filter((r) => r.type === SO.TYPES.REVOKED).length, 1, "the revoke is recorded as its own event");
  assert.equal(await SO.revokeGrant(p, p.rows.get("g1"), { id: "admin" }), false, "already revoked");
  assert.equal(await SO.revokeGrant(p, p.rows.get("g2"), { id: "admin" }), false, "already used");
});

test("an attempt that used an override is recognised; every other attempt is not", async () => {
  const p = fakePrisma([{ id: "u1", type: SO.TYPES.USED, attemptId: "att-1" }]);
  assert.equal(await SO.attemptHasOverride(p, "att-1"), true);
  assert.equal(await SO.attemptHasOverride(p, "att-2"), false);
  p.rows.clear(); // the answer for att-1 is cached (an attempt never loses its override); att-2 stays false
  assert.equal(await SO.attemptHasOverride(p, "att-1"), true);
  assert.equal(await SO.attemptHasOverride(p, "att-2"), false);
});

test("override events are administrative records: high visibility, no risk weight, never reportable by a client", () => {
  for (const t of Object.values(SO.TYPES)) {
    assert.ok(["HIGH", "MEDIUM"].includes(X.EVENT_SEVERITY[t]), t);
    assert.equal(X.WEIGHTS[t], 0, `${t} adds nothing to a student's risk score`);
    assert.equal(X.SERVER_ONLY.has(t), true, `${t} is server-only`);
    assert.equal(X.CLIENT_REPORTABLE.has(t), false);
    assert.equal(X.SECURE_CLIENT_REPORTABLE.has(t), false);
  }
  assert.equal(X.computeRisk([{ type: SO.TYPES.GRANTED }, { type: SO.TYPES.USED }]).score, 0);
});
