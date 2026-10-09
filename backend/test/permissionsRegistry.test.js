// The central permission registry must grant exactly what the requireRole(...) lists it replaced did (no database: the registry answers when the tables are
// unreachable, which is also the production fallback).
const test = require("node:test");
const assert = require("node:assert/strict");
const { REGISTRY, can, requirePermission } = require("../src/utils/permissions");

const ROLES = ["STUDENT", "STAFF", "CLERK", "ADMIN", "INSTITUTE_ADMIN", "SUPER_ADMIN"];
const ORIGINAL = {
  "student.portal": ["STUDENT"],
  "staff.console": ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"],
  "staff.workspace": ["STAFF"],
  "clerk.workspace": ["CLERK"],
  "placement.console": ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"],
  "institute.console": ["SUPER_ADMIN", "ADMIN", "INSTITUTE_ADMIN"],
  "platform.console": ["SUPER_ADMIN", "ADMIN"],
  "platform.owner": ["SUPER_ADMIN"],
};

test("every permission matches the role list it replaced, for every role", async () => {
  assert.deepEqual(Object.keys(REGISTRY).sort(), Object.keys(ORIGINAL).sort());
  for (const key of Object.keys(ORIGINAL)) for (const role of ROLES) {
    assert.equal(await can({ role }, key), ORIGINAL[key].includes(role), `${key} / ${role}`);
  }
});

test("unknown keys and missing users are denied; an unknown key cannot be guarded at startup", async () => {
  assert.equal(await can({ role: "SUPER_ADMIN" }, "no.such.key"), false);
  assert.equal(await can(null, "student.portal"), false);
  assert.throws(() => requirePermission("no.such.key"));
});

test("the guard answers 403 to a role without the permission and lets an allowed role through", async () => {
  const run = (user, key) => new Promise((resolve) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json() { resolve(this.code); } };
    requirePermission(key)({ user, headers: {}, originalUrl: "/x", method: "GET" }, res, () => resolve(200));
  });
  assert.equal(await run({ role: "STUDENT", id: "x" }, "student.portal"), 200);
  assert.equal(await run({ role: "STUDENT", id: "x" }, "platform.console"), 403);
  assert.equal(await run(undefined, "student.portal"), 403);
});
