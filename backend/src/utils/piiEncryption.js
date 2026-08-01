const crypto = require("crypto");

// Field-level encryption for StudentProfile's most sensitive columns (home address, parent
// contact details, personal email) — these are stored in Postgres as plain text everywhere else
// in this schema, but unlike a name or roll number, this specific set is enough on its own to
// physically locate a minor/young-adult student or contact their family, so it gets its own
// at-rest protection independent of the database's own disk-level encryption. `dob` (a DateTime
// column) is deliberately left out — encrypting it would mean changing its column type and
// migrating existing rows, and age alone (without the fields below) is materially less sensitive.
const ENC_PREFIX = "enc1:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function loadKey() {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) throw new Error("PII_ENCRYPTION_KEY is not set — cannot encrypt/decrypt student profile PII");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY must decode to exactly 32 bytes (a 64-char hex string, or base64 of 32 bytes)");
  }
  return key;
}

function encryptValue(plaintext) {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

// Tolerant by design: a value with no enc1: prefix is treated as not-yet-migrated plaintext and
// returned unchanged (safe during the backfill window); a value that fails to decrypt (wrong
// key, corrupted data) logs and returns null rather than throwing, so one bad field can't 500 an
// entire profile view.
function decryptValue(stored) {
  if (typeof stored !== "string" || !stored.startsWith(ENC_PREFIX)) return stored;
  try {
    const key = loadKey();
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = buf.subarray(IV_LENGTH + 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (err) {
    console.error("[piiEncryption] Failed to decrypt a StudentProfile field:", err.message);
    return null;
  }
}

const ENCRYPTED_PROFILE_FIELDS = [
  "personalEmail", "address", "state", "district", "pincode",
  "fatherName", "fatherContact", "motherName", "motherContact",
];

// Applies to a partial StudentProfile write payload (create/update data) — only touches keys
// that are actually present, so callers can keep passing sparse objects exactly as before.
function encryptProfileData(data) {
  if (!data) return data;
  const out = { ...data };
  for (const field of ENCRYPTED_PROFILE_FIELDS) {
    if (out[field] !== undefined && out[field] !== null) out[field] = encryptValue(out[field]);
  }
  return out;
}

// Applies to a full StudentProfile row read back from Prisma.
function decryptProfile(profile) {
  if (!profile) return profile;
  const out = { ...profile };
  for (const field of ENCRYPTED_PROFILE_FIELDS) {
    if (out[field] !== undefined && out[field] !== null) out[field] = decryptValue(out[field]);
  }
  return out;
}

module.exports = { encryptValue, decryptValue, encryptProfileData, decryptProfile, ENCRYPTED_PROFILE_FIELDS };
