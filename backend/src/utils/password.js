const crypto = require("crypto");
const bcrypt = require("bcryptjs");

// Ambiguous characters (I/l/1, O/0) excluded — these passwords are read off a screen and
// re-typed by hand on first login.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "@#$%";

function randomChar(charset) {
  return charset[crypto.randomInt(charset.length)];
}

// Generates a unique, cryptographically random temporary password for a new or reset account.
// Replaces the old shared patterns (`${instituteName}@123`, and the fixed literal "Sanjivani@1")
// that gave every account at an institute, or every reset account platform-wide, the exact same
// password — predictable from public info in the first case, and identical-across-many-accounts
// in both, which is exactly the "reused/breached password" pattern browser password managers
// flag. mustChangePassword still forces rotation on first login regardless; this just removes
// the exploitable window before that happens.
function generateTempPassword() {
  const chars = [
    randomChar(UPPER), randomChar(UPPER),
    randomChar(LOWER), randomChar(LOWER), randomChar(LOWER),
    randomChar(DIGITS), randomChar(DIGITS),
    randomChar(SYMBOLS),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const PASSWORD_MIN_LENGTH = 8;

// Enforced on every USER-CHOSEN password (self-service change, forgot-password reset) — not on
// system-generated temp passwords from generateTempPassword() above, which already satisfy all
// of this by construction. Returns null when valid, or a user-facing reason string.
function validatePasswordComplexity(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must contain at least one special character";
  return null;
}

// Rejects reuse of any of the user's last `historyDepth` passwords (institute-configurable via
// Institute.passwordHistoryDepth). bcrypt.compare is run sequentially, not in parallel — this
// only runs on an explicit password-change action, never on the hot login path, so the extra
// latency doesn't matter and sequential keeps memory/CPU bounded under concurrent changes.
async function isPasswordReused(prisma, userId, candidatePassword, historyDepth) {
  if (!historyDepth || historyDepth <= 0) return false;
  const recent = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: historyDepth,
  });
  for (const entry of recent) {
    if (await bcrypt.compare(candidatePassword, entry.passwordHash)) return true;
  }
  return false;
}

// Call after successfully changing a user's password (any path) to both stamp
// passwordChangedAt (drives expiry enforcement) and append to PasswordHistory. Trims history
// beyond 2x the given depth so a lowered depth doesn't need a separate cleanup pass, and a
// raised depth doesn't lose more history than necessary.
//
// Every call site wraps this together with the actual passwordHash write in one
// `prisma.$transaction(async (tx) => { ...; await recordPasswordChange(tx, ...); })` — passing
// `tx` here — so this function deliberately does NOT open its own `$transaction` (Prisma doesn't
// support nested transactions; doing so would throw). Atomicity comes entirely from the caller's
// transaction context, which is why the client is always named `prisma` here even though it's
// often actually a `tx`.
async function recordPasswordChange(prisma, userId, passwordHash, historyDepth) {
  await prisma.user.update({ where: { id: userId }, data: { passwordChangedAt: new Date() } });
  await prisma.passwordHistory.create({ data: { userId, passwordHash } });
  const keep = Math.max((historyDepth || 3) * 2, 6);
  const all = await prisma.passwordHistory.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const staleIds = all.slice(keep).map((r) => r.id);
  if (staleIds.length > 0) await prisma.passwordHistory.deleteMany({ where: { id: { in: staleIds } } });
}

// True if the institute's configured password-expiry window has elapsed since the user's last
// password change (falling back to account creation date for accounts that predate this field).
function isPasswordExpired(user, expiryDays) {
  if (!expiryDays || expiryDays <= 0) return false;
  const since = user.passwordChangedAt || user.createdAt;
  const ageMs = Date.now() - new Date(since).getTime();
  return ageMs > expiryDays * 24 * 60 * 60 * 1000;
}

module.exports = {
  generateTempPassword,
  validatePasswordComplexity,
  isPasswordReused,
  recordPasswordChange,
  isPasswordExpired,
};
