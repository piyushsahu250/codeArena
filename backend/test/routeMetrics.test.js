// Per-route request metrics: keys use the route pattern (not the real URL), slow and failing routes surface, memory stays bounded.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
require("../src/utils/asyncErrors");
const { timingMiddleware, getSnapshot } = require("../src/utils/metrics");

const get = (port, path) => new Promise((resolve) => http.get({ port, path, agent: false }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }).on("error", () => resolve(0)));

test("different ids collapse into one pattern key, a failing route keeps its mount path, a 404 makes no per-URL key", async () => {
  const app = express();
  app.use(timingMiddleware);
  const router = express.Router();
  router.get("/items/:id", async (req, res) => { res.json({ id: req.params.id }); });
  router.get("/slow", async (_req, res) => { await new Promise((r) => setTimeout(r, 120)); res.json({ ok: true }); });
  router.get("/broken", async () => { throw new Error("boom"); });
  app.use("/api/demo", router);
  app.use((err, _req, res, _next) => { res.status(500).json({ error: "x" }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  try {
    for (let i = 0; i < 8; i++) await get(port, `/api/demo/items/${1000 + i}?q=${i}`);
    for (let i = 0; i < 6; i++) await get(port, "/api/demo/slow");
    for (let i = 0; i < 3; i++) await get(port, "/api/demo/broken");
    await get(port, "/nope-1"); await get(port, "/nope-2");
    await new Promise((r) => setTimeout(r, 100));
    const rt = getSnapshot().routeTiming;
    const byRoute = Object.fromEntries([...rt.slowest, ...rt.failing].map((r) => [r.route, r]));
    assert.ok(byRoute["GET /api/demo/slow"].p95Ms >= 100, "slow route listed with a realistic latency");
    assert.equal(byRoute["GET /api/demo/broken"].errors5xx, 3, "failing route keeps its full mount path");
    assert.ok(!Object.keys(byRoute).some((k) => /1000|q=|nope/.test(k)), "no per-URL keys");
    assert.ok(!rt.failing.some((r) => r.route === "GET /api/demo/items/:id"), "a healthy route is not failing");
  } finally { server.close(); }
});
