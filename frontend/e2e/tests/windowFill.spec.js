const { test, expect, devices } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// The exam window must fill the screen. An emulated Android phone starts a real timed test, then its window is shrunk the way a floating or split-screen window would be (SIMULATED: the browser
// is Chromium with a phone profile; this proves the page and server behaviour, NOT that a real phone's floating window reports these exact measurements). The screen size is pinned so that
// only the window changes.
const PHONE = { ...devices["Pixel 7"] };
const pinScreen = (page) => page.addInitScript(() => {
  for (const [k, v] of Object.entries({ width: 412, height: 915, availWidth: 412, availHeight: 915 })) Object.defineProperty(window.screen, k, { get: () => v });
});
async function startTest(page, user) {
  await login(page, user);
  await page.goto(`/test/${data.windowTestId}`);
  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.getByText(/E2E question [0-9]: pick option B/).first()).toBeVisible({ timeout: 20000 });
}
const windowViolations = (page) => {
  const seen = [];
  page.on("request", (r) => { if (/\/tests\/attempts\/[^/]+\/violation/.test(r.url()) && r.method() === "POST" && /WINDOW_NOT_FILLING_SCREEN/.test(r.postData() || "")) seen.push(r.postData()); });
  return seen;
};

test.describe("phone", () => {
  test.use({ ...PHONE });

  test("a window that stops filling the screen is reported once, counted from the first time, and the student is told", async ({ page }) => {
    await pinScreen(page);
    const seen = windowViolations(page);
    await startTest(page, users.student);
    const responded = page.waitForResponse((r) => /\/tests\/attempts\/[^/]+\/violation/.test(r.url()) && /WINDOW_NOT_FILLING_SCREEN/.test(r.request().postData() || ""), { timeout: 30000 });
    await page.setViewportSize({ width: 300, height: 520 });
    const res = await responded;
    const body = await res.json();
    expect(body.severity, "decided by the server").toBe("CONFIRMED_VIOLATION");
    expect(body.penalized, "counted from the first occurrence").toBe(true);
    expect(body.tabSwitchCount).toBe(1);
    await expect(page.getByText(/Warning 1\/3: the assessment window is not filling the screen/)).toBeVisible();
    // the window stays small for a while longer: still the same episode, no second report
    await page.waitForTimeout(9000);
    expect(seen.length, "one report for one episode").toBe(1);
    await expect(page.getByText(/E2E question [0-9]: pick option B/).first(), "the test keeps running").toBeVisible();
  });

  test("a brief change of the window that goes back to full size is not reported", async ({ page }) => {
    await pinScreen(page);
    const seen = windowViolations(page);
    await startTest(page, users.student2);
    await page.setViewportSize({ width: 300, height: 520 });
    await page.waitForTimeout(2500);
    await page.setViewportSize({ width: 412, height: 839 });
    await page.waitForTimeout(8000);
    expect(seen.length).toBe(0);
  });
});

test("a desktop browser is not judged by this rule: shrinking its window reports nothing from it", async ({ page }) => {
  const seen = windowViolations(page);
  await startTest(page, users.student3);
  await page.setViewportSize({ width: 600, height: 500 });
  await page.waitForTimeout(9000);
  expect(seen.length).toBe(0);
});
