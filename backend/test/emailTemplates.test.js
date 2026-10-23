// The credentials e-mails are sent only when an administrator issues or resets a password, which is exactly when the account must choose a personal password at its
// first sign-in; the wording has to match that workflow (docs/FIRST_LOGIN_PASSWORD_CHANGE.md).
const test = require("node:test");
const assert = require("node:assert/strict");
const { accountCredentialsTemplate, credentialsResendTemplate } = require("../src/utils/emailTemplates");

const NEW = "For your account security, please create your personal password the first time you log in.";
const OLD = "Change your password immediately after logging in";

test("both credentials e-mails tell the person to create their personal password the first time they log in", () => {
  for (const html of [
    accountCredentialsTemplate({ name: "Asha", email: "a@x.test", password: "Tmp#1abc", institute: "I", departmentSection: "CSE A", batchYear: "2026", registrationNumber: "R1" }),
    credentialsResendTemplate({ name: "Asha", email: "a@x.test", password: "Tmp#1abc" }),
  ]) {
    assert.ok(html.includes(NEW), "the new sentence is present");
    assert.ok(!html.includes(OLD), "the old sentence is gone");
    assert.ok(html.includes("Tmp#1abc") || html.includes("Tmp&#35;1abc"), "the temporary password is still in the e-mail");
  }
});
