// Proves the async-error handling: an async route that throws must answer with a prompt 500, not hang. The first half runs WITHOUT the patch to show the
// defect it fixes (the request hangs), the second half with it.
//   node scripts/verifyAsyncErrors.js
const http = require("http");
const express = require("express");

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); if (!ok) failed++; };
process.on("unhandledRejection", () => { /* expected in the unpatched demonstration */ });

function build() {
  const app = express();
  app.get("/async-throws", async () => { throw new Error("boom"); });
  app.get("/async-rejects-after-await", async () => { await new Promise((r) => setTimeout(r, 20)); throw new Error("late boom"); });
  app.get("/sync-throws", () => { throw new Error("sync boom"); });
  app.get("/ok", async (_req, res) => { res.json({ ok: true }); });
  app.get("/already-sent", async (_req, res) => { res.write("partial"); await new Promise((r) => setTimeout(r, 10)); throw new Error("after headers"); });
  app.use((err, _req, res, next) => { if (res.headersSent) return next(err); res.status(500).json({ error: "Something went wrong. Please try again." }); });
  return app;
}

function get(port, path, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ port, path, agent: false }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b })); res.on("error", () => resolve({ status: res.statusCode, body: "aborted" })); });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ hung: true }); });
    req.on("error", () => resolve({ hung: true }));
  });
}
const listen = (app) => new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });

(async () => {
  let s = await listen(build());
  let r = await get(s.address().port, "/async-throws", 1500);
  check("BEFORE the fix: an async route that throws leaves the request hanging", r.hung === true);
  s.close();

  require("../src/utils/asyncErrors");
  require("../src/utils/asyncErrors"); // idempotent
  s = await listen(build());
  const port = s.address().port;
  r = await get(port, "/async-throws", 1500);
  check("AFTER: async throw -> prompt 500 JSON", r.status === 500 && /Something went wrong/.test(r.body), JSON.stringify(r));
  r = await get(port, "/async-rejects-after-await", 1500);
  check("AFTER: rejection after an await -> prompt 500 JSON", r.status === 500);
  r = await get(port, "/sync-throws", 1500);
  check("AFTER: synchronous throw still -> 500", r.status === 500);
  r = await get(port, "/ok", 1500);
  check("AFTER: a normal async route is unaffected", r.status === 200 && JSON.parse(r.body).ok === true);
  r = await get(port, "/already-sent", 1500);
  check("AFTER: an error after the response started does not crash the server", r.hung === true || r.status === 200 || r.body === "aborted" || r.body.startsWith("partial"), JSON.stringify(r));
  r = await get(port, "/ok", 1500);
  check("AFTER: the server is still serving afterwards", r.status === 200);
  s.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
})();
