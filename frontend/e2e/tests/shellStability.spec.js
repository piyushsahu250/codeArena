const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// REGRESSION (UI/UX audit batch 15): routes without their own loading boundary suspended all the way up to the one around <Routes>, so while a page's code downloaded the whole shell (sidebar and
// top bar) was swapped for a full-screen "Loading" and then put back: the sidebar vanished and returned and the content jumped by its width (layout shift 0.375 on the student /learning and
// /interview pages). The shell now stays mounted; only the page area shows the placeholder.
//
// What is checked: from the moment the sidebar first appears, it never disappears again (watched on every animation frame), on a cold load of the two routes that showed it and on a client-side
// navigation to them.
async function watchSidebar(page) {
  await page.addInitScript(() => {
    window.__sidebar = { seen: false, lostAfterSeen: 0 };
    const tick = () => {
      const has = !!document.querySelector("aside.ca-sidebar");
      if (has) window.__sidebar.seen = true;
      else if (window.__sidebar.seen) window.__sidebar.lostAfterSeen++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const state = (page) => page.evaluate(() => window.__sidebar);

test("the sidebar stays on screen while a lazy page loads (cold load and in-app navigation)", async ({ page }) => {
  await watchSidebar(page);
  await login(page, users.student);
  await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});

  for (const path of ["/learning", "/interview"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("aside.ca-sidebar")).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
    await page.waitForTimeout(600);
    const s = await state(page);
    expect(s.seen, `${path}: the sidebar appeared`).toBe(true);
    expect(s.lostAfterSeen, `${path}: frames in which the sidebar was missing after it had appeared (cold load)`).toBe(0);
  }

  // in-app navigation: a fresh watch from this page onwards
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator("aside.ca-sidebar")).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => { window.__sidebar = { seen: true, lostAfterSeen: 0 }; });
  await page.locator("aside.ca-sidebar").getByRole("link", { name: /Learning/i }).first().click();
  await expect(page).toHaveURL(/\/learning/);
  await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(600);
  expect((await state(page)).lostAfterSeen, "navigating to /learning from the dashboard: frames without the sidebar").toBe(0);
});
