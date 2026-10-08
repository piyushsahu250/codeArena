const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { users, login } = require("./helpers");

// Automated accessibility scan (axe). CRITICAL violations fail the run; serious ones are printed so they can be worked down.
for (const [who, path] of [["student", "/dashboard"], ["staff", "/staff"], ["clerk", "/clerk"], ["instAdmin", "/admin"], ["platform", "/admin"]]) {
  test(`${who} ${path}: no critical accessibility violations`, async ({ page }) => {
    await login(page, users[who]);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious").map((v) => `${v.id} (${v.nodes.length})`);
    if (serious.length) console.log(`[a11y] ${who} ${path} serious: ${serious.join(", ")}`);
    expect(results.violations.filter((v) => v.impact === "critical").map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}
