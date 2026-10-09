// An async route that throws must answer with a prompt 500, never hang (Express 4 does not catch promise rejections by itself).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
require("../src/utils/asyncErrors");

function get(port, path, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ port, path, agent: false }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b })); res.on("error", () => resolve({ status: res.statusCode, body: "aborted" })); });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ hung: true }); });
    req.on("error", () => resolve({ hung: true }));
  });
}

test("rejections and throws become a JSON 500; normal routes are unaffected", async () => {
  const app = express();
  app.get("/async-throws", async () => { throw new Error("boom"); });
  app.get("/late", async () => { await new Promise((r) => setTimeout(r, 20)); throw new Error("late"); });
  app.get("/sync-throws", () => { throw new Error("sync"); });
  app.get("/ok", async (_req, res) => { res.json({ ok: true }); });
  app.get("/already-sent", async (_req, res) => { res.write("partial"); await new Promise((r) => setTimeout(r, 10)); throw new Error("after headers"); });
  app.use((err, _req, res, next) => { if (res.headersSent) return next(err); res.status(500).json({ error: "Something went wrong. Please try again." }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  try {
    assert.equal((await get(port, "/async-throws")).status, 500);
    assert.equal((await get(port, "/late")).status, 500);
    assert.equal((await get(port, "/sync-throws")).status, 500);
    const ok = await get(port, "/ok");
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).ok, true);
    await get(port, "/already-sent"); // must not crash the server
    assert.equal((await get(port, "/ok")).status, 200, "server still serving after an error that came after the response started");
  } finally { server.close(); }
});
