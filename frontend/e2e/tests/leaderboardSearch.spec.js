const { test, expect } = require("@playwright/test");
const { data, users, login, watch } = require("./helpers");

// The staff test-results leaderboard: the search box must find students by name, roll number, PRN (registration number) and e-mail, ignore case and
// extra spaces, restore the full list when cleared, keep each person's rank, and explain an empty result. It used to match the roll number only.
async function openResults(page) {
  const problems = watch(page);
  await login(page, users.staff);
  await page.goto(`/staff/tests/${data.resultsTestId}/results`);
  await expect(page.locator("tbody tr", { hasText: "Ela Student" })).toBeVisible({ timeout: 20000 });
  return problems;
}
const rows = (page) => page.locator("tbody tr").filter({ has: page.locator("td.mono") });
const search = (page) => page.getByRole("searchbox", { name: /Search the leaderboard/ });
async function expectNames(page, names) {
  await expect.poll(async () => (await rows(page).allInnerTexts()).map((t) => ["Ela", "Ben", "Cal"].find((n) => t.includes(n))).filter(Boolean), { timeout: 8000 }).toEqual(names);
}

test("search by name, roll number, PRN and e-mail; case and spaces do not matter", async ({ page }) => {
  const problems = await openResults(page);
  await expectNames(page, ["Ela", "Ben", "Cal"]);
  const box = search(page);
  await box.fill("ben");
  await expectNames(page, ["Ben"]);
  await box.fill("  CAL   student ");
  await expectNames(page, ["Cal"]);
  await box.fill("102");
  await expectNames(page, ["Ben"]);
  await box.fill("prn-ela");
  await expectNames(page, ["Ela"]);
  await box.fill("student");
  await expectNames(page, ["Ela", "Ben", "Cal"]);
  await box.fill("e2e-student2");
  await expectNames(page, ["Ben"]);
  expect(problems, "no page errors or 5xx while searching").toEqual([]);
});

test("a filtered row keeps its leaderboard rank, and the count says so", async ({ page }) => {
  await openResults(page);
  await search(page).fill("cal");
  await expectNames(page, ["Cal"]);
  const cells = await rows(page).first().locator("td").allInnerTexts();
  expect(cells.some((c) => /(^|\s)#?3$/.test(c.trim())), "Cal is still ranked 3rd of 3: " + JSON.stringify(cells)).toBe(true);
  await expect(page.getByText(/Showing 1 of 3/)).toBeVisible();
});

test("no match explains itself; Clear and an emptied box restore everyone", async ({ page }) => {
  await openResults(page);
  const box = search(page);
  await box.fill("zzzz-nobody");
  await expect(page.getByText(/No student matches "zzzz-nobody"/)).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(box).toHaveValue("");
  await expectNames(page, ["Ela", "Ben", "Cal"]);
  await box.fill("ben");
  await expectNames(page, ["Ben"]);
  await box.fill("");
  await expectNames(page, ["Ela", "Ben", "Cal"]);
});

test("rapid typing settles on the final query, regex and SQL characters are plain text", async ({ page }) => {
  const problems = await openResults(page);
  const box = search(page);
  await box.click();
  await page.keyboard.type("ela student", { delay: 0 });
  await expectNames(page, ["Ela"]);
  for (const odd of [".*", "(", "%", "'; DROP TABLE users; --"]) {
    await box.fill(odd);
    await expect(page.getByText(/No student matches/)).toBeVisible();
  }
  await box.fill("cal");
  await expectNames(page, ["Cal"]);
  expect(problems).toEqual([]);
});

test("the download carries the same search, so the file matches the screen", async ({ page }) => {
  await openResults(page);
  await search(page).fill("ben");
  await expectNames(page, ["Ben"]);
  const req = page.waitForRequest((r) => r.url().includes("/results/export") && /[?&]q=ben(&|$)/.test(r.url()), { timeout: 15000 });
  await page.getByRole("button", { name: /Download results/ }).click();
  await req;
});

test("mobile width: the search box is usable and the layout does not break", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const problems = await openResults(page);
  const box = search(page);
  await expect(box).toBeVisible();
  const w = (await box.boundingBox()).width;
  expect(w, "the search box fits a phone screen").toBeLessThanOrEqual(390);
  await box.fill("ben");
  await expectNames(page, ["Ben"]);
  expect(problems).toEqual([]);
});
