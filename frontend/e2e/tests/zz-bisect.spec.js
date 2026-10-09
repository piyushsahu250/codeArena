const { test } = require("@playwright/test");
const { users, login } = require("./helpers");

// Diagnostic only: finds the element responsible for sideways scrolling by hiding subtrees and watching document.scrollWidth.
for (const path of ["/admin/users", "/admin/staff-clerk"]) {
  test(`bisect overflow culprit ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 }); // the failing path is load at 375, then narrow to 320 (as pages.spec.js does)
    await login(page, users.platform);
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.setViewportSize({ width: 320, height: 800 });
    await page.waitForTimeout(1500);
    const res = await page.evaluate(() => {
      const vw = window.innerWidth;
      const sw = () => document.documentElement.scrollWidth;
      const base = sw();
      const desc = (el) => `<${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}> w=${Math.round(el.getBoundingClientRect().width)} right=${Math.round(el.getBoundingClientRect().right)} style="${(el.getAttribute("style") || "").slice(0, 110)}" text="${(el.innerText || "").trim().slice(0, 40).replace(/\n/g, " ")}"`;
      if (base <= vw + 1) return { base, vw, chain: ["no overflow at 320 when loaded directly"] };
      let cur = document.body;
      const chain = [];
      for (let depth = 0; depth < 14; depth++) {
        let best = null, bestSw = sw();
        for (const child of [...cur.children]) {
          const prev = child.style.display;
          child.style.display = "none";
          const s = sw();
          child.style.display = prev;
          if (s < bestSw) { bestSw = s; best = child; }
        }
        if (!best) break;
        chain.push(`scrollWidth ${sw()} -> ${bestSw} when hiding ${desc(best)}`);
        if (bestSw <= vw + 1) {
          // this subtree alone fixes it; descend to find the smallest part that does
          cur = best;
          const inner = [...cur.children];
          let narrower = null;
          for (const c of inner) { const p = c.style.display; c.style.display = "none"; const s = sw(); c.style.display = p; if (s <= vw + 1 || s < bestSw) { narrower = c; break; } }
          if (!narrower) break;
          continue;
        }
        cur = best;
      }
      return { base, vw, chain };
    });
    console.log(`BISECT ${path} scrollWidth=${res.base} viewport=${res.vw}\n` + res.chain.map((c) => "  " + c).join("\n"));
  });
}
