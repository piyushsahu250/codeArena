const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// The proctoring log on the staff results page, redesigned for clarity: a summary, one plain sentence about what the signals are, events oldest first with their strikes numbered, times that do not
// wrap, and the long rule text folded away. The seeded attempt has a right-click and a first copy (warnings), a repeated copy (Strike 1) and a full-screen exit (Strike 2).
async function openLog(page) {
  await login(page, users.staff);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/staff/tests/${data.violationsTestId}/results`);
  await page.getByRole("button", { name: /2 strikes: open the proctoring log/i }).click();
  const log = page.getByRole("region", { name: /Proctoring log for/i });
  await expect(log).toBeVisible({ timeout: 15000 });
  return log;
}

test("the log is clear: summary, honest wording, oldest first, strikes numbered", async ({ page }) => {
  await login(page, users.staff);
  await page.goto(`/staff/tests/${data.violationsTestId}/results`);
  await expect(page.getByRole("columnheader", { name: "Strikes" }), "the column is named for what it counts").toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("columnheader", { name: /Tab switches/i })).toHaveCount(0);

  const log = await openLog(page);
  await expect(log.getByText("4 events recorded")).toBeVisible();
  await expect(log.getByText("2 strikes counted")).toBeVisible();
  await expect(log.getByText("2 warnings")).toBeVisible();
  await expect(log.getByText(/browser signals, not proof of misconduct/i)).toBeVisible();

  const names = await log.locator(".vl-event-name").allTextContents();
  expect(names, "oldest first, in plain words").toEqual(["Right-click on the exam page", "Copy attempt", "Copy attempt", "Left full-screen mode"]);
  const counted = await log.locator("tbody tr td:last-child .vl-pill").allTextContents();
  expect(counted).toEqual(["Warning", "Warning", "Strike 1", "Strike 2"]);
});

test("nothing wraps awkwardly: times and the status pill stay on one line, the long rule text is folded away", async ({ page }) => {
  const log = await openLog(page);
  for (const cell of await log.locator(".vl-time").all()) {
    const box = await cell.boundingBox();
    expect(box.height, "a time such as 3:18:14 PM is on one line").toBeLessThan(40);
  }
  const status = page.locator("tbody .badge").first();
  expect((await status.boundingBox()).height, "the status pill is on one line").toBeLessThan(30);
  // Rule text exists only for events the exam's policy covers; when it does, it starts folded away.
  if (await log.locator(".vl-details summary").count()) {
    await expect(log.getByText(/Does not show:/).first(), "the long explanation is not shown until asked for").toBeHidden();
    await log.getByText("What this shows").first().click();
    await expect(log.getByText(/Does not show:/).first()).toBeVisible();
  }
});

test("the log is not a wall of monospace text and can be read at phone width", async ({ page }) => {
  const log = await openLog(page);
  const font = await log.locator(".vl-note").evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
  expect(font, "the explanation is set in the body font").not.toMatch(/mono|courier|consolas/);
  await page.setViewportSize({ width: 375, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page itself does not scroll sideways").toBeLessThanOrEqual(1);
  await expect(log.getByText("Strike 2")).toBeVisible();
});
