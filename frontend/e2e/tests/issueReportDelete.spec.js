const { test, expect } = require("@playwright/test");
const { users, login } = require("./helpers");

// Deleting a reported problem is a SUPER_ADMIN-only action, enforced by the route. The e2e seed has no SUPER_ADMIN (the database allows exactly one, and it is the real
// one), so the allowed path cannot be exercised here; these tests pin the refusals: a platform ADMIN and an institute admin are turned away by the API and
// are not shown the button, and the report is still there afterwards.
async function api(page, method, path, data) {
  const token = await page.evaluate(() => localStorage.getItem("token"));
  const res = await page.request.fetch(`http://localhost:4000/api${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

test("only a SUPER_ADMIN can delete a reported problem; other admins are refused and the report survives", async ({ page }) => {
  await login(page, users.student);
  const made = await api(page, "POST", "/issue-reports", { description: "e2e delete-scope probe", page: "/e2e" });
  expect(made.status).toBe(201);
  const id = made.body.id;
  const student = await api(page, "DELETE", `/issue-reports/${id}`);
  expect(student.status, "student").toBe(403);

  for (const who of [users.instAdmin, users.platform]) {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await login(page, who);
    const res = await api(page, "DELETE", `/issue-reports/${id}`);
    expect(res.status, `${who.email} is not allowed to delete`).toBe(403);
  }

  await page.goto("/admin/issue-reports");
  await expect(page.getByText("e2e delete-scope probe").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});
