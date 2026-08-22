// Single source of truth for "is this a plausible email address" — used at every entry point
// that creates or changes a User's email (admin create, admin edit, bulk upload, self-service
// email change, student personalEmail). Previously this exact check (EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/)
// was independently duplicated in users.js, studentProfileCompletion.js, and mailer.js, and none
// of those copies rejected structurally-broken addresses like "abc@gmail..com" (consecutive dots)
// or "abc@@gmail.com" (was actually caught by the old regex, but only by accident) — this replaces
// all of them with one deliberately stricter check, built from explicit structural rules rather
// than a single opaque regex, so every rejection reason is easy to reason about and test.
//
// This is syntax validation only — it proves the address is well-formed, not that it belongs to
// the person who typed it or that mail to it will actually arrive. See the emailVerified /
// verification-token fields on User for the layer that actually confirms ownership.
function isValidEmail(raw) {
  if (typeof raw !== "string") return false;
  const email = raw.trim();
  if (!email || email.length > 254) return false;
  if (/\s/.test(email)) return false; // no embedded whitespace anywhere (e.g. "abc @gmail.com")

  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) return false; // exactly one @, not first char

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  if (local.length === 0 || local.length > 64) return false;
  if (!/^[A-Za-z0-9._%+-]+$/.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;

  if (domain.length === 0) return false;
  if (domain.includes("..")) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false; // must have a TLD (rejects "abc@invalid", "test@gmail")
  for (const label of labels) {
    if (!label) return false;
    if (!/^[A-Za-z0-9-]{1,63}$/.test(label)) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]{2,24}$/.test(tld)) return false;

  return true;
}

// Trims and lowercases the whole address. Every real mail provider (Gmail, Outlook, Yahoo, ...)
// treats the address as case-insensitive in practice, and this codebase's own duplicate-email
// checks already compare case-insensitively (e.g. bulk-upload's `mode: "insensitive"` lookup) —
// storing a consistent lowercase form everywhere just makes that the actual stored truth instead
// of relying on comparison-time normalization. Never reject or alter anything beyond case/whitespace.
function normalizeEmail(raw) {
  return typeof raw === "string" ? raw.trim().toLowerCase() : raw;
}

module.exports = { isValidEmail, normalizeEmail };
