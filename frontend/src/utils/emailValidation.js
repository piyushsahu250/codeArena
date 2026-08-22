// Frontend mirror of backend/src/utils/emailValidation.js -- deliberately kept as an identical,
// independent copy rather than a shared package, since the frontend build has no access to
// backend/ source at build time. Any change here should be made to both files together. This is
// UX-layer validation only (fast feedback before a network round-trip); the backend independently
// re-validates every one of these entry points, since a client-side check alone can always be
// bypassed by calling the API directly.
export function isValidEmail(raw) {
  if (typeof raw !== "string") return false;
  const email = raw.trim();
  if (!email || email.length > 254) return false;
  if (/\s/.test(email)) return false;

  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) return false;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  if (local.length === 0 || local.length > 64) return false;
  if (!/^[A-Za-z0-9._%+-]+$/.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;

  if (domain.length === 0) return false;
  if (domain.includes("..")) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!label) return false;
    if (!/^[A-Za-z0-9-]{1,63}$/.test(label)) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]{2,24}$/.test(tld)) return false;

  return true;
}

export function normalizeEmail(raw) {
  return typeof raw === "string" ? raw.trim().toLowerCase() : raw;
}
