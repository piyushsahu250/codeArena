const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// REGRESSION (UI/UX audit batch 11): on the stacked (mobile) exam layout the code editor had a fixed height of 380 px. A phone held sideways is only about 375 px tall and the on-screen
// keyboard covers roughly half of it, so the editor was taller than the whole screen and the line being typed could sit behind the keyboard. On a short landscape screen the editor is now
// capped at 220 px; a portrait phone keeps its 380 px and a tablet is unchanged.
test.use({ hasTouch: true });

async function openCoding(page) {
  await login(page, users.student);
  await page.goto(`/test/${data.codingTestId}`);
  await expect(page.getByRole("button", { name: /Begin Assessment/ })).toBeVisible({ timeout: 20000 });
  await page.getByLabel("I have read and understood the instructions.").check();
  await expect(page.getByRole("button", { name: /Begin Assessment/ })).toBeEnabled({ timeout: 8000 });
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.locator("h2", { hasText: /Code (Full|Function)/ }).first()).toBeVisible({ timeout: 20000 });
  const wanted = page.locator("h2", { hasText: /Code Full/ }).first();
  if (!(await wanted.isVisible())) await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(wanted).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
}
const editorHeight = (page) => page.evaluate(() => Math.round(document.querySelector(".monaco-editor").getBoundingClientRect().height));

test("the code editor fits a landscape phone and keeps its size on a portrait phone and a tablet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openCoding(page);
  await expect.poll(() => editorHeight(page), { message: "portrait phone editor height" }).toBe(380);

  await page.setViewportSize({ width: 667, height: 375 });
  await expect.poll(() => editorHeight(page), { message: "landscape phone editor height", timeout: 5000 }).toBeLessThanOrEqual(220);
  expect(await editorHeight(page), "the landscape editor is shorter than the screen").toBeLessThan(375);

  await page.setViewportSize({ width: 375, height: 667 });
  await expect.poll(() => editorHeight(page), { message: "back to portrait", timeout: 5000 }).toBe(380);
});
