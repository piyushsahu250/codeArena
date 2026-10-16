const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// Copilot key / AI-assistant shortcut signals during a real timed test. The Windows Copilot key is Win+Shift+F23; a physical key cannot be pressed from the test, so a
// KeyboardEvent with that signature is dispatched in the page (SYNTHETIC: this proves the page and server handle the signal, NOT that a real keyboard exposes it).
async function startTest(page, testId) {
  await login(page, users.student);
  await page.goto(`/test/${testId}`);
  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.getByText(/E2E question [0-9]: pick option B/).first()).toBeVisible({ timeout: 20000 });
}
const copilotKey = (page, times = 1) => page.evaluate((n) => {
  const results = [];
  for (let i = 0; i < n; i++) {
    const ev = new KeyboardEvent("keydown", { key: "F23", code: "F23", metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    results.push(ev.defaultPrevented);
  }
  return results;
}, times);
const signalRequest = (page, timeout = 10000) => page.waitForRequest((r) => r.url().includes("/exam-security/test-events") && r.method() === "POST", { timeout });

test("policy on: the Copilot key signature is cancelled, reported once with a count, and never counted as a violation", async ({ page }) => {
  const violations = [];
  page.on("request", (r) => { if (/\/tests\/attempts\/[^/]+\/violation/.test(r.url()) && r.method() === "POST") violations.push(r.postData() || ""); });
  await startTest(page, data.aiShortcutTestId);
  const req = signalRequest(page);
  const prevented = await copilotKey(page, 4);
  expect(prevented, "a cancelable event is cancelled (best effort; the OS may still act)").toEqual([true, true, true, true]);
  const body = JSON.parse((await req).postData());
  expect(body.events).toHaveLength(1);
  expect(body.events[0].type).toBe("COPILOT_KEY_SIGNAL");
  expect(body.events[0].metadata).toMatchObject({ code: "F23", metaKey: true, shiftKey: true, cancelable: true, count: 4 });
  const res = await page.waitForResponse((r) => r.url().includes("/exam-security/test-events"), { timeout: 10000 });
  expect((await res.json()).accepted).toBe(1);
  expect(violations, "a keyboard signal is not a proctoring strike").toEqual([]);
  await expect(page.getByText(/E2E question [0-9]: pick option B/).first(), "the test keeps running").toBeVisible();
});

test("policy on: ordinary typing, shortcuts and a lone Windows key send nothing", async ({ page }) => {
  await startTest(page, data.aiShortcutTestId);
  let sent = 0;
  page.on("request", (r) => { if (r.url().includes("/exam-security/test-events")) sent++; });
  for (const k of ["a", "s", "d", "A", "S", "D", "Enter", "Tab", "Space"]) await page.keyboard.press(k);
  await page.keyboard.type("data structures and algorithms");
  for (const combo of ["Shift+A", "Control+a", "Control+z", "Alt+Tab"]) await page.keyboard.press(combo).catch(() => {});
  await page.evaluate(() => {
    for (const init of [{ key: "Meta", code: "MetaLeft", metaKey: true }, { key: "F23", code: "F23" }, { key: "F23", code: "F23", metaKey: true }, { key: "c", code: "KeyC", metaKey: true }]) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(5000);
  expect(sent, "no signal for ordinary input or partial combinations").toBe(0);
});

test("policy off: the same key press is left alone and nothing is sent", async ({ page }) => {
  await startTest(page, data.aiShortcutOffTestId);
  let sent = 0;
  page.on("request", (r) => { if (r.url().includes("/exam-security/test-events")) sent++; });
  const prevented = await copilotKey(page, 2);
  expect(prevented, "the page does not interfere when the test has not enabled the policy").toEqual([false, false]);
  await page.waitForTimeout(5000);
  expect(sent).toBe(0);
});
