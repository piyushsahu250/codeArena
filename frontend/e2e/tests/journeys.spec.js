const { test, expect } = require("@playwright/test");
const { data, users, watch, login, expectNoBrokenText } = require("./helpers");

// Selects "Option B" through the real radio input and proves the selection registered (the input is visually hidden, so the label is clicked).
async function pickB(page) {
  const radio = page.getByRole("radio", { name: /Option B/ });
  await page.locator("label.exam-option", { hasText: "Option B" }).click();
  await expect(radio).toBeChecked();
}

test("student journey: dashboard -> navigation -> take a test -> submit -> result", async ({ page }) => {
  const problems = watch(page);
  const traffic = [];
  page.on("response", async (r) => {
    if (/\/api\//.test(r.url()) && r.request().method() !== "GET") {
      let b = ""; try { b = (await r.text()).slice(0, 300); } catch { /* ignore */ }
      traffic.push(`${r.request().method()} ${r.url().replace(/^.*\/api/, "")} ${r.status()} req=${(r.request().postData() || "").slice(0, 200)} res=${b}`);
    }
  });
  await login(page, users.student);
  await expect(page.locator("h1")).toBeVisible();

  // sidebar navigation reaches real pages without errors
  for (const href of ["/results", "/learning", "/profile"]) {
    await page.locator(`aside a[href="${href}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(href));
    await expect(page.locator("body")).not.toContainText("This page isn't available");
  }

  // pre-start screen: summary only (questions are withheld by the server until the attempt starts)
  await page.goto(`/test/${data.testId}`);
  await expect(page.getByRole("heading", { name: "ZZ E2E Standard Test" })).toBeVisible();
  await expect(page.getByText(data.questionTexts[0])).toHaveCount(0);
  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();

  // the first question appears; answer both
  await expect(page.getByText(/E2E question [0-9]: pick option B/)).toBeVisible();
  await pickB(page);
  await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(page.getByText(/E2E question [0-9]: pick option B/)).toBeVisible();
  await pickB(page);

  await page.getByRole("button", { name: "Submit Test" }).click();
  await page.getByRole("button", { name: "Submit Assessment" }).click();
  await expect(page.getByText(/submitted|Thank you/i).first()).toBeVisible({ timeout: 30000 });

  // result page: both answers were correct (2 x 5 points)
  await page.goto(`/test/${data.testId}/result`);
  await expect(page.locator("h1")).toContainText("Your result");
  console.log("TRAFFIC\n" + traffic.join("\n"));
  await expect(page.locator("body")).toContainText(/10\s*\/\s*10|100(\.0)?\s*%/);
  await expectNoBrokenText(page);
  expect(problems).toEqual([]);
});

test("a finished test cannot be started again", async ({ page }) => {
  await login(page, users.student);
  await page.goto(`/test/${data.testId}`);
  await page.getByLabel("I have read and understood the instructions.").check();
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.locator("body")).toContainText(/already completed|Thank you/i);
});

test("secure session: a second tab takes over a PROCTORED test and the first is told so", async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const p1 = await ctx1.newPage();
  await login(p1, users.student2);
  await p1.goto(`/test/${data.proctoredTestId}`);
  await expect(p1.getByText("SECURE ASSESSMENT")).toBeVisible();
  await p1.getByRole("button", { name: "Run security check" }).click();
  await expect(p1.getByText("Secure connection (HTTPS)")).toBeVisible();
  await p1.getByLabel("I have read and understood the instructions.").check();
  await p1.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(p1.getByText(/E2E question [0-9]: pick option B/)).toBeVisible();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, users.student2);
  await p2.goto(`/test/${data.proctoredTestId}`);
  await p2.getByRole("button", { name: "Run security check" }).click();
  await p2.getByLabel("I have read and understood the instructions.").check();
  await p2.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(p2.getByText(/E2E question [0-9]: pick option B/)).toBeVisible();

  // the first tab's next save is refused with 409 and it shows the blocking message
  await pickB(p1);
  await expect(p1.getByText("Assessment open elsewhere")).toBeVisible({ timeout: 20000 });
  await ctx1.close();
  await ctx2.close();
});

test("question content is not in the page before a test is started", async ({ page }) => {
  const bodies = [];
  page.on("response", async (r) => {
    if (/\/api\/tests\/[^/]+$/.test(r.url()) && r.request().method() === "GET") { try { bodies.push(await r.text()); } catch { /* ignore */ } }
  });
  await login(page, users.studentB ? users.student : users.student);
  await page.goto(`/test/${data.proctoredTestId}`);
  await expect(page.getByText("SECURE ASSESSMENT")).toBeVisible();
  const joined = bodies.join("\n");
  expect(joined).not.toContain("pick option B");
  expect(joined).not.toContain("E2E question 1");
  expect(joined).not.toContain("correctAnswer");
});
