const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// Opens every lesson of every published course (the platform admin can open all of them) and fails on a blank page or an uncaught render error.
// The module-test lessons ("Coding Problems") are listed first so a crash there is reported at once. A page that stays blank is retried once after a
// pause (the API rate limiter can answer 429 to a rapid-fire run); the HTTP status of the lesson request is reported with every failure.
test("every lesson page renders without an uncaught error", async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
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

  async function visit(t) {
    const errors = [];
    let status = null;
    const onErr = (e) => errors.push(e.message);
    const onResp = (r) => { if (r.url().includes(`/api/learning/lessons/${t.id}`) && r.request().method() === "GET") status = r.status(); };
    page.on("pageerror", onErr); page.on("response", onResp);
    await page.goto(`/learning/${t.slug}/lesson/${t.id}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const h1 = await page.locator("h1").first().innerText({ timeout: 8000 }).catch(() => "");
    const bodyLen = (await page.locator("body").innerText()).trim().length;
    page.off("pageerror", onErr); page.off("response", onResp);
    const problem = errors[0] || (!h1 ? "no heading (blank page)" : bodyLen < 40 ? "page nearly empty" : "");
    return { problem, status };
  }

  const broken = [];
  for (const t of targets) {
    let r = await visit(t);
    if (r.problem) { await page.waitForTimeout(r.status === 429 ? 35000 : 4000); r = await visit(t); }
    await page.waitForTimeout(300); // stay under the API rate limiter, as a real reader would
    if (r.problem) broken.push(`${t.course} / ${t.module} / ${t.title}${t.test ? " [module test]" : ""}: ${r.problem} (lesson API status ${r.status})`);
  }
  console.log(`LESSONS CHECKED ${targets.length}, BROKEN ${broken.length}\n${broken.join("\n")}`);
  expect(broken).toEqual([]);
});
