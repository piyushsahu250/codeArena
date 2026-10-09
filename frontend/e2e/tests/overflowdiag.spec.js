const { test } = require("@playwright/test");
const { users, login } = require("./helpers");

// Diagnostic only: for pages that scroll sideways on a phone, list the elements that stick out past the viewport (outermost offenders first).
const TARGETS = [
  ["staff", ["/staff/tests", "/staff/questions/new"]],
  ["platform", ["/admin/users", "/admin/bulk-upload", "/admin/staff-clerk"]],
  ["clerk", ["/clerk/placement-analytics"]],
];
const OLD = [
  ["student", ["/resume", "/interview"]],
  ["staff", ["/staff/tests/new", "/staff/questions", "/staff/students", "/staff/tests"]],
  ["platform", ["/admin/audit-log", "/admin/course-assignments", "/admin/institutes", "/admin/students"]],
  ["clerk", ["/clerk/placement-analytics", "/clerk/students"]],
];

for (const [who, paths] of TARGETS) {
  test(`overflow offenders: ${who}`, async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users[who]);
    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
      const offenders = await page.evaluate(() => {
        const vw = window.innerWidth;
        const out = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= vw + 1) continue;
          // skip anything that scrolls inside its own container (its overflow is contained there)
          let p = el.parentElement, contained = false;
          while (p && p !== document.body) { const ox = getComputedStyle(p).overflowX; if (ox === "auto" || ox === "scroll" || ox === "hidden") { contained = true; break; } p = p.parentElement; }
          if (contained) continue;
          out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || "").slice(0, 50), w: Math.round(r.width), right: Math.round(r.right), style: (el.getAttribute("style") || "").slice(0, 90), text: (el.innerText || "").trim().slice(0, 30).replace(/\n/g, " ") });
        }
        return out.sort((a, b) => b.right - a.right).slice(0, 5);
      });
      console.log(`OFFENDERS ${path}\n` + offenders.map((o) => `  <${o.tag} class="${o.cls}"> w=${o.w} right=${o.right} style="${o.style}" text="${o.text}"`).join("\n"));
    }
  });
}
