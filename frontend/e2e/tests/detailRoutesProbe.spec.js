const { test } = require("@playwright/test");
const { users, login } = require("./helpers");

// UI/UX audit probe (report only; skipped unless UX_AUDIT is set, never fails the build): opens every route that takes an ID with an ID that does not exist, as the role that may open it,
// and prints one "[ux]" line per route that misbehaves:
//   stuck   : the page is still showing only "Loading..." after the requests have finished (a failed read that nothing handles)
//   blank   : nothing useful rendered (empty page or a crashed component)
//   crash   : an uncaught error or an unhandled promise rejection reached the browser
//   raw     : a raw technical message (HTTP status text, "undefined", "[object Object]", a stack) is shown to the user
const MISSING = "00000000-0000-0000-0000-000000000000";
const ROUTES = [
  ["platform", "/admin/institutes/:ID/overview"], ["platform", "/admin/staff-analytics/:ID"], ["platform", "/admin/staff-clerk/:ID"], ["platform", "/admin/students/:ID"],
  ["student", "/ai-interview/report/:ID"], ["student", "/interview/report/:ID"], ["student", "/readiness/report/:ID"], ["student", "/results/:ID"], ["student", "/test/:ID/result"],
  ["student", "/learning/no-such-course"], ["student", "/learning/no-such-course/certificate"], ["student", "/learning/no-such-course/practice"], ["student", "/learning/no-such-course/practice/analytics"],
  ["student", "/learning/no-such-course/practice/section/:ID"], ["student", "/learning/no-such-course/practice/topic/:ID"], ["student", "/learning/no-such-course/skill-graph"],
  ["clerk", "/clerk/students/:ID"],
  ["staff", "/staff/attendance/:ID"], ["staff", "/staff/attendance/:ID/execute/:ID"], ["staff", "/staff/exam-security/:ID"], ["staff", "/staff/exam-security/readiness/:ID"],
  ["staff", "/staff/exam-security/test/:ID"], ["staff", "/staff/interview-reports/:ID"], ["staff", "/staff/questions/:ID/edit"], ["staff", "/staff/students/:ID"],
  ["staff", "/staff/tests/:ID/edit"], ["staff", "/staff/tests/:ID/preview"], ["staff", "/staff/tests/:ID/results"],
];

test("detail routes with an ID that does not exist (report only)", async ({ page }) => {
  test.skip(!process.env.UX_AUDIT, "audit probe: runs only with UX_AUDIT=1");
  test.setTimeout(11 * 60 * 1000);
  let current = null;
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 90)));
  const groups = {};
  for (const [role, route] of ROUTES) (groups[role] ||= []).push(route);
  for (const [role, routes] of Object.entries(groups)) {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await login(page, users[role]);
    for (const template of routes) {
      const url = template.replace(/:ID/g, MISSING);
      current = `${role} ${template}`;
      errors.length = 0;
      await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const info = await page.evaluate(() => {
        const main = document.querySelector("main") || document.body;
        const text = (main.innerText || "").replace(/\s+/g, " ").trim();
        return { text, len: text.length, path: location.pathname };
      });
      const issues = [];
      if (/^(loading|loading…|loading\.\.\.)$/i.test(info.text) || (info.len < 60 && /loading/i.test(info.text))) issues.push("stuck on Loading");
      else if (info.len < 12) issues.push("blank page");
      if (errors.length) issues.push(`uncaught: ${[...new Set(errors)].slice(0, 2).join(" | ")}`);
      if (/\[object Object\]|\bundefined\b|\bNaN\b|Request failed with status code|AxiosError|TypeError|ReferenceError/.test(info.text)) issues.push("raw technical text shown");
      console.log(`[ux] ${current}: ${issues.length ? issues.join("; ") : "ok"} (ended at ${info.path}; shows: "${info.text.slice(0, 70)}")`);
    }
  }
});
