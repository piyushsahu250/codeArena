const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// REGRESSION (UI/UX audit batch 7): opening a record that does not exist (a deleted test, a stale bookmark, a mistyped link) left these pages on "Loading..." forever, or threw an
// uncaught "Request failed with status code 404" into the console. Each now shows a clear message and stays usable. Found by the detail-route probe, which opens every route
// that takes an ID with an ID that does not exist.
const MISSING = "00000000-0000-0000-0000-000000000000";
const ROUTES = [
  ["/staff/tests/:ID/preview", /no longer exists/i],
  ["/staff/tests/:ID/edit", /no longer exists/i],
  ["/staff/tests/:ID/results", /no longer exists/i],
  ["/staff/questions/:ID/edit", /no longer exists/i],
];

test("pages opened with a missing record explain it and raise no uncaught error", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await login(page, users.staff);
  for (const [template, message] of ROUTES) {
    errors.length = 0;
    await page.goto(template.replace(/:ID/g, MISSING));
    await expect(page.getByRole("alert").filter({ hasText: message }).first(), `${template} explains the problem`).toBeVisible({ timeout: 15000 });
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
    expect(text, `${template} is not stuck on Loading`).not.toMatch(/^loading(\.\.\.|…)?$/i);
    expect(errors, `${template} raised no uncaught error`).toEqual([]);
  }
});
