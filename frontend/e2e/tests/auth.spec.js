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

// REGRESSION: signing out cleared the browser's token before the sign-out request read it, so the request went out without credentials and the server session stayed open
// for its full 12 hours. After signing out, the token must be dead on the server.
test("signing out ends the session on the server, not only in the browser", async ({ page, request }) => {
  await login(page, users.student3);
  const token = await page.evaluate(() => localStorage.getItem("token"));
  expect(token).toBeTruthy();
  const before = await request.get("http://localhost:4000/api/auth/permissions", { headers: { Authorization: `Bearer ${token}` } });
  expect(before.status()).toBe(200);
  await page.locator(".ca-topbar-icon-btn", { hasText: users.student3.name.split(" ")[0] }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect.poll(async () => (await request.get("http://localhost:4000/api/auth/permissions", { headers: { Authorization: `Bearer ${token}` } })).status(), { timeout: 10000 }).toBe(401);
});
