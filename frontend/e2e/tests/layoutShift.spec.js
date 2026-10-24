const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// REGRESSION (UI/UX audit batch 4, UX-3): the page's left padding used to animate (0.18 s) when the sidebar mounted, so on every page load the content slid in from the left edge
// (a layout shift of 0.17 - 0.66 on many pages). The padding is now applied instantly; it animates only for the sidebar's own collapse/expand button.
async function mainLeftOverTime(page, ms) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const xs = []; const t0 = performance.now();
    const tick = () => {
      const m = document.querySelector("main");
      if (m) xs.push(Math.round(m.getBoundingClientRect().left));
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(xs);
    };
    tick();
  }), ms);
}

test("the page content does not slide sideways after the page loads", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, users.staff);
  for (const path of ["/staff/interviews", "/staff/tests/new"]) {
    await page.goto(path);
    await page.locator("aside").first().waitFor();
    const xs = await mainLeftOverTime(page, 700);
    expect(xs.length).toBeGreaterThan(5);
    expect(Math.max(...xs) - Math.min(...xs), `main moved sideways on ${path}: ${[...new Set(xs)].join(", ")}`).toBeLessThanOrEqual(1);
  }
});

test("the sidebar collapse button still moves the content, animated", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, users.staff);
  await page.goto("/staff");
  await page.locator("aside").first().waitFor();
  const before = await page.evaluate(() => Math.round(document.querySelector("main").getBoundingClientRect().left));
  await page.getByRole("button", { name: /collapse sidebar/i }).click();
  await expect.poll(() => page.evaluate(() => Math.round(document.querySelector("main").getBoundingClientRect().left)), { timeout: 3000 }).toBeLessThan(before);
  await page.getByRole("button", { name: /expand sidebar/i }).click();
  await expect.poll(() => page.evaluate(() => Math.round(document.querySelector("main").getBoundingClientRect().left)), { timeout: 3000 }).toBe(before);
});
