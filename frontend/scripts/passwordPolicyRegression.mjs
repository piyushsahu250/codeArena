// Regression test for the sign-in page's first-login helpers (src/utils/passwordPolicy.js, src/utils/firstLogin.js) and for the form attributes a browser's password manager
// relies on (src/pages/Login.jsx). Pure logic and source checks, no browser. The server remains the authority on every rule: backend/test/passwordPolicyConsistency.test.js
// holds these rules to the server's verdicts, and backend/scripts/verifyFirstLoginPasswordChange.js exercises the endpoints.
// Run: node frontend/scripts/passwordPolicyRegression.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PASSWORD_RULES, checkPassword, passwordMeetsPolicy } from "../src/utils/passwordPolicy.js";
import {
  EXPIRED_MESSAGE, MATCH_MESSAGE, MISMATCH_MESSAGE, SUCCESS_MESSAGE, WELCOME_MESSAGE,
  canSubmitPasswordChange, changeIntro, confirmStatus, currentPasswordLabel, describeChangeFailure, describeLoginFailure, normalizeReason,
} from "../src/utils/firstLogin.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };
const state = (password) => Object.fromEntries(checkPassword(password).map((r) => [r.id, r.met]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- the five rules, each judged on its own
check("the rules are uppercase, lowercase, number, special character and length, in that order", same(PASSWORD_RULES.map((r) => r.id), ["uppercase", "lowercase", "number", "special", "length"]));
check("an empty password meets none of them", same(state(""), { uppercase: false, lowercase: false, number: false, special: false, length: false }));
check("one capital letter meets only the uppercase rule", same(state("A"), { uppercase: true, lowercase: false, number: false, special: false, length: false }));
check("one lower-case letter meets only the lowercase rule", same(state("a"), { uppercase: false, lowercase: true, number: false, special: false, length: false }));
check("one digit meets only the number rule", same(state("7"), { uppercase: false, lowercase: false, number: true, special: false, length: false }));
check("one symbol meets only the special-character rule", same(state("#"), { uppercase: false, lowercase: false, number: false, special: true, length: false }));
check("eight lower-case letters meet the lowercase and length rules and nothing else", same(state("abcdefgh"), { uppercase: false, lowercase: true, number: false, special: false, length: true }));
check("seven characters are one short", state("Aa1!aaa").length === false && state("Aa1!aaa").uppercase && state("Aa1!aaa").special);
check("eight characters of all four kinds meet every rule", passwordMeetsPolicy("Aa1!aaaa") && checkPassword("Aa1!aaaa").every((r) => r.met));
check("a space or an accented letter counts as a special character, as on the server", state("Pass word").special === true && state("é").special === true);
check("an underscore counts as a special character", state("_").special === true);
check("missing any one kind fails the policy", !passwordMeetsPolicy("aa1!aaaa") && !passwordMeetsPolicy("AA1!AAAA") && !passwordMeetsPolicy("Aaa!aaaa") && !passwordMeetsPolicy("Aa1aaaaa") && !passwordMeetsPolicy("Aa1!aaa"));
check("anything that is not text is an empty password", [undefined, null, 12345678, {}, []].every((v) => !passwordMeetsPolicy(v) && checkPassword(v).every((r) => !r.met)));
check("every rule has text to show", PASSWORD_RULES.every((r) => typeof r.label === "string" && r.label.length > 5));

// ---- the confirmation field
check("two empty fields show no state at all", confirmStatus("", "") === null);
check("an empty confirmation shows no state, whatever the new password is", confirmStatus("Aa1!aaaa", "") === null);
check("a different confirmation is a mismatch", confirmStatus("Aa1!aaaa", "Aa1!aaab") === "mismatch");
check("a confirmation typed before the password is a mismatch", confirmStatus("", "x") === "mismatch");
check("an identical confirmation is a match", confirmStatus("Aa1!aaaa", "Aa1!aaaa") === "match");
check("case matters", confirmStatus("Aa1!aaaa", "aa1!aaaa") === "mismatch");
check("the messages read as specified", MATCH_MESSAGE === "Passwords match." && MISMATCH_MESSAGE === "Passwords do not match.");

// ---- when the button is enabled
const ok = { email: "a@b.c", temporaryPassword: "Tmp#1abc", newPassword: "Aa1!aaaa", confirmPassword: "Aa1!aaaa" };
check("everything filled, every rule met and both fields equal: enabled", canSubmitPasswordChange(ok));
for (const key of Object.keys(ok)) check(`${key} missing: disabled`, !canSubmitPasswordChange({ ...ok, [key]: "" }));
check("a new password that breaks a rule: disabled (even when the confirmation matches it)", !canSubmitPasswordChange({ ...ok, newPassword: "aa1!aaaa", confirmPassword: "aa1!aaaa" }));
check("fields that differ: disabled", !canSubmitPasswordChange({ ...ok, confirmPassword: "Aa1!aaab" }));

// ---- the words the page uses
check("the welcome message is the specified text", WELCOME_MESSAGE === "Welcome to CodeArena! Please create your personal password before continuing.");
check("the success message is the specified text", SUCCESS_MESSAGE === "Password changed successfully. Welcome to CodeArena!");
check("a temporary password gets the welcome message and the 'Temporary Password' label", changeIntro("TEMPORARY_PASSWORD") === WELCOME_MESSAGE && currentPasswordLabel("TEMPORARY_PASSWORD") === "Temporary Password");
check("an expired password gets its own message and the 'Current Password' label", changeIntro("PASSWORD_EXPIRED") === EXPIRED_MESSAGE && currentPasswordLabel("PASSWORD_EXPIRED") === "Current Password");
check("an unknown or missing reason is treated as a temporary password", normalizeReason(undefined) === "TEMPORARY_PASSWORD" && normalizeReason("SOMETHING") === "TEMPORARY_PASSWORD" && normalizeReason("PASSWORD_EXPIRED") === "PASSWORD_EXPIRED");

// ---- failures, in words a student can act on
const http = (status, error) => ({ response: { status, data: error === undefined ? {} : { error } } });
check("no answer at all (network, DNS, timeout) is 'network'", describeChangeFailure({}).kind === "network" && describeChangeFailure(undefined).kind === "network" && describeChangeFailure(new Error("x")).kind === "network");
check("a 401 means the temporary password was not accepted, and says what to do if it was already replaced", describeChangeFailure(http(401, "Invalid email or password.")).kind === "credentials" && /already created your personal password/.test(describeChangeFailure(http(401)).message));
check("a 400 shows the server's own text (policy, reuse, mismatch)", describeChangeFailure(http(400, "Password must contain at least one number")).message === "Password must contain at least one number");
check("a 400 without text still says something useful", describeChangeFailure(http(400)).message.length > 20);
check("a 429 is 'limited' and keeps the server's text", describeChangeFailure(http(429, "Too many login attempts. Please try again later.")).kind === "limited");
check("a 403 is 'refused' and keeps the server's text", describeChangeFailure(http(403, "This account has been deactivated. Contact your administrator.")).message.includes("deactivated"));
check("a 500 is 'server': the outcome is unknown", describeChangeFailure(http(500, "Failed to change password")).kind === "server" && !describeChangeFailure(http(500, "Failed to change password")).message.includes("Failed to change password"));
check("no failure message ever contains a password-like value or an internal term", ["network", "credentials", "limited", "server"].every((k) => !/password:|stack|prisma|sql/i.test(describeChangeFailure(k === "network" ? {} : http(k === "credentials" ? 401 : k === "limited" ? 429 : 500)).message)));
check("sign-in: no answer is the 'temporarily unavailable' message, not a wrong-password message", /temporarily unavailable/.test(describeLoginFailure({})) && /temporarily unavailable/.test(describeLoginFailure(undefined)));
check("sign-in: the server's own text is shown, with the long-standing fallback", describeLoginFailure(http(401, "Invalid email or password.")) === "Invalid email or password." && describeLoginFailure(http(500)) === "Login failed");

// ---- what the sign-in page must contain so a browser's password manager understands the form (source checks; the browser run is in frontend/e2e/tests/firstLogin.spec.js)
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "pages", "Login.jsx"), "utf8");
const count = (needle) => source.split(needle).length - 1;
check("the page is ONE form (the second step adds fields to it instead of replacing it)", count("<form") === 1 && count("</form>") === 1);
check('the e-mail field is type="email", name="username", autoComplete="username"', /id="login-email"[\s\S]*?name="username"[\s\S]*?type="email"[\s\S]*?autoComplete="username"/.test(source));
check('the sign-in / temporary password field is autoComplete="current-password"', /id="login-password"[\s\S]*?autoComplete="current-password"/.test(source));
check('both new-password fields are autoComplete="new-password"', count('autoComplete="new-password"') === 2);
check("no field is marked autoComplete off or given a made-up value", !/autoComplete="off"/.test(source) && count("autoComplete=") === 4);
check("the page never writes anything itself to localStorage, sessionStorage, cookies or the console (the session is stored by AuthContext only)", !/localStorage|sessionStorage|document\.cookie|console\./.test(source));
check("the new password is never put in the address (no navigate or link built from it)", !/navigate\([^)]*[nN]ewPassword|to=\{[^}]*[nN]ewPassword/.test(source));
check('the submit button says "Change Password & Login" on the second step', source.includes("Change Password & Login"));
check("show / hide is a checkbox, so the submit button stays the first <button> of the form (the existing browser tests click `form button`)", count('type="checkbox"') === 1 && source.indexOf("<button") === source.indexOf('<button className="btn btn-primary"'));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("first-login regression: all passed");
