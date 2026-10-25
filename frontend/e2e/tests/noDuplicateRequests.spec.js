const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// REGRESSION (UI/UX audit batch 9): a probe that loads every page of every role on a cold load found 78 pages with a median of 2 to 3 API requests each, and exactly one page that repeated an
// identical GET: the interview admin page asked for its question list twice (once from the "load everything" effect and once from the filter effect). These checks keep identical GETs
// from being sent twice on the busiest pages of each role.
const CASES = [
  ["staff", ["/staff", "/staff/interviews", "/staff/tests", "/staff/questions"]],
  ["student", ["/dashboard", "/results", "/learning"]],
  ["platform", ["/admin", "/admin/students", "/admin/users"]],
];

test("busy pages never send the same GET request twice on load", async ({ page }) => {
  let calls = [];
  page.on("request", (r) => { if (r.method() === "GET" && r.url().includes("/api/")) calls.push(r.url().replace(/^.*\/api/, "/api")); });
  for (const [role, paths] of CASES) {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await login(page, users[role]);
    await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
    for (const p of paths) {
      calls = [];
      await page.goto(p, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
      await page.waitForTimeout(500);
      const counts = {};
      for (const u of calls) counts[u] = (counts[u] || 0) + 1;
      const repeated = Object.entries(counts).filter(([, n]) => n > 1).map(([u, n]) => `${u} x${n}`);
      expect(repeated, `${role} ${p} repeated an identical GET`).toEqual([]);
    }
  }
});
