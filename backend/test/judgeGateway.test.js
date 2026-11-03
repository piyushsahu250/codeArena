// The path from the API to the judge service and what happens when the judge misbehaves: authentication, a full queue, a crashing worker, a hung worker, an unreachable
// worker. The real judge service (src/judgeServer.js) is started as a child process; the "failing worker" cases use a small stand-in server so the failure is exact.
// Executing code needs Linux (see judgeServer/judge.js); everything else here runs on every platform.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const SECRET = "gateway-test-secret-0123456789abcdef";
const LINUX = process.platform === "linux" && fs.existsSync("/usr/bin/time") && spawnSync("python3", ["--version"]).status === 0;

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const sign = (body, ts = Date.now(), secret = SECRET) => ({ "x-judge-timestamp": String(ts), "x-judge-signature": crypto.createHmac("sha256", secret).update(`${ts}.`).update(body).digest("hex") });
const post = (port, body, headers = {}) => fetch(`http://127.0.0.1:${port}/judge`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

async function startJudgeService() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "judgeServer.js")], { env: { ...process.env, JUDGE_SHARED_SECRET: SECRET, JUDGE_PORT: String(port), JUDGE_CONCURRENCY: "1", JUDGE_MAX_QUEUE_SIZE: "1", JUDGE_MAX_PROCESSES: "4096" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 100; i++) { // wait until it answers
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return { port, child, log: () => log }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill(); throw new Error("judge service did not start: " + log);
}

// ---------------------------------------------------------------- the real judge service: authentication and validation

test("the judge service accepts only correctly signed, fresh, well-formed requests", async (t) => {
  const svc = await startJudgeService();
  t.after(() => svc.child.kill());
  const good = JSON.stringify({ language: "python", code: "print(1)", testCases: [{ input: "", expected: "1" }] });

  assert.equal((await fetch(`http://127.0.0.1:${svc.port}/health`)).status, 200, "health needs no signature");
  assert.equal((await post(svc.port, good)).status, 401, "no signature");
  assert.equal((await post(svc.port, good, { "x-judge-timestamp": String(Date.now()), "x-judge-signature": "00".repeat(32) })).status, 401, "wrong signature");
  assert.equal((await post(svc.port, good, sign(good, Date.now(), "another-secret-another-secret-abc"))).status, 401, "signed with another secret");
  assert.equal((await post(svc.port, good, sign(good, Date.now() - 5 * 60 * 1000))).status, 401, "a captured request replayed five minutes later");
  assert.equal((await post(svc.port, good + " ", sign(good))).status, 401, "body changed after signing");
  const bad = JSON.stringify({ language: "python", code: 5, testCases: [] });
  assert.equal((await post(svc.port, bad, sign(bad))).status, 400, "signed but malformed");
  const noCases = JSON.stringify({ language: "python", code: "x" });
  assert.equal((await post(svc.port, noCases, sign(noCases))).status, 400, "missing test cases");
});

test("a signed request is executed and judged (Linux)", { skip: LINUX ? false : "needs Linux with /usr/bin/time and python3" }, async (t) => {
  const svc = await startJudgeService();
  t.after(() => svc.child.kill());
  const body = JSON.stringify({ language: "python", code: "n = int(input())\nprint(n * 2)", testCases: [{ input: "4", expected: "8" }, { input: "5", expected: "11" }], timeLimitMs: 3000 });
  const res = await post(svc.port, body, sign(body));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.verdict, "PARTIAL");
  assert.deepEqual(out.details.map((d) => d.verdict), ["PASSED", "WRONG_ANSWER"]);
});

test("a full queue is answered 503 and the rest still finish (Linux)", { skip: LINUX ? false : "needs Linux with /usr/bin/time and python3" }, async (t) => {
  const svc = await startJudgeService(); // concurrency 1, queue 1: one running, one waiting, the third is turned away
  t.after(() => svc.child.kill());
  const slow = JSON.stringify({ language: "python", code: "import time\ntime.sleep(1.2)\nprint(1)", testCases: [{ input: "", expected: "1" }], timeLimitMs: 5000 });
  const sends = Array.from({ length: 4 }, () => post(svc.port, slow, sign(slow)));
  const statuses = (await Promise.all(sends)).map((r) => r.status).sort();
  assert.ok(statuses.includes(503), `expected a 503 among ${statuses}`);
  assert.ok(statuses.filter((s) => s === 200).length >= 2, `accepted work still finished: ${statuses}`);
});

// ---------------------------------------------------------------- the gateway against a worker that fails in a controlled way

async function gatewayAgainst(handler, env = {}) {
  const hits = { count: 0 };
  const server = http.createServer((req, res) => { hits.count++; handler(req, res); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const keys = { JUDGE_URL: `http://127.0.0.1:${port}`, JUDGE_SHARED_SECRET: SECRET, JUDGE_FALLBACK_LOCAL: "0", JUDGE_REMOTE_TIMEOUT_MS: "400", ...env };
  // The gateway reads its settings when it is loaded, so each case loads a fresh copy.
  const saved = {}; for (const k of Object.keys(keys)) { saved[k] = process.env[k]; process.env[k] = keys[k]; }
  const file = require.resolve("../src/utils/judgeGateway");
  delete require.cache[file];
  const gateway = require(file);
  return { gateway, hits, close: () => { server.closeAllConnections?.(); server.close(); delete require.cache[file]; for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } } };
}
const args = { language: "python", code: "print(1)", testCases: [{ input: "", expected: "1" }] };

test("gateway: a worker that answers 503 is reported as a full queue, never retried or run locally", async () => {
  const g = await gatewayAgainst((_req, res) => { res.statusCode = 503; res.end("{}"); });
  try {
    await assert.rejects(() => g.gateway.judgeSubmission(args), (e) => e.queueBusy === true);
    assert.equal(g.hits.count, 1, "asked once");
  } finally { g.close(); }
});

test("gateway: a worker that crashes with a 500 is a failure, not a verdict, and is asked only once", async () => {
  const g = await gatewayAgainst((_req, res) => { res.statusCode = 500; res.end("{}"); });
  try {
    await assert.rejects(() => g.gateway.judgeSubmission(args), (e) => /judge service error 500/.test(e.message) && !e.queueBusy && !e.unreachable);
    assert.equal(g.hits.count, 1);
  } finally { g.close(); }
});

test("gateway: a worker that hangs times out, and the submission is not executed a second time", async () => {
  const g = await gatewayAgainst(() => { /* never answers */ }, { JUDGE_FALLBACK_LOCAL: "1" });
  try {
    await assert.rejects(() => g.gateway.judgeSubmission(args), (e) => e.name === "TimeoutError" || /timeout|aborted/i.test(e.message));
    assert.equal(g.hits.count, 1, "the request was accepted, so it is never re-run in-process even with the fallback on");
  } finally { g.close(); }
});

test("gateway: a worker that drops the connection mid-request is a failure, not an in-process re-run", async () => {
  const g = await gatewayAgainst((req, res) => { req.socket.destroy(); }, { JUDGE_FALLBACK_LOCAL: "1" });
  try {
    await assert.rejects(() => g.gateway.judgeSubmission(args));
    assert.equal(g.hits.count, 1);
  } finally { g.close(); }
});

test("gateway: an unreachable worker is reported as unreachable (and falls back only when allowed)", async () => {
  const port = await freePort(); // nothing listens here
  const saved = { ...process.env };
  Object.assign(process.env, { JUDGE_URL: `http://127.0.0.1:${port}`, JUDGE_SHARED_SECRET: SECRET, JUDGE_FALLBACK_LOCAL: "0" });
  const file = require.resolve("../src/utils/judgeGateway"); delete require.cache[file];
  try {
    const gateway = require(file);
    await assert.rejects(() => gateway.judgeSubmission(args), (e) => e.unreachable === true);
    const st = await gateway.status();
    assert.equal(st.mode, "remote"); assert.equal(st.reachable, false);
  } finally { delete require.cache[file]; for (const k of ["JUDGE_URL", "JUDGE_SHARED_SECRET", "JUDGE_FALLBACK_LOCAL"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
});

test("gateway: the signature it sends is the one the service verifies (same algorithm, body-bound, fresh)", async () => {
  let seen;
  const g = await gatewayAgainst((req, res) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { seen = { headers: req.headers, body: b }; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ verdict: "ACCEPTED", passedCases: 1, totalCases: 1, details: [] })); }); });
  try {
    const out = await g.gateway.judgeSubmission(args);
    assert.equal(out.verdict, "ACCEPTED");
    const ts = Number(seen.headers["x-judge-timestamp"]);
    assert.ok(Math.abs(Date.now() - ts) < 5000, "timestamp is current");
    const expected = crypto.createHmac("sha256", SECRET).update(`${ts}.`).update(seen.body).digest("hex");
    assert.equal(seen.headers["x-judge-signature"], expected);
  } finally { g.close(); }
});
