const { test } = require("@playwright/test");
const { users, login } = require("./helpers");

// Diagnostic only (runs after journeys.spec.js so the student has results): what sticks out on /dashboard/performance at 320px?
test("overflow offenders: student performance", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await login(page, users.student);
  await page.goto("/dashboard/performance");
  await page.waitForLoadState("networkidle").catch(() => {});
  const res = await page.evaluate(() => {
    const vw = window.innerWidth;
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      let p = el.parentElement, contained = false;
      while (p && p !== document.body) { const ox = getComputedStyle(p).overflowX; if (ox === "auto" || ox === "scroll" || ox === "hidden") { contained = true; break; } p = p.parentElement; }
      out.push({ contained, tag: el.tagName.toLowerCase(), cls: String(el.className || "").slice(0, 40), w: Math.round(r.width), right: Math.round(r.right), style: (el.getAttribute("style") || "").slice(0, 120), text: (el.innerText || "").trim().slice(0, 30).replace(/\n/g, " ") });
    }
    return { scroll: document.documentElement.scrollWidth, offenders: out.filter((o) => !o.contained).sort((a, b) => b.right - a.right).slice(0, 8), containedCount: out.filter((o) => o.contained).length };
  });
  console.log("PERF-OFFENDERS scroll=" + res.scroll + " contained=" + res.containedCount + "\n" + res.offenders.map((o) => `  <${o.tag} class="${o.cls}"> w=${o.w} right=${o.right} style="${o.style}" text="${o.text}"`).join("\n"));
});
