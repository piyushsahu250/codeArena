const { test, expect } = require("@playwright/test");
const { users, watch, login, expectNoBrokenText } = require("./helpers");

test("student dashboard: header, sections, honest empty states, one aggregated request", async ({ page }) => {
  const problems = watch(page);
  const dashboardCalls = [];
  page.on("request", (r) => { if (r.url().includes("/api/student/dashboard")) dashboardCalls.push(r.url()); });
  await login(page, users.student);
  await expect(page.locator("h1")).toContainText(/Good (morning|afternoon|evening), Ela|Welcome back/);
  await expect(page.getByText("Continue learning")).toBeVisible();
  await expect(page.getByText("Your next tasks")).toBeVisible();
  await expect(page.getByText("Placement readiness")).toBeVisible();
  await expect(page.getByText("Not available yet").first()).toBeVisible(); // empty metrics are explained, never a bare 0
  await expectNoBrokenText(page);
  expect(dashboardCalls.length).toBe(1);
  expect(problems).toEqual([]);
});

test("student dashboard shows the pending test as a task with a deadline", async ({ page }) => {
  await login(page, users.student);
  await expect(page.getByText("ZZ E2E Standard Test")).toBeVisible();
  await expect(page.getByText(/Due/).first()).toBeVisible();
});

test("student dashboard: compact view toggle is remembered", async ({ page }) => {
  await login(page, users.student);
  await page.getByRole("button", { name: /Compact view/ }).click();
  await expect(page.locator("main.sd.compact")).toBeVisible();
  await page.reload();
  await expect(page.locator("main.sd.compact")).toBeVisible();
});

test("staff dashboard: task-first layout with real counts", async ({ page }) => {
  const problems = watch(page);
  await login(page, users.staff);
  await expect(page.locator("h1")).toContainText(/Good (morning|afternoon|evening), Sam/);
  await expect(page.getByText("Students in scope")).toBeVisible();
  await expect(page.getByText("Students requiring attention")).toBeVisible();
  await expectNoBrokenText(page);
  expect(problems).toEqual([]);
});

test("clerk dashboard: task center and metrics", async ({ page }) => {
  const problems = watch(page);
  await login(page, users.clerk);
  await expect(page.getByText("Task center")).toBeVisible();
  await expect(page.getByText("Documents pending")).toBeVisible();
  await expectNoBrokenText(page);
  expect(problems).toEqual([]);
});

test("institute dashboard: health, KPIs, department table and export", async ({ page }) => {
  const problems = watch(page);
  await login(page, users.instAdmin);
  await expect(page.getByText("Institute health")).toBeVisible();
  await expect(page.getByText("Department performance")).toBeVisible();
  await expect(page.getByText("E2E Computer Science").first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export CSV/ }).first().click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await expectNoBrokenText(page);
  expect(problems).toEqual([]);
});

test("global command center: institutes table, search and drill-down", async ({ page }) => {
  const problems = watch(page);
  await login(page, users.platform);
  await expect(page.getByText("Institute overview")).toBeVisible();
  await page.getByPlaceholder("Search institute").fill("ZZ E2E Alpha");
  await expect(page.getByRole("link", { name: /ZZ E2E Alpha Institute/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /ZZ E2E Beta Institute/ })).toHaveCount(0);
  await page.getByRole("link", { name: /ZZ E2E Alpha Institute/ }).click();
  await expect(page.getByText("Global dashboard")).toBeVisible(); // breadcrumb back to the global view
  await expect(page.locator("h1")).toContainText("ZZ E2E Alpha Institute");
  await expectNoBrokenText(page);
  expect(problems).toEqual([]);
});
