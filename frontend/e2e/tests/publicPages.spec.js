const { test, expect } = require("@playwright/test");

// REGRESSION (UI/UX audit batch 10): a probe of the pages anyone can open without signing in found nine of them (sign-in, forgot and reset password, email confirmation, the four certificate /
// marksheet verification pages, and the forced password change) with no <h1> (their title was an <h2>), so a screen reader had no page heading to jump to; and, at phone width, footer links
// 16px tall on every marketing page, "Learn more" links 17px and the sign-in page's "Forgot password?" 15px, all below the 24 x 24 CSS px minimum touch target (WCAG 2.5.8).
const WITH_ONE_H1 = [
  "/login", "/forgot-password", "/reset-password?token=abc", "/verify-email?token=abc",
  "/certificate/verify/NOSUCHCODE", "/learning/certificate/verify/NOSUCHCODE", "/results/verify/NOSUCHCODE", "/interview/verify/NOSUCHCODE",
  "/this-page-does-not-exist",
];

test("every public page has exactly one main heading", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const route of WITH_ONE_H1) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
    await expect(page.locator("h1"), `${route} has one <h1>`).toHaveCount(1);
  }
});

test("phone width: footer, Learn more and Forgot password links meet the 24px minimum touch target", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  const small = async (selector) => page.locator(selector).evaluateAll((els) => els.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).filter((el) => el.getBoundingClientRect().height < 24 || el.getBoundingClientRect().width < 24).map((el) => `${(el.textContent || "").trim().slice(0, 20)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
  for (const [route, selector] of [["/", ".ca-landing-footer-col a"], ["/", ".ca-feature-learn-more"], ["/about", ".ca-landing-footer-col a"], ["/login", ".ca-tap-link"]]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
    expect(await page.locator(selector).count(), `${route} has ${selector}`).toBeGreaterThan(0);
    expect(await small(selector), `${route} ${selector} under 24px`).toEqual([]);
  }
});
