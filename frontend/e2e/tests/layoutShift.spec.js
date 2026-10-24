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

// REGRESSION (UI/UX audit batch 5, UX-8): the filter form on /staff/interview-reports sat ~170px too high until the stat cards loaded and pushed it down, and the
// /dashboard/performance loading skeleton was narrower and shorter than the page that replaced it.
async function topsOverTime(page, selector, ms) {
  return page.evaluate(([sel, ms]) => new Promise((resolve) => {
    const out = []; const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector(sel);
      if (el) out.push(Math.round(el.getBoundingClientRect().top));
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(out);
    };
    tick();
  }), [selector, ms]);
}

test("the filter form on the interview reports page does not jump down when the stat cards arrive", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, users.staff);
  await page.goto("/staff/interview-reports");
  const tops = await topsOverTime(page, "main form.card", 2500);
  expect(tops.length).toBeGreaterThan(5);
  expect(Math.max(...tops) - Math.min(...tops), `form top positions: ${[...new Set(tops)].join(", ")}`).toBeLessThanOrEqual(24);
});

test("the performance page keeps its width and does not jump when the data replaces the loading skeleton", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, users.student);
  await page.goto("/dashboard/performance");
  const lefts = await page.evaluate(() => new Promise((resolve) => {
    const out = []; const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector("main > div > div");
      if (el) out.push(Math.round(el.getBoundingClientRect().left));
      if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else resolve(out);
    };
    tick();
  }));
  expect(lefts.length).toBeGreaterThan(5);
  expect(Math.max(...lefts) - Math.min(...lefts), `content left positions: ${[...new Set(lefts)].join(", ")}`).toBeLessThanOrEqual(1);
});
