const { test, expect } = require("@playwright/test");
const { users, watch, login } = require("./helpers");

test("an anonymous visitor is sent to the login page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password shows an error and stays on login", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(users.student.email);
  await page.locator('input[type="password"]').fill("definitely-wrong-password");
  await page.locator("form button").first().click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("body")).toContainText(/invalid|incorrect|wrong|credentials/i);
});

for (const [key, landing] of [["student", /\/dashboard/], ["staff", /\/staff/], ["clerk", /\/clerk/], ["instAdmin", /\/admin/], ["platform", /\/admin/]]) {
  test(`${key} logs in and lands on their own dashboard without errors`, async ({ page }) => {
    const problems = watch(page);
    await login(page, users[key]);
    await expect(page).toHaveURL(landing);
    await expect(page.locator("main, #main-content").first()).toBeVisible();
    expect(problems).toEqual([]);
  });
}

test("the session survives a reload and a logged-out user cannot reuse a protected page", async ({ page }) => {
  await login(page, users.student);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.evaluate(() => localStorage.clear());
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
