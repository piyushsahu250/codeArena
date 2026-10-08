const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// The page itself must never scroll sideways (wide tables scroll inside their own container) at any common width.
const WIDTHS = [320, 375, 768, 1024, 1440, 1920];
const SCREENS = [["student", "/dashboard"], ["staff", "/staff"], ["clerk", "/clerk"], ["instAdmin", "/admin"], ["platform", "/admin"]];

for (const [who, path] of SCREENS) {
  test(`${who} ${path}: no horizontal page overflow from 320px to 1920px`, async ({ page }) => {
    await login(page, users[who]);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(250);
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(scroll, `${who} at ${w}px scrolls sideways (${scroll} > ${inner})`).toBeLessThanOrEqual(inner + 1);
    }
  });
}

test("student dashboard on a phone: sidebar becomes a drawer and primary controls are touch-sized", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, users.student);
  const hamburger = page.getByRole("button", { name: "Toggle menu" });
  await expect(hamburger).toBeVisible();
  const small = await page.evaluate(() => [...document.querySelectorAll(".sd-btn, .sd-action")].filter((el) => el.offsetParent).map((el) => ({ h: el.getBoundingClientRect().height, t: (el.textContent || "").trim().slice(0, 20) })).filter((x) => x.h < 34));
  expect(small, `controls shorter than 34px: ${JSON.stringify(small)}`).toEqual([]);
});
