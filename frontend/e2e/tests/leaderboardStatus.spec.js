const { test, expect } = require("@playwright/test");
const { data, users, login, watch } = require("./helpers");

// The staff results leaderboard must label each attempt from the server's lifecycle (finished, in progress, time expired, auto-submitted), count them correctly and
// rank only finished attempts. REGRESSION: an attempt whose own time had run out but which was not yet closed used to read "In progress" and rank by its running score.
// Seeded test (20-minute duration): Ela submitted (9), Dan auto-submitted (4), Ben in progress inside his time (7), Cal in progress but 60 minutes in (8, expired).
async function open(page) {
  const problems = watch(page);
  await login(page, users.staff);
  await page.goto(`/staff/tests/${data.statusTestId}/results`);
  await expect(page.locator("tbody tr", { hasText: "Ela Student" })).toBeVisible({ timeout: 20000 });
  return problems;
}
const row = (page, name) => page.locator("tbody tr", { hasText: name }).first();
const cellsOf = async (page, name) => (await row(page, name).locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());

test("each attempt shows the right state, and the counts add up", async ({ page }) => {
  const problems = await open(page);
  await expect(row(page, "Ela Student").getByText("Submitted", { exact: true })).toBeVisible();
  await expect(row(page, "Dan Student").getByText("Auto-submitted", { exact: true })).toBeVisible();
  await expect(row(page, "Ben Student").getByText("In progress", { exact: true })).toBeVisible();
  await expect(row(page, "Cal Student").getByText("Time expired", { exact: true }), "past its own time and not closed").toBeVisible();
  await expect(row(page, "Cal Student").getByText("In progress", { exact: true }), "an expired attempt is not shown as in progress").toHaveCount(0);
  await expect(page.locator(".card", { hasText: "Completed" }).filter({ hasText: "2 / 4" }).first()).toBeVisible();
  await expect(page.locator(".card", { hasText: "In progress" }).filter({ hasText: /^In progress\s*1$/ }).first()).toBeVisible();
  await expect(page.locator(".card", { hasText: "Time expired, not closed" }).filter({ hasText: "1" }).first()).toBeVisible();
  expect(problems, "no page errors or 5xx").toEqual([]);
});

test("only finished attempts are ranked, even though an unfinished attempt has a higher running score", async ({ page }) => {
  await open(page);
  const ela = (await cellsOf(page, "Ela Student"))[0];
  const dan = (await cellsOf(page, "Dan Student"))[0];
  const ben = (await cellsOf(page, "Ben Student"))[0];
  const cal = (await cellsOf(page, "Cal Student"))[0];
  expect(ela, "Ela (9, submitted) is rank 1").toMatch(/1$/);
  expect(dan, "Dan (4, auto-submitted) is rank 2 although Ben (7) and Cal (8) have higher running scores").toMatch(/2$/);
  expect(ben).toBe("—");
  expect(cal).toBe("—");
});

test("a search keeps each row state and rank", async ({ page }) => {
  await open(page);
  await page.getByRole("searchbox", { name: /Search the leaderboard/ }).fill("cal");
  await expect(page.locator("tbody tr", { hasText: "Cal Student" })).toHaveCount(1);
  await expect(row(page, "Cal Student").getByText("Time expired", { exact: true })).toBeVisible();
  expect((await cellsOf(page, "Cal Student"))[0]).toBe("—");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(row(page, "Ela Student")).toBeVisible();
});
