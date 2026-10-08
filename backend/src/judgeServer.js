// Stand-alone judge service (same image as the API, started with JUDGE_ROLE=server by docker-entrypoint.sh). It owns code execution -- the
// sandboxed child processes, the CPU/memory/time/process limits, the privilege drop and the network-isolation rule -- so a burst of
// submissions can no longer starve the web API of CPU, and the judge can be given its own resource limits, restarted on its own and later
// moved to other hosts. It has no database access and no student data beyond the program it is asked to run.
//
//   POST /judge   body = the exact argument object of utils/judge.js judgeSubmission()  -> its result JSON
//   GET  /health  -> { ok, queue, commit }
// Authentication: HMAC-SHA256 over `${timestamp}.${rawBody}` with JUDGE_SHARED_SECRET (headers x-judge-timestamp, x-judge-signature), 60 s
// replay window, constant-time comparison. The service listens only on the private docker network and is never published to the host.
const express = require("express");
const crypto = require("crypto");
const { judgeSubmission, warmUpCompilers } = require("./utils/judge");
const { runQueued, getQueueStatus } = require("./utils/queue");

const SECRET = process.env.JUDGE_SHARED_SECRET;
const PORT = Number(process.env.JUDGE_PORT || 4100);
if (!SECRET || SECRET.length < 24) { console.error("[judge-server] JUDGE_SHARED_SECRET (>= 24 chars) is required"); process.exit(1); }

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

function authentic(req) {
  const ts = Number(req.get("x-judge-timestamp"));
  const sig = String(req.get("x-judge-signature") || "");
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 60 * 1000) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(`${ts}.`).update(req.rawBody || Buffer.alloc(0)).digest("hex");
  const a = Buffer.from(sig, "hex"), b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get("/health", (_req, res) => res.json({ ok: true, queue: getQueueStatus(), commit: process.env.COMMIT_SHA || null }));

app.post("/judge", async (req, res) => {
  if (!authentic(req)) return res.status(401).json({ error: "unauthorized" });
  const args = req.body;
  if (!args || typeof args !== "object" || typeof args.language !== "string" || typeof args.code !== "string" || !Array.isArray(args.testCases)) {
    return res.status(400).json({ error: "language, code and testCases are required" });
  }
  try {
    res.json(await runQueued(() => judgeSubmission(args)));
  } catch (err) {
    if (err.queueBusy) return res.status(503).json({ queueBusy: true, error: "Judge queue is full" });
    console.error("[judge-server] execution failed:", err.message);
    res.status(500).json({ error: "Judge failed" });
  }
});

app.listen(PORT, () => {
  console.log(`CodeArena judge service on :${PORT} (concurrency ${getQueueStatus().maxConcurrent}, queue ${getQueueStatus().maxQueueSize})`);
  warmUpCompilers().catch((e) => console.warn("judge warm-up failed", e.message));
});
