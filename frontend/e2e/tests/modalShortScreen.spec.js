const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// REGRESSION (UI/UX audit batch 3): dialogs had no height limit, so on a short screen (a phone in landscape, a small laptop with the browser zoomed) the bottom of the dialog,
// including its Cancel / Submit buttons, sat below the fold and could not be scrolled to. The dialog card now scrolls inside itself.
test("short screen: the Report a problem dialog stays inside the viewport and its buttons can be reached", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 260 });
  await login(page, users.student);
  await page.getByTitle("Report a problem").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const card = dialog.locator(".card").first();
  const box = await card.boundingBox();
  expect(box.y, "dialog top is on screen").toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, "dialog bottom is on screen").toBeLessThanOrEqual(260 + 1);
  const scrolls = await card.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls, "content taller than the card scrolls inside it").toBe(true);
  const submit = dialog.getByRole("button", { name: /submit|send/i }).last();
  await submit.scrollIntoViewIfNeeded();
  const sb = await submit.boundingBox();
  expect(sb.y + sb.height, "submit button can be scrolled into view").toBeLessThanOrEqual(260 + 1);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
