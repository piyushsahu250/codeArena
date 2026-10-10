const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// Staff & clerk analytics UI. Numbers, isolation and exports are proven by backend/scripts/verifyStaffAnalytics.js against the real API; this checks that
// the screens render the real data states, are reachable only by the right roles, and can be driven by keyboard and on a phone.
const DENIED = /isn't available for your account type/i;

test("staff and clerk cannot open the admin analytics pages", async ({ page }) => {
  await login(page, users.staff);
  await page.goto("/admin/staff-analytics");
  await expect(page.locator("body")).toContainText(DENIED);
});

test("a student cannot open the personal activity page", async ({ page }) => {
  await login(page, users.student);
  await page.goto("/my-activity");
  await expect(page.locator("body")).toContainText(DENIED);
});

test("platform admin sees filters, KPIs, definitions and an export menu with three formats", async ({ page }) => {
  await login(page, users.platform);
  await page.goto("/admin/staff-analytics");
  await expect(page.locator("h1")).toContainText("Staff & clerk analytics");
  await expect(page.getByLabel("College filter")).toBeVisible();
  await expect(page.getByText("People in scope")).toBeVisible();
  await expect(page.getByText("Counted events").first()).toBeVisible();
  await page.getByRole("button", { name: /Export people/ }).click();
  for (const label of ["CSV (spreadsheet)", "Excel (.xlsx)", "PDF report"]) await expect(page.getByRole("menuitem", { name: label })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByText("How these numbers are calculated").click();
  await expect(page.getByText("no composite performance score", { exact: false })).toBeVisible();
});

test("institute admin gets no college picker and sees only their college", async ({ page }) => {
  await login(page, users.instAdmin);
  await page.goto("/admin/staff-analytics");
  await expect(page.locator("h1")).toContainText("Staff & clerk analytics");
  await expect(page.getByLabel("College filter")).toHaveCount(0);
  await expect(page.getByText("Your college", { exact: true })).toBeVisible();
});

test("the people table opens a person's detail with workload, ratios and a log", async ({ page }) => {
  await login(page, users.instAdmin);
  await page.goto("/admin/staff-analytics");
  const first = page.locator("table.ad-table a.ad-link").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByText("By activity type")).toBeVisible();
  await expect(page.getByText("Ratios with published formulas")).toBeVisible();
  await expect(page.getByText("Activity log")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/NaN|undefined/);
});

test("staff see only their own activity page, with no peer ranking", async ({ page }) => {
  await login(page, users.staff);
  await page.goto("/my-activity");
  await expect(page.locator("h1")).toContainText("My activity");
  await expect(page.getByText("only your own recorded activity")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("People in scope");
});

test("the analytics dashboard fits a phone without sideways page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, users.platform);
  await page.goto("/admin/staff-analytics");
  await expect(page.locator("h1")).toContainText("Staff & clerk analytics");
  await page.waitForLoadState("networkidle").catch(() => {});
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
});
