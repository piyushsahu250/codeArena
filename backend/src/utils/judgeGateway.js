// Single entry point for running student code. With JUDGE_URL + JUDGE_SHARED_SECRET set, submissions go to the separate judge service
// (src/judgeServer.js); otherwise -- and whenever the service is unreachable -- they run in-process exactly as before (utils/judge.js).
// Falling back is only done for "could not connect" failures, never after a request was accepted, so a submission is never executed twice.
const crypto = require("crypto");
const local = require("./judge");

const URL_BASE = process.env.JUDGE_URL ? process.env.JUDGE_URL.replace(/\/+$/, "") : "";
const SECRET = process.env.JUDGE_SHARED_SECRET || "";
const FALLBACK = process.env.JUDGE_FALLBACK_LOCAL !== "0";
const TIMEOUT_MS = Number(process.env.JUDGE_REMOTE_TIMEOUT_MS || 180000);
const enabled = () => !!(URL_BASE && SECRET);

let lastFailureAt = 0;
let remoteCalls = 0, fallbackCalls = 0;

function sign(body) {
  const ts = Date.now();
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.`).update(body).digest("hex");
  return { "x-judge-timestamp": String(ts), "x-judge-signature": sig };
}

async function callRemote(args) {
  const body = JSON.stringify(args);
  let res;
  try {
    res = await fetch(`${URL_BASE}/judge`, { method: "POST", headers: { "content-type": "application/json", ...sign(body) }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const code = err.cause?.code || err.code;
    if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EHOSTUNREACH"].includes(code)) { const e = new Error(`judge service unreachable (${code})`); e.unreachable = true; throw e; }
    throw err; // timeout or an unknown failure after the request may have started: surface it, do not run twice
  }
  if (res.status === 503) { const e = new Error("Judge queue is full"); e.queueBusy = true; throw e; }
  if (!res.ok) throw new Error(`judge service error ${res.status}`);
  return res.json();
}

async function judgeSubmission(args) {
  if (!enabled()) return local.judgeSubmission(args);
  try {
    remoteCalls++;
    return await callRemote(args);
  } catch (err) {
    if (err.unreachable && FALLBACK) {
      fallbackCalls++;
      if (Date.now() - lastFailureAt > 30000) { lastFailureAt = Date.now(); console.error(`[judge-gateway] ${err.message}; running in-process until it is back`); }
      return local.judgeSubmission(args);
    }
    throw err;
  }
}

async function status() {
  if (!enabled()) return { mode: "local" };
  try {
    const r = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(2500) });
    return { mode: "remote", reachable: r.ok, ...(r.ok ? await r.json() : {}), remoteCalls, fallbackCalls };
  } catch (e) { return { mode: "remote", reachable: false, error: e.cause?.code || e.message, remoteCalls, fallbackCalls }; }
}

module.exports = { judgeSubmission, status, enabled };
