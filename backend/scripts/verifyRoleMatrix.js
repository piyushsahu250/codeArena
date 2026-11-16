// Per-role request matrix over EVERY route (audit 2026-11, brief item 7). It signs in as each role, calls every route of the inventory (scripts/routeInventory.js) and compares what came back with what the
// route's own guard says. Needs the API on localhost:4000 and the CI database; creates two institutes, six users and removes them afterwards. It sends only empty or invalid bodies and random ids, so
// anything that is allowed answers 400 or 404, and nothing real is changed. Report-only by default (exit 0); VERIFY_MATRIX_STRICT=1 makes a violation fail the run.
//
//   1. UNAUTHENTICATED: every route that is not on the reviewed public list must answer 401.
// Roles: SUPER_ADMIN, ADMIN, INSTITUTE_ADMIN (a separate role in the schema), STAFF, CLERK, STUDENT in institute A, plus ADMIN, INSTITUTE_ADMIN and STUDENT in institute B.
//   2. ROLE GUARD: a persona whose role is NOT in the route's allowed roles must be refused (401/403), never 2xx, 400, 404 or 5xx. That is the direct test that the guard runs before the handler.
//   3. NO SERVER ERRORS: a 5xx for any persona is listed (an empty body or a random id must never crash a handler).
//   4. INSTITUTE LEAK SCAN: every parameterless GET is called as institute B's administrator and student; no body may contain institute A's id, name or any of its users' e-mail addresses. Control: the same
//      calls as institute A's administrator must show A's own marker at least once, so the scan is proven able to see what it looks for.
// Routes that call external AI providers, start a database dump or log the caller out are skipped (and listed).
const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { scanRoutes, label } = require("./routeInventory");
const { securityLists } = require("./routeInventory");

const HOST = process.env.VERIFY_API_HOST || "localhost";
const PORT = Number(process.env.VERIFY_API_PORT || 4000);
const STRICT = process.env.VERIFY_MATRIX_STRICT === "1";
const SKIP = [
  [/^\/api\/backup/, "starts a database dump"],
  [/^\/api\/ai\/questions/, "calls an external AI provider"],
  [/^\/api\/ai-interviews/, "may call an external AI provider"],
  [/^\/api\/resume\/.*(improve|ai|job-match|generate|interview-questions)/i, "may call an external AI provider"],
  [/\/(logout)$/, "ends the caller's session"],
];
const tag = `rm-${Date.now().toString(36)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The API limits each signed-in user to 600 requests per 5 minutes (and each client address likewise): the matrix makes about 660 calls per role, so each role has two users it alternates between,
// unauthenticated batches pretend to come from different addresses (the API trusts one proxy hop), and a 429 is retried once after a pause. A 429 that remains is reported as inconclusive.
async function call(method, path, token, body, ip) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await callOnce(method, path, token, body, ip);
    if (res.status !== 429) return res;
    await sleep(2500 * (attempt + 1));
  }
  return { status: 429, text: "", json: null };
}
function callOnce(method, path, token, body, ip) {
  return new Promise((resolve) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ hostname: HOST, port: PORT, path, method, timeout: 20000, headers: { "Content-Type": "application/json", ...(ip ? { "X-Forwarded-For": ip } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let chunks = "";
      res.on("data", (d) => { if (chunks.length < 200000) chunks += d; });
      res.on("end", () => { let j = null; try { j = JSON.parse(chunks); } catch { /* not JSON */ } resolve({ status: res.statusCode, text: chunks, json: j }); });
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, text: "", json: null, timeout: true }); });
    req.on("error", () => resolve({ status: -1, text: "", json: null }));
    if (data) req.write(data);
    req.end();
  });
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const tokenFor = (u) => jwt.sign({ id: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "40m" });
const fill = (route) => route.replace(/:(\w+)/g, (_, p) => (/id$/i.test(p) ? "00000000-0000-4000-8000-000000000000" : "x"));
const allowedRoles = (r) => (r.roles && r.roles.length ? new Set(r.roles) : null);

(async () => {
  if (!process.env.JWT_SECRET) { console.log("JWT_SECRET is not set"); process.exit(STRICT ? 1 : 0); }
  const created = { users: [], institutes: [] };
  const mk = async (role, instituteId, name) => { const u = await prisma.user.create({ data: { name: `${name} ${tag}`, email: `${tag}-${name}@example.test`, passwordHash: "not-a-real-hash", role, instituteId, registrationNumber: role === "STUDENT" ? `PRN-${tag}-${name}`.slice(0, 40) : null } }); created.users.push(u.id); return u; };
  try {
    const A = await prisma.institute.create({ data: { name: `${tag}-A` } });
    const B = await prisma.institute.create({ data: { name: `${tag}-B` } });
    created.institutes.push(A.id, B.id);
    let sup = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
    if (!sup) sup = await mk("SUPER_ADMIN", null, "super");
    const P = {
      SUPER_ADMIN: { u: sup }, ADMIN: { u: await mk("ADMIN", A.id, "adminA") }, INSTITUTE_ADMIN: { u: await mk("INSTITUTE_ADMIN", A.id, "instadminA") }, STAFF: { u: await mk("STAFF", A.id, "staffA") },
      CLERK: { u: await mk("CLERK", A.id, "clerkA") }, STUDENT: { u: await mk("STUDENT", A.id, "studentA") },
      ADMIN_B: { u: await mk("ADMIN", B.id, "adminB") }, INSTITUTE_ADMIN_B: { u: await mk("INSTITUTE_ADMIN", B.id, "instadminB") }, STUDENT_B: { u: await mk("STUDENT", B.id, "studentB") },
    };
    for (const [k, p] of Object.entries(P)) {
      p.token = tokenFor(p.u);
      // a second user of the same role and institute, so one role's 660 calls spread over two rate-limit buckets
      if (k === "SUPER_ADMIN") p.token2 = p.token;
      else { const base = p.u; const twin = await mk(base.role, base.instituteId, `${k.toLowerCase()}2`); p.token2 = tokenFor(twin); }
    }
    const tokOf = (k, i) => (i % 2 ? P[k].token2 : P[k].token);

    const all = scanRoutes();
    const skipped = []; const routes = [];
    for (const r of all) { const why = SKIP.find(([re]) => re.test(r.route))?.[1]; if (why) skipped.push(`${label(r)} (${why})`); else routes.push(r); }
    const publicSet = new Set(securityLists(all).publicRoutes.map(label));
    console.log(`routes ${all.length}, exercised ${routes.length}, skipped ${skipped.length}; personas ${Object.keys(P).join(", ")}`);

    // 1. unauthenticated
    const nonPublic = routes.filter((r) => !publicSet.has(label(r)));
    const unauth = await pool(nonPublic, 6, async (r, i) => ({ r, res: await call(r.method, fill(r.route), null, r.method === "GET" ? undefined : {}, `10.77.${Math.floor(i / 200)}.${(i % 200) + 1}`) }));
    const v1 = unauth.filter((x) => x.res.status !== 401 && x.res.status !== -1 && x.res.status !== 429).map((x) => `${label(x.r)} -> ${x.res.status}`);
    const unauth429 = unauth.filter((x) => x.res.status === 429).length;

    // 2 and 3. every persona on every route
    const personas = Object.keys(P);
    const jobs = []; for (const r of routes) for (const k of personas) jobs.push({ r, k });
    const results = await pool(jobs, 6, async ({ r, k }, i) => ({ r, k, res: await call(r.method, fill(r.route), tokOf(k, i), r.method === "GET" ? undefined : {}) }));
    const roleOf = (k) => k.replace(/_B$/, "");
    const v2 = []; const v3 = []; const inconclusive = []; let allowedAnswers = 0; let overRestricted = 0;
    for (const { r, k, res } of results) {
      if (res.status === 429 || res.timeout || res.status === -1) { inconclusive.push(`${k} ${label(r)} -> ${res.timeout ? "timeout" : res.status}`); continue; }
      if (res.status >= 500) v3.push(`${k} ${label(r)} -> ${res.status} ${String(res.json?.error || "").slice(0, 60)}`);
      const allowed = allowedRoles(r);
      if (allowed && !allowed.has(roleOf(k))) { if (res.status !== 401 && res.status !== 403) v2.push(`${k} (${roleOf(k)}) got ${res.status} on ${label(r)}; allowed: ${[...allowed].join(",")}`); }
      else if (allowed && allowed.has(roleOf(k))) { allowedAnswers++; if (res.status === 403 && !res.json?.featureDisabled) overRestricted++; }
    }

    // 4. institute leak scan on parameterless GETs
    const lists = routes.filter((r) => r.method === "GET" && !/:/.test(r.route));
    const markers = [A.id, `${tag}-A`, `${tag}-adminA`, `${tag}-instadminA`, `${tag}-staffA`, `${tag}-clerkA`, `${tag}-studentA`];
    const scan = async (k) => (await pool(lists, 6, async (r) => ({ r, res: await call("GET", r.route, P[k].token) }))).map(({ r, res }) => ({ r, hit: markers.find((m) => res.text.includes(m)) || null, status: res.status }));
    const ctrl = await scan("ADMIN");
    const controlHits = ctrl.filter((x) => x.hit).length;
    const leaks = [];
    for (const k of ["ADMIN_B", "INSTITUTE_ADMIN_B", "STUDENT_B"]) for (const x of await scan(k)) if (x.hit) leaks.push(`${k} saw institute A data (${x.hit}) on ${label(x.r)}`);

    const section = (title, list, max = 25) => { console.log(`\n== ${title}: ${list.length}`); list.slice(0, max).forEach((l) => console.log("   " + l)); if (list.length > max) console.log(`   ... ${list.length - max} more`); };
    section("1 UNAUTHENTICATED requests not answered with 401", v1);
    section("2 ROLE GUARD violations (a role outside the allowed set was not refused)", v2);
    section("3 SERVER ERRORS (5xx)", v3);
    section("4 INSTITUTE LEAKS (institute B saw institute A data)", leaks);
    console.log(`\ncontrol: institute A's administrator saw A's own marker on ${controlHits} of ${lists.length} parameterless GET routes (must be > 0 for the leak scan to mean anything)`);
    console.log(`unauthenticated calls still limited after retries (inconclusive): ${unauth429}`);
    console.log(`allowed-role answers ${allowedAnswers}, of which 403 for another reason (ownership, scope) ${overRestricted}; inconclusive (429/timeout) ${inconclusive.length}; skipped ${skipped.length}`);
    section("skipped routes", skipped, 12);
    const violations = v1.length + v2.length + leaks.length + (controlHits === 0 ? 1 : 0);
    console.log(`\nRESULT: ${violations === 0 ? "no isolation or role-guard violations found" : violations + " violation(s)"}; ${v3.length} route/persona pairs returned 5xx`);
    process.exitCode = STRICT && (violations > 0) ? 1 : 0;
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: created.users }, role: { not: "SUPER_ADMIN" } } }).catch(() => {});
    await prisma.institute.deleteMany({ where: { id: { in: created.institutes } } }).catch(() => {});
    await prisma.$disconnect();
  }
})().catch((e) => { console.error("matrix failed to run:", e.message); process.exit(1); });
