// Live check: the API tells browsers to remember a CORS preflight answer (Access-Control-Max-Age). REGRESSION: without it every authenticated API call was preceded by its own
// OPTIONS round trip once the browser's 5-second default had expired, doubling the network cost of each call. Also checks that a disallowed origin still gets no CORS headers.
// Needs the API on localhost:4000 (or VERIFY_BASE).
const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

async function preflight(origin) {
  return fetch(`${BASE}/health`, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,x-client-features" },
  });
}

(async () => {
  const ok = await preflight("http://localhost:5173");
  check("a preflight from an allowed origin is answered 204", ok.status === 204, `status ${ok.status}`);
  check("it allows the origin", ok.headers.get("access-control-allow-origin") === "http://localhost:5173", String(ok.headers.get("access-control-allow-origin")));
  const maxAge = Number(ok.headers.get("access-control-max-age"));
  check("it can be cached by the browser for at least an hour (Access-Control-Max-Age)", Number.isFinite(maxAge) && maxAge >= 3600, `max-age ${ok.headers.get("access-control-max-age")}`);
  check("the authorization header is allowed", /authorization/i.test(ok.headers.get("access-control-allow-headers") || ""));

  const bad = await preflight("https://evil.example");
  check("a preflight from a foreign origin gets no allow-origin header", !bad.headers.get("access-control-allow-origin"), String(bad.headers.get("access-control-allow-origin")));

  console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.log("FAIL  unexpected error ->", err.message); process.exit(1); });
