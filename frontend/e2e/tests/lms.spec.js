const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// Opens every lesson of every published course (the platform admin can open all of them) and fails on a blank page or an uncaught render error.
// The module-test lessons ("Coding Problems") are listed first so a crash there is reported at once.
test("every lesson page renders without an uncaught error", async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await login(page, users.platform);
  const token = await page.evaluate(() => localStorage.getItem("token"));
  const api = async (path) => (await page.request.get(`http://localhost:4000/api${path}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const courses = await api("/learning/courses");
  const targets = [];
  for (const c of courses) {
    const full = await api(`/learning/courses/${c.slug}`);
    for (const m of full.modules || []) for (const l of m.lessons || (await api(`/learning/courses/${c.slug}/modules/${m.id}/lessons`)) || []) {
      targets.push({ slug: c.slug, course: c.name, module: m.title, id: l.id, title: l.title, test: !!l.isModuleTest });
    }
  }
  expect(targets.length).toBeGreaterThan(0);
  targets.sort((a, b) => Number(b.test) - Number(a.test));
  const broken = [];
  for (const t of targets) {
    const errors = [];
    const onErr = (e) => errors.push(e.message);
    page.on("pageerror", onErr);
    await page.goto(`/learning/${t.slug}/lesson/${t.id}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const h1 = await page.locator("h1").first().innerText({ timeout: 8000 }).catch(() => "");
    const bodyLen = (await page.locator("body").innerText()).trim().length;
    page.off("pageerror", onErr);
    if (errors.length || !h1 || bodyLen < 40) broken.push(`${t.course} / ${t.module} / ${t.title}${t.test ? " [module test]" : ""}: ${errors[0] || (h1 ? "page nearly empty" : "no heading (blank page)")}`);
  }
  console.log(`LESSONS CHECKED ${targets.length}, BROKEN ${broken.length}\n${broken.join("\n")}`);
  expect(broken).toEqual([]);
});
