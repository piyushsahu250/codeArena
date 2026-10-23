const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { users, login } = require("./helpers");

// Wider accessibility coverage than a11y.spec.js (which gates the five logged-in dashboards in light mode): every PUBLIC page, a few of them in dark mode, and the five dashboards
// in dark mode. A GATE since audit batch 8: a serious or critical axe finding fails the test (the first complete report, from batch 7, listed 17 colour-contrast findings on 17 public
// pages in light mode; once the scan also scrolled the page it found the dark-mode home page as well; batch 8 fixed both). Each finding is also printed as one "[a11y-ext]" line, which
// the CI browser-suite step publishes as annotations, so the reason for a failure is readable without a GitHub sign-in. A page that cannot be loaded or analysed is tried twice and
// then fails too: a gate that passes because it saw nothing is worse than none.
const PUBLIC = ["/", "/about", "/contact", "/privacy", "/terms", "/for-institutions", "/features", "/coding-platform", "/online-assessment", "/lms", "/employability-readiness",
  "/ai-mock-interview", "/coding-challenges", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/certificate/verify/ZZ-NOPE", "/results/verify/ZZ-NOPE",
  "/interview/verify/ZZ-NOPE", "/learning/certificate/verify/ZZ-NOPE", "/no-such-page"];
const PUBLIC_DARK = ["/", "/login", "/forgot-password", "/register"];
const DASHBOARDS = [["student", "/dashboard"], ["staff", "/staff"], ["clerk", "/clerk"], ["instAdmin", "/admin"], ["platform", "/admin"]];

function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
// One line per page has to fit a CI annotation (about 4 KB for the whole report), so a colour-contrast message is reduced to its numbers:
// "Element has insufficient color contrast of 4.35 (foreground color: #c7852a, background color: #123528, font size: 9.0pt (12px), ...)" becomes "4.35 fg #c7852a on #123528 9.0pt".
const compactMessage = (message) => String(message || "")
  .replace(/^Element has insufficient color contrast of /, "")
  .replace(/\(foreground color: (#[0-9a-f]+), background color: (#[0-9a-f]+), font size: ([\d.]+pt)[^)]*\)?[\s\S]*$/i, "fg $1 on $2 $3");
// The serious or critical findings on the page as it is now (an empty list means none); throws if axe itself cannot finish.
async function scan(page, label) {
  const results = await withTimeout(new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(), 20000);
  const found = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => `${n.target.join(" ").slice(0, 60)} [${compactMessage((n.any[0] && n.any[0].message) || (n.all[0] && n.all[0].message) || "").slice(0, 70)}]`).join(" ; ")}`);
  if (found.length) console.log(`[a11y-ext] ${label}: ${found.join(" | ")}`.slice(0, 430));
  return found;
}
// Every wait is bounded (a page that never goes network-idle, such as one that polls, must cost seconds, not the whole test timeout).
const settle = (page) => page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
// The home page paints each section only when it scrolls into view (opacity 0 until then), and a contrast check cannot measure text that is not painted, so the first runs never
// examined anything below the fold. Scrolling down in steps, as a visitor does, shows every section; then back to the top. Pages with nothing to reveal pass through in well under a second.
async function revealAll(page) {
  await page.evaluate(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700); // the reveal fades in over half a second
}
async function open(page, path, theme) {
  await page.addInitScript((t) => { try { localStorage.setItem("caTheme", t); } catch { /* storage blocked */ } }, theme);
  await page.goto(path, { timeout: 15000 });
  await settle(page);
  await revealAll(page);
}
// Loads and scans, twice at most. The assertion is outside the retry loop: a finding is a finding, not something to try again.
async function checkPage(page, label, load) {
  let found = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 2 && found === null; attempt++) {
    try { await load(); found = await scan(page, label); } catch (err) { lastError = err; }
  }
  if (found === null) throw new Error(`${label}: could not be scanned (${String(lastError && lastError.message).slice(0, 160)})`);
  expect(found, `${label}: serious or critical accessibility findings`).toEqual([]);
}

for (const path of PUBLIC) {
  test(`a11y-ext public ${path} (light)`, async ({ page }) => {
    test.setTimeout(100000);
    await checkPage(page, `public ${path} light`, () => open(page, path, "light"));
  });
}
for (const path of PUBLIC_DARK) {
  test(`a11y-ext public ${path} (dark)`, async ({ page }) => {
    test.setTimeout(100000);
    await checkPage(page, `public ${path} dark`, () => open(page, path, "dark"));
  });
}
for (const [who, path] of DASHBOARDS) {
  test(`a11y-ext ${who} ${path} (dark)`, async ({ page }) => {
    test.setTimeout(100000);
    await page.addInitScript(() => { try { localStorage.setItem("caTheme", "dark"); } catch { /* storage blocked */ } });
    await checkPage(page, `${who} ${path} dark`, async () => {
      await login(page, users[who]);
      await page.goto(path, { timeout: 15000 });
      await settle(page);
    });
  });
}
