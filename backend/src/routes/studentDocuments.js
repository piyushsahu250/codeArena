const express = require("express");
const { Readable } = require("stream");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { validateDocumentInput, DOCUMENT_TYPES } = require("../utils/documentValidation");
const { fetchExternalUrl } = require("../utils/safeFetch");
const { notifyDocumentVerification } = require("../utils/notifications");

const router = express.Router();

// Rewrites a Google Drive/Dropbox "view" share link into its direct-download form so the browser
// saves the file straight to Downloads instead of opening the provider's viewer page. Any other
// host is fetched as-is.
function directDownloadUrl(link) {
  const driveFileMatch = link.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveFileMatch) return `https://drive.google.com/uc?export=download&id=${driveFileMatch[1]}`;
  if (/drive\.google\.com\/open/.test(link)) {
    try {
      const id = new URL(link).searchParams.get("id");
      if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
    } catch {}
  }
  if (/dropbox\.com/.test(link)) {
    if (/[?&]dl=0\b/.test(link)) return link.replace(/([?&])dl=0\b/, "$1dl=1");
    if (/[?&]dl=1\b/.test(link)) return link;
    return link + (link.includes("?") ? "&dl=1" : "?dl=1");
  }
  return link;
}

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
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true } });
    await logAudit({
      req, action: AUDIT_ACTIONS.DOCUMENT_UPLOADED, actorId: req.user.id, actorName: req.user.name, actorRole: "STUDENT",
      studentId: req.user.id, instituteId: student?.instituteId,
      details: { self: true, documentId: doc.id, documentType: doc.documentType },
    });
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
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true } });
    await logAudit({
      req, action: AUDIT_ACTIONS.DOCUMENT_UPDATED, actorId: req.user.id, actorName: req.user.name, actorRole: "STUDENT",
      studentId: req.user.id, instituteId: student?.instituteId,
      details: { self: true, documentId: doc.id, documentType: doc.documentType, fieldsChanged: Object.keys(data) },
    });
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

router.get("/student/:studentId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
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

router.patch("/:id/verify", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!["VERIFIED", "REJECTED", "REUPLOAD_REQUIRED"].includes(status)) {
      return res.status(400).json({ error: "status must be VERIFIED, REJECTED, or REUPLOAD_REQUIRED" });
    }
    if (status !== "VERIFIED" && !reason?.trim()) {
      return res.status(400).json({ error: "A remark is required when rejecting or requesting re-upload" });
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
        rejectionReason: status !== "VERIFIED" ? reason.trim() : null,
      },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.DOCUMENT_VERIFIED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: doc.studentId, instituteId: student.instituteId,
      details: {
        documentId: doc.id, documentType: doc.documentType, documentLabel: doc.label,
        studentName: student.name, registrationNumber: student.registrationNumber,
        previousStatus: doc.verificationStatus, status, reason: status !== "VERIFIED" ? reason.trim() : null,
      },
    });
    await notifyDocumentVerification(prisma, student, { document: doc, status, verifierName: req.user.name, reason: status !== "VERIFIED" ? reason.trim() : null });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to verify document" });
  }
});

// Bulk counterpart to PATCH /:id/verify above — same status/reason validation and per-document
// authorization, but skips (rather than fails the whole batch on) any document that's missing or
// belongs to a student outside the requester's institute, mirroring the skip-and-report idiom
// used elsewhere on this platform for batch operations (e.g. question bank bulk-delete).
router.post("/bulk-verify", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { documentIds, status, reason } = req.body;
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ error: "documentIds must be a non-empty array" });
    }
    if (!["VERIFIED", "REJECTED", "REUPLOAD_REQUIRED"].includes(status)) {
      return res.status(400).json({ error: "status must be VERIFIED, REJECTED, or REUPLOAD_REQUIRED" });
    }
    if (status !== "VERIFIED" && !reason?.trim()) {
      return res.status(400).json({ error: "A remark is required when rejecting or requesting re-upload" });
    }

    // Batch-load every document + student up front instead of a per-id findUnique/findUnique pair
    // inside the loop — verifying a class's worth of documents (dozens-hundreds) previously meant
    // hundreds of fully sequential round-trips (2 reads + 1 write + audit + notify, each awaited
    // one at a time).
    const uniqueDocumentIds = [...new Set(documentIds)];
    const docs = await prisma.studentDocument.findMany({ where: { id: { in: uniqueDocumentIds } } });
    const docById = new Map(docs.map((d) => [d.id, d]));
    const studentIds = [...new Set(docs.map((d) => d.studentId))];
    const students = studentIds.length ? await prisma.user.findMany({ where: { id: { in: studentIds } } }) : [];
    const studentById = new Map(students.map((s) => [s.id, s]));

    const validEntries = [];
    let skipped = 0;
    for (const documentId of uniqueDocumentIds) {
      const doc = docById.get(documentId);
      const student = doc && studentById.get(doc.studentId);
      if (!doc || !student || student.role !== "STUDENT" || (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId)) {
        skipped++;
        continue;
      }
      validEntries.push({ doc, student });
    }

    if (validEntries.length) {
      const trimmedReason = status !== "VERIFIED" ? reason.trim() : null;
      // Every valid document in this batch gets the identical status/reason, so the write is one
      // updateMany instead of N individual updates.
      await prisma.studentDocument.updateMany({
        where: { id: { in: validEntries.map((v) => v.doc.id) } },
        data: { verificationStatus: status, verifiedByUserId: req.user.id, verifiedByName: req.user.name, verifiedAt: new Date(), rejectionReason: trimmedReason },
      });

      // Audit + notify still run per-document (traceability needs one audit row per document, and
      // notifyDocumentVerification is per-student), but chunked rather than fully sequential —
      // each notify fires 2 concurrent ops (in-app + email), so an unbounded burst across a whole
      // class would mean dozens of simultaneous writes/sends from this one 0.1vCPU instance.
      const NOTIFY_BATCH_SIZE = 15;
      for (let i = 0; i < validEntries.length; i += NOTIFY_BATCH_SIZE) {
        const batch = validEntries.slice(i, i + NOTIFY_BATCH_SIZE);
        await Promise.all(batch.map(async ({ doc, student }) => {
          await logAudit({
            req, action: AUDIT_ACTIONS.DOCUMENT_VERIFIED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
            studentId: doc.studentId, instituteId: student.instituteId,
            details: {
              documentId: doc.id, documentType: doc.documentType, documentLabel: doc.label,
              studentName: student.name, registrationNumber: student.registrationNumber,
              previousStatus: doc.verificationStatus, status, reason: trimmedReason, bulk: true,
            },
          });
          await notifyDocumentVerification(prisma, student, { document: doc, status, verifierName: req.user.name, reason: trimmedReason });
        }));
      }
    }

    res.json({ verifiedCount: validEntries.length, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to bulk verify documents" });
  }
});

// ADMIN-only: remove a document regardless of verification status — the student-side DELETE above
// is deliberately locked once a document is VERIFIED, but Admin retains an override to remove one
// (e.g. it was verified against the wrong file, or is no longer needed). Separate path from the
// student route above so this never collides with (or accidentally widens) that STUDENT-only
// handler. STAFF and CLERK are both deliberately excluded — their document responsibilities are
// view/download/verify/remarks, never irreversible deletion (see the Document Verification
// permission review).
router.delete("/:id/admin", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
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

// ADMIN/STAFF/CLERK: download a verified document straight into the browser's Downloads folder
// instead of opening the provider's viewer page. This platform stores only a shareable link (no
// in-house file storage — see documentLink), so this proxies the actual file content from that
// link through our own server with a Content-Disposition: attachment header; the response is
// whatever the source file really is (usually already a PDF for placement documents) — it is
// never relabeled to .pdf if the source is something else, since that would corrupt the download.
router.get("/:id/download", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const doc = await prisma.studentDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const student = await authorizeStudentAccess(req, res, doc.studentId);
    if (!student) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let upstream;
    try {
      upstream = await fetchExternalUrl(directDownloadUrl(doc.documentLink), { signal: controller.signal });
    } catch (fetchErr) {
      return res.status(502).json({ error: fetchErr.message || "Could not fetch the document from its source link" });
    } finally {
      clearTimeout(timeout);
    }
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: "Could not fetch the document from its source link" });
    }

    const typeLabel = DOCUMENT_TYPES.find((t) => t.value === doc.documentType)?.label || doc.documentType;
    const baseName = `${typeLabel}${doc.label ? `-${doc.label}` : ""}`.replace(/[^a-z0-9-_ ]/gi, "").trim() || "document";
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const ext = contentType.includes("pdf") ? ".pdf" : contentType.includes("png") ? ".png" : /jpe?g/.test(contentType) ? ".jpg" : "";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}${ext}"`);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to download document" });
  }
});

module.exports = router;
