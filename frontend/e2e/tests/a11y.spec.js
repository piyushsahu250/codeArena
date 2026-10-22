const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { users, login } = require("./helpers");

// Automated accessibility scan (axe, WCAG 2 A and AA). CRITICAL and SERIOUS violations fail the run (the five dashboards had none after the sidebar contrast fix); the details are printed so a failure names the element.
for (const [who, path] of [["student", "/dashboard"], ["staff", "/staff"], ["clerk", "/clerk"], ["instAdmin", "/admin"], ["platform", "/admin"]]) {
  test(`${who} ${path}: no critical or serious accessibility violations`, async ({ page }) => {
    await login(page, users[who]);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious").map((v) => `${v.id} (${v.nodes.length}): ${v.help} -> ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} [${(n.any[0] && n.any[0].message || "").slice(0, 140)}]`).join(" ; ")}`);
    if (serious.length) console.log(`[a11y] ${who} ${path} serious: ${serious.join(" | ")}`);
    expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => `${v.impact} ${v.id}: ${v.help}`)).toEqual([]);
  });
}
