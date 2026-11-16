// A new route cannot quietly be public, or signed-in-with-no-role-check, without a person deciding that. Pure static test: it reads the router source (scripts/routeInventory.js), no database, no server.
// Added in the 2026-11 audit after the first full scan found exactly ten public routes and 31 role-less signed-in routes; this keeps it that way.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scanRoutes, securityLists, label } = require("../scripts/routeInventory");

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "snapshots", "route-guards.json"), "utf8"));
const routes = scanRoutes();
const lists = securityLists(routes);

test("the scan finds the platform's routes (a broken scan must not pass by finding nothing)", () => {
  assert.ok(routes.length > 600, `expected hundreds of routes, found ${routes.length}`);
  const files = new Set(routes.map((r) => r.file));
  for (const f of ["modules/exams/exams.routes.js", "modules/users/users.routes.js", "modules/auth/auth.routes.js", "routes/learning.js", "routes/moduleCoding.js", "modules/testManagement/testManagement.routes.js"]) assert.ok(files.has(f), `${f} was not scanned`);
});

test("the routes anyone can call without logging in are exactly the reviewed list", () => {
  const now = lists.publicRoutes.map(label).sort();
  assert.deepEqual(now, snapshot.publicRoutes, "a route became public (or stopped being public). If intended, review it and update test/snapshots/route-guards.json in the same commit.");
});

test("every public route has a rate limiter", () => {
  const unlimited = lists.publicRoutes.filter((r) => !r.limiter).map(label);
  assert.deepEqual(unlimited, [], "public routes without a limiter");
});

test("the signed-in routes with no role or permission guard are exactly the reviewed list", () => {
  const now = lists.signedInWithoutRoleGuard.map(label).sort();
  assert.deepEqual(now, snapshot.signedInWithoutRoleGuard, "a signed-in route has no role guard. Check its handler scopes data to the caller, then add it to test/snapshots/route-guards.json in the same commit.");
});

test("no route is declared twice with the same method and path (the second would be dead or shadow the first)", () => {
  const count = new Map();
  for (const r of routes) count.set(label(r), (count.get(label(r)) || 0) + 1);
  const dup = [...count].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
  assert.deepEqual(dup, [], "the same method and path is registered more than once");
});
