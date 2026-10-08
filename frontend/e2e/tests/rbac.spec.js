const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// Route guards in the UI. (The API enforces the same rules independently; those are covered by the backend verify scripts.)
const DENIED = /isn't available for your account type/i;

for (const [who, path] of [["student", "/admin"], ["student", "/staff"], ["student", "/clerk"], ["clerk", "/staff"], ["clerk", "/admin"], ["staff", "/clerk"], ["staff", "/admin"]]) {
  test(`${who} cannot open ${path}`, async ({ page }) => {
    await login(page, users[who]);
    await page.goto(path);
    await expect(page.locator("body")).toContainText(DENIED);
  });
}

test("a student sees only student navigation", async ({ page }) => {
  await login(page, users.student);
  const nav = await page.locator("aside").innerText();
  for (const staffOnly of ["Feature Management", "Email Logs", "Academic Groups", "Question Bank"]) expect(nav).not.toContain(staffOnly);
  expect(nav).toContain("Dashboard");
});

test("institute admin sees their own institute, platform admin sees the global command center", async ({ page, browser }) => {
  await login(page, users.instAdmin);
  await expect(page.locator("h1")).toContainText("ZZ E2E Alpha Institute");
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await login(p2, users.platform);
  await expect(p2.locator("h1")).toContainText("Global Command Center");
  await ctx.close();
});

test("institute admin cannot reach another institute's drill-down page data", async ({ page }) => {
  await login(page, users.instAdmin);
  const { data } = require("./helpers");
  await page.goto(`/admin/institutes/${data.institutes.B.id}/overview`);
  // the backend pins institute-bound callers to their own institute, so Beta's name must never be shown
  await expect(page.locator("body")).not.toContainText("ZZ E2E Beta Institute", { timeout: 8000 });
});
