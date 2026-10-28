const crypto = require("crypto");
const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// An administrator extends a test while a student is taking it: the student's countdown must follow the server's new deadline without a reload, keep the open question, and keep the new
// deadline after a refresh. Real Chromium and the real API (the student page asks the server for its own clock about every 20 seconds).
const API = "http://localhost:4000/api";
const minutesLeft = async (page) => {
  const text = (await page.locator('[role="timer"]').first().innerText()).replace(/[^0-9:]/g, "");
  const p = text.split(":").map(Number);
  return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p[0] + (p[1] || 0) / 60;
};
const QUESTION = /E2E question [0-9]: pick option B/;

test("extending a running test updates the countdown without a refresh, shows the revised deadline, and survives a refresh", async ({ page, request }) => {
  await login(page, users.student);
  await page.goto(`/test/${data.durationTestId}`);
  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.getByText(QUESTION).first()).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => { window.__stayedOnThisPage = true; });
  const before = await minutesLeft(page);
  expect(before, "a 20 minute test, just started").toBeGreaterThan(17);
  expect(before).toBeLessThanOrEqual(20);

  // the administrator (the test's creator) previews and applies 20 -> 60
  const staffToken = (await (await request.post(`${API}/auth/login`, { data: { email: users.staff.email, password: users.staff.password } })).json()).token;
  const H = { Authorization: `Bearer ${staffToken}` };
  const impact = await (await request.get(`${API}/tests/${data.durationTestId}/duration-impact?durationMin=60`, { headers: H })).json();
  expect(impact.attempts.active).toBeGreaterThanOrEqual(1);
  expect(impact.plan.movedLater).toBeGreaterThanOrEqual(1);
  const applied = await request.patch(`${API}/tests/${data.durationTestId}/duration`, { headers: H, data: { durationMin: 60, expectedVersion: impact.test.version, requestId: crypto.randomUUID(), reason: "e2e" } });
  expect(applied.status()).toBe(200);
  expect((await applied.json()).eligibleAttempts).toBeGreaterThanOrEqual(1);

  // the student page follows within a sync interval, with no reload
  await expect.poll(() => minutesLeft(page), { timeout: 50000, intervals: [1000] }).toBeGreaterThan(55);
  await expect(page.getByText(/Your exam duration has been updated by the administrator\. Your revised deadline is/)).toBeVisible();
  expect(await page.evaluate(() => window.__stayedOnThisPage === true), "the page was not reloaded").toBe(true);
  await expect(page.getByText(QUESTION).first(), "the open question is still there").toBeVisible();

  // a refresh gets the same new deadline from the server
  await page.reload();
  const begin = page.getByRole("button", { name: /Begin Assessment/ });
  if (await begin.isVisible().catch(() => false)) {
    await page.getByLabel("I have read and understood the instructions.").check();
    await begin.click();
  }
  await expect(page.getByText(QUESTION).first()).toBeVisible({ timeout: 20000 });
  expect(await minutesLeft(page), "after a refresh the deadline is still the extended one").toBeGreaterThan(55);
});
