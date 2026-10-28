const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// Navigation and scroll behaviour of the Staff test workflow, in real Chromium against the real API. The policy under test (utils/scrollPolicy.js, components/ScrollManager.jsx):
// a link to another page opens at the top; Back and Forward return to where that entry was; the same page with another query keeps its place; saving a test returns to Manage Tests with the
// saved test shown; a form keeps everything the user entered when a save fails; modals and field changes never move the page.
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
const marker = (page) => page.evaluate(() => { window.__stayedOnThisPage = true; });
const stayed = (page) => page.evaluate(() => window.__stayedOnThisPage === true);
const inViewport = (page, selector) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= -2 && r.bottom <= window.innerHeight + 2 || (r.top < window.innerHeight && r.bottom > 0); }, selector);

test.describe("staff workflow", () => {
  test.beforeEach(async ({ page }) => { await login(page, users.staff); });

  test("changing a field in the middle of the long Create Test form does not move the page or submit it", async ({ page }) => {
    await page.goto("/staff/tests/new");
    await expect(page.locator("form")).toBeVisible();
    await marker(page);
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(() => scrollY(page)).toBeGreaterThan(400);
    const before = await scrollY(page);
    // a checkbox that is already on screen
    const box = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('form input[type="checkbox"]')];
      const i = boxes.findIndex((b) => { const r = b.getBoundingClientRect(); return r.top > 60 && r.bottom < window.innerHeight - 60 && r.width > 0; });
      return i;
    });
    test.skip(box < 0, "no checkbox is on screen at this scroll position");
    const target = page.locator('form input[type="checkbox"]').nth(box);
    const was = await target.isChecked();
    await target.setChecked(!was, { force: true });
    expect(await target.isChecked()).toBe(!was);
    expect(Math.abs((await scrollY(page)) - before), "the page did not move").toBeLessThanOrEqual(4);
    await expect(page).toHaveURL(/\/staff\/tests\/new$/);
    expect(await stayed(page), "no reload, no remount of the page").toBe(true);
  });

  test("submitting with required fields missing shows validation on the form and keeps what was typed", async ({ page }) => {
    await page.goto("/staff/tests/new");
    const title = page.locator("#test-title");
    await title.fill("Half filled test title");
    await marker(page);
    await page.getByRole("button", { name: /Create test/ }).click();
    await expect(page).toHaveURL(/\/staff\/tests\/new$/);
    expect(await page.locator("form :invalid").count(), "the browser marks the missing fields").toBeGreaterThan(0);
    await expect(title).toHaveValue("Half filled test title");
    expect(await stayed(page)).toBe(true);
  });

  test("saving a test returns to Manage Tests with the saved test shown, in place (no reload)", async ({ page }) => {
    await page.goto(`/staff/tests/${data.testId}/edit`);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible({ timeout: 15000 });
    await marker(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/staff\/tests$/, { timeout: 20000 });
    try {
      await expect(page.getByText(/saved\./).first()).toBeVisible({ timeout: 8000 });
    } catch (err) {
      const diag = await page.evaluate(() => JSON.stringify({ state: history.state && history.state.usr, toasts: document.querySelectorAll(".ca-toast").length, text: document.body.innerText.slice(0, 160), url: location.pathname }));
      throw new Error(`the saved notice was not shown | ${diag}`);
    }
    await expect(page.locator(`#test-row-${data.testId}`)).toBeVisible({ timeout: 15000 });
    await expect.poll(() => inViewport(page, `#test-row-${data.testId}`), { timeout: 10000 }).toBe(true);
    expect(await stayed(page), "no full page load").toBe(true);
  });

  test("a failed save keeps the user on the form with everything entered, and says what happened", async ({ page }) => {
    await page.goto(`/staff/tests/${data.testId}/edit`);
    const title = page.locator("#test-title");
    await expect(title).toBeVisible({ timeout: 15000 });
    const original = await title.inputValue();
    await title.fill(`${original} (edited)`);
    await page.route(/\/tests\/[^/?]+$/, (route) => (route.request().method() === "PATCH" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated failure" }) }) : route.continue()));
    await marker(page);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Simulated failure" })).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(title).toHaveValue(`${original} (edited)`);
    expect(await stayed(page)).toBe(true);
    await expect(page.getByRole("button", { name: "Save changes" }), "the form can be saved again").toBeEnabled();
  });

  test("two quick clicks on Save send one request", async ({ page }) => {
    await page.goto(`/staff/tests/${data.testId}/edit`);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible({ timeout: 15000 });
    let patches = 0;
    await page.route(/\/tests\/[^/?]+$/, async (route) => {
      if (route.request().method() === "PATCH") { patches += 1; await new Promise((r) => setTimeout(r, 1200)); }
      await route.continue();
    });
    await page.getByRole("button", { name: "Save changes" }).dblclick();
    await expect(page).toHaveURL(/\/staff\/tests$/, { timeout: 20000 });
    expect(patches, "one save, not two").toBe(1);
  });

  test("opening and closing a dialog on a scrolled dashboard does not move the page", async ({ page }) => {
    await page.goto("/staff/tests");
    await expect(page.getByRole("heading", { name: "Manage Tests" })).toBeVisible({ timeout: 15000 });
    const open = page.getByRole("button", { name: "Edit live duration" }).first();
    await open.scrollIntoViewIfNeeded();
    const before = await scrollY(page);
    expect(before).toBeGreaterThan(100);
    await open.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(Math.abs((await scrollY(page)) - before), "the page is where it was").toBeLessThanOrEqual(4);
  });

  test("Back returns to the scroll position the dashboard had, and a new page opens at the top", async ({ page }) => {
    await page.goto("/staff/tests");
    await expect(page.getByRole("heading", { name: "Manage Tests" })).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect.poll(() => scrollY(page)).toBeGreaterThan(500);
    await page.waitForTimeout(400); // the position is remembered shortly after scrolling stops
    const where = await scrollY(page);
    await marker(page);
    await page.locator('a[href="/staff/tests/new"]').first().click();
    await expect(page).toHaveURL(/\/staff\/tests\/new$/);
    await expect.poll(() => scrollY(page), { timeout: 5000 }).toBeLessThanOrEqual(4);
    await page.goBack();
    await expect(page).toHaveURL(/\/staff\/tests$/);
    await expect.poll(() => scrollY(page), { timeout: 8000 }).toBeGreaterThanOrEqual(where - 40);
    expect(await stayed(page), "Back was in-app navigation, not a reload").toBe(true);
  });
});

test("a student cannot open the staff dashboard (authorisation is still enforced)", async ({ page }) => {
  await login(page, users.student);
  await page.goto("/staff/tests");
  await expect(page.getByRole("heading", { name: "Manage Tests" })).toHaveCount(0);
});
