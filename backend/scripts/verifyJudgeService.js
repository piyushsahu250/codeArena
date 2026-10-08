// Verifies the separate judge service from inside the API container (needs JUDGE_URL and JUDGE_SHARED_SECRET).
//   node scripts/verifyJudgeService.js            health, auth rejection, remote execution, concurrency
//   node scripts/verifyJudgeService.js --fallback expects the judge to be STOPPED: the API must still grade in-process
const crypto = require("crypto");
const gw = require("../src/utils/judgeGateway");
const URL_BASE = (process.env.JUDGE_URL || "").replace(/\/+$/, "");
const SECRET = process.env.JUDGE_SHARED_SECRET || "";
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const PY = { language: "python", code: "print(int(input())*2)", testCases: [{ input: "21\n", expected: "42" }, { input: "5\n", expected: "10" }] };
const signed = (body, ts = Date.now(), secret = SECRET) => ({ "content-type": "application/json", "x-judge-timestamp": String(ts), "x-judge-signature": crypto.createHmac("sha256", secret).update(`${ts}.`).update(body).digest("hex") });

(async () => {
  if (!gw.enabled()) { console.log("FAIL  JUDGE_URL / JUDGE_SHARED_SECRET not set in this container"); process.exit(1); }
  if (process.argv.includes("--fallback")) {
    const st = await gw.status();
    check("judge service is unreachable (stopped for this test)", st.reachable === false, JSON.stringify(st));
    const r = await gw.judgeSubmission(PY);
    check("submission still graded correctly in-process", r.verdict === "ACCEPTED" || r.passedCases === 2, `verdict=${r.verdict} passed=${r.passedCases}/${r.totalCases}`);
    const after = await gw.status();
    check("fallback counter incremented", after.fallbackCalls >= 1, `fallbackCalls=${after.fallbackCalls}`);
    console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed"); process.exit(failed ? 1 : 0);
  }
  const st = await gw.status();
  check("health reachable", st.reachable === true, JSON.stringify({ queue: st.queue }));
  const body = JSON.stringify(PY);
  let r = await fetch(`${URL_BASE}/judge`, { method: "POST", headers: { "content-type": "application/json" }, body });
  check("unsigned request rejected (401)", r.status === 401);
  r = await fetch(`${URL_BASE}/judge`, { method: "POST", headers: signed(body, Date.now(), "x".repeat(40)), body });
  check("wrong-secret signature rejected (401)", r.status === 401);
  r = await fetch(`${URL_BASE}/judge`, { method: "POST", headers: signed(body, Date.now() - 10 * 60 * 1000), body });
  check("stale (replayed) timestamp rejected (401)", r.status === 401);
  r = await fetch(`${URL_BASE}/judge`, { method: "POST", headers: signed(body), body: body + " " });
  check("tampered body rejected (401)", r.status === 401);
  const bad = JSON.stringify({ language: 5 });
  r = await fetch(`${URL_BASE}/judge`, { method: "POST", headers: signed(bad), body: bad });
  check("malformed signed request answered 400", r.status === 400);

  const before = (await gw.status()).remoteCalls;
  const res = await gw.judgeSubmission(PY);
  check("correct program judged remotely", res.passedCases === 2 && res.totalCases === 2, `verdict=${res.verdict}`);
  check("it went through the service", (await gw.status()).remoteCalls === before + 1);
  const wrong = await gw.judgeSubmission({ ...PY, code: "print(1)" });
  check("wrong program fails its cases", wrong.passedCases < 2, `verdict=${wrong.verdict}`);
  const loop = await gw.judgeSubmission({ ...PY, code: "while True: pass", timeLimitMs: 1000 });
  check("infinite loop is stopped, not hung", loop.passedCases === 0, `verdict=${loop.verdict}`);

  const t0 = Date.now();
  const many = await Promise.all(Array.from({ length: 12 }, () => gw.judgeSubmission(PY)));
  check("12 concurrent submissions all graded", many.every((x) => x.passedCases === 2), `${Date.now() - t0} ms`);
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
