// The password rules, as the sign-in page shows them while a student types. They mirror backend/src/utils/password.js (validatePasswordComplexity), which is where they are
// ENFORCED: the server repeats every check, and nothing here is a security control. This file exists so a student sees each rule turn from unmet to met as they type.
// backend/test/passwordPolicyConsistency.test.js loads this very file and compares its verdict with the server's for a matrix of passwords, so the two cannot drift apart
// unnoticed. Keep this module free of imports: that test loads it directly with Node.
export const PASSWORD_MIN_LENGTH = 8;

// In the order a student is asked to satisfy them. `special` is anything that is not a letter A-Z/a-z or a digit, exactly as the server counts it.
export const PASSWORD_RULES = [
  { id: "uppercase", label: "At least one uppercase letter (A-Z)", test: (password) => /[A-Z]/.test(password) },
  { id: "lowercase", label: "At least one lowercase letter (a-z)", test: (password) => /[a-z]/.test(password) },
  { id: "number", label: "At least one number (0-9)", test: (password) => /[0-9]/.test(password) },
  { id: "special", label: "At least one special character (for example ! @ # $ %)", test: (password) => /[^A-Za-z0-9]/.test(password) },
  { id: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (password) => password.length >= PASSWORD_MIN_LENGTH },
];

// One entry per rule, each judged on its own: [{ id, label, met }]. Anything that is not text counts as an empty password.
export function checkPassword(password) {
  const value = typeof password === "string" ? password : "";
  return PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.test(value) }));
}

export const passwordMeetsPolicy = (password) => checkPassword(password).every((rule) => rule.met);
