const { test, expect } = require("@playwright/test");

// REGRESSION (UI/UX audit batch 14): /register showed a browser alert() and then redirected to the sign-in page. It now redirects straight away and the sign-in page explains, in the page,
// that accounts are created by the institute administrator. No modal pop-up is ever shown.
test("/register explains that accounts are created by the administrator, without a pop-up", async ({ page }) => {
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await page.goto("/register");
  await expect(page).toHaveURL(/\/login\?notice=registration/);
  const notice = page.getByTestId("registration-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("institute administrator");
  expect(dialogs, "no alert() dialog was shown").toEqual([]);
  await expect(page.locator("#login-email"), "the sign-in form is there and usable").toBeVisible();
});

test("the notice is not shown on an ordinary visit to the sign-in page", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("#login-email")).toBeVisible();
  await expect(page.getByTestId("registration-notice")).toHaveCount(0);
});
