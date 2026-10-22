// Live check of GET /api/health/deep (2026-10 audit). It used to be public, unlimited, and returned which optional services are configured and which required
// environment variables are missing. Now an unauthenticated caller gets only the overall status; the per-dependency detail needs the HEALTH_DEEP_TOKEN secret, and
// the route has its own per-IP rate limit.
// This script runs where HEALTH_DEEP_TOKEN is NOT set (CI), so it also proves that a token header cannot unlock the detail when no token is configured.
const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const get = async (headers = {}) => { const res = await fetch(`${BASE}/health/deep`, { headers }); let body = null; try { body = await res.json(); } catch { /* none */ } return { status: res.status, body }; };

(async () => {
  const anon = await get();
  check("an anonymous caller still gets 200 or 503 with an overall status", [200, 503].includes(anon.status) && ["ok", "degraded"].includes(anon.body && anon.body.status), JSON.stringify(anon.body));
  check("the anonymous response carries no per-dependency detail", anon.body && !("checks" in anon.body) && !/environment|missing|JWT_SECRET|PII_ENCRYPTION_KEY|DATABASE_URL|judge|configured/i.test(JSON.stringify(anon.body)), JSON.stringify(anon.body));
  check("the anonymous response has a timestamp", !!(anon.body && anon.body.checkedAt));
  for (const token of ["", "wrong-token", "undefined", "null"]) {
    const r = await get({ "x-health-token": token });
    check(`a token header (${JSON.stringify(token)}) does not unlock the detail when none is configured`, r.body && !("checks" in r.body));
  }
  const basic = await (await fetch(`${BASE}/health`)).json();
  check("the plain liveness endpoint is unchanged", basic.status === "ok" && basic.service === "CodeArena API");
  let limited = 0;
  for (let i = 0; i < 40; i++) if ((await get()).status === 429) limited++;
  check("the deep endpoint is rate limited per IP", limited > 0, `${limited} of 40 extra requests were refused`);
  console.log(failures === 0 ? "\nDEEP HEALTH VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
