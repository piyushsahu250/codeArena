const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");
const API = "http://localhost:4000/api";

// Temporary diagnostic: why does the "could not leave fullscreen" notice get detached while the test tries to click it?
test("diagnose notice flicker", async ({ page }) => {
  page.on("console", (m) => console.log("BROWSER", m.type(), m.text().slice(0, 200)));
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log("NAVIGATED", f.url()); });
  await login(page, users.student3);
  const H = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("token"))}` };
  const created = await page.request.post(`${API}/interview/sessions`, { headers: H, data: { isMock: true, config: {} } });
  const id = (await created.json()).id;
  await page.goto(`/interview/session/${id}`);
  await page.getByRole("button", { name: /Resume Interview/ }).click();
  await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => { document.exitFullscreen = () => Promise.reject(new Error("exit blocked by the browser")); });
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(page).toHaveURL(/\/interview$/);
  await page.evaluate(() => {
    window.__log = [];
    new MutationObserver((muts) => { for (const m of muts) for (const n of [...m.addedNodes, ...m.removedNodes]) if (n.nodeType === 1 && (n.getAttribute("role") === "alert" || n.querySelector?.('[role="alert"]'))) window.__log.push(`${m.addedNodes.length ? "added" : "removed"} @${Math.round(performance.now())}`); }).observe(document.body, { childList: true, subtree: true });
  });
  await page.waitForTimeout(3000);
  console.log("MUTATIONS", JSON.stringify(await page.evaluate(() => window.__log)));
  console.log("STATE", JSON.stringify(await page.evaluate(() => ({ alerts: document.querySelectorAll('[role="alert"]').length, fs: !!document.fullscreenElement, url: location.pathname }))));
});
