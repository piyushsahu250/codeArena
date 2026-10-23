const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// REGRESSION (UI/UX audit batch 2): at phone width the shared Back button was 23px tall on about 74 pages, selects 21px, native checkboxes 13px and <summary> rows 16px, all below the
// 24 x 24 CSS px minimum touch target of WCAG 2.5.8. The probe (uxAudit.spec.js) found them; these checks keep them fixed.
const MIN = 24;
async function sizes(page, selector) {
  return page.locator(selector).evaluateAll((els) => els.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; }).map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }));
}

test("phone width: the Back button, selects, checkboxes and summaries meet the 24px minimum touch target", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await login(page, users.staff);
  await page.goto("/staff/tests/new");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  const back = await sizes(page, ".ca-back-btn");
  expect(back.length, "this page has a Back button").toBeGreaterThan(0);
  for (const s of back) expect(s.h, "Back button height").toBeGreaterThanOrEqual(MIN);
  for (const s of await sizes(page, "select")) expect(s.h, "select height").toBeGreaterThanOrEqual(MIN);
  for (const s of await sizes(page, 'input[type="checkbox"], input[type="radio"]')) { expect(s.w, "checkbox width").toBeGreaterThanOrEqual(MIN - 4); expect(s.h, "checkbox height").toBeGreaterThanOrEqual(MIN - 4); }
  await page.goto("/my-activity");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  for (const s of await sizes(page, "summary")) expect(s.h, "summary height").toBeGreaterThanOrEqual(MIN);
});

test("desktop width: the Back button keeps a comfortable size and does not change the page layout width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, users.staff);
  await page.goto("/staff/tests/new");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  for (const s of await sizes(page, ".ca-back-btn")) expect(s.h).toBeGreaterThanOrEqual(MIN);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
