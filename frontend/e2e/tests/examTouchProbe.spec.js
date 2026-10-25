const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// Exam / code-editor touch probe (report only; skipped unless UX_AUDIT is set, never fails the build). Opens the real timed test with touch emulation at a portrait phone, a landscape phone and
// a tablet, lands on the full-program coding question, and prints one "[ux-exam]" line per problem found:
//   overflow  : the page scrolls sideways
//   editor    : the code editor is shorter than 200 px, narrower than 280 px, or starts below the fold
//   fixed     : fixed / sticky bars (header, timer, banners) take more than 35 % of the screen height
//   buttons   : a visible button smaller than 24 x 24 CSS px
//   reach     : the Next / Previous / Run / Submit controls cannot be scrolled fully into view
//   text      : visible text smaller than 11 px
test.use({ hasTouch: true });

const VIEWPORTS = [["phone portrait 375x667", { width: 375, height: 667 }], ["phone landscape 667x375", { width: 667, height: 375 }], ["tablet 768x1024", { width: 768, height: 1024 }]];

async function openCoding(page) {
  await login(page, users.student);
  await page.goto(`/test/${data.codingTestId}`);
  await expect(page.getByRole("button", { name: /Begin Assessment/ })).toBeVisible({ timeout: 20000 });
  await page.getByLabel("I have read and understood the instructions.").check();
  await expect(page.getByRole("button", { name: /Begin Assessment/ })).toBeEnabled({ timeout: 8000 });
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.locator("h2", { hasText: /Code (Full|Function)/ }).first()).toBeVisible({ timeout: 20000 });
  const wanted = page.locator("h2", { hasText: /Code Full/ }).first();
  if (!(await wanted.isVisible())) await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(wanted).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
}

function measure() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = { overflow: document.documentElement.scrollWidth - vw };
  const ed = document.querySelector(".monaco-editor");
  if (ed) { const r = ed.getBoundingClientRect(); out.editor = { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + window.scrollY) }; }
  const fixed = [...document.querySelectorAll("body *")].filter((el) => { const cs = getComputedStyle(el); return (cs.position === "fixed" || cs.position === "sticky") && cs.display !== "none" && cs.visibility !== "hidden"; })
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width > vw * 0.5 && r.height > 8 && r.top < vh && r.bottom > 0);
  out.fixedPx = Math.round(fixed.reduce((s, r) => s + Math.min(r.height, vh), 0));
  out.vh = vh;
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  out.smallButtons = [...document.querySelectorAll("button")].filter(visible).filter((b) => { const r = b.getBoundingClientRect(); return r.width < 24 || r.height < 24; })
    .map((b) => `"${(b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 16)}" ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
  let tiny = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const t = (n.textContent || "").trim(); if (t.length < 3) continue; const el = n.parentElement; if (!el || !visible(el) || el.closest(".monaco-editor")) continue; if (parseFloat(getComputedStyle(el).fontSize) < 11) tiny++; }
  out.tinyText = tiny;
  return out;
}

test("exam page under touch (report only)", async ({ page }) => {
  test.skip(!process.env.UX_AUDIT, "audit probe: runs only with UX_AUDIT=1");
  test.setTimeout(8 * 60 * 1000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 80)));
  await page.setViewportSize(VIEWPORTS[0][1]);
  await openCoding(page);
  for (const [label, vp] of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(700);
    const m = await page.evaluate(measure);
    const issues = [];
    if (m.overflow > 1) issues.push(`overflow: scrolls sideways by ${m.overflow}px`);
    if (!m.editor) issues.push("editor: not found");
    else {
      if (m.editor.h < 200) issues.push(`editor: only ${m.editor.h}px tall`);
      if (m.editor.w < 280) issues.push(`editor: only ${m.editor.w}px wide`);
      if (m.editor.top > m.vh) issues.push(`editor: starts at ${m.editor.top}px, below the ${m.vh}px fold`);
    }
    if (m.fixedPx > m.vh * 0.35) issues.push(`fixed: bars take ${m.fixedPx}px of ${m.vh}px`);
    if (m.smallButtons.length) issues.push(`buttons: ${m.smallButtons.length} under 24px (${m.smallButtons.slice(0, 4).join(", ")})`);
    if (m.tinyText > 0) issues.push(`text: ${m.tinyText} text runs under 11px`);
    for (const name of [/^Next/, /^Previous|^Prev/, /^Run/, /^Submit/]) {
      const btn = page.getByRole("button", { name }).first();
      if (!(await btn.count())) continue;
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      const box = await btn.boundingBox();
      if (!box || box.y < 0 || box.y + box.height > vp.height + 1 || box.x < 0 || box.x + box.width > vp.width + 1) issues.push(`reach: ${name} is not fully on screen after scrolling (${box ? JSON.stringify({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }) : "no box"})`);
    }
    console.log(`[ux-exam] ${label}: ${issues.length ? issues.join("; ") : "ok"} (editor ${m.editor ? m.editor.w + "x" + m.editor.h : "n/a"}, fixed bars ${m.fixedPx}px of ${m.vh}px)`);
  }
  if (errors.length) console.log(`[ux-exam] uncaught errors: ${[...new Set(errors)].slice(0, 3).join(" | ")}`);
});
