const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

function lum([r, g, b]) { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// Samples visible text elements inside the dashboard kits, resolves foreground and the first opaque ancestor background, and requires
// WCAG AA contrast (4.5:1 normal text, 3:1 large) in both themes.
async function contrastSamples(page) {
  return page.evaluate(() => {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map((x) => parseFloat(x)); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c.rgb; } return [255, 255, 255]; };
    const out = [];
    const els = [...document.querySelectorAll(".sd *, .ad *")].filter((e) => e.children.length === 0 && (e.textContent || "").trim().length > 1 && e.offsetParent);
    for (const el of els.slice(0, 400)) {
      const cs = getComputedStyle(el);
      const fg = parse(cs.color); if (!fg) continue;
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
      out.push({ text: el.textContent.trim().slice(0, 28), fg: fg.rgb, bg: bgOf(el), large: size >= 24 || (size >= 18.66 && bold) });
    }
    return out;
  });
}

for (const [who, path] of [["student", "/dashboard"], ["instAdmin", "/admin"], ["platform", "/admin"]]) {
  for (const theme of ["light", "dark"]) {
    test(`${who} ${path} in ${theme} mode: text contrast meets WCAG AA`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("caTheme", t), theme);
      await login(page, users[who]);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const samples = await contrastSamples(page);
      const bad = samples.filter((s) => ratio(s.fg, s.bg) < (s.large ? 3 : 4.5)).map((s) => `${s.text} ${ratio(s.fg, s.bg).toFixed(2)}`);
      expect(bad.slice(0, 8), `${bad.length} of ${samples.length} sampled text nodes below AA`).toEqual([]);
    });
  }
}

test("dark mode actually changes the page background", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("caTheme", "dark"));
  await login(page, users.student);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe("rgb(251, 249, 244)");
});
