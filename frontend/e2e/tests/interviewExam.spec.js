const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// A formal PROCTORED interview in progress (mock interviews, company rounds, talent-pool sessions): no Exit control, a header that cannot navigate away, the browser Back
// button absorbed, and the same server session after a refresh. Practice interviews keep their Exit button (fullscreen.spec.js). The camera and microphone are the browser's
// fake devices (playwright.config.js). The interview question bank must not be empty on this host; if it is, every test here is skipped, like the fullscreen tests.
test.describe.configure({ mode: "serial" });

const API = "http://localhost:4000/api";
const exitControl = (page) => page.locator('button:text-is("Exit"), a:text-is("Exit")');
const inFullscreen = (page) => page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement));
async function tokenOf(page) { return page.evaluate(() => localStorage.getItem("token")); }
async function spaNavigate(page, path) {
  await page.evaluate((p) => { history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
}

// The student's in-progress mock interview (PROCTORED), with one real answer so it opens on the Resume screen (which skips the camera/face readiness gate).
async function proctoredInterviewWithProgress(page) {
  const H = { Authorization: `Bearer ${await tokenOf(page)}` };
  const created = await page.request.post(`${API}/interview/sessions`, { headers: H, data: { isMock: true, config: {} } });
  test.skip(created.status() === 400, "the interview question bank is empty on this host");
  expect(created.ok(), `create mock interview: ${created.status()}`).toBeTruthy();
  const body = await created.json();
  const id = body.id || body.session?.id;
  const detail = await (await page.request.get(`${API}/interview/sessions/${id}`, { headers: H })).json();
  expect(detail.security?.level, "a mock interview is a PROCTORED session").toBe("PROCTORED");
  const open = detail.questions.find((q) => ["HR", "TECHNICAL"].includes(q.category) && (!q.answer || q.answer.skipped !== false));
  if (open) {
    const ans = await page.request.post(`${API}/interview/sessions/${id}/answer`, { headers: H, data: { questionId: open.id, answerText: "I would explain the concept with an example and the trade-offs involved.", timeTakenSec: 5 } });
    expect(ans.ok(), `answer: ${ans.status()}`).toBeTruthy();
  }
  return { id, H };
}

async function resumeInterview(page, id) {
  await spaNavigate(page, `/interview/session/${id}`); // in-app navigation, so Back is a client-side route change
  await page.getByRole("button", { name: /Resume Interview/ }).click();
  await expect(page.getByRole("button", { name: /Next →|Submit Interview|Next round|Previous/ }).first()).toBeVisible({ timeout: 20000 });
}

test.describe("proctored interview in progress", () => {
  test.beforeEach(async ({ page }) => { await login(page, users.student3); });

  test("there is no Exit control and the page header cannot take the student away", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const { id } = await proctoredInterviewWithProgress(page);
    await resumeInterview(page, id);
    await expect(exitControl(page)).toHaveCount(0);
    // the header shows the logo only: no link home, no search, no menus, no Back, no breadcrumb trail
    const header = page.locator("nav.ca-topbar");
    await expect(header).toHaveCount(1);
    await expect(header.locator("a, button, input")).toHaveCount(0);
    await expect(page.getByPlaceholder(/Search students/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the browser Back button is absorbed: the interview stays open and the student is told", async ({ page }) => {
    const { id } = await proctoredInterviewWithProgress(page);
    await resumeInterview(page, id);
    await expect.poll(() => inFullscreen(page), { timeout: 10000 }).toBe(true);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/interview/session/${id}`));
    await expect(page.getByText(/still in progress/i)).toBeVisible();
    await expect(exitControl(page)).toHaveCount(0);
    expect(await inFullscreen(page)).toBe(true);
    // and pressing it again does not get through either
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/interview/session/${id}`));
  });

  test("a refresh brings back the same session, and a second start does not create another attempt", async ({ page }) => {
    const { id, H } = await proctoredInterviewWithProgress(page);
    await resumeInterview(page, id);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/interview/session/${id}`));
    await expect(page.getByRole("button", { name: /Resume Interview/ })).toBeVisible({ timeout: 20000 });
    const again = await page.request.post(`${API}/interview/sessions`, { headers: H, data: { isMock: true, config: {} } });
    expect(again.ok()).toBeTruthy();
    const body = await again.json();
    expect(body.session?.id || body.id, "the same in-progress session is returned, not a new attempt").toBe(id);
    expect(body.resumed).toBe(true);
  });

  test("another student cannot read, answer, report on or finish this session, and nobody can terminate it from the browser", async ({ page, browser }) => {
    const { id, H } = await proctoredInterviewWithProgress(page);
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await login(other, users.student2);
    const O = { Authorization: `Bearer ${await tokenOf(other)}` };
    expect((await other.request.get(`${API}/interview/sessions/${id}`, { headers: O })).status()).toBe(404);
    expect((await other.request.post(`${API}/interview/sessions/${id}/finalize`, { headers: O, data: {} })).status()).toBe(403);
    expect((await other.request.post(`${API}/interview/sessions/${id}/violation`, { headers: O, data: { type: "TAB_SWITCH" } })).status()).toBe(403);
    expect((await other.request.post(`${API}/interview/sessions/${id}/answer`, { headers: O, data: { questionId: "x", answerText: "x" } })).status()).toBe(403);
    await ctx.close();
    // there is no route a student could use to terminate or reset a formal attempt
    expect((await page.request.delete(`${API}/interview/sessions/${id}`, { headers: H })).status()).toBe(404);
    expect((await page.request.post(`${API}/interview/sessions/${id}/terminate`, { headers: H, data: {} })).status()).toBe(404);
    expect((await page.request.post(`${API}/interview/sessions/${id}/reset`, { headers: H, data: {} })).status()).toBe(404);
    const still = await (await page.request.get(`${API}/interview/sessions/${id}`, { headers: H })).json();
    expect(still.session.status).toBe("IN_PROGRESS");
  });

  test("a submitted interview cannot be changed, and submitting twice is harmless", async ({ page }) => {
    const { id, H } = await proctoredInterviewWithProgress(page);
    const detail = await (await page.request.get(`${API}/interview/sessions/${id}`, { headers: H })).json();
    const qid = detail.questions[0].id;
    const first = await page.request.post(`${API}/interview/sessions/${id}/finalize`, { headers: H, data: {} });
    expect(first.ok()).toBeTruthy();
    const second = await page.request.post(`${API}/interview/sessions/${id}/finalize`, { headers: H, data: {} });
    expect(second.ok()).toBeTruthy();
    const late = await page.request.post(`${API}/interview/sessions/${id}/answer`, { headers: H, data: { questionId: qid, answerText: "changed after submitting" } });
    expect(late.status(), "answers of a finished interview are refused").toBe(400);
    const draft = await page.request.post(`${API}/interview/sessions/${id}/questions/${qid}/text-draft`, { headers: H, data: { answerText: "late draft" } });
    expect(draft.status(), "drafts of a finished interview are refused").toBe(409);
    const after = await (await page.request.get(`${API}/interview/sessions/${id}`, { headers: H })).json();
    expect(["COMPLETED", "TERMINATED"]).toContain(after.session.status);
  });
});
