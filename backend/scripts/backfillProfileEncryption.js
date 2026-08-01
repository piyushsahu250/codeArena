/**
 * One-time (idempotent) backfill that encrypts StudentProfile's sensitive fields (personalEmail,
 * address, state, district, pincode, fatherName/Contact, motherName/Contact) for every row written
 * before field-level encryption existed. Safe to run on every deploy: encryptProfileData/
 * decryptProfile both recognize the "enc1:" prefix, so a row already encrypted is skipped (its
 * decrypted value round-trips unchanged, so re-encrypting it would just be wasted work — this
 * script explicitly filters those out rather than relying on that idempotency alone).
 *
 * Requires PII_ENCRYPTION_KEY to be set — see backend/src/utils/piiEncryption.js. If it's missing,
 * this exits non-zero but (like every other script in this CMD chain) doesn't block the rest of
 * the deploy; existing rows just stay unencrypted until the key is set and this re-runs.
 */
const prisma = require("../src/prisma");
const { encryptProfileData, ENCRYPTED_PROFILE_FIELDS } = require("../src/utils/piiEncryption");

function isAlreadyEncrypted(value) {
  return typeof value === "string" && value.startsWith("enc1:");
}

async function backfillProfileEncryption() {
  const profiles = await prisma.studentProfile.findMany({
    select: { studentId: true, ...Object.fromEntries(ENCRYPTED_PROFILE_FIELDS.map((f) => [f, true])) },
  });

  let updatedCount = 0;
  for (const profile of profiles) {
    const toEncrypt = {};
    for (const field of ENCRYPTED_PROFILE_FIELDS) {
      const value = profile[field];
      if (value !== null && value !== undefined && !isAlreadyEncrypted(value)) toEncrypt[field] = value;
    }
    if (Object.keys(toEncrypt).length === 0) continue;

    await prisma.studentProfile.update({
      where: { studentId: profile.studentId },
      data: encryptProfileData(toEncrypt),
    });
    updatedCount++;
  }

  return { totalProfiles: profiles.length, updatedCount };
}

async function main() {
  const { totalProfiles, updatedCount } = await backfillProfileEncryption();
  console.log(`[backfillProfileEncryption] Done. Encrypted ${updatedCount} of ${totalProfiles} StudentProfile row(s) this run.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillProfileEncryption] failed:", err.message);
  process.exit(1);
});
