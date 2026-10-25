const { test } = require("@playwright/test");

// Public-pages probe (report only; skipped unless UX_AUDIT is set, never fails the build). The earlier probes walk the signed-in pages; this one walks the pages anyone can open without
// signing in (marketing pages, sign-in and password pages, certificate and result verification, the 404 page), at a phone width and a desktop width, and prints one "[ux-pub]" line per problem:
//   overflow  : the page scrolls sideways
//   console   : an uncaught error, a console error, or a failed same-site request other than an expected 401/403/404 on a verification lookup
//   head      : missing or generic <title>, missing meta description, missing html lang
//   headings  : not exactly one <h1>
//   images    : an image without alt text, or one that failed to load
//   names     : a link or button with no accessible name
//   targets   : a button or standalone link smaller than 24 x 24 CSS px (phone width)
//   perf      : LCP above 2.5 s or CLS above 0.1 on a cold load
const ROUTES = [
  "/", "/about", "/contact", "/privacy", "/terms", "/for-institutions", "/features", "/coding-platform", "/online-assessment", "/lms", "/employability-readiness",
  "/ai-mock-interview", "/coding-challenges", "/login", "/register", "/forgot-password", "/reset-password?token=abc", "/verify-email?token=abc",
  "/interview/verify/NOSUCHCODE", "/learning/certificate/verify/NOSUCHCODE", "/certificate/verify/NOSUCHCODE", "/results/verify/NOSUCHCODE", "/this-page-does-not-exist",
];
const VIEWPORTS = [["phone", { width: 375, height: 700 }], ["desktop", { width: 1280, height: 720 }]];

function inspect() {
  const out = {};
  const de = document.documentElement;
  out.overflow = de.scrollWidth - window.innerWidth;
  out.title = document.title || "";
  out.description = !!document.querySelector('meta[name="description"]')?.content;
  out.lang = de.getAttribute("lang") || "";
  out.h1 = document.querySelectorAll("h1").length;
  out.imgNoAlt = [...document.images].filter((i) => !i.hasAttribute("alt")).map((i) => (i.getAttribute("src") || "").slice(0, 40));
  out.imgBroken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => (i.getAttribute("src") || "").slice(0, 40));
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const nameOf = (el) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent || el.textContent || el.getAttribute("title") || el.querySelector("img[alt]")?.getAttribute("alt") || "").trim();
  out.unnamed = [...document.querySelectorAll("a[href], button")].filter(visible).filter((el) => !nameOf(el)).map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("href") ? "[" + el.getAttribute("href").slice(0, 30) + "]" : ""}`);
  out.small = [...document.querySelectorAll("button, a[href]")].filter(visible).filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width >= 24 && r.height >= 24) return false;
    // a link inside a sentence is exempt from the minimum target size
    if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.parentElement && /\S/.test([...el.parentElement.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""))) return false;
    return true;
  }).map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 18)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
  return out;
}

test("public pages (report only)", async ({ page }) => {
  test.skip(!process.env.UX_AUDIT, "audit probe: runs only with UX_AUDIT=1");
  test.setTimeout(11 * 60 * 1000);
  let problems = [];
  page.on("pageerror", (e) => problems.push(`uncaught: ${String(e.message || e).slice(0, 80)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 80)}`); });
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url().replace(/^.*\/api/, "/api")}`); });
  page.on("requestfailed", (r) => { if (r.url().includes("/api/")) problems.push(`request failed ${r.url().replace(/^.*\/api/, "/api").slice(0, 50)}`); });
  await page.addInitScript(() => {
    window.__pub = { lcp: 0, cls: 0 };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__pub.lcp = Math.max(window.__pub.lcp, e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true }); } catch { /* unsupported */ }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__pub.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch { /* unsupported */ }
  });
  for (const [vpName, vp] of VIEWPORTS) {
    await page.setViewportSize(vp);
    const lcps = [];
    for (const route of ROUTES) {
      problems = [];
      await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
      await page.waitForTimeout(600);
      const info = await page.evaluate(inspect);
      const perf = await page.evaluate(() => window.__pub);
      lcps.push(Math.round(perf.lcp));
      const issues = [];
      if (info.overflow > 1) issues.push(`overflow: scrolls sideways by ${info.overflow}px`);
      if (problems.length) issues.push(`console: ${[...new Set(problems)].slice(0, 3).join(" | ")}`);
      const headBits = [];
      if (!info.title || /^(vite|react app|codearena)?$/i.test(info.title.trim())) headBits.push(`title "${info.title}"`);
      if (!info.description) headBits.push("no meta description");
      if (!info.lang) headBits.push("no html lang");
      if (headBits.length) issues.push(`head: ${headBits.join(", ")}`);
      if (info.h1 !== 1) issues.push(`headings: ${info.h1} h1 elements`);
      if (info.imgNoAlt.length) issues.push(`images: no alt on ${info.imgNoAlt.slice(0, 3).join(", ")}`);
      if (info.imgBroken.length) issues.push(`images: failed to load ${info.imgBroken.slice(0, 3).join(", ")}`);
      if (info.unnamed.length) issues.push(`names: ${info.unnamed.length} link/button without a name (${info.unnamed.slice(0, 3).join(", ")})`);
      if (vpName === "phone" && info.small.length) issues.push(`targets: ${info.small.length} under 24px (${info.small.slice(0, 3).join(", ")})`);
      if (perf.lcp > 2500 || perf.cls > 0.1) issues.push(`perf: LCP ${Math.round(perf.lcp)} ms, CLS ${perf.cls.toFixed(3)}`);
      if (issues.length) console.log(`[ux-pub] ${vpName} ${route}: ${issues.join("; ")}`);
    }
    const sorted = [...lcps].sort((a, b) => a - b);
    console.log(`[ux-pub] ${vpName} SUMMARY: ${ROUTES.length} pages, LCP median ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted[sorted.length - 1]} ms (local server, cold load)`);
  }
});
