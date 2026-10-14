const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// "A, S and D do not type in the code editor during a test" regression suite. Real Chromium, the real Monaco editor, a real timed test (standard and
// PROCTORED, so every proctoring listener is installed). What is asserted is the text Monaco actually holds, not just that keys were pressed.

async function openTest(page, testId, firstQuestionPattern) {
  await login(page, users.student);
  await page.goto(`/test/${testId}`);
  // PROCTORED tests keep Begin disabled until the pre-flight security check has run
  const check = page.getByRole("button", { name: "Run security check" });
  if (await check.isVisible({ timeout: 5000 }).catch(() => false)) {
    await check.click();
    await expect(page.getByText("Secure connection (HTTPS)")).toBeVisible();
    expect(await page.locator("li:has-text(\"✕\")").allTextContents(), "required security checks that failed on this browser").toEqual([]);
  }
  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.getByText(firstQuestionPattern).first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
}

// The app bundles Monaco (no window.monaco global), so the text is read from the rendered lines, in visual order.
const readEditor = () => { const lines = [...document.querySelectorAll(".monaco-editor .view-lines .view-line")].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)); return lines.map((l) => l.textContent.replace(/ /g, " ")).join("\n"); };
const editorText = (page) => page.evaluate(readEditor);
async function focusEditorAndClear(page) {
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect.poll(() => editorText(page)).toBe("");
}
// Records every keydown/keyup as the WINDOW sees it in the bubbling phase, i.e. after every document-level handler ran, with whether it was cancelled.
async function recordKeys(page) {
  await page.evaluate(() => {
    window.__keys = [];
    for (const type of ["keydown", "keyup"]) window.addEventListener(type, (e) => window.__keys.push({ type, key: e.key, prevented: e.defaultPrevented, ctrl: e.ctrlKey, alt: e.altKey }), false);
  });
}
const keysOf = (page) => page.evaluate(() => window.__keys);
const watchViolations = (page) => { const sent = []; page.on("request", (r) => { if (/\/tests\/attempts\/[^/]+\/violation/.test(r.url()) && r.method() === "POST") sent.push(r.postData() || ""); }); return sent; };

for (const [label, idKey, pattern] of [
  ["standard timed test", "codingTestId", /E2E coding \(full program\)/],
  ["PROCTORED timed test (all proctoring listeners active)", "codingProctoredTestId", /E2E coding \(full program\)/],
]) {
  test(`${label}: a, s, d (lower and upper case) type normally in full-program mode`, async ({ page }) => {
    const violations = watchViolations(page);
    await openTest(page, data[idKey], pattern);
    await focusEditorAndClear(page);
    await recordKeys(page);

    await page.keyboard.type("asd");
    await expect.poll(() => editorText(page)).toBe("asd");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Shift+a"); await page.keyboard.press("Shift+s"); await page.keyboard.press("Shift+d");
    await expect.poll(() => editorText(page)).toBe("asd\nASD");

    await page.keyboard.press("Enter");
    const sentence = "data structures and algorithms";
    await page.keyboard.type(sentence, { delay: 15 });
    await expect.poll(() => editorText(page)).toBe(`asd\nASD\n${sentence}`);

    const keys = await keysOf(page);
    for (const k of ["a", "s", "d", "A", "S", "D"]) {
      expect(keys.some((e) => e.type === "keydown" && e.key === k), `a keydown for ${k} reached the window`).toBe(true);
      expect(keys.some((e) => e.type === "keyup" && e.key === k), `a keyup for ${k} reached the window`).toBe(true);
    }
    const cancelled = keys.filter((e) => e.type === "keydown" && "asdASD".includes(e.key) && e.key.length === 1 && e.prevented);
    expect(cancelled, "no plain or shifted a/s/d keydown was cancelled by any handler").toEqual([]);
    expect(violations, "typing code is never reported as a proctoring violation").toEqual([]);
  });
}

test("a, s, d work at the start, middle and end of a line, and after editing", async ({ page }) => {
  await openTest(page, data.codingTestId, /E2E coding \(full program\)/);
  await focusEditorAndClear(page);
  await page.keyboard.type("xyz");
  await page.keyboard.press("Home"); await page.keyboard.press("a");
  await page.keyboard.press("End"); await page.keyboard.press("s");
  await page.keyboard.press("Home"); for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("d");
  await expect.poll(() => editorText(page)).toBe("axydzs");
  await page.keyboard.press("Backspace");
  await expect.poll(() => editorText(page)).toBe("axyzs");
  await page.keyboard.type("add sad dads");
  await expect.poll(() => editorText(page)).toBe("axyzsadd sad dads");
});

test("function-based mode: a, s, d type normally in the editor of the second question", async ({ page }) => {
  await openTest(page, data.codingTestId, /E2E coding \(full program\)/);
  await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(page.getByText(/E2E coding \(function\)/).first()).toBeVisible();
  await page.waitForFunction((src) => new Function("return (" + src + ")()")().includes("addNums"), readEditor.toString(), { timeout: 15000 });
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+a"); await page.keyboard.press("Delete");
  await page.keyboard.type("def addNums(self, a, b):\n    return a + b  # sum and add, standard dads");
  const t = await editorText(page);
  expect(t).toContain("def addNums(self, a, b):");
  expect(t).toContain("return a + b  # sum and add, standard dads");
});

test("C is selectable and types normally; the typed code is what autosave sends to the server", async ({ page }) => {
  await openTest(page, data.codingTestId, /E2E coding \(full program\)/);
  await page.locator("select.mono").first().selectOption("c");
  await focusEditorAndClear(page);
  const code = "#include <stdio.h>\nint main(void) { int a, s, d; scanf(\"%d %d\", &a, &d); s = a + d; printf(\"%d\\n\", s); return 0; }";
  const autosave = page.waitForRequest((r) => /\/submissions\/autosave/.test(r.url()) && r.method() === "POST" && (r.postData() || "").includes("scanf"), { timeout: 20000 });
  await page.keyboard.type(code);
  await expect.poll(() => editorText(page)).toBe(code);
  const req = await autosave;
  expect(JSON.parse(req.postData()).code, "the server receives exactly what was typed").toBe(code);
  expect(JSON.parse(req.postData()).language).toBe("c");
});

test("other text fields take a, s, d too (login form here; the same global listeners are not present on ordinary pages)", async ({ page }) => {
  await page.goto("/login");
  const email = page.locator('input[type="email"]');
  await email.click();
  await page.keyboard.type("asd.ASD@data-structures-and-algorithms.example");
  await expect(email).toHaveValue("asd.ASD@data-structures-and-algorithms.example");
});

test("modifier shortcuts keep their meaning: Ctrl+A / Ctrl+Z in the editor work, Ctrl+S is the one intercepted shortcut and never touches the text", async ({ page }) => {
  await openTest(page, data.codingProctoredTestId, /E2E coding \(full program\)/);
  await focusEditorAndClear(page);
  await recordKeys(page);
  await page.keyboard.type("sad ads das");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("x");
  await expect.poll(() => editorText(page)).toBe("x");
  await page.keyboard.press("Control+z");
  await expect.poll(() => editorText(page)).toBe("sad ads das");
  await page.keyboard.press("Control+s");
  await expect.poll(() => editorText(page), "Ctrl+S inserts nothing").toBe("sad ads das");
  const keys = await keysOf(page);
  expect(keys.find((e) => e.type === "keydown" && e.ctrl && e.key === "s")?.prevented, "Ctrl+S is the intentional, modifier-gated exception").toBe(true);
  await page.keyboard.type("d");
  await expect.poll(() => editorText(page)).toBe("sad ads dasd");
});

test("hidden test cases and reference solutions never reach the browser during the test", async ({ page }) => {
  const bodies = [];
  page.on("response", async (r) => { if (r.url().includes("/api/")) { try { bodies.push(await r.text()); } catch { /* ignore */ } } });
  await openTest(page, data.codingTestId, /E2E coding \(full program\)/);
  const all = bodies.join("\n");
  expect(all).not.toMatch(/"isHidden":\s*true/);
  expect(all).not.toMatch(/referenceSolution/i);
  expect(all).not.toContain('"input":"5 6"');
});
