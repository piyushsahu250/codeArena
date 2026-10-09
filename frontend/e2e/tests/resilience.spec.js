const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// A failed API call that the page itself does not handle (the course list on the staff learning page has no catch) must not leave the person with a silent
// empty screen: they get one plain message with a Refresh action.
test("an unhandled network failure is reported once, in plain words", async ({ page }) => {
  await login(page, users.platform);
  await page.route("**/api/learning/courses", (route) => route.abort("failed"));
  await page.goto("/staff/learning");
  const notice = page.getByRole("status").filter({ hasText: /couldn't reach the server/i });
  await expect(notice).toBeVisible({ timeout: 10000 });
  await expect(notice.getByRole("button", { name: "Refresh" })).toBeVisible();
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
});

test("a server error on an unhandled call says it was on our side", async ({ page }) => {
  await login(page, users.platform);
  await page.route("**/api/learning/courses", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }));
  await page.goto("/staff/learning");
  await expect(page.getByRole("status").filter({ hasText: /went wrong on our side/i })).toBeVisible({ timeout: 10000 });
});

test("no notice appears when everything loads", async ({ page }) => {
  await login(page, users.platform);
  await page.goto("/staff/learning");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /couldn't reach|went wrong on our side|could not be loaded/i })).toHaveCount(0);
});
