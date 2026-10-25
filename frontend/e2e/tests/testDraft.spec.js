const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// REGRESSION (UI/UX audit batch 12): the create-test form lost everything typed when the tab was reloaded or the session expired. The unsaved form is now kept as a draft in the tab and OFFERED
// back after a reload (never applied silently); it can be restored or discarded, and another account on the same tab does not see it.
const TITLE = "Draft survival check";

test("an unsaved test is offered back after a reload, restores exactly, and can be discarded", async ({ page }) => {
  await login(page, users.staff);
  await page.goto("/staff/tests/new");
  await page.locator("#test-title").fill(TITLE);
  await page.waitForTimeout(1500); // the draft is saved shortly after typing stops

  await page.reload();
  const offer = page.getByTestId("draft-offer");
  await expect(offer, "the draft is offered after a reload").toBeVisible({ timeout: 15000 });
  await expect(page.locator("#test-title"), "nothing is applied until the person chooses").toHaveValue("");

  await offer.getByRole("button", { name: "Restore draft" }).click();
  await expect(page.locator("#test-title"), "restoring brings back exactly what was typed").toHaveValue(TITLE);
  await expect(offer).toBeHidden();

  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByTestId("draft-offer"), "still offered after another reload until it is saved or discarded").toBeVisible({ timeout: 15000 });
  await page.getByTestId("draft-offer").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("draft-offer")).toBeHidden();

  await page.reload();
  await expect(page.locator("#test-title")).toHaveValue("");
  await expect(page.getByTestId("draft-offer"), "a discarded draft does not come back").toHaveCount(0);
});

test("a draft is not offered to a different account on the same tab", async ({ page }) => {
  await login(page, users.staff);
  await page.goto("/staff/tests/new");
  await page.locator("#test-title").fill(TITLE);
  await page.waitForTimeout(1500);

  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.goto("/login");
  await login(page, users.platform);
  await page.goto("/staff/tests/new");
  await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
  await expect(page.getByTestId("draft-offer"), "the other account sees no draft").toHaveCount(0);
});
