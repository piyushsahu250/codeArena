const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// Strict exam security on a fullscreen-required test, in real Chromium against the real API:
//   1. leaving fullscreen blocks the exam behind a recovery overlay until the student presses the button (a user gesture), the exit is recorded with an event id, and the browser REALLY is in
//      fullscreen again afterwards;
//   2. a violation report that cannot be delivered (the network fails) is kept, shown to the student as "waiting to be sent", retried with the SAME event id, and counted exactly once.
// (SIMULATED where stated: a failing network is made with request interception; real tab switching and a real operating-system Escape are not driven from here.)
const API = "http://localhost:4000/api";
const QUESTION = /E2E question [0-9]: pick option B/;
const inFullscreen = (page) => page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement));
const isViolation = (url) => /\/tests\/attempts\/[^/]+\/violation/.test(url);

// A real browser only lets a page enter fullscreen right after a user gesture. Playwright's own page.evaluate counts as a gesture, which would let the page's automatic re-entry succeed and
// remove the overlay by itself, so the rule is enforced here the way a browser does: requestFullscreen rejects unless a real click happened within the last second.
const requireGestureForFullscreen = (page) => page.addInitScript(() => {
  const real = Element.prototype.requestFullscreen;
  let gestureUntil = 0;
  document.addEventListener("click", () => { gestureUntil = Date.now() + 1000; }, true);
  Element.prototype.requestFullscreen = function (...args) {
    if (Date.now() > gestureUntil) return Promise.reject(new TypeError("requestFullscreen requires a user gesture"));
    return real.apply(this, args);
  };
});

async function beginStrictTest(page, user) {
  await login(page, user);
  await page.goto(`/test/${data.strictTestId}`);
  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.getByText(QUESTION).first()).toBeVisible({ timeout: 20000 });
  await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(true);
  // a browser lets a page re-enter fullscreen on its own for a few seconds after a click; wait that out so recovery really needs the button
  await page.waitForTimeout(6000);
}

test("leaving fullscreen blocks the exam until the student re-enters it from the button, and the exit is recorded", async ({ page }) => {
  await requireGestureForFullscreen(page);
  await beginStrictTest(page, users.student);
  const answered = page.waitForResponse((r) => isViolation(r.url()) && r.request().method() === "POST", { timeout: 20000 });
  await page.evaluate(() => document.exitFullscreen());

  const overlay = page.getByRole("alertdialog");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Fullscreen mode is required for this assessment. Your exit from fullscreen has been recorded.");
  expect(await inFullscreen(page), "the page does not force fullscreen back by itself").toBe(false);
  expect(await page.evaluate(() => document.getElementById("root").hasAttribute("inert")), "the exam behind the overlay is inert").toBe(true);

  const res = await answered;
  const sent = res.request().postDataJSON();
  expect(sent.type).toBe("FULLSCREEN_EXIT");
  expect(sent.eventId, "every report carries its own event id").toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  const body = await res.json();
  expect(body.acknowledged, "the server acknowledged it").toBe(true);
  expect(body.eventId).toBe(sent.eventId);
  expect(body.penalized).toBe(true);

  try {
    await page.getByRole("button", { name: "Re-enter Fullscreen" }).click({ timeout: 15000 });
  } catch (err) {
    // say what is under the button's centre, so a blocked click explains itself in the CI annotation
    const diag = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Re-enter Fullscreen/.test(x.textContent));
      if (!b) return "button not found";
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return JSON.stringify({ disabled: b.disabled, rect: [r.x, r.y, r.width, r.height].map(Math.round), top: top ? `${top.tagName}.${String(top.className).slice(0, 40)}|${(top.textContent || "").slice(0, 50)}` : null, fullscreen: !!document.fullscreenElement, visibility: document.visibilityState, size: [innerWidth, innerHeight] });
    });
    throw new Error(`the Re-enter Fullscreen click failed: ${String(err.message).split("\n")[0]} | ${diag}`);
  }
  await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(true);
  await expect(overlay).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById("root").hasAttribute("inert"))).toBe(false);
  await expect(page.getByText(QUESTION).first(), "the exam continues where it was").toBeVisible();
});

test("a violation report that cannot be delivered is kept, retried with the same event id, and counted once", async ({ page, request }) => {
  await beginStrictTest(page, users.student2);
  const bodies = [];
  let calls = 0;
  await page.route("**/tests/attempts/*/violation", (route) => {
    bodies.push(route.request().postDataJSON());
    calls += 1;
    if (calls <= 2) return route.abort("connectionrefused"); // the first two attempts never reach the server
    return route.continue();
  });
  const delivered = page.waitForResponse((r) => isViolation(r.url()) && r.status() === 200, { timeout: 40000 });
  await page.evaluate(() => document.exitFullscreen());

  await expect(page.getByText(/1 security event is waiting to be sent/)).toBeVisible({ timeout: 10000 });
  const res = await delivered;
  const sentBody = res.request().postDataJSON();
  await expect(page.getByText(/security events? (is|are) waiting to be sent/)).toHaveCount(0, { timeout: 10000 });
  expect(bodies.length, "two failures and one success").toBe(3);
  expect(new Set(bodies.map((b) => b.eventId)).size, "every retry carries the SAME event id").toBe(1);
  expect((await res.json()).tabSwitchCount, "counted once").toBe(1);

  // the staff log has exactly one FULLSCREEN_EXIT for this attempt
  const attemptId = res.url().match(/attempts\/([^/]+)\/violation/)[1];
  const staffToken = (await (await request.post(`${API}/auth/login`, { data: { email: users.staff.email, password: users.staff.password } })).json()).token;
  const log = await (await request.get(`${API}/tests/admin/attempts/${attemptId}/violations`, { headers: { Authorization: `Bearer ${staffToken}` } })).json();
  expect(log.events.filter((e) => e.type === "FULLSCREEN_EXIT")).toHaveLength(1);
  expect(sentBody.eventId).toBeTruthy();
});
