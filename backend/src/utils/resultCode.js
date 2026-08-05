const prisma = require("../prisma");

function slugCode(str, maxLen) {
  return String(str || "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, maxLen);
}

// Builds a globally-unique marksheet verification ID: MS-<year>-<institute code>-<6-digit
// sequence>. Mirrors utils/certificates.js's generateCertificateCode() exactly — randomized
// sequence (not an incrementing counter) so concurrent generations never contend on a shared
// lock, a collision just retries with a fresh random sequence.
async function generateMarksheetCode({ instituteCode }) {
  const year = new Date().getFullYear();
  const inst = slugCode(instituteCode, 10) || "GEN";
  for (let attempt = 0; attempt < 10; attempt++) {
    const seq = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    const code = `MS-${year}-${inst}-${seq}`;
    const existing = await prisma.resultEntry.findUnique({ where: { verificationCode: code } });
    if (!existing) return code;
  }
  throw new Error("Failed to generate a unique marksheet verification code — please retry");
}

module.exports = { generateMarksheetCode };
