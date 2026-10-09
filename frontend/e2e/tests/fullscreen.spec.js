const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// Fullscreen lifecycle of the proctored screens: whatever way a session is left (Exit button, browser Back, rapid clicks, a refusing browser) the page must
// return to normal browsing, a failed exit must be reported with a Retry, and a fullscreen session that belongs to someone else must be left alone.
// The mock interview is driven through its "Resume" screen (a session that already has an answer skips the camera/face readiness gate), with fake
// camera/microphone devices supplied by the browser launch flags in playwright.config.js.
const API = "http://localhost:4000/api";
// the Exit control (a button now; it used to be a router link, which is the bug) -- matched either way so the same test can prove the old behaviour fails
const exitControl = (page) => page.locator('button:text-is("Exit"), a:text-is("Exit")');
const inFullscreen = (page) => page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement));

// Client-side navigation through the router (history entry + popstate), as a link click would do.
async function spaNavigate(page, path) {
  await page.evaluate((p) => { history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
}

async function tokenOf(page) { return page.evaluate(() => localStorage.getItem("token")); }

// Creates (or re-uses) the student's in-progress mock interview and makes sure it has one real answer, so it opens on the Resume screen.
async function mockInterviewWithProgress(page) {
  const H = { Authorization: `Bearer ${await tokenOf(page)}` };
  const created = await page.request.post(`${API}/interview/sessions`, { headers: H, data: { isMock: true, config: {} } });
  test.skip(created.status() === 400, "the interview question bank is empty on this host");
  expect(created.ok(), `create mock interview: ${created.status()}`).toBeTruthy();
  const body = await created.json();
  const id = body.id || body.session?.id;
  const detail = await (await page.request.get(`${API}/interview/sessions/${id}`, { headers: H })).json();
  const open = detail.questions.find((q) => ["HR", "TECHNICAL"].includes(q.category) && (!q.answer || q.answer.skipped !== false));
  if (open) {
    const ans = await page.request.post(`${API}/interview/sessions/${id}/answer`, { headers: H, data: { questionId: open.id, answerText: "I would explain the concept with an example and the trade-offs involved.", timeTakenSec: 5 } });
    expect(ans.ok(), `answer: ${ans.status()}`).toBeTruthy();
  }
  return id;
}

async function openAndResume(page, id) {
  await page.goto(`/interview/session/${id}`);
  await page.getByRole("button", { name: /Resume Interview/ }).click();
  await expect(exitControl(page)).toBeVisible({ timeout: 20000 });
}

test.describe("mock interview", () => {
  test.beforeEach(async ({ page }) => { await login(page, users.student3); });

  test("Exit releases fullscreen and returns to the interview hub", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const id = await mockInterviewWithProgress(page);
    await openAndResume(page, id);
    await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(true);
    await exitControl(page).click();
    await expect(page).toHaveURL(/\/interview$/);
    await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(false);
    await expect(page.getByText(/still in fullscreen/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the browser Back button releases fullscreen too", async ({ page }) => {
    const id = await mockInterviewWithProgress(page);
    // entered by in-app navigation, so Back is a client-side route change (a full page load would end fullscreen by itself and prove nothing)
    await spaNavigate(page, `/interview/session/${id}`);
    await page.getByRole("button", { name: /Resume Interview/ }).click();
    await expect(exitControl(page)).toBeVisible({ timeout: 20000 });
    await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(true);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/interview\/session\//);
    await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(false);
  });

  test("rapid repeated Exit clicks end cleanly", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const id = await mockInterviewWithProgress(page);
    await openAndResume(page, id);
    const exit = exitControl(page);
    await exit.click();
    await exit.click({ timeout: 500 }).catch(() => {}); // the button is already gone: that is the expected outcome
    await expect(page).toHaveURL(/\/interview$/);
    await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(false);
    expect(errors).toEqual([]);
  });

  test("a refused fullscreen request does not trap the student", async ({ page }) => {
    await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error("fullscreen denied by the browser")); });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const id = await mockInterviewWithProgress(page);
    await openAndResume(page, id);
    expect(await inFullscreen(page)).toBe(false);
    await exitControl(page).click();
    await expect(page).toHaveURL(/\/interview$/);
    expect(errors).toEqual([]);
  });

  test("a browser without any fullscreen API still opens and exits the interview", async ({ page }) => {
    await page.addInitScript(() => {
      for (const k of ["requestFullscreen", "webkitRequestFullscreen", "mozRequestFullScreen", "msRequestFullscreen"]) { try { Element.prototype[k] = undefined; } catch { /* ignore */ } }
    });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const id = await mockInterviewWithProgress(page);
    await openAndResume(page, id);
    await exitControl(page).click();
    await expect(page).toHaveURL(/\/interview$/);
    expect(errors).toEqual([]);
  });

  test("if the browser refuses to leave fullscreen the student is told and can retry", async ({ page }) => {
    const id = await mockInterviewWithProgress(page);
    await openAndResume(page, id);
    await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(true);
    await page.evaluate(() => { document.exitFullscreen = () => Promise.reject(new Error("exit blocked by the browser")); });
    await exitControl(page).click();
    await expect(page).toHaveURL(/\/interview$/);
    const notice = page.getByRole("alert").filter({ hasText: /still in fullscreen/i });
    await expect(notice).toBeVisible();
    // the page's own cleanup also tries to leave fullscreen shortly after navigation; let every pending attempt fail before the browser "relents",
    // otherwise a late attempt would legitimately succeed and remove the notice
    await page.waitForTimeout(1500);
    expect(await inFullscreen(page)).toBe(true); // never claims success while the browser is still fullscreen
    await page.evaluate(() => { delete document.exitFullscreen; }); // the browser relents
    await notice.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(false);
    await expect(notice).toHaveCount(0);
  });

  test("leaving the interview does not end a fullscreen session that belongs to something else", async ({ page }) => {
    const id = await mockInterviewWithProgress(page);
    // another feature puts the page in fullscreen first (a real click, so the browser allows it)
    await page.evaluate(() => {
      const b = document.createElement("button"); b.id = "foreign-fullscreen"; b.textContent = "fs";
      b.style.cssText = "position:fixed;top:0;left:0;z-index:99999";
      b.onclick = () => document.documentElement.requestFullscreen();
      document.body.appendChild(b);
    });
    await page.locator("#foreign-fullscreen").click();
    await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(true);
    // client-side navigation (a full page load would end fullscreen by itself)
    await page.evaluate((sid) => { history.pushState({}, "", `/interview/session/${sid}`); window.dispatchEvent(new PopStateEvent("popstate")); }, id);
    await page.getByRole("button", { name: /Resume Interview/ }).click();
    await expect(exitControl(page)).toBeVisible({ timeout: 20000 });
    await exitControl(page).click();
    await expect(page).toHaveURL(/\/interview$/);
    expect(await inFullscreen(page)).toBe(true); // not ours to end
    await page.evaluate(() => document.exitFullscreen());
  });
});

test("formal test: leaving the page by Back releases the fullscreen the test entered", async ({ page }) => {
  await login(page, users.student3);
  await spaNavigate(page, `/test/${data.fullscreenTestId}`); // in-app navigation: Back is then a client-side route change
  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.getByText(/E2E question [0-9]: pick option B/)).toBeVisible();
  await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(true);
  await page.goBack();
  await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(false);
});
