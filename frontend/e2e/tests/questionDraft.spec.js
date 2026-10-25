const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// REGRESSION (UI/UX audit batch 13): like the create-test form (batch 12), the create-question form lost everything typed on a reload or an expired session. The unsaved form is now kept
// as a draft in the tab and OFFERED back (never applied silently); it can be restored or discarded.
const TITLE = "Draft survival: reverse a string";
const DESCRIPTION = "Read a line and print it reversed. This text must survive a reload.";

test("an unsaved question is offered back after a reload, restores exactly, and can be discarded", async ({ page }) => {
  await login(page, users.staff);
  await page.goto("/staff/questions/new");
  await page.locator("#cq-title").fill(TITLE);
  await page.locator("#cq-description").fill(DESCRIPTION);
  await page.waitForTimeout(1500); // the draft is saved shortly after typing stops

  await page.reload();
  const offer = page.getByTestId("draft-offer");
  await expect(offer, "the draft is offered after a reload").toBeVisible({ timeout: 15000 });
  await expect(page.locator("#cq-title"), "nothing is applied until the person chooses").toHaveValue("");

  await offer.getByRole("button", { name: "Restore draft" }).click();
  await expect(page.locator("#cq-title"), "restoring brings back the name").toHaveValue(TITLE);
  await expect(page.locator("#cq-description"), "and the description").toHaveValue(DESCRIPTION);
  await expect(offer).toBeHidden();

  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByTestId("draft-offer"), "still offered until it is saved or discarded").toBeVisible({ timeout: 15000 });
  await page.getByTestId("draft-offer").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("draft-offer")).toBeHidden();

  await page.reload();
  await expect(page.locator("#cq-title")).toHaveValue("");
  await expect(page.getByTestId("draft-offer"), "a discarded draft does not come back").toHaveCount(0);
});
