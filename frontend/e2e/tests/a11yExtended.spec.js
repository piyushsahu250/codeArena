const { test } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { users, login } = require("./helpers");

// Wider accessibility coverage than a11y.spec.js (which gates the five logged-in dashboards in light mode): every PUBLIC page, a few of them in dark mode, and the five
// dashboards in dark mode. REPORT ONLY: nothing here can fail the build. Each serious or critical axe finding is printed as one "[a11y-ext]" line and the CI browser-suite step
// publishes them as a single warning annotation, so the real state is readable without a GitHub sign-in. Move a page into a11y.spec.js (the gate) once it reports nothing.
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
async function scan(page, label) {
  try {
    const results = await withTimeout(new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(), 25000);
    const found = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => `${n.target.join(" ").slice(0, 60)} [${compactMessage((n.any[0] && n.any[0].message) || (n.all[0] && n.all[0].message) || "").slice(0, 70)}]`).join(" ; ")}`);
    if (found.length) console.log(`[a11y-ext] ${label}: ${found.join(" | ")}`.slice(0, 430));
  } catch (err) {
    console.log(`[a11y-ext] ${label}: scan failed: ${String(err && err.message).slice(0, 160)}`);
  }
}
// Every wait is bounded (a page that never goes network-idle, such as one that polls, must cost seconds, not the whole 60 s test timeout, which WOULD fail the test).
const settle = (page) => page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
async function open(page, path, theme) {
  await page.addInitScript((t) => { try { localStorage.setItem("caTheme", t); } catch { /* storage blocked */ } }, theme);
  await page.goto(path, { timeout: 20000 });
  await settle(page);
}

for (const path of PUBLIC) {
  test(`a11y-ext public ${path} (light)`, async ({ page }) => {
    try { await open(page, path, "light"); await scan(page, `public ${path} light`); } catch (err) { console.log(`[a11y-ext] public ${path} light: could not load: ${String(err && err.message).slice(0, 120)}`); }
  });
}
for (const path of PUBLIC_DARK) {
  test(`a11y-ext public ${path} (dark)`, async ({ page }) => {
    try { await open(page, path, "dark"); await scan(page, `public ${path} dark`); } catch (err) { console.log(`[a11y-ext] public ${path} dark: could not load: ${String(err && err.message).slice(0, 120)}`); }
  });
}
for (const [who, path] of DASHBOARDS) {
  test(`a11y-ext ${who} ${path} (dark)`, async ({ page }) => {
    try {
      await page.addInitScript(() => { try { localStorage.setItem("caTheme", "dark"); } catch { /* storage blocked */ } });
      await login(page, users[who]);
      await page.goto(path, { timeout: 20000 });
      await settle(page);
      await scan(page, `${who} ${path} dark`);
    } catch (err) { console.log(`[a11y-ext] ${who} ${path} dark: could not load: ${String(err && err.message).slice(0, 120)}`); }
  });
}
