// Load test of the REAL judge service (src/judgeServer.js) with the production queue settings: N Python submissions fired at the same instant, the way a class presses Submit together.
// Run it where it cannot hurt anyone (a CI runner or a dev box), NEVER against the production judge. Linux only (the judge needs GNU time and bash ulimit).
//   node scripts/loadJudge.js [50 100 200]
// Measures per burst: wall time, throughput, latency percentiles, how many were queued or refused, the deepest queue seen, and CORRECTNESS: every submission must get its own result back
// (each reads a different number and must print its square), so a mix-up between concurrent submissions fails the run. The numbers describe THIS machine: report them as that, not as a promise about production.
"use strict";
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");

const SECRET = "load-test-secret-0123456789abcdef";
const CONCURRENCY = Number(process.env.LOAD_JUDGE_CONCURRENCY || 2);  // production: JUDGE_CONCURRENCY=2
const QUEUE = Number(process.env.LOAD_JUDGE_QUEUE || 200);            // production: JUDGE_MAX_QUEUE_SIZE=200
const BURSTS = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!BURSTS.length) BURSTS.push(50, 100, 200);

if (process.platform !== "linux" || !fs.existsSync("/usr/bin/time")) { console.log("loadJudge: needs Linux with /usr/bin/time; nothing was run"); process.exit(0); }

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const sign = (body) => { const ts = Date.now(); return { "x-judge-timestamp": String(ts), "x-judge-signature": crypto.createHmac("sha256", SECRET).update(`${ts}.`).update(body).digest("hex") }; };
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function start() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "judgeServer.js")], {
    env: { ...process.env, JUDGE_SHARED_SECRET: SECRET, JUDGE_PORT: String(port), JUDGE_CONCURRENCY: String(CONCURRENCY), JUDGE_MAX_QUEUE_SIZE: String(QUEUE), JUDGE_MAX_PROCESSES: "4096" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return { port, child }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill(); throw new Error("judge service did not start: " + log.slice(-400));
}

async function burst(port, n) {
  const code = "n = int(input())\nprint(n * n)";
  let maxWaiting = 0, maxActive = 0, polling = true;
  const poller = (async () => { while (polling) { try { const h = await (await fetch(`http://127.0.0.1:${port}/health`)).json(); maxWaiting = Math.max(maxWaiting, h.queue.waiting); maxActive = Math.max(maxActive, h.queue.active); } catch { /* ignore */ } await new Promise((r) => setTimeout(r, 100)); } })();
  const t0 = Date.now();
  const one = async (i) => {
    const body = JSON.stringify({ language: "python", code, testCases: [{ input: String(i), expected: String(i * i) }, { input: String(i + 1000), expected: String((i + 1000) ** 2) }], timeLimitMs: 3000 });
    const s = Date.now();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/judge`, { method: "POST", headers: { "content-type": "application/json", ...sign(body) }, body, signal: AbortSignal.timeout(170000) });
      const ms = Date.now() - s;
      if (res.status !== 200) return { i, status: res.status, ms };
      const out = await res.json();
      const mine = out.details && out.details[0] && out.details[0].actual === String(i * i) && out.details[1] && out.details[1].actual === String((i + 1000) ** 2);
      return { i, status: 200, ms, verdict: out.verdict, ownResult: !!mine };
    } catch (e) { return { i, status: 0, ms: Date.now() - s, error: e.message }; }
  };
  const results = await Promise.all(Array.from({ length: n }, (_, i) => one(i)));
  const wallMs = Date.now() - t0; polling = false; await poller;
  const ok = results.filter((r) => r.status === 200), lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const refused = results.filter((r) => r.status === 503).length, failed = results.filter((r) => r.status !== 200 && r.status !== 503);
  const wrong = ok.filter((r) => r.verdict !== "ACCEPTED" || !r.ownResult);
  return { n, wallSec: +(wallMs / 1000).toFixed(1), perSec: +(ok.length / (wallMs / 1000)).toFixed(1), answered: ok.length, refused503: refused, failed: failed.length, wrongOrMixedUp: wrong.length, p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), maxMs: lat[lat.length - 1], maxQueueDepth: maxWaiting, maxRunning: maxActive, firstFailure: failed[0] || wrong[0] || null };
}

(async () => {
  const svc = await start();
  let bad = 0; const rows = [];
  try {
    await burst(svc.port, 4); // warm-up, not reported
    for (const n of BURSTS) {
      const r = await burst(svc.port, n); rows.push(r);
      console.log(JSON.stringify(r));
      console.log(`::notice title=judge load, ${n} at once (CI runner, not production)::answered ${r.answered}/${n} in ${r.wallSec}s (${r.perSec}/s), latency p50 ${r.p50} ms, p95 ${r.p95} ms, max ${r.maxMs} ms, refused ${r.refused503}, failed ${r.failed}, mixed-up ${r.wrongOrMixedUp}, deepest queue ${r.maxQueueDepth}, running at once ${r.maxRunning} (concurrency ${CONCURRENCY}, queue ${QUEUE})`);
      if (r.failed || r.wrongOrMixedUp) bad++;
      if (n <= QUEUE + CONCURRENCY && r.refused503) { console.log(`unexpected: ${r.refused503} refused although ${n} fits the queue`); bad++; }
    }
    // the queue limit must refuse, not hang: one burst past capacity
    const over = await burst(svc.port, QUEUE + CONCURRENCY + 40);
    console.log(JSON.stringify({ pastCapacity: over }));
    console.log(`::notice title=judge load past the queue limit (${QUEUE + CONCURRENCY + 40} at once)::answered ${over.answered}, refused with 503 ${over.refused503}, failed ${over.failed}, mixed-up ${over.wrongOrMixedUp}`);
    if (!over.refused503 || over.failed || over.wrongOrMixedUp) { console.log("a burst past the limit must be refused cleanly, with every accepted one still correct"); bad++; }
    if (over.answered + over.refused503 !== QUEUE + CONCURRENCY + 40) { console.log("every request must get either a result or a 503"); bad++; }
  } finally { svc.child.kill(); }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
