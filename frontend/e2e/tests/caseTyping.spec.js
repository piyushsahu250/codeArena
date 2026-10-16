const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");
// Case-preservation regression suite: what the student intends to type (lower, UPPER, mixed) is exactly what the editor holds, what autosave sends,
// what a resumed attempt restores. Real Chromium, real Monaco, real timed test. Also checks that the editor input element carries the plain-text hints.



async function openTest(page, testId, firstQuestionPattern) {
  await login(page, users.student);
  await page.goto(`/test/${testId}`);
  // PROCTORED tests keep Begin disabled until the pre-flight security check has run
  await expect(page.getByRole("button", { name: /Begin Assessment/ })).toBeVisible({ timeout: 20000 });
  const check = page.getByRole("button", { name: "Run security check" });
  if (await check.isVisible()) {
    await check.click();
    await expect(page.getByText("Secure connection (HTTPS)")).toBeVisible();
    expect(await page.locator("li:has-text(\"✕\")").allTextContents(), "required security checks that failed on this browser").toEqual([]);
  }
  await page.getByLabel("I have read and understood the instructions.").check();
  const begin = page.getByRole("button", { name: /Begin Assessment/ });
  try {
    await expect(begin).toBeEnabled({ timeout: 8000 });
  } catch {
    const screen = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1500);
    throw new Error("Begin Assessment stayed disabled. Pre-start screen: " + screen);
  }
  await begin.click();
  try {
    // Question order is shuffled per attempt, so land on the wanted question whichever one is shown first.
    await expect(page.locator("h2", { hasText: /Code (Full|Function)/ }).first()).toBeVisible({ timeout: 20000 });
    const wanted = page.locator("h2", { hasText: firstQuestionPattern }).first();
    if (!(await wanted.isVisible())) await page.getByRole("button", { name: /Next/ }).first().click();
    await expect(wanted).toBeVisible({ timeout: 10000 });
  } catch {
    const screen = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1200);
    throw new Error("The question did not appear after Begin. Screen: " + screen);
  }
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
}

// The app bundles Monaco (no window.monaco global), so the text is read from the rendered lines, in visual order.
const readEditor = () => { const lines = [...document.querySelectorAll(".monaco-editor .view-lines .view-line")].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)); return lines.map((l) => l.textContent.replace(/ /g, " ")).join("\n"); };
const editorText = (page) => page.evaluate(readEditor);
// Monaco repaints lines a frame after the model changes; a read taken mid-repaint can miss characters. Return the text once three reads 100 ms apart agree.
async function stableText(page) {
  let prev = null; let same = 0;
  for (let i = 0; i < 40; i++) {
    const t = await editorText(page);
    if (t === prev) { if (++same >= 3) return t; } else { same = 0; prev = t; }
    await page.waitForTimeout(100);
  }
  return prev;
}
// Polls until the settled editor text equals `expected`; on failure the message carries both strings on ONE line (a multi-line diff does not survive CI annotations).
async function expectText(page, expected) {
  let last = null;
  try {
    await expect.poll(async () => (last = await stableText(page)), { timeout: 8000 }).toBe(expected);
  } catch {
    throw new Error(`editor text mismatch: expected ${JSON.stringify(expected)} but the editor holds ${JSON.stringify(last)}`);
  }
}
async function focusEditorAndClear(page) {
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expectText(page, "");
}
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MIXED = "aBcDeFgHiJkLmNoPqRsTuVwXyZ";

async function typeAndExpect(page, text, delay = 0) {
  await focusEditorAndClear(page);
  await page.keyboard.type(text, { delay });
  await expectText(page, text);
}

for (const [label, delay] of [["fast (no delay)", 0], ["steady (25 ms/key)", 25]]) {
  test(`case is preserved ${label}: lower, UPPER, mixed, transitions`, async ({ page }) => {
    await openTest(page, data.codingTestId, /Code Full/);
    await typeAndExpect(page, LOWER, delay);
    await typeAndExpect(page, UPPER, delay);
    await typeAndExpect(page, MIXED, delay);
    await typeAndExpect(page, "aAaAbBbBsSsSdDdD asdASDasdASD", delay);
    await typeAndExpect(page, "data structures and algorithms IS NOT Data Structures", delay);
  });
}

test("case-sensitive code is preserved exactly (Java and C, identifiers, strings, comments)", async ({ page }) => {
  await openTest(page, data.codingTestId, /Code Full/);
  const samples = {
    java: [
      "int studentAge = 20;",
      'String userName = "piyush";',
      "boolean isActive = true;",
      'if (score >= 50) { System.out.println("Passed"); }',
      "// Student NAME and studentName and STUDENTNAME differ",
    ],
    c: [
      "int studentAge = 20;",
      'char userName[] = "piyush";',
      'if (score >= 50) { printf("Passed"); }',
      "/* Score SCORE score */",
    ],
  };
  for (const [lang, lines] of Object.entries(samples)) {
    await page.locator("select.mono").first().selectOption(lang);
    for (const line of lines) await typeAndExpect(page, line);
  }
});

test("the editor's real input element asks the keyboard for plain, un-capitalised text", async ({ page }, testInfo) => {
  await openTest(page, data.codingTestId, /Code Full/);
  await page.locator(".monaco-editor .view-lines").first().click();
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    const attrs = {};
    for (const a of el.attributes) attrs[a.name] = a.value;
    return { tag: el.tagName, cls: String(el.className), attrs, hasTextarea: !!document.querySelector(".monaco-editor textarea") };
  });
  await testInfo.attach("editor-input-element", { body: JSON.stringify(info, null, 2), contentType: "application/json" });
  expect(info.attrs.autocapitalize, "autocapitalize on the focused editor input: " + JSON.stringify(info)).toBe("off");
  expect(info.attrs.autocorrect, "autocorrect on the focused editor input: " + JSON.stringify(info)).toBe("off");
  expect(info.attrs.spellcheck, "spellcheck on the focused editor input: " + JSON.stringify(info)).toBe("false");
});

test("autosave sends exactly what was typed, and a resumed attempt restores it unchanged", async ({ page }) => {
  await openTest(page, data.codingTestId, /Code Full/);
  await page.locator("select.mono").first().selectOption("java");
  await focusEditorAndClear(page);
  const code = 'String userName = "piyush"; int studentAge = 20; // Resume CASE check';
  const saved = page.waitForRequest((r) => /\/submissions\/autosave/.test(r.url()) && r.method() === "POST" && (r.postData() || "").includes("Resume"), { timeout: 20000 });
  await page.keyboard.type(code);
  await expectText(page, code);
  expect(JSON.parse((await saved).postData()).code, "the server receives exactly what was typed").toBe(code);
  await page.waitForTimeout(1500); // let the debounced save settle, then reload = resume
  await page.reload();
  await expect(page.getByRole("button", { name: /Begin Assessment/ })).toBeVisible({ timeout: 20000 });
  const check = page.getByRole("button", { name: "Run security check" });
  if (await check.isVisible()) await check.click();
  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.locator("h2", { hasText: /Code (Full|Function)/ }).first()).toBeVisible({ timeout: 20000 });
  // the shuffled order is fixed per attempt, so the same question is shown first again
  await expect.poll(async () => (await stableText(page)).includes("Resume CASE check"), { timeout: 15000 }).toBe(true);
  expect(await stableText(page)).toBe(code);
});
