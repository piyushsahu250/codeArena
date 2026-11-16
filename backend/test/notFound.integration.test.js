// REGRESSION (found by scripts/verifyRoleMatrix.js, 2026-11 audit): updating or deleting a record that does not exist raised Prisma's P2025 and was answered with a generic 500 ("Failed to delete
// institute", "Failed to update XP rule", "Failed to update badge", "Failed to delete badge"). A missing record is a 404. Needs the API on localhost:4000; with REQUIRE_INTEGRATION=1 a missing
// prerequisite FAILS the file instead of skipping it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");

const tag = `nf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let last = "";
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ hostname: "localhost", port: 4000, path, method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let chunks = ""; res.on("data", (d) => (chunks += d));
      res.on("end", () => { last = `${method} ${path} -> ${res.statusCode} ${chunks.slice(0, 200)}`; let b = {}; try { b = JSON.parse(chunks || "{}"); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: b }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
let admin = null;
let ready = false;
test.before(async () => {
  let up = false; try { up = (await request("GET", "/api/health", null)).status === 200; } catch { up = false; }
  if (!up || !process.env.JWT_SECRET) { if (process.env.REQUIRE_INTEGRATION === "1") throw new Error("notFound integration: the API or JWT_SECRET is missing"); return; }
  // a platform-level administrator (no institute): the gamification rules and the institute list are platform-level resources
  admin = await prisma.user.create({ data: { name: `Platform ${tag}`, email: `${tag}@example.test`, passwordHash: "not-a-real-hash", role: "ADMIN", instituteId: null } });
  ready = true;
});
test.after(async () => { try { if (admin) await prisma.user.deleteMany({ where: { id: admin.id } }); } finally { await prisma.$disconnect(); } });

const ghost = "00000000-0000-4000-8000-000000000000";

test("a missing record is a 404, not a server error, for the four handlers that used to answer 500", async (t) => {
  if (!ready) return t.skip("not ready");
  const token = jwt.sign({ id: admin.id, role: admin.role, email: admin.email }, process.env.JWT_SECRET, { expiresIn: "20m" });
  const cases = [
    ["DELETE", `/api/institutes/${ghost}`, undefined],
    ["PATCH", `/api/gamification/xp-rules/NOT_AN_ACTIVITY_${tag}`, { xp: 5 }],
    ["PATCH", `/api/gamification/badges/${ghost}`, { name: "x" }],
    ["DELETE", `/api/gamification/badges/${ghost}`, undefined],
  ];
  for (const [method, path, body] of cases) {
    const r = await request(method, path, token, body);
    assert.equal(r.status, 404, `${method} ${path}: expected 404, ${last}`);
    assert.ok(r.body.error, "the 404 says what was not found");
  }
});
