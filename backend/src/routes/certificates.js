const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { issueCertificate, revokeCertificate } = require("../utils/certificates");
const { generateCertificatePdf } = require("../utils/certificatePdf");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena.site";

// Unified system for the Certificate model — LEARNING_MODULE, CODING_ASSESSMENT, and MANUAL
// (workshops/FDP/bootcamps/placement-prep/institute certifications, which have no underlying
// program/enrollment model on this platform, so an admin or staff member fills in the program
// name by hand at issuance). AI Mock Interview certificates deliberately stay on the separate,
// already-working InterviewCertificate model/routes (backend/src/routes/interview.js) — GET /me
// below merges both into one list for the student-facing "My Certificates" page rather than
// migrating working interview-certificate data into this table.

function serializeCert(cert, extra = {}) {
  return {
    id: cert.id,
    certificateCode: cert.certificateCode,
    type: cert.type,
    title: cert.title,
    programName: cert.programName,
    status: cert.status,
    issuedAt: cert.issuedAt,
    revokedAt: cert.revokedAt,
    revokedReason: cert.revokedReason,
    ...extra,
  };
}

// STUDENT: every certificate this student holds, across both certificate systems, newest first.
router.get("/me", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("certificates"), async (req, res) => {
  try {
    const [certs, interviewCert] = await Promise.all([
      prisma.certificate.findMany({ where: { studentId: req.user.id }, orderBy: { issuedAt: "desc" } }),
      prisma.interviewCertificate.findFirst({ where: { studentId: req.user.id } }),
    ]);

    const unified = certs.map((c) => serializeCert(c, { downloadUrl: `/certificates/${c.id}/download`, source: "certificate" }));
    if (interviewCert) {
      unified.push({
        id: interviewCert.id,
        certificateCode: interviewCert.certificateCode,
        type: "AI_INTERVIEW",
        title: "AI Mock Interview — Interview Ready",
        programName: null,
        status: "VALID", // InterviewCertificate has no revocation field — always valid once issued
        issuedAt: interviewCert.issuedAt,
        revokedAt: null,
        revokedReason: null,
        downloadUrl: `/interview/certificate/download`,
        source: "interview",
      });
    }
    unified.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
    res.json(unified);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load certificates" });
  }
});

// STUDENT: download one of their own Certificate-model certificates as a PDF. (Interview
// certificates keep using their own existing download route.)
router.get("/:id/download", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("certificates"), async (req, res) => {
  try {
    const cert = await prisma.certificate.findUnique({
      where: { id: req.params.id },
      include: { student: { include: { institute: true } } },
    });
    if (!cert || cert.studentId !== req.user.id) return res.status(404).json({ error: "Certificate not found" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${cert.certificateCode}.pdf"`);
    await generateCertificatePdf({
      studentName: cert.student.name,
      title: cert.title,
      programName: cert.programName,
      certificateCode: cert.certificateCode,
      issuedAt: cert.issuedAt,
      status: cert.status,
      verifyUrl: `${FRONTEND_URL}/certificate/verify/${cert.certificateCode}`,
      instituteName: cert.student.institute?.name,
      instituteLogoUrl: cert.student.institute?.logoUrl,
    }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate certificate" });
  }
});

// PUBLIC (no auth) — reached by scanning the certificate's QR code or visiting its verify link.
// Deliberately exposes only what the spec asks for: status, ID, student name, institute, program
// name, completion date, issuer, and this request's timestamp — never anything else about the
// student's account.
router.get("/verify/:code", async (req, res) => {
  try {
    const cert = await prisma.certificate.findUnique({
      where: { certificateCode: req.params.code },
      include: { student: { include: { institute: true } } },
    });
    if (!cert) return res.status(404).json({ valid: false, error: "No certificate found with this ID" });

    res.json({
      valid: true,
      status: cert.status,
      revoked: cert.status === "REVOKED",
      certificateCode: cert.certificateCode,
      studentName: cert.student.name,
      institute: cert.student.institute?.name || null,
      programName: cert.programName || cert.title,
      completionDate: cert.issuedAt,
      issuedBy: cert.issuedByName || "CodeArena",
      verificationTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ valid: false, error: "Verification failed" });
  }
});

// ADMIN/STAFF: manually issue a MANUAL-type certificate for activities with no underlying data
// model on this platform (workshops, FDP, bootcamps, placement-prep programs, institute
// certifications). Staff may only issue to students within their own institute.
router.post("/manual", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const { studentId, programName, title } = req.body;
    if (!studentId || !programName) return res.status(400).json({ error: "studentId and programName are required" });

    const student = await prisma.user.findUnique({ where: { id: studentId }, include: { institute: true } });
    if (!student || student.role !== "STUDENT") return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only issue certificates to students under your own institute" });
    }

    const cert = await issueCertificate({
      type: "MANUAL",
      studentId: student.id,
      title: title || programName,
      programName,
      issuedByName: req.user.name,
      instituteCode: student.institute?.code,
      programCode: programName,
    });

    await logAudit({ req, action: AUDIT_ACTIONS.CERTIFICATE_ISSUED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, studentId: student.id, instituteId: student.instituteId, details: { certificateId: cert.id, type: "MANUAL", programName } });
    res.status(201).json(serializeCert(cert));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to issue certificate" });
  }
});

// ADMIN: revoke any Certificate-model certificate. Revocation is a status flip, never a delete —
// the certificate stays verifiable (showing "revoked") rather than the QR code just breaking.
// Institute-scoped the same way /manual and /admin are — an institute-scoped ADMIN may only
// revoke certificates belonging to their own institute's students.
router.post("/:id/revoke", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.certificate.findUnique({ where: { id: req.params.id }, include: { student: { select: { instituteId: true } } } });
    if (!existing) return res.status(404).json({ error: "Certificate not found" });
    if (req.requesterInstituteId && existing.student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only revoke certificates belonging to your own institute" });
    }
    if (existing.status === "REVOKED") return res.status(400).json({ error: "This certificate is already revoked" });

    const cert = await revokeCertificate(existing.id, { revokedByName: req.user.name, reason: req.body.reason });
    await logAudit({ req, action: AUDIT_ACTIONS.CERTIFICATE_REVOKED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, studentId: existing.studentId, details: { certificateId: cert.id, reason: req.body.reason || null } });
    res.json(serializeCert(cert));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to revoke certificate" });
  }
});

// ADMIN/STAFF: browse all issued certificates (institute-scoped for Staff), for a management
// view alongside the "Issue Certificate" flow. Paginated the same "cap, not archive" way as this
// platform's other operational list views.
router.get("/admin", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const where = req.requesterInstituteId ? { student: { instituteId: req.requesterInstituteId } } : {};
    if (req.query.type) where.type = req.query.type;
    const certs = await prisma.certificate.findMany({
      where,
      include: { student: { select: { name: true, email: true, rollNumber: true } } },
      orderBy: { issuedAt: "desc" },
      take: 500,
    });
    res.json(certs.map((c) => ({ ...serializeCert(c), studentName: c.student.name, studentEmail: c.student.email, rollNumber: c.student.rollNumber })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load certificates" });
  }
});

module.exports = router;
