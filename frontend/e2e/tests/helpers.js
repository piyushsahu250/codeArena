const fs = require("fs");
const { expect } = require("@playwright/test");

const data = JSON.parse(fs.readFileSync(process.env.E2E_USERS_JSON || "/e2e/users.json", "utf8"));

// Collects uncaught page errors and failing API responses so every test can assert "nothing broke while I was looking".
function watch(page) {
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console.error: ${m.text().slice(0, 200)}`); });
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/^.*\/api/, "/api")}`); });
  return problems;
}

async function login(page, user) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator("form button").first().click();
  await expect(page).not.toHaveURL(/\/login/);
}

// No page may render the textual signs of unhandled data: "undefined", "null", "NaN", "[object Object]".
async function expectNoBrokenText(page) {
  const text = await page.locator("body").innerText();
  for (const bad of ["undefined", "NaN", "[object Object]", "null%"]) expect(text, `page text contains "${bad}"`).not.toContain(bad);
}

module.exports = { data, users: data.users, watch, login, expectNoBrokenText };
