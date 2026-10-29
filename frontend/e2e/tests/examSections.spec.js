const { test, expect } = require("@playwright/test");
const { users, login, watch, expectNoBrokenText } = require("./helpers");

// Smoke checks that the section-wise examination screens load for the right roles, render real text and raise no page error or server error. The exam flow itself (all four sections,
// refresh recovery, concurrency, expiry, isolation) is covered against the real API by backend/test/examEngine.integration.test.js.
test("a student sees the examinations page", async ({ page }) => {
  const problems = watch(page);
  await login(page, users.student);
  await page.goto("/exams");
  await expect(page.getByRole("heading", { name: "Examinations" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoBrokenText(page);
  expect(problems).toEqual([]);
});

test("an institute administrator sees the section exams list and the editor", async ({ page }) => {
  const problems = watch(page);
  await login(page, users.instAdmin);
  await page.goto("/exam-admin");
  await expect(page.getByRole("heading", { name: "Section Exams" })).toBeVisible();
  await page.getByRole("link", { name: /New section exam/ }).click();
  await expect(page).toHaveURL(/\/exam-admin\/new/);
  await expect(page.getByLabel("Title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "A · Aptitude" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "D · AI Mock Interview" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoBrokenText(page);
  expect(problems).toEqual([]);
});

test("a student cannot open the administration screens", async ({ page }) => {
  await login(page, users.student);
  await page.goto("/exam-admin");
  await expect(page.getByRole("heading", { name: "Section Exams" })).toHaveCount(0);
});
