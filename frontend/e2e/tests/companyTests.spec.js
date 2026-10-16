const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// Company-tagged tests (the "TCS" style rounds) run on the shared exam engine. Opening one from the Company Tests page must NOT start the attempt:
// the attempt, and with it the server-side clock, begins at the Begin button after the instructions / security gate.
test("company test: Start Test opens the instructions gate without creating an attempt or releasing questions", async ({ page }) => {
  const starts = [];
  const detailBodies = [];
  page.on("request", (r) => { if (/\/tests\/[^/]+\/start$/.test(r.url()) && r.method() === "POST") starts.push(Date.now()); });
  page.on("response", async (r) => { if (new RegExp(`/tests/${data.companyTestId}$`).test(r.url()) && r.request().method() === "GET") { try { detailBodies.push(await r.json()); } catch { /* ignore */ } } });

  await login(page, users.student);
  await page.goto("/company-tests");
  const card = page.locator(".card", { hasText: "Company Test" }).filter({ hasText: "ZZCO" }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /Start Test/ }).click();

  await expect(page).toHaveURL(new RegExp(`/test/${data.companyTestId}$`));
  await expect(page.getByRole("button", { name: /Begin Assessment/ })).toBeVisible();
  expect(starts, "no attempt is started before the Begin button").toEqual([]);
  expect(detailBodies.every((b) => b.questionsWithheld === true), "questions are still withheld on the gate").toBe(true);

  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.getByText(/E2E question [0-9]: pick option B/).first()).toBeVisible({ timeout: 20000 });
  expect(starts.length, "exactly one start, made by Begin").toBe(1);
});
