// Verifies the per-route metrics: keys use the route PATTERN (not the real URL), slow and failing routes surface, memory stays bounded.
//   node scripts/verifyRouteMetrics.js
const http = require("http");
const express = require("express");
require("../src/utils/asyncErrors");
const { timingMiddleware, getSnapshot } = require("../src/utils/metrics");

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); if (!ok) failed++; };
const get = (port, path) => new Promise((resolve) => http.get({ port, path, agent: false }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }).on("error", () => resolve(0)));

(async () => {
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

  for (let i = 0; i < 8; i++) await get(port, `/api/demo/items/${1000 + i}?q=${i}`);
  for (let i = 0; i < 6; i++) await get(port, "/api/demo/slow");
  for (let i = 0; i < 3; i++) await get(port, "/api/demo/broken");
  await get(port, "/nope");
  await new Promise((r) => setTimeout(r, 100));

  const rt = getSnapshot().routeTiming;
  const byRoute = Object.fromEntries([...rt.slowest, ...rt.failing].map((r) => [r.route, r]));
  check("different ids and query strings collapse into one pattern key", rt.trackedRoutes >= 3 && !Object.keys(byRoute).some((k) => /1000|q=/.test(k)), Object.keys(byRoute).join(" | "));
  check("the slow route is listed with a realistic latency", byRoute["GET /api/demo/slow"]?.p95Ms >= 100, JSON.stringify(byRoute["GET /api/demo/slow"]));
  check("the failing route is listed with its 5xx count (3)", byRoute["GET /api/demo/broken"]?.errors5xx === 3, JSON.stringify(byRoute["GET /api/demo/broken"]));
  check("a healthy route is not in the failing list", !rt.failing.some((r) => r.route === "GET /api/demo/items/:id"));
  check("a 404 does not create a key per URL", !Object.keys(byRoute).some((k) => k.includes("nope")));
  server.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
})();
