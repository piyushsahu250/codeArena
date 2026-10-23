const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { data, users, login } = require("./helpers");

// First sign-in with an administrator-issued temporary password: the page stays on /login, asks for a personal password on the same form, and only a successful change opens a
// session. Each flagged account (data.firstLogin.*, seeded by backend/scripts/e2eSeed.js into an institute of its own) serves one test, because a successful change consumes the
// temporary password. The server-side half (no session before the change, atomic replace, rate limits, audit) is backend/scripts/verifyFirstLoginPasswordChange.js.
const WELCOME = "Welcome to CodeArena! Please create your personal password before continuing.";
const SUCCESS = "Password changed successfully. Welcome to CodeArena!";
const API = "http://localhost:4000/api";
const rules = ["uppercase", "lowercase", "number", "special", "length"];

const strongPassword = () => `Nn7#${Math.random().toString(36).slice(2, 12)}Zz`; // upper, lower, digit, special, 14+ characters

async function signInWithTemporary(page, account, theme) {
  if (theme) await page.addInitScript((t) => { try { localStorage.setItem("caTheme", t); } catch { /* storage blocked */ } }, theme);
  await page.goto("/login");
  await page.locator("#login-email").fill(account.email);
  await page.locator("#login-password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-new-password")).toBeVisible();
}
const metRules = async (page) => {
  const met = [];
  for (const id of rules) if (await page.locator(`#login-password-rules li[data-rule="${id}"]`).evaluate((el) => el.classList.contains("met"))) met.push(id);
  return met;
};
const fillNew = async (page, password, confirm = password) => {
  await page.locator("#login-new-password").fill(password);
  await page.locator("#login-confirm-password").fill(confirm);
};
const submit = (page) => page.getByRole("button", { name: "Change Password & Login" });
const storageDump = (page) => page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);

test("a temporary password keeps the student on the login page with the new-password form, and nothing is stored yet", async ({ page, context }) => {
  const acct = data.firstLogin.journey;
  await signInWithTemporary(page, acct);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("#login-intro")).toHaveText(WELCOME);
  await expect(submit(page)).toBeVisible();
  await expect(submit(page)).toBeDisabled();
  await expect(page.locator("#login-email")).toHaveValue(acct.email);
  await expect(page.locator("#login-email")).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#login-password")).toHaveValue(acct.password);
  await expect(page.locator("label[for=login-password]")).toHaveText("Temporary Password");
  await expect(page.locator("#login-new-password")).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("user"))).toBeNull();
  // The dashboard cannot be opened from another tab either: the server has issued no session.
  const other = await context.newPage();
  await other.goto("/dashboard");
  await expect(other).toHaveURL(/\/login/);
  await other.close();
});

test("choosing a personal password signs the student in on the right dashboard, and the old temporary password stops working", async ({ page }) => {
  const acct = data.firstLogin.journey;
  const chosen = strongPassword();
  await signInWithTemporary(page, acct);
  await fillNew(page, chosen);
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator(".ca-toast.success")).toContainText(SUCCESS);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeTruthy();
  const stored = await storageDump(page);
  expect(stored).not.toContain(chosen);
  expect(stored).not.toContain(acct.password);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("user"))).mustChangePassword).toBe(false);
  // Signing in again is the ordinary sign-in: no second form.
  await page.evaluate(() => localStorage.clear());
  await page.goto("/login");
  await page.locator("#login-email").fill(acct.email);
  await page.locator("#login-password").fill(chosen);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // And the temporary one is gone.
  await page.evaluate(() => localStorage.clear());
  await page.goto("/login");
  await page.locator("#login-email").fill(acct.email);
  await page.locator("#login-password").fill(acct.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".ca-login-error")).toContainText(/invalid email or password/i);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("#login-new-password")).toHaveCount(0);
});

test("each rule turns from unmet to met by itself while typing, and the confirmation says whether the two agree", async ({ page }) => {
  await signInWithTemporary(page, data.firstLogin.rules);
  expect(await metRules(page)).toEqual([]);
  for (const id of rules) {
    const item = page.locator(`#login-password-rules li[data-rule="${id}"]`);
    await expect(item).toContainText("(requirement not met)");
    await expect(item.locator(".ca-pw-rule-icon")).toHaveText("✕");
  }
  const steps = [["A", ["uppercase"]], ["Aa", ["uppercase", "lowercase"]], ["Aa1", ["uppercase", "lowercase", "number"]], ["Aa1!", ["uppercase", "lowercase", "number", "special"]], ["Aa1!aaaa", rules]];
  for (const [typed, expected] of steps) {
    await page.locator("#login-new-password").fill(typed);
    expect(await metRules(page), `after typing ${typed}`).toEqual(expected);
  }
  const length = page.locator('#login-password-rules li[data-rule="length"]');
  await expect(length).toContainText("(requirement met)");
  await expect(length.locator(".ca-pw-rule-icon")).toHaveText("✓");
  // Other combinations: the rules are not a ladder.
  await page.locator("#login-new-password").fill("abcdefghij");
  expect(await metRules(page)).toEqual(["lowercase", "length"]);
  await page.locator("#login-new-password").fill("1234567!");
  expect(await metRules(page)).toEqual(["number", "special", "length"]);

  // The confirmation: silent while empty, then a mismatch, then a match; the button follows.
  await page.locator("#login-new-password").fill("Aa1!aaaa");
  const status = page.locator("#login-confirm-status");
  await expect(status).toHaveText("");
  await expect(submit(page)).toBeDisabled();
  await page.locator("#login-confirm-password").fill("Aa1!aaa");
  await expect(status).toContainText("Passwords do not match.");
  await expect(submit(page)).toBeDisabled();
  await page.locator("#login-confirm-password").fill("Aa1!aaaa");
  await expect(status).toContainText("Passwords match.");
  await expect(submit(page)).toBeEnabled();
  // A password that breaks a rule keeps the button disabled even when the two fields agree.
  await fillNew(page, "aa1!aaaa");
  await expect(status).toContainText("Passwords match.");
  await expect(submit(page)).toBeDisabled();
  // Changing the first field after confirming brings the mismatch back.
  await fillNew(page, "Aa1!aaaa");
  await page.locator("#login-new-password").fill("Aa1!aaab");
  await expect(status).toContainText("Passwords do not match.");
  // Show / hide.
  await expect(page.locator("#login-new-password")).toHaveAttribute("type", "password");
  await page.getByLabel("Show passwords").check();
  for (const id of ["#login-password", "#login-new-password", "#login-confirm-password"]) await expect(page.locator(id)).toHaveAttribute("type", "text");
  await page.getByLabel("Show passwords").uncheck();
  await expect(page.locator("#login-new-password")).toHaveAttribute("type", "password");
});

test("a lost connection never leaves the student unsure: the form keeps its values, and a change that did go through is recognised", async ({ page }) => {
  const acct = data.firstLogin.network;
  const chosen = strongPassword();
  await signInWithTemporary(page, acct);
  await fillNew(page, chosen);
  // 1. The request never reaches the server.
  await page.route("**/auth/change-temporary-password", (route) => route.abort("failed"));
  await submit(page).click();
  await expect(page.locator(".ca-login-error")).toContainText("Your password was not changed");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("#login-email")).toHaveValue(acct.email);
  await expect(page.locator("#login-password")).toHaveValue(acct.password);
  await expect(page.locator("#login-new-password")).toHaveValue(chosen);
  await expect(page.locator("#login-confirm-password")).toHaveValue(chosen);
  await expect(submit(page)).toBeEnabled();
  expect(await storageDump(page)).not.toContain(chosen);
  // 2. The server changes the password but the answer is lost on the way back: the page must find out, not report a failure.
  await page.unroute("**/auth/change-temporary-password");
  await page.route("**/auth/change-temporary-password", async (route) => {
    await route.fetch();
    await route.abort("connectionreset");
  });
  await submit(page).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator(".ca-toast.success")).toContainText(SUCCESS);
});

test("pressing the button twice, or Enter twice, sends one request", async ({ page }) => {
  const acct = data.firstLogin.double;
  await signInWithTemporary(page, acct);
  let sent = 0;
  page.on("request", (req) => { if (req.url().includes("/auth/change-temporary-password") && req.method() === "POST") sent++; });
  await fillNew(page, strongPassword());
  await submit(page).dblclick();
  await expect(page).toHaveURL(/\/dashboard/);
  expect(sent).toBe(1);
});

test("the requirement to choose a password is the server's: forged browser state and direct API calls get nowhere", async ({ page, request }) => {
  const acct = data.firstLogin.guard;
  // The API itself: the right temporary password buys a request to choose a new one, not a session.
  const res = await request.post(`${API}/auth/login`, { data: { email: acct.email, password: acct.password } });
  const body = await res.json();
  expect(res.status()).toBe(200);
  expect(body.passwordChangeRequired).toBe(true);
  expect(body.token).toBeFalsy();
  // Nothing in the response can be presented as a bearer token.
  for (const bearer of [String(body.token), "undefined", "", "null"]) {
    const probe = await request.get(`${API}/dashboard/student`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
    expect(probe.status()).toBe(401);
  }
  // A browser state that claims the password was already changed opens nothing.
  await page.goto("/login");
  await page.evaluate(() => {
    localStorage.setItem("token", "forged.token.value");
    localStorage.setItem("user", JSON.stringify({ id: "x", name: "Forged", role: "STUDENT", mustChangePassword: false }));
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?expired=1/);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
});

test("a temporary password that is no longer accepted is explained, and the way back to sign-in keeps the e-mail", async ({ page }) => {
  const acct = data.firstLogin.wrong;
  await signInWithTemporary(page, acct);
  // Replaced, reset or typed differently between the two steps: the second step refuses it.
  await page.locator("#login-password").fill("Zz9!NotTheTemporaryOne");
  await fillNew(page, strongPassword());
  await submit(page).click();
  await expect(page.locator(".ca-login-error")).toContainText("temporary password was not accepted");
  await expect(page.locator(".ca-login-error")).toContainText("already created your personal password");
  await expect(page.locator("#login-new-password")).toBeVisible();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.locator("#login-new-password")).toHaveCount(0);
  await expect(page.locator("#login-email")).toHaveValue(acct.email);
  await expect(page.locator("#login-email")).toHaveJSProperty("readOnly", false);
  await expect(page.locator("#login-password")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("an ordinary sign-in shows no new-password form, and a wrong password stays an ordinary error", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("#login-new-password")).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(1);
  await page.locator("#login-email").fill(users.student2.email);
  await page.locator("#login-password").fill("Definitely#Wrong1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".ca-login-error")).toContainText(/invalid email or password/i);
  await expect(page.locator("#login-new-password")).toHaveCount(0);
  await login(page, users.student);
  await expect(page).toHaveURL(/\/dashboard/);
});

test("the form is built for password managers: one form, standard autocomplete values, and no field that fights them", async ({ page }) => {
  await page.goto("/login");
  const attrs = (selector) => page.locator(selector).evaluate((el) => ({ type: el.type, name: el.name, autocomplete: el.autocomplete, form: el.form && el.form.id }));
  const first = { email: await attrs("#login-email"), password: await attrs("#login-password") };
  expect(first.email).toMatchObject({ type: "email", name: "username", autocomplete: "username" });
  expect(first.password).toMatchObject({ type: "password", autocomplete: "current-password" });
  expect(await page.locator("form").count()).toBe(1);
  // The same inputs are still there, in the same form, on the second step.
  await signInWithTemporary(page, data.firstLogin.access);
  expect(await page.locator("form").count()).toBe(1);
  expect(await attrs("#login-email")).toMatchObject({ type: "email", name: "username", autocomplete: "username" });
  expect(await attrs("#login-password")).toMatchObject({ type: "password", autocomplete: "current-password" });
  expect(await attrs("#login-new-password")).toMatchObject({ type: "password", autocomplete: "new-password" });
  expect(await attrs("#login-confirm-password")).toMatchObject({ type: "password", autocomplete: "new-password" });
  expect(await page.locator("form input:not([type=checkbox])").count()).toBe(4);
  expect(await page.locator("input[type=hidden], input[style*='display: none'], input[autocomplete=off]").count()).toBe(0);
});

test("the second step works with the keyboard alone and has no serious accessibility findings in either theme", async ({ page }) => {
  const acct = data.firstLogin.access;
  await signInWithTemporary(page, acct);
  // Focus lands on the field to fill; Tab runs new password -> confirmation -> show passwords -> button -> back link, in reading order.
  await expect(page.locator("#login-new-password")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#login-confirm-password")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Show passwords")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator("#login-new-password")).toHaveAttribute("type", "text");
  await page.keyboard.press("Space");
  await fillNew(page, "Aa1!aaaa");
  await page.locator("#login-confirm-password").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(submit(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Back to sign in" })).toBeFocused();
  // The rule list and the status are labelled for assistive technology.
  await expect(page.locator("#login-password-rules")).toHaveAttribute("aria-label", "Password requirements");
  await expect(page.locator("#login-new-password")).toHaveAttribute("aria-describedby", "login-password-rules");
  await expect(page.locator("#login-confirm-status")).toHaveAttribute("role", "status");
  const findings = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join("; ")}`);
  await fillNew(page, "Aa1!aaaa"); // every rule met, the confirmation matching
  expect(await findings(), "light theme").toEqual([]);
  await fillNew(page, "aa1"); // rules unmet, the confirmation matching
  await page.locator("#login-confirm-password").fill("zz");
  expect(await findings(), "light theme, with unmet rules and a mismatch").toEqual([]);
});

test("the second step has no serious accessibility findings in the dark theme", async ({ page }) => {
  await signInWithTemporary(page, data.firstLogin.access, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const run = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join("; ")}`);
  await fillNew(page, "Aa1!aaaa");
  expect(await run(), "dark theme, every rule met").toEqual([]);
  await fillNew(page, "aa1");
  await page.locator("#login-confirm-password").fill("zz");
  expect(await run(), "dark theme, unmet rules and a mismatch").toEqual([]);
});
