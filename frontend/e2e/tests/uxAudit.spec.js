const fs = require("fs");
const path = require("path");
const { test } = require("@playwright/test");
const { users, login } = require("./helpers");

// UI/UX audit probe (report only, never fails the build): walks the same parameterless pages as pages.spec.js, for every role, and prints one "[ux]" line per page that shows a
// defect of a kind the other specs do not look for, plus per-role performance summaries ("[ux-perf]"). The CI browser-suite step publishes the lines as annotations.
//   layout    : the page cannot be scrolled to its end (html/body locked, content taller than the window, no inner scroller), or has TWO large vertical scrollbars
//   targets   : buttons, checkboxes and selects smaller than 24 x 24 CSS px (WCAG 2.5.8) at a phone width
//   requests  : API answers >= 400 other than the expected 401/403 of an access check, failed requests, console errors, uncaught page errors
//   history   : in-app navigation followed by Back/Forward lands somewhere other than the page just left (or makes extra history entries)
//   perf      : LCP, CLS, long-task time and DOM size of each page on a cold load (a local server and a small database: a floor, not a field measurement)
const src = fs.readFileSync(path.join(__dirname, "pages.spec.js"), "utf8");
const grab = (name) => JSON.parse(src.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1]);
const GROUPS = [["student", grab("STUDENT")], ["staff", grab("STAFF")], ["platform", grab("ADMIN")], ["clerk", grab("CLERK")]];

const quantile = (values, q) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

function layoutProbe() {
  const de = document.documentElement; const b = document.body;
  const vh = window.innerHeight;
  const cs = (el) => getComputedStyle(el);
  const locked = cs(de).overflowY === "hidden" || cs(b).overflowY === "hidden";
  const contentH = Math.max(de.scrollHeight, b.scrollHeight);
  const scrollers = [];
  for (const el of document.querySelectorAll("body *")) {
    const s = cs(el);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4 && el.clientHeight >= vh * 0.6 && el.clientWidth >= window.innerWidth * 0.5 && !el.closest("aside, nav, [role=navigation], [role=dialog], dialog")) scrollers.push(el);
  }
  const docScrolls = !locked && contentH > vh + 2;
  const out = [];
  if (locked && contentH > vh + 2 && scrollers.length === 0) out.push("cannot scroll to the end (html/body overflow hidden, no inner scroller)");
  if (docScrolls && scrollers.length > 0) out.push(`two vertical scrollbars (page + ${scrollers[0].tagName.toLowerCase()}.${String(scrollers[0].className).split(" ")[0]} inside ${scrollers[0].parentElement ? scrollers[0].parentElement.tagName.toLowerCase() + "." + String(scrollers[0].parentElement.className).split(" ")[0] : "?"})`);
  return out;
}
function smallTargets() {
  const bad = [];
  for (const el of document.querySelectorAll('button, [role="button"], input[type="checkbox"], input[type="radio"], select, summary')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
    if (r.width < 24 || r.height < 24) bad.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label").slice(0, 20)}]` : ""} "${(el.innerText || el.value || "").trim().slice(0, 14)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
}

const run = process.env.UX_AUDIT ? test : test.skip; // runs only in its own CI step (UX_AUDIT=1), so the main browser suite is not slowed
for (const [who, paths] of GROUPS) {
  run(`ux-audit ${who}: layout, targets, requests, history, performance`, async ({ page }) => {
    test.setTimeout(12 * 60 * 1000);
    const perf = [];
    let current = "login";
    const seen = new Map(); // path -> Set of findings
    const note = (kind, text) => { const key = `${kind} ${text}`.slice(0, 220); if (!seen.has(current)) seen.set(current, new Set()); seen.get(current).add(key); };
    page.on("pageerror", (e) => note("requests", `uncaught error: ${String(e.message).slice(0, 90)}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) note("requests", `console.error: ${m.text().slice(0, 90)}`); });
    page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400 && ![401, 403].includes(r.status())) note("requests", `HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/^.*\/api/, "/api").slice(0, 70)}`); });
    page.on("requestfailed", (r) => { if (r.url().includes("/api/")) note("requests", `request failed ${r.url().replace(/^.*\/api/, "/api").slice(0, 60)}`); });
    await page.addInitScript(() => {
      window.__ux = { lcp: 0, cls: 0, long: 0 };
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ux.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch { /* unsupported */ }
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ux.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch { /* unsupported */ }
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ux.long += e.duration; }).observe({ type: "longtask", buffered: true }); } catch { /* unsupported */ }
    });
    await login(page, users[who]);

    for (const p of paths) {
      current = p;
      try {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(p);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
        const m = await page.evaluate(() => ({ ...window.__ux, nodes: document.getElementsByTagName("*").length }));
        perf.push({ p, ...m });
        for (const f of await page.evaluate(layoutProbe)) note("layout(1280x720)", f);
        await page.setViewportSize({ width: 375, height: 667 });
        await page.waitForTimeout(250);
        for (const f of await page.evaluate(layoutProbe)) note("layout(375x667)", f);
        const small = await page.evaluate(smallTargets);
        for (const d of [...new Set(small)].slice(0, 3)) note("targets(375)", d);
      } catch (err) { note("requests", `probe error: ${String(err.message).slice(0, 80)}`); }
    }

    // History: click through the navigation, then Back x3 and Forward x1.
    current = "(history)";
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(paths[0]);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const trail = [new URL(page.url()).pathname];
      const hrefs = await page.evaluate(() => [...document.querySelectorAll('aside a[href^="/"], nav a[href^="/"]')].map((a) => a.getAttribute("href")).filter((h) => h && !h.includes("#")));
      const targets = [...new Set(hrefs)].filter((h) => paths.includes(h) && h !== trail[0]).slice(0, 3);
      for (const h of targets) {
        await page.locator(`aside a[href="${h}"], nav a[href="${h}"]`).first().click();
        await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
        trail.push(new URL(page.url()).pathname);
      }
      if (trail.length < 3) note("history", `only ${trail.length - 1} navigation link(s) found to walk`);
      for (let i = trail.length - 2; i >= 0; i--) {
        await page.goBack();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(300);
        const at = new URL(page.url()).pathname;
        if (at !== trail[i]) note("history", `Back from ${trail[i + 1]} landed on ${at}, expected ${trail[i]}`);
      }
      if (trail.length > 1) {
        await page.goForward();
        await page.waitForTimeout(300);
        const at = new URL(page.url()).pathname;
        if (at !== trail[1]) note("history", `Forward landed on ${at}, expected ${trail[1]}`);
      }
    } catch (err) { note("history", `walk error: ${String(err.message).slice(0, 80)}`); }

    const agg = new Map();
    for (const [p, set] of seen) for (const m of set) { if (!agg.has(m)) agg.set(m, []); agg.get(m).push(p); }
    for (const [m, ps] of [...agg].sort((a, b) => b[1].length - a[1].length)) console.log(`[ux] ${who}: ${m} :: ${ps.length} page(s): ${ps.slice(0, 4).join(", ")}`.slice(0, 430));
    const lcps = perf.map((x) => x.lcp).filter((x) => x > 0);
    const worstLcp = [...perf].sort((a, b) => b.lcp - a.lcp).slice(0, 3).map((x) => `${x.p}=${Math.round(x.lcp)}ms`).join(", ");
    const worstCls = [...perf].sort((a, b) => b.cls - a.cls).slice(0, 2).map((x) => `${x.p}=${x.cls.toFixed(3)}`).join(", ");
    const worstLong = [...perf].sort((a, b) => b.long - a.long).slice(0, 2).map((x) => `${x.p}=${Math.round(x.long)}ms`).join(", ");
    const worstDom = [...perf].sort((a, b) => b.nodes - a.nodes).slice(0, 2).map((x) => `${x.p}=${x.nodes}`).join(", ");
    console.log(`[ux-perf] ${who} (${perf.length} pages, 1280x720, cold load, local server): LCP median ${Math.round(quantile(lcps, 0.5))}ms, p90 ${Math.round(quantile(lcps, 0.9))}ms; slowest ${worstLcp}; worst CLS ${worstCls}; most long-task time ${worstLong}; largest DOM ${worstDom}`.slice(0, 430));
  });
}

// Browser Back after signing out must not show a signed-in page.
run("ux-audit student: Back after sign-out does not reopen a signed-in page", async ({ page }) => {
  await login(page, users.student4);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  try {
    await page.locator(".ca-topbar-icon-btn", { hasText: users.student4.name.split(" ")[0] }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/, { timeout: 8000 });
    await page.goBack();
    await page.waitForTimeout(1500);
    const url = new URL(page.url()).pathname;
    const body = (await page.locator("body").innerText()).slice(0, 300);
    if (!url.startsWith("/login")) console.log(`[ux] student (history) :: Back after sign-out landed on ${url}; page text: ${body.replace(/\s+/g, " ").slice(0, 120)}`);
  } catch (err) { console.log(`[ux] student (history) :: sign-out/back probe error: ${String(err.message).slice(0, 100)}`); }
});
