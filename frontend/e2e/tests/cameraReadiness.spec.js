const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// The pre-exam camera check must not say "ready" over an empty preview. The browser camera is replaced by a scripted one (SIMULATED: this proves the page's behaviour for each camera outcome in a
// real Chromium video element, NOT that any physical camera or other browser works). "lit" is a canvas stream with moving colour, "black" a canvas stream of pure black (a granted camera that
// delivers nothing visible, the reported failure), and the others reject getUserMedia the way a browser does.
const stubCamera = (page, plan) => page.addInitScript((plan) => {
  window.__streams = [];
  let call = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    const mode = plan[Math.min(call++, plan.length - 1)];
    if (["NotAllowedError", "NotFoundError", "NotReadableError"].includes(mode)) throw Object.assign(new Error(mode), { name: mode });
    const c = document.createElement("canvas"); c.width = 320; c.height = 240;
    const ctx = c.getContext("2d");
    const paint = () => { ctx.fillStyle = mode === "lit" ? `rgb(${40 + (Date.now() % 90)},120,200)` : "#000"; ctx.fillRect(0, 0, 320, 240); };
    paint(); setInterval(paint, 50);
    const stream = c.captureStream(15);
    window.__streams.push(stream);
    return stream;
  };
}, plan);
async function open(page, plan) {
  await stubCamera(page, plan);
  await login(page, users.student);
  await page.goto(`/test/${data.cameraTestId}`);
  await page.getByLabel("I have read and understood the instructions.").check();
}
const grant = (page) => page.getByRole("button", { name: /Grant camera access|Retry camera/ }).click();
const begin = (page) => page.getByRole("button", { name: /Begin Assessment/ });

test("a camera that shows a picture becomes ready, and only then can the test begin", async ({ page }) => {
  await open(page, ["lit"]);
  await expect(begin(page)).toBeDisabled();
  await grant(page);
  await expect(page.getByText("✓ Camera is ready")).toBeVisible({ timeout: 15000 });
  await expect(begin(page)).toBeEnabled();
});

test("a granted camera that delivers only black is NOT ready: the student is told why and cannot begin", async ({ page }) => {
  await open(page, ["black"]);
  await grant(page);
  await expect(page.locator('p[role="alert"]')).toContainText("completely black", { timeout: 15000 });
  await expect(page.getByText(/✓ .*ready/)).toHaveCount(0);
  await expect(begin(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry camera" })).toBeVisible();
});

test("retry after a black feed releases the first stream and then succeeds, with no stream left running", async ({ page }) => {
  await open(page, ["black", "lit"]);
  await grant(page);
  await expect(page.locator('p[role="alert"]')).toContainText("completely black", { timeout: 15000 });
  await grant(page);
  await expect(page.getByText("✓ Camera is ready")).toBeVisible({ timeout: 15000 });
  const states = await page.evaluate(() => window.__streams.map((s) => s.getTracks().map((t) => t.readyState)));
  expect(states.length).toBe(2);
  expect(states[0], "the failed attempt's stream was stopped").toEqual(["ended"]);
  expect(states[1], "only the working stream is live").toEqual(["live"]);
  await expect(begin(page)).toBeEnabled();
});

test("the cause decides the message: denied, no camera, busy", async ({ page }) => {
  await open(page, ["NotAllowedError", "NotFoundError", "NotReadableError"]);
  await grant(page);
  await expect(page.locator('p[role="alert"]')).toContainText("blocked for this site");
  await grant(page);
  await expect(page.locator('p[role="alert"]')).toContainText("No camera was found");
  await grant(page);
  const busy = page.locator('p[role="alert"]');
  await expect(busy).toContainText("Another app or browser tab may be using it");
  await expect(busy, "a busy camera is not a permission problem").not.toContainText("blocked");
  await expect(begin(page)).toBeDisabled();
});
