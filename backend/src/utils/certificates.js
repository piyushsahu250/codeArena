const prisma = require("../prisma");
const { notifyCertificateIssued } = require("./notifications");

function slugCode(str, maxLen) {
  return String(str || "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, maxLen);
}

// Builds a globally-unique certificate ID in the documented format:
// CA-<year>-<institute code>-<program code>-<6-digit sequence>. The sequence is randomized
// rather than an incrementing counter, so concurrent issuances never contend on a shared lock —
// a collision just retries with a fresh random sequence (astronomically unlikely twice in a row).
async function generateCertificateCode({ instituteCode, programCode }) {
  const year = new Date().getFullYear();
  const inst = slugCode(instituteCode, 10) || "GEN";
  const prog = slugCode(programCode, 14) || "CERT";
  for (let attempt = 0; attempt < 10; attempt++) {
    const seq = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    const code = `CA-${year}-${inst}-${prog}-${seq}`;
    const existing = await prisma.certificate.findUnique({ where: { certificateCode: code } });
    if (!existing) return code;
  }
  throw new Error("Failed to generate a unique certificate code — please retry");
}

// Creates a new Certificate row. Callers own idempotency (e.g. "one LEARNING_MODULE cert per
// student per course") — this helper always inserts, it never checks for an existing row itself,
// since the right uniqueness key differs per type (unique DB constraint for LEARNING_MODULE,
// application-level findFirst for CODING_ASSESSMENT, none at all for MANUAL — a student can
// legitimately receive several distinct manual certificates).
async function issueCertificate({ type, studentId, courseId, moduleCodingTestId, readinessSubjectId, readinessLevel, title, programName, issuedByName, instituteCode, programCode }) {
  const certificateCode = await generateCertificateCode({ instituteCode, programCode });
  const certificate = await prisma.certificate.create({
    data: {
      certificateCode,
      type,
      studentId,
      courseId: courseId || null,
      moduleCodingTestId: moduleCodingTestId || null,
      readinessSubjectId: readinessSubjectId || null,
      readinessLevel: readinessLevel || null,
      title,
      programName: programName || null,
      issuedByName: issuedByName || null,
    },
  });
  // Best-effort, never blocks/fails issuance itself — same posture as every other notify call in
  // this codebase (see notifications.js's own file comment). Runs for every issuance path (manual
  // and the three auto-issue paths), not just one route, since it lives here rather than in each
  // individual caller.
  prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true, email: true } })
    .then((student) => { if (student) return notifyCertificateIssued(prisma, student, certificate); })
    .catch((err) => console.error("[issueCertificate] notification failed:", err));
  return certificate;
}

async function revokeCertificate(id, { revokedByName, reason }) {
  return prisma.certificate.update({
    where: { id },
    data: { status: "REVOKED", revokedAt: new Date(), revokedByName: revokedByName || null, revokedReason: reason || null },
  });
}

module.exports = { generateCertificateCode, issueCertificate, revokeCertificate };
