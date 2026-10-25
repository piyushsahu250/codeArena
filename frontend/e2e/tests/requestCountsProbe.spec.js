const fs = require("fs");
const path = require("path");
const { test } = require("@playwright/test");
const { users, login } = require("./helpers");

// Request-count probe (report only; skipped unless UX_AUDIT is set, never fails the build). Opens every parameterless page of every role (the same lists as pages.spec.js) on a cold load and
// records the API requests the page makes: how many, which identical GET requests were sent more than once (wasted work), and how long until the last API answer arrived.
// Prints "[ux-req]" lines: one summary per role, and one line per page that has duplicates, 15 or more API requests, or a last answer later than 2 s.
const src = fs.readFileSync(path.join(__dirname, "pages.spec.js"), "utf8");
const grab = (name) => JSON.parse(src.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1]);
const GROUPS = [["student", grab("STUDENT")], ["staff", grab("STAFF")], ["platform", grab("ADMIN")], ["clerk", grab("CLERK")]];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

test("API requests per page (report only)", async ({ page }) => {
  test.skip(!process.env.UX_AUDIT, "audit probe: runs only with UX_AUDIT=1");
  test.setTimeout(12 * 60 * 1000);
  let calls = [];
  let t0 = 0;
  page.on("request", (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    calls.push({ key: `${r.method()} ${u.replace(/^.*\/api/, "/api")}`, method: r.method(), start: Date.now() - t0, end: null });
    r.__call = calls[calls.length - 1];
  });
  page.on("requestfinished", (r) => { if (r.__call) r.__call.end = Date.now() - t0; });
  page.on("requestfailed", (r) => { if (r.__call) r.__call.end = Date.now() - t0; });

  for (const [role, pages] of GROUPS) {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await login(page, users[role]);
    await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
    const totals = []; const lasts = []; let withDup = 0; let dupRequests = 0;
    for (const p of pages) {
      calls = []; t0 = Date.now();
      await page.goto(p, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
      await page.waitForTimeout(500);
      const counts = new Map();
      for (const c of calls) if (c.method === "GET") counts.set(c.key, (counts.get(c.key) || 0) + 1);
      const dups = [...counts.entries()].filter(([, n]) => n > 1);
      const last = Math.max(0, ...calls.map((c) => c.end || c.start));
      totals.push(calls.length); lasts.push(last);
      if (dups.length) { withDup++; dupRequests += dups.reduce((s, [, n]) => s + n - 1, 0); }
      if (dups.length || calls.length >= 15 || last > 2000) {
        console.log(`[ux-req] ${role} ${p}: ${calls.length} API requests, last answer at ${last} ms${dups.length ? `; sent more than once: ${dups.map(([k, n]) => `${k.replace(/^GET /, "")} x${n}`).slice(0, 4).join(", ")}` : ""}`);
      }
    }
    console.log(`[ux-req] ${role} SUMMARY: ${pages.length} pages, median ${median(totals)} API requests per page (max ${Math.max(...totals)}), median last answer ${median(lasts)} ms (max ${Math.max(...lasts)} ms), ${withDup} page(s) repeat an identical GET (${dupRequests} extra requests in total)`);
  }
});
