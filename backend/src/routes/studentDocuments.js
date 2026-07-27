const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { validateDocumentInput, DOCUMENT_TYPES } = require("../utils/documentValidation");

const router = express.Router();

const DOC_FIELDS = ["documentType", "label", "documentLink"];

function pickDocData(body) {
  const data = {};
  for (const key of DOC_FIELDS) if (body[key] !== undefined) data[key] = body[key];
  return data;
}

// =========================== Student-facing ===========================

router.get("/types", authenticate, (req, res) => res.json(DOCUMENT_TYPES));

router.get("/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const documents = await prisma.studentDocument.findMany({ where: { studentId: req.user.id }, orderBy: { createdAt: "desc" } });
    res.json(documents);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load documents" });
  }
});

router.post("/", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const error = validateDocumentInput(req.body);
    if (error) return res.status(400).json({ error });
    const data = pickDocData(req.body);
    const doc = await prisma.studentDocument.create({ data: { studentId: req.user.id, ...data } });
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save document" });
  }
});

// Editing any field of a REJECTED/REUPLOAD_REQUIRED document resets it to PENDING — re-verification
// on edit, same rule as PlacementOffer. A VERIFIED document is locked: once staff/clerk/admin has
// confirmed it, the student can no longer edit or delete it (see DELETE below) — prevents a
// verified record from silently drifting after the fact.
router.patch("/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const existing = await prisma.studentDocument.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.studentId !== req.user.id) return res.status(404).json({ error: "Document not found" });
    if (existing.verificationStatus === "VERIFIED") {
      return res.status(403).json({ error: "This document has been verified and can no longer be edited" });
    }

    const merged = { ...existing, ...req.body };
    const error = validateDocumentInput(merged);
    if (error) return res.status(400).json({ error });

    const data = pickDocData(req.body);
    if (existing.verificationStatus !== "PENDING") {
      data.verificationStatus = "PENDING";
      data.verifiedByUserId = null;
      data.verifiedByName = null;
      data.verifiedAt = null;
      data.rejectionReason = null;
    }
    const doc = await prisma.studentDocument.update({ where: { id: req.params.id }, data });
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update document" });
  }
});

router.delete("/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const existing = await prisma.studentDocument.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.studentId !== req.user.id) return res.status(404).json({ error: "Document not found" });
    if (existing.verificationStatus === "VERIFIED") {
      return res.status(403).json({ error: "This document has been verified and can no longer be deleted" });
    }
    await prisma.studentDocument.delete({ where: { id: req.params.id } });
    res.json({ message: "Document deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// =========================== Staff/Clerk/Admin ===========================

async function authorizeStudentAccess(req, res, studentId) {
  const student = await prisma.user.findUnique({ where: { id: studentId } });
  if (!student || student.role !== "STUDENT") {
    res.status(404).json({ error: "Student not found" });
    return null;
  }
  if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
    res.status(403).json({ error: "You can only access students under your own institute" });
    return null;
  }
  return student;
}

router.get("/student/:studentId", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const student = await authorizeStudentAccess(req, res, req.params.studentId);
    if (!student) return;
    const documents = await prisma.studentDocument.findMany({ where: { studentId: req.params.studentId }, orderBy: { createdAt: "desc" } });
    res.json(documents);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load student documents" });
  }
});

router.patch("/:id/verify", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!["VERIFIED", "REJECTED", "REUPLOAD_REQUIRED"].includes(status)) {
      return res.status(400).json({ error: "status must be VERIFIED, REJECTED, or REUPLOAD_REQUIRED" });
    }

    const doc = await prisma.studentDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const student = await authorizeStudentAccess(req, res, doc.studentId);
    if (!student) return;

    const updated = await prisma.studentDocument.update({
      where: { id: req.params.id },
      data: {
        verificationStatus: status,
        verifiedByUserId: req.user.id,
        verifiedByName: req.user.name,
        verifiedAt: new Date(),
        rejectionReason: status !== "VERIFIED" ? (reason || null) : null,
      },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.DOCUMENT_VERIFIED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: doc.studentId, instituteId: student.instituteId,
      details: { documentId: doc.id, documentType: doc.documentType, status },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to verify document" });
  }
});

// ADMIN/STAFF/CLERK: remove a document regardless of verification status — the student-side DELETE
// above is deliberately locked once a document is VERIFIED, but staff overseeing placement records
// still need a way to remove one (e.g. it was verified against the wrong file, or is no longer
// needed). Separate path from the student route above so this never collides with (or accidentally
// widens) that STUDENT-only handler.
router.delete("/:id/admin", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const doc = await prisma.studentDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const student = await authorizeStudentAccess(req, res, doc.studentId);
    if (!student) return;

    await prisma.studentDocument.delete({ where: { id: req.params.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.DOCUMENT_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: doc.studentId, instituteId: student.instituteId,
      details: { documentId: doc.id, documentType: doc.documentType, previousStatus: doc.verificationStatus },
    });
    res.json({ message: "Document deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

module.exports = router;
