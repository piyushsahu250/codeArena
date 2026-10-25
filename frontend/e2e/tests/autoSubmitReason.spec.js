const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// An auto-submitted attempt must say why. The seeded test has three attempts: Ela submitted normally (9 points); Ben was auto-submitted because his time ran out and the server closed the attempt
// 10 minutes after his deadline, with 0 strikes; Cal was auto-submitted because three tab switches reached the strike limit.
async function openResults(page) {
  await login(page, users.staff);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/staff/tests/${data.violationsTestId}/results`);
  await expect(page.locator("thead th", { hasText: /^Strikes$/ })).toBeVisible({ timeout: 15000 });
}
const rowOf = (page, name) => page.getByRole("row").filter({ hasText: name });
const card = (page) => page.getByRole("region", { name: /Why this attempt was auto-submitted/i });

test("auto-submitted by the clock with 0 strikes: the page says time ran out and that no strikes were involved", async ({ page }) => {
  await openResults(page);
  await rowOf(page, users.student2.name).getByRole("button", { name: /Auto-submitted: show why/i }).click();
  await expect(card(page)).toBeVisible({ timeout: 15000 });
  await expect(card(page)).toContainText("Auto-submitted: time ran out");
  await expect(card(page)).toContainText("No strikes were involved");
  await expect(card(page)).toContainText("the server closed it 10 min after the deadline");
  for (const [label, value] of [["Allowed time", "20 minutes"], ["After the deadline", "10 min"], ["Strikes", "0 of 3"]]) {
    await expect(card(page).locator(".vl-auto-fact", { hasText: label }), `${label} is shown`).toContainText(value);
  }
  const log = page.getByRole("region", { name: /Proctoring log for/i });
  await expect(log.getByText("0 strikes counted")).toBeVisible();
  await expect(log.getByText("No events recorded for this attempt.")).toBeVisible();
});

test("auto-submitted by the strike limit: the page says so and lists the counted events", async ({ page }) => {
  await openResults(page);
  await rowOf(page, users.student3.name).getByRole("button", { name: /Auto-submitted: show why/i }).click();
  await expect(card(page)).toContainText("Auto-submitted: strike limit reached", { timeout: 15000 });
  await expect(card(page)).toContainText("reached 3 of 3 strikes");
  const log = page.getByRole("region", { name: /Proctoring log for/i });
  await expect(log.getByText("3 strikes counted")).toBeVisible();
  expect(await log.locator("tbody tr td:last-child .vl-pill").allTextContents()).toEqual(["Strike 1", "Strike 2", "Strike 3"]);
  expect(await log.locator(".vl-event-name").allTextContents()).toEqual(["Left the exam page (tab switch)", "Left the exam page (tab switch)", "Left the exam page (tab switch)"]);
});

test("the status is a real button (expanded state, keyboard) and a normally submitted attempt has none", async ({ page }) => {
  await openResults(page);
  const ben = rowOf(page, users.student2.name).getByRole("button", { name: /Auto-submitted/i });
  await expect(ben).toHaveAttribute("aria-expanded", "false");
  await ben.focus();
  await page.keyboard.press("Enter");
  await expect(ben).toHaveAttribute("aria-expanded", "true");
  await expect(card(page)).toBeVisible({ timeout: 15000 });
  await page.keyboard.press("Enter");
  await expect(ben).toHaveAttribute("aria-expanded", "false");
  await expect(card(page)).toHaveCount(0);
  await expect(rowOf(page, users.student.name).getByRole("button", { name: /Auto-submitted/i }), "a normally submitted attempt is not offered an auto-submit explanation").toHaveCount(0);
});
