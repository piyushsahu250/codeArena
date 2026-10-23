// The sign-in page shows the password rules to a student while they type (frontend/src/utils/passwordPolicy.js); the server enforces them (validatePasswordComplexity in
// src/utils/password.js). This test loads the page's own rules file and holds the two to the same verdict, rule by rule, for a matrix of passwords, so a change to one that is
// not made to the other fails here instead of reaching students as a form that says "all good" and a server that says no (or the reverse).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { validatePasswordComplexity, generateTempPassword } = require("../src/utils/password");

const policyFile = path.join(__dirname, "..", "..", "frontend", "src", "utils", "passwordPolicy.js");
const loadPolicy = () => import(pathToFileURL(policyFile).href);

// The server reports the FIRST rule a password breaks, in this order; each phrase identifies the page's rule that has to be unmet for that to be so.
const SERVER_ORDER = [
  ["at least 8 characters", "length"],
  ["uppercase letter", "uppercase"],
  ["lowercase letter", "lowercase"],
  ["one number", "number"],
  ["special character", "special"],
];
const ruleNamedBy = (message) => (SERVER_ORDER.find(([phrase]) => message.includes(phrase)) || [])[1];

const MATRIX = [
  "", " ", "\t", "a", "Aa1!", "Aa1!Aa1", "Aa1!Aa1!", "aA1!aA1", "aA1!aA1!",
  "alllowercase1!", "ALLUPPERCASE1!", "NoDigitsHere!", "NoSpecial123", "12345678", "!!!!!!!!", "abcdefgh", "ABCDEFGH",
  "Valid1!Pass", "Valid1 Pass", "Pass word1!", "Valid1_Pass", "Valid1-Pass", "Valid1.Pass",
  "Éclair1aaaa", "éCLAIR1AAAA", "Éclair1!aaaa", "パスワード1Aa", "パスワードabc1A", "Ωmega1abcd", "Zz9́aaaaa1",
  "A".repeat(200) + "a1!", "a".repeat(8), "A1!".repeat(40),
];

test("the page's rules are in the order a student is asked to meet them, each with its own id and text", async () => {
  const policy = await loadPolicy();
  assert.deepEqual(policy.PASSWORD_RULES.map((r) => r.id), ["uppercase", "lowercase", "number", "special", "length"]);
  for (const rule of policy.PASSWORD_RULES) assert.ok(rule.label && typeof rule.test === "function");
  assert.equal(policy.PASSWORD_MIN_LENGTH, 8);
});

test("the page and the server reach the same verdict for every password in the matrix", async () => {
  const policy = await loadPolicy();
  for (const password of MATRIX) {
    const serverMessage = validatePasswordComplexity(password);
    assert.equal(policy.passwordMeetsPolicy(password), serverMessage === null, `verdict differs for ${JSON.stringify(password.slice(0, 24))}: server says ${JSON.stringify(serverMessage)}`);
  }
});

test("when the server refuses a password, the rule it names is one the page shows as unmet", async () => {
  const policy = await loadPolicy();
  for (const password of MATRIX) {
    const serverMessage = validatePasswordComplexity(password);
    if (serverMessage === null) continue;
    const named = ruleNamedBy(serverMessage);
    assert.ok(named, `unrecognised server message ${JSON.stringify(serverMessage)}`);
    const shown = policy.checkPassword(password).find((r) => r.id === named);
    assert.equal(shown.met, false, `the server named "${named}" for ${JSON.stringify(password.slice(0, 24))} but the page shows it as met`);
  }
});

test("each rule is judged on its own", async () => {
  const policy = await loadPolicy();
  const state = (password) => Object.fromEntries(policy.checkPassword(password).map((r) => [r.id, r.met]));
  assert.deepEqual(state(""), { uppercase: false, lowercase: false, number: false, special: false, length: false });
  assert.deepEqual(state("A"), { uppercase: true, lowercase: false, number: false, special: false, length: false });
  assert.deepEqual(state("aA"), { uppercase: true, lowercase: true, number: false, special: false, length: false });
  assert.deepEqual(state("aA1"), { uppercase: true, lowercase: true, number: true, special: false, length: false });
  assert.deepEqual(state("aA1!"), { uppercase: true, lowercase: true, number: true, special: true, length: false });
  assert.deepEqual(state("aA1!aaaa"), { uppercase: true, lowercase: true, number: true, special: true, length: true });
  assert.deepEqual(state("abcdefghij"), { uppercase: false, lowercase: true, number: false, special: false, length: true });
});

test("anything that is not text counts as an empty password", async () => {
  const policy = await loadPolicy();
  for (const value of [undefined, null, 12345678, {}, [], true]) {
    assert.equal(policy.passwordMeetsPolicy(value), false);
    assert.ok(policy.checkPassword(value).every((r) => r.met === false));
  }
});

test("every temporary password the platform generates satisfies the page's rules as well as the server's", async () => {
  const policy = await loadPolicy();
  for (let i = 0; i < 200; i++) {
    const generated = generateTempPassword();
    assert.equal(validatePasswordComplexity(generated), null);
    assert.equal(policy.passwordMeetsPolicy(generated), true, generated.replace(/./g, "*"));
  }
});

test("the rules file is plain: no imports, so the Node test and the browser load the same code", () => {
  const source = fs.readFileSync(policyFile, "utf8");
  assert.ok(!/^\s*import\s/m.test(source), "passwordPolicy.js must not import anything");
});
